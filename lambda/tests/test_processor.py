"""Tests for data processor."""

from __future__ import annotations

import json
from datetime import datetime, timezone

from moto import mock_aws

from dapanoskop.processor import process, update_index


def _make_group(app: str, usage_type: str, cost: float, quantity: float) -> dict:
    return {
        "Keys": [f"App${app}", usage_type],
        "Metrics": {
            "UnblendedCost": {"Amount": str(cost), "Unit": "USD"},
            "UsageQuantity": {"Amount": str(quantity), "Unit": "N/A"},
        },
    }


def _make_collected(
    current_groups: list[dict],
    prev_groups: list[dict],
    yoy_groups: list[dict],
    cc_mapping: dict[str, str] | None = None,
) -> dict:
    return {
        "now": datetime(2026, 2, 1, 6, 0, 0, tzinfo=timezone.utc),
        "period_labels": {
            "current": "2026-01",
            "prev_month": "2025-12",
            "yoy": "2025-01",
        },
        "raw_data": {
            "current": current_groups,
            "prev_month": prev_groups,
            "yoy": yoy_groups,
        },
        "cc_mapping": cc_mapping or {},
    }


def test_process_basic() -> None:
    """Test basic processing with simple data."""
    # Note: CE returns GB-hours for TimedStorage-ByteHrs
    # 100 GB stored × 730 hours = 73,000 GB-hours
    collected = _make_collected(
        current_groups=[
            _make_group("web-app", "BoxUsage:m5.xlarge", 1000, 744),
            _make_group("web-app", "TimedStorage-ByteHrs", 200, 73_000),
            _make_group("api", "BoxUsage:t3.medium", 500, 1488),
        ],
        prev_groups=[
            _make_group("web-app", "BoxUsage:m5.xlarge", 900, 720),
            _make_group("web-app", "TimedStorage-ByteHrs", 180, 65_700),
            _make_group("api", "BoxUsage:t3.medium", 480, 1440),
        ],
        yoy_groups=[
            _make_group("web-app", "BoxUsage:m5.xlarge", 700, 744),
            _make_group("web-app", "TimedStorage-ByteHrs", 150, 58_400),
            _make_group("api", "BoxUsage:t3.medium", 300, 744),
        ],
        cc_mapping={"web-app": "Engineering", "api": "Engineering"},
    )

    result = process(collected)
    summary = result["summary"]

    assert summary["period"] == "2026-01"
    assert len(summary["cost_centers"]) == 1
    assert summary["cost_centers"][0]["name"] == "Engineering"
    assert summary["cost_centers"][0]["current_cost_usd"] == 1700.0

    # Workloads sorted by cost descending
    workloads = summary["cost_centers"][0]["workloads"]
    assert workloads[0]["name"] == "web-app"
    assert workloads[0]["current_cost_usd"] == 1200.0
    assert workloads[1]["name"] == "api"
    assert workloads[1]["current_cost_usd"] == 500.0

    # Tagging coverage
    assert summary["tagging_coverage"]["tagged_percentage"] == 100.0

    # Parquet rows
    assert len(result["workload_rows"]) > 0
    assert len(result["usage_type_rows"]) > 0


def test_untagged_workloads() -> None:
    """Test that empty app tags become 'Untagged'."""
    collected = _make_collected(
        current_groups=[
            _make_group("", "BoxUsage:t3.micro", 100, 744),
            _make_group("tagged-app", "BoxUsage:t3.micro", 400, 744),
        ],
        prev_groups=[],
        yoy_groups=[],
    )

    result = process(collected)
    summary = result["summary"]

    assert summary["tagging_coverage"]["tagged_cost_usd"] == 400.0
    assert summary["tagging_coverage"]["untagged_cost_usd"] == 100.0
    assert summary["tagging_coverage"]["tagged_percentage"] == 80.0


