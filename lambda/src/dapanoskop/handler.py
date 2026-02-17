"""AWS Lambda entry point for Dapanoskop data pipeline."""

from __future__ import annotations

import json
import logging
import os
from datetime import datetime, timezone
from typing import Any

import boto3

from dapanoskop.collector import collect
from dapanoskop.processor import process, update_index, write_to_s3
from dapanoskop.storage_lens import get_storage_lens_metrics

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)


def _enrich_with_storage_lens(
    processed: dict[str, Any], storage_lens_config_id: str
) -> None:
    """Add S3 Storage Lens data to the processed summary (in-place)."""
    logger.info(
        "Querying S3 Storage Lens metrics (config_id=%s)",
        storage_lens_config_id or "auto-discover",
    )
    try:
        metrics = get_storage_lens_metrics(config_id=storage_lens_config_id)
        if metrics is not None:
            # Add to storage_metrics
            processed["summary"]["storage_metrics"]["storage_lens_total_bytes"] = (
                metrics["total_bytes"]
            )

            # Add storage_lens object to summary
            processed["summary"]["storage_lens"] = {
                "total_bytes": metrics["total_bytes"],
                "object_count": metrics["object_count"],
                "timestamp": metrics["timestamp"],
                "config_id": metrics["config_id"],
                "org_id": metrics["org_id"],
            }
            logger.info(
                "Storage Lens: %d bytes, %d objects (config: %s)",
                metrics["total_bytes"],
                metrics["object_count"],
                metrics["config_id"],
            )
    except Exception:
        logger.warning(
            "Failed to read S3 Storage Lens metrics, skipping", exc_info=True
        )


def _sanitize_error_message(error_msg: str) -> str:
    """Sanitize error messages to prevent AWS account ID leakage.

    Replaces 12-digit AWS account IDs with REDACTED.
    """
    import re

    # Replace 12-digit account IDs (commonly found in ARNs)
    return re.sub(r"\b\d{12}\b", "REDACTED", error_msg)


def _month_exists_in_s3(s3_client: Any, bucket: str, year: int, month: int) -> bool:
    """Check if data already exists for a given month in S3."""
    period = f"{year:04d}-{month:02d}"
    prefix = f"{period}/"
    try:
        response = s3_client.list_objects_v2(Bucket=bucket, Prefix=prefix, MaxKeys=1)
        return "Contents" in response and len(response["Contents"]) > 0
    except Exception:
        return False


def _generate_backfill_months(months: int) -> list[tuple[int, int]]:
    """Generate list of (year, month) tuples for backfill.

    Returns months from current month back N months, in reverse chronological order.
    """
    now = datetime.now(timezone.utc)
    result: list[tuple[int, int]] = []
    year, month = now.year, now.month

    for _ in range(months):
        # Move to previous month
        if month == 1:
            month = 12
            year -= 1
        else:
            month -= 1
        result.append((year, month))

    return result


def _handle_backfill(
    bucket: str,
    cost_category_name: str,
    include_efs: bool,
    include_ebs: bool,
    months: int,
    force: bool,
    storage_lens_config_id: str = "",
) -> dict[str, Any]:
    """Handle backfill mode: process multiple historical months."""
    logger.info("Starting backfill for %d months (force=%s)", months, force)

    s3 = boto3.client("s3")
    backfill_months = _generate_backfill_months(months)

    succeeded: list[str] = []
    failed: list[dict[str, Any]] = []
    skipped: list[str] = []

    for year, month in backfill_months:
        period_label = f"{year:04d}-{month:02d}"
        try:
            # Check if already exists (unless force=True)
            if not force and _month_exists_in_s3(s3, bucket, year, month):
                logger.info("Skipping %s (already exists)", period_label)
                skipped.append(period_label)
                continue

            logger.info("Collecting data for %s", period_label)
            collected = collect(
                cost_category_name=cost_category_name,
                target_year=year,
                target_month=month,
            )

            logger.info("Processing data for %s", period_label)
            processed = process(
                collected, include_efs=include_efs, include_ebs=include_ebs
            )

            # Enrich with S3 Storage Lens data if configured
            if storage_lens_config_id is not None:
                _enrich_with_storage_lens(processed, storage_lens_config_id)

            logger.info("Writing to S3 for %s", period_label)
            write_to_s3(processed, bucket, update_index_file=False)

            succeeded.append(period_label)
            logger.info("Completed %s", period_label)

        except Exception as e:
            error_str = str(e)
            # Check if this is a "no data available" error from Cost Explorer
            # CE returns DataUnavailableException or similar errors for months without data
            is_no_data_error = (
                "DataUnavailableException" in error_str
                or "No data available" in error_str
            )

            if is_no_data_error:
                logger.info(
                    "Skipping %s (no data available in Cost Explorer)", period_label
                )
                skipped.append(period_label)
            else:
                logger.exception("Failed to process %s", period_label)
                failed.append(
                    {
                        "period": period_label,
                        "error": _sanitize_error_message(error_str),
                    }
                )

    # Update index once at the end (always, even if some months failed)
    logger.info("Updating index.json")
    try:
        update_index(bucket)
    except Exception:
        logger.exception("Failed to update index.json")
        # Don't fail the entire backfill if index update fails

    logger.info(
        "Backfill complete: %d succeeded, %d failed, %d skipped",
        len(succeeded),
        len(failed),
        len(skipped),
    )

    return {
        "statusCode": 200
        if not failed
        else 207,  # 207 Multi-Status for partial success
        "body": json.dumps(
            {
                "message": "backfill_complete",
                "succeeded": succeeded,
                "failed": failed,
                "skipped": skipped,
            }
        ),
    }


def handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    """Lambda handler for cost data collection and processing.

    Event payload:
        backfill (bool): Enable backfill mode (default: False)
        months (int): Number of months to backfill (default: 13)
        force (bool): Force re-process existing months (default: False)
    """
    bucket = os.environ.get("DATA_BUCKET")
    if not bucket:
        raise ValueError("DATA_BUCKET environment variable is required")

    cost_category_name = os.environ.get("COST_CATEGORY_NAME", "")
    include_efs = os.environ.get("INCLUDE_EFS", "false").lower() == "true"
    include_ebs = os.environ.get("INCLUDE_EBS", "false").lower() == "true"
    storage_lens_config_id = os.environ.get("STORAGE_LENS_CONFIG_ID", "")

    # Check for backfill mode
    backfill = event.get("backfill", False)
    if backfill:
        months = event.get("months", 13)
        force = event.get("force", False)
        return _handle_backfill(
            bucket,
            cost_category_name,
            include_efs,
            include_ebs,
            months,
            force,
            storage_lens_config_id,
        )

    # Normal mode: process current month
    try:
        logger.info("Starting data collection (bucket=%s)", bucket)
        collected = collect(cost_category_name=cost_category_name)

        logger.info("Processing collected data")
        processed = process(collected, include_efs=include_efs, include_ebs=include_ebs)

        # Enrich with S3 Storage Lens data if configured
        if storage_lens_config_id is not None:
            _enrich_with_storage_lens(processed, storage_lens_config_id)

        logger.info("Writing to S3")
        write_to_s3(processed, bucket)

        period = processed["summary"]["period"]
        logger.info("Pipeline completed for period %s", period)
        return {
            "statusCode": 200,
            "body": json.dumps({"message": "ok", "period": period}),
        }
    except Exception:
        logger.exception("Pipeline failed")
        raise
