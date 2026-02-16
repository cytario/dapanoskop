"""Tests for S3 Inventory reader."""

from __future__ import annotations

import csv
import gzip
import io
import json

import boto3
from moto import mock_aws

from dapanoskop.inventory import get_inventory_bucket_summary, get_inventory_total_bytes


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
    source_bucket: str = "source-bucket",
    create_bucket: bool = True,
) -> None:
    """Set up a mock S3 inventory with manifest and data file."""
    if create_bucket:
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
        "sourceBucket": source_bucket,
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
    assert get_inventory_bucket_summary("", "") is None


@mock_aws
def test_inventory_missing_size_column() -> None:
    """Test handling of inventory schema without Size column."""
    s3 = boto3.client("s3", region_name="eu-west-1")
    bucket = "inventory-dest"
    prefix = "inventory/source-bucket/AllObjects"

    schema = "Bucket, Key, StorageClass"
    rows = [["source-bucket", "file1.txt", "STANDARD"]]

    _setup_inventory(s3, bucket, prefix, "2026-02-15T00-00Z", schema, rows)

    result = get_inventory_total_bytes(bucket, prefix)
    assert result is None  # No Size column means 0 bytes total → returns None


@mock_aws
def test_bucket_summary_single_config() -> None:
    """Test bucket summary with a single inventory config."""
    s3 = boto3.client("s3", region_name="eu-west-1")
    bucket = "inventory-dest"
    prefix = "inventory/my-bucket/AllObjects"

    schema = "Bucket, Key, Size"
    rows = [
        ["my-bucket", "file1.txt", "5000"],
        ["my-bucket", "file2.txt", "3000"],
    ]

    _setup_inventory(
        s3,
        bucket,
        prefix,
        "2026-02-15T00-00Z",
        schema,
        rows,
        source_bucket="my-bucket",
    )

    result = get_inventory_bucket_summary(bucket, prefix)
    assert result is not None
    assert len(result) == 1
    assert result[0]["source_bucket"] == "my-bucket"
    assert result[0]["total_bytes"] == 8000
    assert result[0]["object_count"] == 2


@mock_aws
def test_bucket_summary_multi_bucket() -> None:
    """Test bucket summary discovering multiple inventory configs."""
    s3 = boto3.client("s3", region_name="eu-west-1")
    bucket = "inventory-dest"
    schema = "Bucket, Key, Size"

    # Set up two inventory configs under a root prefix
    _setup_inventory(
        s3,
        bucket,
        "inventory/bucket-a/AllObjects",
        "2026-02-15T00-00Z",
        schema,
        [["bucket-a", "big.dat", "10000"]],
        source_bucket="bucket-a",
    )
    _setup_inventory(
        s3,
        bucket,
        "inventory/bucket-b/AllObjects",
        "2026-02-15T00-00Z",
        schema,
        [["bucket-b", "small.dat", "500"]],
        source_bucket="bucket-b",
        create_bucket=False,
    )

    # Query from the root prefix — should discover both configs
    result = get_inventory_bucket_summary(bucket, "inventory")
    assert result is not None
    assert len(result) == 2
    # Sorted by total_bytes descending
    assert result[0]["source_bucket"] == "bucket-a"
    assert result[0]["total_bytes"] == 10000
    assert result[1]["source_bucket"] == "bucket-b"
    assert result[1]["total_bytes"] == 500


@mock_aws
def test_total_bytes_multi_bucket() -> None:
    """Test total bytes sums across multiple inventory configs."""
    s3 = boto3.client("s3", region_name="eu-west-1")
    bucket = "inventory-dest"
    schema = "Bucket, Key, Size"

    _setup_inventory(
        s3,
        bucket,
        "inv/bucket-a/Config",
        "2026-02-15T00-00Z",
        schema,
        [["bucket-a", "f1.txt", "1000"]],
        source_bucket="bucket-a",
    )
    _setup_inventory(
        s3,
        bucket,
        "inv/bucket-b/Config",
        "2026-02-15T00-00Z",
        schema,
        [["bucket-b", "f1.txt", "2000"]],
        source_bucket="bucket-b",
        create_bucket=False,
    )

    result = get_inventory_total_bytes(bucket, "inv")
    assert result == 3000