def test_storage_metrics() -> None:
    """Test storage metric calculations.

    AWS CE returns GB-hours for TimedStorage-*. Example:
    - 1000 GB stored × 730 hours = 730,000 GB-hours
    - 500 GB stored × 730 hours = 365,000 GB-hours
    """
    collected = _make_collected(
        current_groups=[
            _make_group("app", "TimedStorage-ByteHrs", 500, 730_000),
            _make_group("app", "TimedStorage-INT-FA-ByteHrs", 200, 365_000),
            _make_group("app", "TimedStorage-GlacierStaging", 50, 730_000),
        ],
        prev_groups=[
            _make_group("app", "TimedStorage-ByteHrs", 450, 700_000),
        ],
        yoy_groups=[],
    )

    result = process(collected)
    sm = result["summary"]["storage_metrics"]

    assert sm["total_cost_usd"] == 750.0
    assert sm["prev_month_cost_usd"] == 450.0
    assert sm["total_volume_bytes"] > 0
    # Hot tier = (ByteHrs + INT-FA) / total = (730K + 365K) / (730K + 365K + 730K)
    expected_hot = (730_000 + 365_000) / (730_000 + 365_000 + 730_000) * 100
    assert abs(sm["hot_tier_percentage"] - round(expected_hot, 1)) < 0.2
    # Verify cost_per_tb_usd calculation is applied correctly
    # Total GB-hours: 730,000 + 365,000 + 730,000 = 1,825,000
    # Total bytes: (1,825,000 GB-hours × 1e9) / 730 = 2,500,000,000,000 = 2.5 TB
    expected_volume_bytes = (1_825_000 * 1_000_000_000) / 730
    expected_volume_tb = expected_volume_bytes / 1_000_000_000_000
    expected_cost_per_tb = 750.0 / expected_volume_tb
    assert abs(sm["cost_per_tb_usd"] - round(expected_cost_per_tb, 2)) < 0.1


def test_multiple_cost_centers() -> None:
    """Test grouping workloads into multiple cost centers."""
    collected = _make_collected(
        current_groups=[
            _make_group("web-app", "BoxUsage:m5.xlarge", 1000, 744),
            _make_group("data-pipeline", "BoxUsage:r5.xlarge", 2000, 744),
        ],
        prev_groups=[],
        yoy_groups=[],
        cc_mapping={"web-app": "Frontend", "data-pipeline": "Data"},
    )

    result = process(collected)
    summary = result["summary"]

    assert len(summary["cost_centers"]) == 2
    # Sorted by cost descending
    assert summary["cost_centers"][0]["name"] == "Data"
    assert summary["cost_centers"][0]["current_cost_usd"] == 2000.0
    assert summary["cost_centers"][1]["name"] == "Frontend"
    assert summary["cost_centers"][1]["current_cost_usd"] == 1000.0


@mock_aws
def test_update_index_creates_sorted_index() -> None:
    """Test that update_index creates reverse-sorted period index."""
    import boto3

    s3 = boto3.client("s3", region_name="us-east-1")
    bucket = "test-bucket"
    s3.create_bucket(Bucket=bucket)

    # Create multiple period prefixes
    s3.put_object(Bucket=bucket, Key="2026-01/summary.json", Body=b"{}")
    s3.put_object(Bucket=bucket, Key="2025-12/summary.json", Body=b"{}")
    s3.put_object(Bucket=bucket, Key="2025-11/summary.json", Body=b"{}")
    s3.put_object(Bucket=bucket, Key="2026-02/summary.json", Body=b"{}")

    update_index(bucket)

    # Read index.json
    response = s3.get_object(Bucket=bucket, Key="index.json")
    index_data = json.loads(response["Body"].read())

    # Should be reverse sorted (newest first)
    assert index_data["periods"] == ["2026-02", "2026-01", "2025-12", "2025-11"]


@mock_aws
def test_update_index_ignores_non_period_prefixes() -> None:
    """Test that update_index ignores non-period prefixes."""
    import boto3

    s3 = boto3.client("s3", region_name="us-east-1")
    bucket = "test-bucket"
    s3.create_bucket(Bucket=bucket)

    # Create valid period prefixes and invalid ones
    s3.put_object(Bucket=bucket, Key="2026-01/summary.json", Body=b"{}")
    s3.put_object(Bucket=bucket, Key="2025-12/summary.json", Body=b"{}")
    s3.put_object(Bucket=bucket, Key="logs/error.log", Body=b"error")
    s3.put_object(Bucket=bucket, Key="backup/old-data.json", Body=b"{}")
    s3.put_object(Bucket=bucket, Key="test/file.txt", Body=b"test")

    update_index(bucket)

    # Read index.json
    response = s3.get_object(Bucket=bucket, Key="index.json")
    index_data = json.loads(response["Body"].read())

    # Should only include valid period prefixes
    assert index_data["periods"] == ["2026-01", "2025-12"]
    assert "logs" not in index_data["periods"]
    assert "backup" not in index_data["periods"]
    assert "test" not in index_data["periods"]


