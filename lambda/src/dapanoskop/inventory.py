"""S3 Inventory data reader for total storage volume."""

from __future__ import annotations

import csv
import gzip
import io
import json
import logging
from typing import Any

import boto3

logger = logging.getLogger(__name__)

_DATE_FOLDER_LEN = len("YYYY-MM-DDT00-00Z")


def _list_prefixes(s3_client: Any, bucket: str, prefix: str) -> list[str]:
    """List immediate sub-prefixes under a prefix."""
    paginator = s3_client.get_paginator("list_objects_v2")
    prefixes: list[str] = []
    search = prefix.rstrip("/") + "/"
    for page in paginator.paginate(Bucket=bucket, Prefix=search, Delimiter="/"):
        for cp in page.get("CommonPrefixes", []):
            prefixes.append(cp["Prefix"])
    return prefixes


def _is_date_folder(prefix: str) -> bool:
    """Check if a prefix looks like an inventory date folder (YYYY-MM-DDT00-00Z/)."""
    name = prefix.rstrip("/").rsplit("/", 1)[-1]
    return len(name) >= _DATE_FOLDER_LEN and name[4] == "-" and "T" in name


def _find_latest_manifest(s3_client: Any, bucket: str, prefix: str) -> str | None:
    """Find the most recent inventory manifest under a config prefix.

    Expects date-stamped folders: {prefix}/YYYY-MM-DDT00-00Z/manifest.json
    """
    date_prefixes = [
        p for p in _list_prefixes(s3_client, bucket, prefix) if _is_date_folder(p)
    ]
    if not date_prefixes:
        return None
    date_prefixes.sort(reverse=True)
    return f"{date_prefixes[0]}manifest.json"


def _discover_configs(s3_client: Any, bucket: str, prefix: str) -> list[str]:
    """Discover inventory config paths under a prefix.

    S3 Inventory delivers to: {prefix}/{source-bucket}/{config-name}/
    This function walks up to 2 levels to find configs with date folders.
    If the prefix itself has date folders, returns [prefix].
    """
    # Check if the prefix itself is a config (has date folders)
    children = _list_prefixes(s3_client, bucket, prefix)
    if any(_is_date_folder(c) for c in children):
        return [prefix]

    # Walk one level: {prefix}/{source-bucket}/
    configs: list[str] = []
    for child in children:
        grandchildren = _list_prefixes(s3_client, bucket, child)
        if any(_is_date_folder(gc) for gc in grandchildren):
            # This child is a config
            configs.append(child.rstrip("/"))
        else:
            # Walk one more level: {prefix}/{source-bucket}/{config-name}/
            for gc in grandchildren:
                gc_children = _list_prefixes(s3_client, bucket, gc)
                if any(_is_date_folder(gcc) for gcc in gc_children):
                    configs.append(gc.rstrip("/"))

    return configs


def _read_manifest(s3_client: Any, bucket: str, key: str) -> dict[str, Any]:
    """Download and parse an S3 inventory manifest."""
    response = s3_client.get_object(Bucket=bucket, Key=key)
    return json.loads(response["Body"].read().decode("utf-8"))


def _resolve_dest_bucket(manifest: dict[str, Any]) -> str:
    """Extract the destination bucket name from a manifest."""
    dest = manifest.get("destinationBucket", "")
    if dest.startswith("arn:aws:s3:::"):
        return dest.split(":")[-1]
    return dest


def _aggregate_csv(
    s3_client: Any,
    dest_bucket: str,
    manifest: dict[str, Any],
) -> tuple[int, int]:
    """Sum Size and count objects from CSV inventory data files.

    Returns (total_bytes, object_count).
    """
    file_schema = manifest.get("fileSchema", "")
    columns = [c.strip() for c in file_schema.split(",")]

    if "Size" not in columns:
        logger.error("Inventory schema missing 'Size' column: %s", columns)
        return 0, 0

    size_idx = columns.index("Size")
    total_bytes = 0
    object_count = 0

    for file_info in manifest.get("files", []):
        key = file_info["key"]
        logger.info("Reading inventory file: %s", key)

        response = s3_client.get_object(Bucket=dest_bucket, Key=key)
        body = response["Body"].read()

        with gzip.open(io.BytesIO(body), "rt") as f:
            reader = csv.reader(f)
            for row in reader:
                if len(row) > size_idx:
                    try:
                        total_bytes += int(row[size_idx])
                        object_count += 1
                    except (ValueError, IndexError):
                        continue

    return total_bytes, object_count


