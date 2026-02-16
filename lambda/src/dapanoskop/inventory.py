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


def _find_latest_manifest(s3_client: Any, bucket: str, prefix: str) -> str | None:
    """Find the most recent inventory manifest under the given prefix.

    S3 Inventory delivers manifests at:
    {prefix}/YYYY-MM-DDT00-00Z/manifest.json

    Returns the full S3 key of the latest manifest, or None if not found.
    """
    paginator = s3_client.get_paginator("list_objects_v2")
    date_prefixes: list[str] = []

    search_prefix = prefix.rstrip("/") + "/"

    for page in paginator.paginate(Bucket=bucket, Prefix=search_prefix, Delimiter="/"):
        for cp in page.get("CommonPrefixes", []):
            date_prefixes.append(cp["Prefix"])

    if not date_prefixes:
        logger.warning(
            "No inventory date folders found under s3://%s/%s", bucket, prefix
        )
        return None

    # Date format (YYYY-MM-DDT00-00Z) sorts lexicographically
    date_prefixes.sort(reverse=True)
    return f"{date_prefixes[0]}manifest.json"


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


def _sum_sizes_csv(
    s3_client: Any,
    dest_bucket: str,
    manifest: dict[str, Any],
) -> int:
    """Sum the Size column from CSV inventory data files."""
    file_schema = manifest.get("fileSchema", "")
    columns = [c.strip() for c in file_schema.split(",")]

    if "Size" not in columns:
        logger.error("Inventory schema missing 'Size' column: %s", columns)
        return 0

    size_idx = columns.index("Size")
    total_bytes = 0

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
                    except (ValueError, IndexError):
                        continue

    return total_bytes


def _sum_sizes_parquet(
    s3_client: Any,
    dest_bucket: str,
    manifest: dict[str, Any],
) -> int:
    """Sum the Size column from Parquet inventory data files."""
    import pyarrow.compute as pc
    import pyarrow.parquet as pq

    total_bytes = 0

    for file_info in manifest.get("files", []):
        key = file_info["key"]
        logger.info("Reading inventory file: %s", key)

        response = s3_client.get_object(Bucket=dest_bucket, Key=key)
        body = response["Body"].read()

        table = pq.read_table(io.BytesIO(body), columns=["Size"])
        total_bytes += pc.sum(table.column("Size")).as_py()

    return total_bytes


def get_inventory_total_bytes(bucket: str, prefix: str) -> int | None:
    """Read S3 Inventory data and return total bytes stored.

    Args:
        bucket: S3 bucket containing inventory delivery
        prefix: Prefix path to the inventory config
                (e.g., "inventory/source-bucket/AllObjects")

    Returns:
        Total bytes across all objects in the inventory, or None if unavailable.
    """
    if not bucket or not prefix:
        return None

    s3 = boto3.client("s3")

    manifest_key = _find_latest_manifest(s3, bucket, prefix)
    if not manifest_key:
        return None

    logger.info("Using inventory manifest: s3://%s/%s", bucket, manifest_key)
    manifest = _read_manifest(s3, bucket, manifest_key)
    dest_bucket = _resolve_dest_bucket(manifest)

    file_format = manifest.get("fileFormat", "")
    if file_format == "CSV":
        return _sum_sizes_csv(s3, dest_bucket, manifest)
    elif file_format == "Parquet":
        return _sum_sizes_parquet(s3, dest_bucket, manifest)
    else:
        logger.warning("Unsupported inventory format: %s", file_format)
        return None