@mock_aws
def test_update_index_empty_bucket() -> None:
    """Test that update_index handles empty bucket correctly."""
    import boto3

    s3 = boto3.client("s3", region_name="us-east-1")
    bucket = "test-bucket"
    s3.create_bucket(Bucket=bucket)

    update_index(bucket)

    # Read index.json
    response = s3.get_object(Bucket=bucket, Key="index.json")
    index_data = json.loads(response["Body"].read())

    assert index_data["periods"] == []


@mock_aws
def test_write_to_s3_creates_all_files() -> None:
    """Test that write_to_s3 creates summary.json, parquet files, and index.json."""
    import io

    import boto3

    import pyarrow.parquet as pq

    from dapanoskop.processor import write_to_s3

    s3 = boto3.client("s3", region_name="us-east-1")
    bucket = "test-bucket"
    s3.create_bucket(Bucket=bucket)

    # Create processed data (CE returns GB-hours for TimedStorage-*)
    # 100 GB × 730 hours = 73,000 GB-hours
    collected = _make_collected(
        current_groups=[
            _make_group("web-app", "BoxUsage:m5.xlarge", 1000, 744),
            _make_group("api", "TimedStorage-ByteHrs", 200, 73_000),
        ],
        prev_groups=[
            _make_group("web-app", "BoxUsage:m5.xlarge", 900, 720),
        ],
        yoy_groups=[],
        cc_mapping={"web-app": "Engineering", "api": "Engineering"},
    )
    processed = process(collected)

    write_to_s3(processed, bucket)

    # Verify all files were created
    objects = s3.list_objects_v2(Bucket=bucket)
    keys = [obj["Key"] for obj in objects.get("Contents", [])]

    assert "2026-01/summary.json" in keys
    assert "2026-01/cost-by-workload.parquet" in keys
    assert "2026-01/cost-by-usage-type.parquet" in keys
    assert "index.json" in keys

    # Verify summary.json is valid JSON
    summary_obj = s3.get_object(Bucket=bucket, Key="2026-01/summary.json")
    summary = json.loads(summary_obj["Body"].read())
    assert summary["period"] == "2026-01"

    # Verify parquet files can be read
    wl_obj = s3.get_object(Bucket=bucket, Key="2026-01/cost-by-workload.parquet")
    wl_data = io.BytesIO(wl_obj["Body"].read())
    wl_table = pq.read_table(wl_data)
    assert wl_table.num_rows > 0

    ut_obj = s3.get_object(Bucket=bucket, Key="2026-01/cost-by-usage-type.parquet")
    ut_data = io.BytesIO(ut_obj["Body"].read())
    ut_table = pq.read_table(ut_data)
    assert ut_table.num_rows > 0


@mock_aws
def test_write_to_s3_skip_index_update() -> None:
    """Test that update_index_file=False does not create index.json."""
    import boto3

    from dapanoskop.processor import write_to_s3

    s3 = boto3.client("s3", region_name="us-east-1")
    bucket = "test-bucket"
    s3.create_bucket(Bucket=bucket)

    # Create processed data
    collected = _make_collected(
        current_groups=[
            _make_group("web-app", "BoxUsage:m5.xlarge", 1000, 744),
        ],
        prev_groups=[],
        yoy_groups=[],
    )
    processed = process(collected)

    write_to_s3(processed, bucket, update_index_file=False)

    # Verify files were created except index.json
    objects = s3.list_objects_v2(Bucket=bucket)
    keys = [obj["Key"] for obj in objects.get("Contents", [])]

    assert "2026-01/summary.json" in keys
    assert "2026-01/cost-by-workload.parquet" in keys
    assert "2026-01/cost-by-usage-type.parquet" in keys
    assert "index.json" not in keys


@mock_aws
def test_write_to_s3_empty_rows() -> None:
    """Test that no parquet files are created when rows are empty."""
    import boto3

    from dapanoskop.processor import write_to_s3

    s3 = boto3.client("s3", region_name="us-east-1")
    bucket = "test-bucket"
    s3.create_bucket(Bucket=bucket)

    # Create processed data with no groups (empty rows)
    collected = _make_collected(
        current_groups=[],
        prev_groups=[],
        yoy_groups=[],
    )
    processed = process(collected)

    write_to_s3(processed, bucket)

    # Verify files
    objects = s3.list_objects_v2(Bucket=bucket)
    keys = [obj["Key"] for obj in objects.get("Contents", [])]

    # summary.json and index.json should be created
    assert "2026-01/summary.json" in keys
    assert "index.json" in keys

    # Parquet files should NOT be created when rows are empty
    assert "2026-01/cost-by-workload.parquet" not in keys
    assert "2026-01/cost-by-usage-type.parquet" not in keys


