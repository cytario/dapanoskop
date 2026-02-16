"""S3 Storage Lens metrics reader for total storage volume.

Queries CloudWatch metrics published by S3 Storage Lens to retrieve org-wide
storage volume and object count. Requires an org-wide Storage Lens configuration
with CloudWatch metrics export enabled.
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta
from typing import Any

import boto3
from botocore.exceptions import ClientError

logger = logging.getLogger(__name__)


def _get_org_config_with_export(
    s3control: Any, account_id: str, config_id: str = ""
) -> dict[str, Any] | None:
    """Find org-wide Storage Lens configuration with CloudWatch metrics.

    Args:
        s3control: boto3 s3control client
        account_id: AWS account ID
        config_id: Optional specific config ID to use (auto-discovers if empty)

    Returns:
        Dict with config_id, org_id, home_region, or None if not found
    """
    try:
        response = s3control.list_storage_lens_configurations(AccountId=account_id)
    except ClientError as e:
        logger.error("Failed to list Storage Lens configurations: %s", e)
        return None

    if not response.get("StorageLensConfigurationList"):
        logger.warning("No Storage Lens configurations found")
        return None

    configs = response["StorageLensConfigurationList"]

    # If specific config requested, filter to that one
    if config_id:
        configs = [c for c in configs if c["Id"] == config_id]
        if not configs:
            logger.warning("Requested config %s not found", config_id)
            return None

    for config_summary in configs:
        cfg_id = config_summary["Id"]
        home_region = config_summary.get("StorageLensArn", "").split(":")[3]
        logger.debug("Checking configuration: %s", cfg_id)

        try:
            config_response = s3control.get_storage_lens_configuration(
                ConfigId=cfg_id, AccountId=account_id
            )
        except ClientError as e:
            logger.warning("Failed to get config %s: %s", cfg_id, e)
            continue

        config = config_response["StorageLensConfiguration"]

        # Check if this is an org-wide configuration
        if "AwsOrg" not in config:
            logger.debug("Skipping %s: not org-wide configuration", cfg_id)
            continue

        org_arn = config["AwsOrg"]["Arn"]
        org_id = org_arn.split("/")[-1]
        logger.info("Found org-wide configuration: %s (Org: %s)", cfg_id, org_id)

        # Check if CloudWatch metrics are enabled
        data_export = config.get("DataExport")
        if not data_export:
            logger.warning("Configuration %s has no data export", cfg_id)
            continue

        cloudwatch_metrics = data_export.get("CloudWatchMetrics")
        if not cloudwatch_metrics or not cloudwatch_metrics.get("IsEnabled"):
            logger.warning("Configuration %s has no CloudWatch metrics enabled", cfg_id)
            continue

        logger.info("CloudWatch metrics enabled for %s", cfg_id)

        return {
            "config_id": cfg_id,
            "org_id": org_id,
            "home_region": home_region,
        }

    return None


def _list_storage_lens_metrics(
    cloudwatch: Any, org_id: str, metric_name: str
) -> list[dict[str, Any]]:
    """List all Storage Lens metrics for the org across all dimensions.

    Returns list of metric specifications with all their dimensions.
    """
    metrics: list[dict[str, Any]] = []
    paginator = cloudwatch.get_paginator("list_metrics")

    try:
        for page in paginator.paginate(
            Namespace="AWS/S3/Storage-Lens",
            MetricName=metric_name,
            Dimensions=[
                {"Name": "organization_id", "Value": org_id},
                {"Name": "record_type", "Value": "ORGANIZATION"},
            ],
        ):
            metrics.extend(page["Metrics"])
    except ClientError as e:
        logger.error("Failed to list metrics for %s: %s", metric_name, e)
        return []

    logger.debug("Found %d metric combinations for %s", len(metrics), metric_name)
    return metrics


def _build_metric_stat_queries(
    cloudwatch: Any,
    org_id: str,
    metric_names: list[str],
) -> list[dict[str, Any]]:
    """Build CloudWatch metric data queries using MetricStat.

    Lists all metric combinations and creates queries for each.
    """
    queries: list[dict[str, Any]] = []
    query_id = 0

    for metric_name in metric_names:
        # List all metric combinations for this metric
        metrics = _list_storage_lens_metrics(cloudwatch, org_id, metric_name)

        if not metrics:
            logger.warning("No metrics found for %s", metric_name)
            continue

        # Create a query for each metric combination
        for metric in metrics:
            queries.append(
                {
                    "Id": f"m{query_id}",
                    "MetricStat": {
                        "Metric": metric,
                        "Period": 86400,  # 1 day
                        "Stat": "Average",  # Use Average for gauge metrics
                    },
                    "Label": metric_name,
                }
            )
            query_id += 1

    logger.info("Created %d metric queries", len(queries))
    return queries


def _convert_metric_data_to_datapoints(
    metric_results: list[dict[str, Any]],
) -> dict[str, list[dict[str, Any]]]:
    """Convert get_metric_data results to datapoint format.

    Aggregates multiple metric results with the same label by summing
    their values (for metrics split across storage classes/regions).
    """
    # Group by metric name and timestamp
    aggregated: dict[str, dict[str, dict[str, Any]]] = {}

    for metric_result in metric_results:
        metric_name = metric_result["Label"]

        if metric_name not in aggregated:
            aggregated[metric_name] = {}

        for timestamp, value in zip(
            metric_result["Timestamps"], metric_result["Values"]
        ):
            timestamp_key = timestamp.isoformat()
            if timestamp_key not in aggregated[metric_name]:
                aggregated[metric_name][timestamp_key] = {
                    "Timestamp": timestamp,
                    "Value": 0,
                }
            # Sum the average values across all dimension combinations
            aggregated[metric_name][timestamp_key]["Value"] += value

    # Convert to final format
    results: dict[str, list[dict[str, Any]]] = {}
    for metric_name, timestamps in aggregated.items():
        datapoints = sorted(timestamps.values(), key=lambda x: x["Timestamp"])
        results[metric_name] = datapoints
        logger.info("Retrieved %d datapoints for %s", len(datapoints), metric_name)

    return results


def get_storage_lens_metrics(
    config_id: str = "",
    metric_names: list[str] | None = None,
    start_time: datetime | None = None,
    end_time: datetime | None = None,
) -> dict[str, Any] | None:
    """Query CloudWatch metrics for S3 Storage Lens.

    Discovers the org-wide Storage Lens configuration with CloudWatch metrics
    enabled and queries for storage metrics.

    Args:
        config_id: Optional specific Storage Lens config ID (auto-discovers if empty)
        metric_names: List of metric names to query (defaults to StorageBytes, ObjectCount)
        start_time: Start datetime for metrics (defaults to 7 days ago)
        end_time: End datetime for metrics (defaults to now)

    Returns:
        Dict with total_bytes, object_count, timestamp, config_id, org_id.
        Returns None if no suitable configuration found or metrics unavailable.
    """
    # Get AWS account ID
    try:
        sts = boto3.client("sts")
        account_id = sts.get_caller_identity()["Account"]
    except ClientError as e:
        logger.error("Failed to get AWS account ID: %s", e)
        return None

    # Find Storage Lens configuration
    s3control = boto3.client("s3control")
    config = _get_org_config_with_export(s3control, account_id, config_id)

    if not config:
        logger.warning(
            "No suitable org-wide Storage Lens configuration found with CloudWatch metrics"
        )
        return None

    # Set up CloudWatch client in home region
    cloudwatch = boto3.client("cloudwatch", region_name=config["home_region"])

    # Default to common useful metrics
    if metric_names is None:
        metric_names = ["StorageBytes", "ObjectCount"]

    # Default time range: last 7 days
    if end_time is None:
        end_time = datetime.now()
    if start_time is None:
        start_time = end_time - timedelta(days=7)

    # Build metric data queries
    metric_data_queries = _build_metric_stat_queries(
        cloudwatch, config["org_id"], metric_names
    )

    if not metric_data_queries:
        logger.warning("No metric queries built for %s", metric_names)
        return None

    # Query CloudWatch
    try:
        response = cloudwatch.get_metric_data(
            MetricDataQueries=metric_data_queries,
            StartTime=start_time,
            EndTime=end_time,
        )
    except ClientError as e:
        logger.error("Failed to query CloudWatch metrics: %s", e)
        return None

    # Convert to datapoint format
    results = _convert_metric_data_to_datapoints(response["MetricDataResults"])

    # Extract latest values
    total_bytes = 0
    object_count = 0
    timestamp = None

    if "StorageBytes" in results and results["StorageBytes"]:
        latest = results["StorageBytes"][-1]
        total_bytes = int(latest["Value"])
        timestamp = latest["Timestamp"]

    if "ObjectCount" in results and results["ObjectCount"]:
        latest = results["ObjectCount"][-1]
        object_count = int(latest["Value"])
        if timestamp is None:
            timestamp = latest["Timestamp"]

    if timestamp is None:
        logger.warning("No datapoints available for Storage Lens metrics")
        return None

    logger.info(
        "Storage Lens metrics: %d bytes, %d objects (timestamp: %s)",
        total_bytes,
        object_count,
        timestamp,
    )

    return {
        "total_bytes": total_bytes,
        "object_count": object_count,
        "timestamp": timestamp.isoformat(),
        "config_id": config["config_id"],
        "org_id": config["org_id"],
    }