def _aggregate_parquet(
    s3_client: Any,
    dest_bucket: str,
    manifest: dict[str, Any],
) -> tuple[int, int]:
    """Sum Size and count objects from Parquet inventory data files.

    Returns (total_bytes, object_count).
    """
    import pyarrow.compute as pc
    import pyarrow.parquet as pq

    total_bytes = 0
    object_count = 0

    for file_info in manifest.get("files", []):
        key = file_info["key"]
        logger.info("Reading inventory file: %s", key)

        response = s3_client.get_object(Bucket=dest_bucket, Key=key)
        body = response["Body"].read()

        table = pq.read_table(io.BytesIO(body), columns=["Size"])
        total_bytes += pc.sum(table.column("Size")).as_py()
        object_count += len(table)

    return total_bytes, object_count


def _read_config_inventory(
    s3_client: Any, bucket: str, config_prefix: str
) -> dict[str, Any] | None:
    """Read inventory for a single config and return summary.

    Returns dict with source_bucket, total_bytes, object_count, or None.
    """
    manifest_key = _find_latest_manifest(s3_client, bucket, config_prefix)
    if not manifest_key:
        return None

    manifest = _read_manifest(s3_client, bucket, manifest_key)
    dest_bucket = _resolve_dest_bucket(manifest)
    source_bucket = manifest.get("sourceBucket", "unknown")

    file_format = manifest.get("fileFormat", "")
    if file_format == "CSV":
        total_bytes, object_count = _aggregate_csv(s3_client, dest_bucket, manifest)
    elif file_format == "Parquet":
        total_bytes, object_count = _aggregate_parquet(s3_client, dest_bucket, manifest)
    else:
        logger.warning("Unsupported inventory format: %s", file_format)
        return None

    return {
        "source_bucket": source_bucket,
        "total_bytes": total_bytes,
        "object_count": object_count,
    }


def get_inventory_total_bytes(bucket: str, prefix: str) -> int | None:
    """Read S3 Inventory data and return total bytes stored.

    Discovers all inventory configs under the prefix and sums across all.

    Args:
        bucket: S3 bucket containing inventory delivery
        prefix: Prefix path — either a specific config or a root containing
                multiple configs (e.g., "inventory/" or
                "inventory/source-bucket/AllObjects")

    Returns:
        Total bytes across all objects in all inventories, or None if unavailable.
    """
    if not bucket or not prefix:
        return None

    s3 = boto3.client("s3")
    configs = _discover_configs(s3, bucket, prefix)

    if not configs:
        logger.warning("No inventory configs found under s3://%s/%s", bucket, prefix)
        return None

    total = 0
    for config_prefix in configs:
        result = _read_config_inventory(s3, bucket, config_prefix)
        if result:
            total += result["total_bytes"]

    return total if total > 0 else None


def get_inventory_bucket_summary(
    bucket: str, prefix: str
) -> list[dict[str, Any]] | None:
    """Read S3 Inventory data and return per-source-bucket breakdown.

    Discovers all inventory configs under the prefix and aggregates
    per source bucket.

    Args:
        bucket: S3 bucket containing inventory delivery
        prefix: Prefix path — either a specific config or a root containing
                multiple configs

    Returns:
        List of dicts with source_bucket, total_bytes, object_count.
        Sorted by total_bytes descending. None if unavailable.
    """
    if not bucket or not prefix:
        return None

    s3 = boto3.client("s3")
    configs = _discover_configs(s3, bucket, prefix)

    if not configs:
        logger.warning("No inventory configs found under s3://%s/%s", bucket, prefix)
        return None

    # Aggregate per source bucket (in case multiple configs per bucket)
    by_bucket: dict[str, dict[str, int]] = {}
    for config_prefix in configs:
        result = _read_config_inventory(s3, bucket, config_prefix)
        if not result:
            continue
        name = result["source_bucket"]
        if name not in by_bucket:
            by_bucket[name] = {"total_bytes": 0, "object_count": 0}
        by_bucket[name]["total_bytes"] += result["total_bytes"]
        by_bucket[name]["object_count"] += result["object_count"]

    if not by_bucket:
        return None

    buckets = [
        {
            "source_bucket": name,
            "total_bytes": data["total_bytes"],
            "object_count": data["object_count"],
        }
        for name, data in by_bucket.items()
    ]
    buckets.sort(key=lambda b: b["total_bytes"], reverse=True)
    return buckets