@mock_aws
def test_write_to_s3_parquet_schema() -> None:
    """Test that parquet files have correct column names and types."""
    import io

    import boto3

    import pyarrow as pa
    import pyarrow.parquet as pq

    from dapanoskop.processor import write_to_s3

    s3 = boto3.client("s3", region_name="us-east-1")
    bucket = "test-bucket"
    s3.create_bucket(Bucket=bucket)

    # Create processed data (CE returns GB-hours for TimedStorage-*)
    # 100 GB × 730 hours = 73,000 GB-hours
    collected = _make_collected(
        current_groups=[
            _make_group("web-app", "BoxUsage:m5.xlarge", 1000, 744),
            _make_group("api", "TimedStorage-ByteHrs", 200, 73_000),
        ],
        prev_groups=[],
        yoy_groups=[],
        cc_mapping={"web-app": "Engineering", "api": "Engineering"},
    )
    processed = process(collected)

    write_to_s3(processed, bucket, update_index_file=False)

    # Check cost-by-workload.parquet schema
    wl_obj = s3.get_object(Bucket=bucket, Key="2026-01/cost-by-workload.parquet")
    wl_data = io.BytesIO(wl_obj["Body"].read())
    wl_table = pq.read_table(wl_data)

    assert wl_table.column_names == ["cost_center", "workload", "period", "cost_usd"]
    assert wl_table.schema.field("cost_center").type == pa.string()
    assert wl_table.schema.field("workload").type == pa.string()
    assert wl_table.schema.field("period").type == pa.string()
    assert wl_table.schema.field("cost_usd").type == pa.float64()

    # Check cost-by-usage-type.parquet schema
    ut_obj = s3.get_object(Bucket=bucket, Key="2026-01/cost-by-usage-type.parquet")
    ut_data = io.BytesIO(ut_obj["Body"].read())
    ut_table = pq.read_table(ut_data)

    assert ut_table.column_names == [
        "workload",
        "usage_type",
        "category",
        "period",
        "cost_usd",
        "usage_quantity",
    ]
    assert ut_table.schema.field("workload").type == pa.string()
    assert ut_table.schema.field("usage_type").type == pa.string()
    assert ut_table.schema.field("category").type == pa.string()
    assert ut_table.schema.field("period").type == pa.string()
    assert ut_table.schema.field("cost_usd").type == pa.float64()
    assert ut_table.schema.field("usage_quantity").type == pa.float64()


def test_parse_groups_empty_keys() -> None:
    """Test that _parse_groups handles empty Keys array gracefully."""
    from dapanoskop.processor import _parse_groups

    groups = [
        {
            "Keys": [],
            "Metrics": {
                "UnblendedCost": {"Amount": "100", "Unit": "USD"},
                "UsageQuantity": {"Amount": "10", "Unit": "N/A"},
            },
        }
    ]

    result = _parse_groups(groups)

    # Empty Keys should be skipped (len(keys) != 2)
    assert result == []


def test_parse_groups_single_key() -> None:
    """Test that _parse_groups handles single key (expects 2) gracefully."""
    from dapanoskop.processor import _parse_groups

    groups = [
        {
            "Keys": ["App$web-app"],
            "Metrics": {
                "UnblendedCost": {"Amount": "100", "Unit": "USD"},
                "UsageQuantity": {"Amount": "10", "Unit": "N/A"},
            },
        }
    ]

    result = _parse_groups(groups)

    # Single key should be skipped (len(keys) != 2)
    assert result == []


def test_parse_groups_missing_keys_field() -> None:
    """Test that _parse_groups handles missing Keys field gracefully."""
    from dapanoskop.processor import _parse_groups

    groups = [
        {
            "Metrics": {
                "UnblendedCost": {"Amount": "100", "Unit": "USD"},
                "UsageQuantity": {"Amount": "10", "Unit": "N/A"},
            },
        }
    ]

    result = _parse_groups(groups)

    # Missing Keys should be handled gracefully
    assert result == []


