"""Tests for S3 Inventory reader."""

from __future__ import annotations

import csv
import gzip
import io
import json

import boto3
from moto import mock_aws

from dapanoskop.inventory import get_inventory_total_bytes


def _create_inventory_csv(rows: list[list[str]]) -> bytes:
    """Create a gzipped CSV file from rows."""
    buf = io.StringIO()
    writer = csv.writer(buf)
    for row in rows:
        writer.writerow(row)
    compressed = io.BytesIO()
    with gzip.open(compressed, "wt") as f:
        f.write(buf.getvalue())
    return compressed.getvalue()


def _setup_inventory(
    s3_client: object,
    bucket: str,
    prefix: str,
    date_folder: str,
    schema: str,
    csv_rows: list[list[str]],
) -> None:
    """Set up a mock S3 inventory with manifest and data file."""
    s3_client.create_bucket(
        Bucket=bucket,
        CreateBucketConfiguration={"LocationConstraint": "eu-west-1"},
    )

    data_key = f"{prefix}/{date_folder}/data/part-0.csv.gz"
    s3_client.put_object(
        Bucket=bucket,
        Key=data_key,
        Body=_create_inventory_csv(csv_rows),
    )

    manifest = {
        "sourceBucket": "source-bucket",
        "destinationBucket": f"arn:aws:s3:::{bucket}",
        "fileFormat": "CSV",
        "fileSchema": schema,
        "files": [{"key": data_key, "size": 100, "MD5checksum": "abc123"}],
    }

    manifest_key = f"{prefix}/{date_folder}/manifest.json"
    s3_client.put_object(
        Bucket=bucket,
        Key=manifest_key,
        Body=json.dumps(manifest).encode(),
    )


@mock_aws
def test_inventory_total_bytes() -> None:
    """Test reading inventory and summing object sizes."""
    s3 = boto3.client("s3", region_name="eu-west-1")
    bucket = "inventory-dest"
    prefix = "inventory/source-bucket/AllObjects"

    # Schema: Bucket, Key, Size, StorageClass
    schema = "Bucket, Key, Size, StorageClass"
    rows = [
        ["source-bucket", "file1.txt", "1000", "STANDARD"],
        ["source-bucket", "file2.txt", "2000", "STANDARD_IA"],
        ["source-bucket", "dir/file3.txt", "3000", "GLACIER"],
    ]

    _setup_inventory(s3, bucket, prefix, "2026-02-15T00-00Z", schema, rows)

    result = get_inventory_total_bytes(bucket, prefix)
    assert result == 6000


@mock_aws
def test_inventory_latest_manifest() -> None:
    """Test that the latest date folder is selected."""
    s3 = boto3.client("s3", region_name="eu-west-1")
    bucket = "inventory-dest"
    prefix = "inventory/source-bucket/AllObjects"
    schema = "Bucket, Key, Size"

    # Create two date folders — older with 100 bytes, newer with 999 bytes
    _setup_inventory(
        s3,
        bucket,
        prefix,
        "2026-02-01T00-00Z",
        schema,
        [["b", "old.txt", "100"]],
    )

    # Create newer manifest with different data
    data_key = f"{prefix}/2026-02-15T00-00Z/data/part-0.csv.gz"
    s3.put_object(
        Bucket=bucket,
        Key=data_key,
        Body=_create_inventory_csv([["b", "new.txt", "999"]]),
    )
    manifest = {
        "sourceBucket": "source-bucket",
        "destinationBucket": f"arn:aws:s3:::{bucket}",
        "fileFormat": "CSV",
        "fileSchema": schema,
        "files": [{"key": data_key, "size": 50, "MD5checksum": "def456"}],
    }
    s3.put_object(
        Bucket=bucket,
        Key=f"{prefix}/2026-02-15T00-00Z/manifest.json",
        Body=json.dumps(manifest).encode(),
    )

    result = get_inventory_total_bytes(bucket, prefix)
    assert result == 999


@mock_aws
def test_inventory_no_manifest() -> None:
    """Test graceful handling when no inventory exists."""
    s3 = boto3.client("s3", region_name="eu-west-1")
    bucket = "inventory-dest"
    s3.create_bucket(
        Bucket=bucket,
        CreateBucketConfiguration={"LocationConstraint": "eu-west-1"},
    )

    result = get_inventory_total_bytes(bucket, "inventory/nonexistent/config")
    assert result is None


def test_inventory_disabled() -> None:
    """Test that empty bucket/prefix returns None without AWS calls."""
    assert get_inventory_total_bytes("", "") is None
    assert get_inventory_total_bytes("bucket", "") is None
    assert get_inventory_total_bytes("", "prefix") is None


@mock_aws
def test_inventory_missing_size_column() -> None:
    """Test handling of inventory schema without Size column."""
    s3 = boto3.client("s3", region_name="eu-west-1")
    bucket = "inventory-dest"
    prefix = "inventory/source-bucket/AllObjects"

    # Schema without Size column
    schema = "Bucket, Key, StorageClass"
    rows = [["source-bucket", "file1.txt", "STANDARD"]]

    _setup_inventory(s3, bucket, prefix, "2026-02-15T00-00Z", schema, rows)

    result = get_inventory_total_bytes(bucket, prefix)
    assert result == 0