def test_storage_metrics_realistic_scale() -> None:
    """Test storage metrics with realistic AWS GB-hour magnitudes."""
    # Scenario: 5 TB stored for entire month (730 hours)
    # 5 TB = 5,000 GB
    # 5,000 GB × 730 hours = 3,650,000 GB-hours (AWS CE returns this)
    # AWS S3 Standard pricing: ~$0.023/GB = ~$23/TB/month
    # Expected cost: 5 TB * $23 = $115

    collected = _make_collected(
        current_groups=[
            _make_group("app", "TimedStorage-ByteHrs", 115.0, 3_650_000),
        ],
        prev_groups=[
            _make_group("app", "TimedStorage-ByteHrs", 110.0, 3_500_000),
        ],
        yoy_groups=[],
    )

    result = process(collected)
    sm = result["summary"]["storage_metrics"]

    # Verify volume: (3,650,000 GB-hours × 1e9) / 730 hours = 5,000,000,000,000 bytes = 5 TB
    assert sm["total_volume_bytes"] == 5_000_000_000_000

    # Verify cost per TB: $115 / 5 TB = $23/TB (realistic S3 Standard pricing)
    assert sm["cost_per_tb_usd"] == 23.0


def test_storage_metrics_zero_volume() -> None:
    """Test storage metrics with zero volume (no storage usage types)."""
    collected = _make_collected(
        current_groups=[
            # Only compute, no storage
            _make_group("app", "BoxUsage:m5.xlarge", 1000, 744),
            _make_group("app", "Lambda-GB-Second", 200, 5000),
        ],
        prev_groups=[
            _make_group("app", "BoxUsage:m5.xlarge", 900, 720),
        ],
        yoy_groups=[],
    )

    result = process(collected)
    sm = result["summary"]["storage_metrics"]

    # No storage usage -> zero volume, zero cost, and safe division
    assert sm["total_cost_usd"] == 0.0
    assert sm["prev_month_cost_usd"] == 0.0
    assert sm["total_volume_bytes"] == 0
    assert sm["hot_tier_percentage"] == 0.0
    assert sm["cost_per_tb_usd"] == 0.0  # No crash from division by zero


def test_storage_metrics_with_efs_and_ebs() -> None:
    """Test that EFS and EBS usage types are included in volume when flags are set.

    Without include_efs/include_ebs, only TimedStorage-* types count toward volume.
    With the flags enabled, EFS: and EBS: prefixes should also contribute.
    """
    collected = _make_collected(
        current_groups=[
            # S3 standard: 100 GB * 730 hours = 73,000 GB-hours
            _make_group("app", "TimedStorage-ByteHrs", 50, 73_000),
            # EFS usage (should only count when include_efs=True)
            _make_group("app", "EFS:TimedStorage-ByteHrs", 30, 36_500),
            # EBS usage (should only count when include_ebs=True)
            _make_group("app", "EBS:VolumeUsage.gp3", 20, 14_600),
        ],
        prev_groups=[],
        yoy_groups=[],
    )

    # Without flags: only TimedStorage-ByteHrs contributes to volume
    result_no_flags = process(collected)
    sm_no_flags = result_no_flags["summary"]["storage_metrics"]
    expected_s3_bytes = (73_000 * 1_000_000_000) / 730  # 100 GB = 100,000,000,000
    assert sm_no_flags["total_volume_bytes"] == round(expected_s3_bytes)

    # With include_efs: S3 + EFS contribute
    result_efs = process(collected, include_efs=True)
    sm_efs = result_efs["summary"]["storage_metrics"]
    expected_efs_bytes = ((73_000 + 36_500) * 1_000_000_000) / 730
    assert sm_efs["total_volume_bytes"] == round(expected_efs_bytes)
    assert sm_efs["total_volume_bytes"] > sm_no_flags["total_volume_bytes"]

    # With include_ebs: S3 + EBS contribute
    result_ebs = process(collected, include_ebs=True)
    sm_ebs = result_ebs["summary"]["storage_metrics"]
    expected_ebs_bytes = ((73_000 + 14_600) * 1_000_000_000) / 730
    assert sm_ebs["total_volume_bytes"] == round(expected_ebs_bytes)

    # With both flags: all three contribute
    result_both = process(collected, include_efs=True, include_ebs=True)
    sm_both = result_both["summary"]["storage_metrics"]
    expected_all_bytes = ((73_000 + 36_500 + 14_600) * 1_000_000_000) / 730
    assert sm_both["total_volume_bytes"] == round(expected_all_bytes)
