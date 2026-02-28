"""Tests for data processor."""

from __future__ import annotations

import json
from datetime import datetime, timezone

from moto import mock_aws

from dapanoskop.processor import (
    _apply_split_charge_redistribution,
    process,
    update_index,
)


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
    # Note: CE returns GB-Months for TimedStorage-ByteHrs (average GB stored)
    # 100 GB stored for one month = 100 GB-Months
    collected = _make_collected(
        current_groups=[
            _make_group("web-app", "BoxUsage:m5.xlarge", 1000, 744),
            _make_group("web-app", "TimedStorage-ByteHrs", 200, 100),
            _make_group("api", "BoxUsage:t3.medium", 500, 1488),
        ],
        prev_groups=[
            _make_group("web-app", "BoxUsage:m5.xlarge", 900, 720),
            _make_group("web-app", "TimedStorage-ByteHrs", 180, 90),
            _make_group("api", "BoxUsage:t3.medium", 480, 1440),
        ],
        yoy_groups=[
            _make_group("web-app", "BoxUsage:m5.xlarge", 700, 744),
            _make_group("web-app", "TimedStorage-ByteHrs", 150, 80),
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

    AWS CE returns GB-Months for TimedStorage-*. Example:
    - 1000 GB stored for one month = 1,000 GB-Months
    - 500 GB stored for one month = 500 GB-Months
    """
    collected = _make_collected(
        current_groups=[
            _make_group("app", "TimedStorage-ByteHrs", 500, 1_000),
            _make_group("app", "TimedStorage-INT-FA-ByteHrs", 200, 500),
            _make_group("app", "TimedStorage-GlacierStaging", 50, 1_000),
        ],
        prev_groups=[
            _make_group("app", "TimedStorage-ByteHrs", 450, 960),
        ],
        yoy_groups=[],
    )

    result = process(collected)
    sm = result["summary"]["storage_metrics"]

    assert sm["total_cost_usd"] == 750.0
    assert sm["prev_month_cost_usd"] == 450.0
    # Total GB-Months: 1,000 + 500 + 1,000 = 2,500
    # Total bytes: 2,500 × 2^30 = 2,684,354,560,000 bytes
    assert sm["total_volume_bytes"] == 2_684_354_560_000
    # Hot tier = (ByteHrs + INT-FA) / total = (1000 + 500) / (1000 + 500 + 1000)
    expected_hot = (1_000 + 500) / (1_000 + 500 + 1_000) * 100
    assert abs(sm["hot_tier_percentage"] - round(expected_hot, 1)) < 0.2
    # Cost per TB: $750 / (2,684,354,560,000 / 2^40) = $307.2/TB
    assert sm["cost_per_tb_usd"] == 307.2


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

    # Create processed data (CE returns GB-Months for TimedStorage-*)
    # 100 GB stored = 100 GB-Months
    collected = _make_collected(
        current_groups=[
            _make_group("web-app", "BoxUsage:m5.xlarge", 1000, 744),
            _make_group("api", "TimedStorage-ByteHrs", 200, 100),
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

    # Create processed data (CE returns GB-Months for TimedStorage-*)
    # 100 GB stored = 100 GB-Months
    collected = _make_collected(
        current_groups=[
            _make_group("web-app", "BoxUsage:m5.xlarge", 1000, 744),
            _make_group("api", "TimedStorage-ByteHrs", 200, 100),
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
    """Test storage metrics with realistic AWS GB-Month magnitudes."""
    # Scenario: 5 TB stored for entire month
    # 5 TB = 5,000 GB → CE returns 5,000 GB-Months
    # AWS S3 Standard pricing: ~$0.023/GB = ~$23/TB/month
    # Expected cost: 5 TB * $23 = $115

    collected = _make_collected(
        current_groups=[
            _make_group("app", "TimedStorage-ByteHrs", 115.0, 5_000),
        ],
        prev_groups=[
            _make_group("app", "TimedStorage-ByteHrs", 110.0, 4_800),
        ],
        yoy_groups=[],
    )

    result = process(collected)
    sm = result["summary"]["storage_metrics"]

    # Verify volume: 5,000 GB-Months × 2^30 = 5,368,709,120,000 bytes
    assert sm["total_volume_bytes"] == 5_368_709_120_000

    # Verify cost per TB: $115 / (5,368,709,120,000 / 2^40) = $23.55/TB
    assert sm["cost_per_tb_usd"] == 23.55


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
            # S3 standard: 100 GB-Months
            _make_group("app", "TimedStorage-ByteHrs", 50, 100),
            # EFS usage (should only count when include_efs=True)
            _make_group("app", "EFS:TimedStorage-ByteHrs", 30, 50),
            # EBS usage (should only count when include_ebs=True)
            _make_group("app", "EBS:VolumeUsage.gp3", 20, 20),
        ],
        prev_groups=[],
        yoy_groups=[],
    )

    # Without flags: only TimedStorage-ByteHrs contributes to volume
    result_no_flags = process(collected)
    sm_no_flags = result_no_flags["summary"]["storage_metrics"]
    assert sm_no_flags["total_volume_bytes"] == 107_374_182_400  # 100 × 2^30 bytes

    # With include_efs: S3 + EFS contribute
    result_efs = process(collected, include_efs=True)
    sm_efs = result_efs["summary"]["storage_metrics"]
    assert sm_efs["total_volume_bytes"] == 161_061_273_600  # 150 × 2^30 bytes
    assert sm_efs["total_volume_bytes"] > sm_no_flags["total_volume_bytes"]

    # With include_ebs: S3 + EBS contribute
    result_ebs = process(collected, include_ebs=True)
    sm_ebs = result_ebs["summary"]["storage_metrics"]
    assert sm_ebs["total_volume_bytes"] == 128_849_018_880  # 120 × 2^30 bytes

    # With both flags: all three contribute
    result_both = process(collected, include_efs=True, include_ebs=True)
    sm_both = result_both["summary"]["storage_metrics"]
    assert sm_both["total_volume_bytes"] == 182_536_110_080  # 170 × 2^30 bytes


def test_split_charge_categories() -> None:
    """Test that split charge categories are marked and have zero cost."""
    collected = _make_collected(
        current_groups=[
            _make_group("web-app", "BoxUsage:m5.xlarge", 800, 744),
            _make_group("shared-infra", "BoxUsage:t3.medium", 200, 744),
        ],
        prev_groups=[
            _make_group("web-app", "BoxUsage:m5.xlarge", 750, 720),
            _make_group("shared-infra", "BoxUsage:t3.medium", 180, 720),
        ],
        yoy_groups=[],
        cc_mapping={"web-app": "Engineering", "shared-infra": "Shared Services"},
    )
    collected["split_charge_categories"] = ["Shared Services"]
    collected["split_charge_rules"] = [
        {
            "Source": "Shared Services",
            "Targets": ["Engineering"],
            "Method": "PROPORTIONAL",
            "Parameters": [],
        }
    ]
    collected["allocated_costs"] = {
        "current": {"Engineering": 800.0, "Shared Services": 200.0},
        "prev_month": {"Engineering": 750.0, "Shared Services": 180.0},
        "yoy": {},
    }

    result = process(collected)
    ccs = result["summary"]["cost_centers"]

    # Engineering should get its allocated cost + redistributed Shared Services
    # current: 800 + 200 = 1000, prev: 750 + 180 = 930
    eng = next(cc for cc in ccs if cc["name"] == "Engineering")
    assert eng["current_cost_usd"] == 1000.0
    assert eng["prev_month_cost_usd"] == 930.0
    assert "is_split_charge" not in eng

    # Shared Services should be marked as split charge with zero cost
    shared = next(cc for cc in ccs if cc["name"] == "Shared Services")
    assert shared["is_split_charge"] is True
    assert shared["current_cost_usd"] == 0.0
    assert shared["prev_month_cost_usd"] == 0.0
    # But workloads should still be present for drill-down
    assert len(shared["workloads"]) == 1


def test_no_split_charge_fallback() -> None:
    """Test that without split charge data, workload sums are used as before."""
    collected = _make_collected(
        current_groups=[
            _make_group("web-app", "BoxUsage:m5.xlarge", 1000, 744),
        ],
        prev_groups=[],
        yoy_groups=[],
        cc_mapping={"web-app": "Engineering"},
    )
    # No split_charge_categories or allocated_costs keys

    result = process(collected)
    eng = result["summary"]["cost_centers"][0]
    assert eng["name"] == "Engineering"
    assert eng["current_cost_usd"] == 1000.0
    assert "is_split_charge" not in eng


def test_hot_tier_with_region_prefixed_usage_types() -> None:
    """Test hot tier calculation with region-prefixed usage types (Bug 4).

    AWS Cost Explorer returns usage types with region prefixes like
    USE1-TimedStorage-ByteHrs instead of bare TimedStorage-ByteHrs.
    The _is_hot_tier() function must use endswith() to handle these,
    and _is_storage_volume() must use an 'in' check for TimedStorage.
    """
    collected = _make_collected(
        current_groups=[
            # Region-prefixed hot tier: Standard and Infrequent Access
            _make_group("app", "USE1-TimedStorage-ByteHrs", 200, 1_000),
            _make_group("app", "EUW1-TimedStorage-INT-FA-ByteHrs", 100, 500),
            # Region-prefixed cold tier: Glacier (not hot)
            _make_group("app", "USE1-TimedStorage-GlacierByteHrs", 10, 2_000),
        ],
        prev_groups=[],
        yoy_groups=[],
    )

    result = process(collected)
    sm = result["summary"]["storage_metrics"]

    # All three are volume-contributing (TimedStorage in usage_type)
    # Total GB-Months: 1,000 + 500 + 2,000 = 3,500
    # Total bytes: 3,500 × 2^30 = 3,758,096,384,000
    assert sm["total_volume_bytes"] == 3_758_096_384_000

    # Hot tier = Standard + INT-FA = 1,000 + 500 = 1,500 of 3,500
    expected_hot = (1_000 + 500) / (1_000 + 500 + 2_000) * 100
    assert abs(sm["hot_tier_percentage"] - round(expected_hot, 1)) < 0.2

    # All items are Storage category, so total_cost = 200 + 100 + 10 = 310
    assert sm["total_cost_usd"] == 310.0

    # Cost per TB: $310 / (3,758,096,384,000 / 2^40) = $310 / 3.41796875 = $90.7/TB
    assert sm["cost_per_tb_usd"] == 90.7


def test_cost_per_tb_with_non_volume_storage_costs() -> None:
    """Test that non-volume storage items contribute to cost but not volume (Bug 4).

    Storage category items like Requests-Tier1 and Retrieval-SIA contribute
    to total_cost_usd but NOT to total_volume_bytes. Only TimedStorage-*
    items contribute to volume. cost_per_tb_usd uses total_cost / volume.
    """
    collected = _make_collected(
        current_groups=[
            # Volume-contributing: TimedStorage
            _make_group("app", "TimedStorage-ByteHrs", 200, 1_000),
            # Storage cost but NOT volume-contributing
            _make_group("app", "Requests-Tier1", 50, 1_000_000),
            _make_group("app", "Retrieval-SIA", 30, 500),
        ],
        prev_groups=[],
        yoy_groups=[],
    )

    result = process(collected)
    sm = result["summary"]["storage_metrics"]

    # Only TimedStorage contributes to volume: 1,000 GB-Months × 2^30 = 1,073,741,824,000 bytes
    assert sm["total_volume_bytes"] == 1_073_741_824_000

    # All three are Storage category, so total cost = 200 + 50 + 30 = 280
    assert sm["total_cost_usd"] == 280.0

    # cost_per_tb = 280 / (1,073,741,824,000 / 2^40) = 280 / 0.9765625 = $286.72/TB
    assert sm["cost_per_tb_usd"] == 286.72

    # Hot tier: only TimedStorage-ByteHrs is hot = 1,000 / 1,000 = 100%
    assert sm["hot_tier_percentage"] == 100.0


def test_total_spend_with_allocated_costs_missing_cc_name() -> None:
    """Test fallback to workload sums when allocated_costs keys don't match (Bug 2 & 5).

    When allocated_costs exist but contain keys like 'No cost category' instead
    of the expected cost center names, the processor should fall back to summing
    workload costs for those cost centers, not show $0.
    """
    collected = _make_collected(
        current_groups=[
            _make_group("web-app", "BoxUsage:m5.xlarge", 1000, 744),
            _make_group("api", "BoxUsage:t3.medium", 500, 1488),
        ],
        prev_groups=[
            _make_group("web-app", "BoxUsage:m5.xlarge", 900, 720),
            _make_group("api", "BoxUsage:t3.medium", 450, 1440),
        ],
        yoy_groups=[],
        cc_mapping={"web-app": "Engineering", "api": "Platform"},
    )
    # Allocated costs have keys that DON'T match the cost center names
    # (e.g. historic months before Cost Categories were defined)
    collected["allocated_costs"] = {
        "current": {"No cost category": 1500.0},
        "prev_month": {"No cost category": 1350.0},
        "yoy": {},
    }

    result = process(collected)
    ccs = result["summary"]["cost_centers"]

    # Both cost centers should fall back to workload sums
    eng = next(cc for cc in ccs if cc["name"] == "Engineering")
    assert eng["current_cost_usd"] == 1000.0, (
        "Engineering should use workload sum, not $0 from missing allocated key"
    )
    assert eng["prev_month_cost_usd"] == 900.0

    platform = next(cc for cc in ccs if cc["name"] == "Platform")
    assert platform["current_cost_usd"] == 500.0, (
        "Platform should use workload sum, not $0 from missing allocated key"
    )
    assert platform["prev_month_cost_usd"] == 450.0


# --- Split charge redistribution unit tests ---


def test_redistribution_proportional() -> None:
    """Test PROPORTIONAL redistribution distributes by target cost ratio."""
    costs = {"Shared": 100.0, "Eng": 300.0, "Data": 100.0}
    rules = [
        {
            "Source": "Shared",
            "Targets": ["Eng", "Data"],
            "Method": "PROPORTIONAL",
            "Parameters": [],
        }
    ]
    result = _apply_split_charge_redistribution(costs, rules)
    assert result["Shared"] == 0.0
    # Eng gets 300/(300+100) * 100 = 75, Data gets 100/(300+100) * 100 = 25
    assert result["Eng"] == 375.0
    assert result["Data"] == 125.0


def test_redistribution_even() -> None:
    """Test EVEN redistribution splits equally among targets."""
    costs = {"Shared": 100.0, "Eng": 300.0, "Data": 100.0}
    rules = [
        {
            "Source": "Shared",
            "Targets": ["Eng", "Data"],
            "Method": "EVEN",
            "Parameters": [],
        }
    ]
    result = _apply_split_charge_redistribution(costs, rules)
    assert result["Shared"] == 0.0
    assert result["Eng"] == 350.0
    assert result["Data"] == 150.0


def test_redistribution_fixed() -> None:
    """Test FIXED redistribution uses explicit allocation percentages."""
    costs = {"Shared": 200.0, "Eng": 300.0, "Data": 100.0}
    rules = [
        {
            "Source": "Shared",
            "Targets": ["Eng", "Data"],
            "Method": "FIXED",
            "Parameters": [
                {"Type": "ALLOCATION_PERCENTAGES", "Values": ["Eng=70", "Data=30"]}
            ],
        }
    ]
    result = _apply_split_charge_redistribution(costs, rules)
    assert result["Shared"] == 0.0
    # Eng gets 70% of 200 = 140, Data gets 30% of 200 = 60
    assert result["Eng"] == 440.0
    assert result["Data"] == 160.0


def test_redistribution_zero_source_cost() -> None:
    """Test that zero source cost results in no redistribution."""
    costs = {"Shared": 0.0, "Eng": 300.0}
    rules = [
        {
            "Source": "Shared",
            "Targets": ["Eng"],
            "Method": "PROPORTIONAL",
            "Parameters": [],
        }
    ]
    result = _apply_split_charge_redistribution(costs, rules)
    assert result["Shared"] == 0.0
    assert result["Eng"] == 300.0


def test_redistribution_target_not_in_costs() -> None:
    """Test that missing targets get initialized to zero before redistribution."""
    costs = {"Shared": 100.0}
    rules = [
        {
            "Source": "Shared",
            "Targets": ["NewTeam"],
            "Method": "EVEN",
            "Parameters": [],
        }
    ]
    result = _apply_split_charge_redistribution(costs, rules)
    assert result["Shared"] == 0.0
    assert result["NewTeam"] == 100.0


def test_redistribution_no_rules() -> None:
    """Test that empty rules returns a copy of original costs unchanged."""
    costs = {"Eng": 300.0, "Data": 100.0}
    result = _apply_split_charge_redistribution(costs, [])
    assert result == costs
    # Verify it's a copy, not the same object
    assert result is not costs


def test_redistribution_proportional_zero_targets_fallback() -> None:
    """Test PROPORTIONAL falls back to EVEN when all targets have zero cost."""
    costs = {"Shared": 100.0, "Eng": 0.0, "Data": 0.0}
    rules = [
        {
            "Source": "Shared",
            "Targets": ["Eng", "Data"],
            "Method": "PROPORTIONAL",
            "Parameters": [],
        }
    ]
    result = _apply_split_charge_redistribution(costs, rules)
    assert result["Shared"] == 0.0
    assert result["Eng"] == 50.0
    assert result["Data"] == 50.0


def test_redistribution_fixed_malformed_value_skipped() -> None:
    """Test Issue 2: non-numeric percentage string is skipped with a warning.

    When AWS returns a value like 'Eng=abc' or 'Eng=Team=70', the float()
    conversion would raise ValueError. The function must log a warning and skip
    the malformed entry rather than crashing, then fall back to EVEN split.
    """
    costs = {"Shared": 100.0, "Eng": 0.0, "Data": 0.0}
    rules = [
        {
            "Source": "Shared",
            "Targets": ["Eng", "Data"],
            "Method": "FIXED",
            "Parameters": [
                # Both values are malformed — no valid percentages can be parsed
                {
                    "Type": "ALLOCATION_PERCENTAGES",
                    "Values": ["Eng=abc", "Data=xyz"],
                }
            ],
        }
    ]
    # Should not raise; falls back to EVEN split (param_map ends up empty)
    result = _apply_split_charge_redistribution(costs, rules)
    assert result["Shared"] == 0.0
    # EVEN fallback: 100 / 2 = 50 each
    assert result["Eng"] == 50.0
    assert result["Data"] == 50.0


def test_redistribution_fixed_positional_values() -> None:
    """Test FIXED with positional percentages (real AWS API format).

    AWS CE API returns ALLOCATION_PERCENTAGES as positional values where
    Values[i] corresponds to Targets[i].
    """
    costs = {
        "Sagemaker": 1000.0,
        "Px Operations": 200.0,
        "Px Lab Services": 300.0,
        "Px Research": 400.0,
        "Px Image Analysis": 100.0,
    }
    rules = [
        {
            "Source": "Sagemaker",
            "Targets": [
                "Px Operations",
                "Px Lab Services",
                "Px Research",
                "Px Image Analysis",
            ],
            "Method": "FIXED",
            "Parameters": [
                {
                    "Type": "ALLOCATION_PERCENTAGES",
                    "Values": ["15", "20.00", "25.00", "40"],
                }
            ],
        }
    ]
    result = _apply_split_charge_redistribution(costs, rules)
    assert result["Sagemaker"] == 0.0
    # 15% of 1000 = 150
    assert result["Px Operations"] == 350.0
    # 20% of 1000 = 200
    assert result["Px Lab Services"] == 500.0
    # 25% of 1000 = 250
    assert result["Px Research"] == 650.0
    # 40% of 1000 = 400
    assert result["Px Image Analysis"] == 500.0


def test_redistribution_fixed_non_numeric_positional_falls_back_to_even() -> None:
    """Test FIXED with non-numeric positional values falls back to EVEN.

    When positional values can't be parsed as floats, param_map stays empty
    and the function falls through to the EVEN distribution fallback.
    """
    costs = {"Shared": 120.0, "Eng": 0.0, "Data": 0.0, "Ops": 0.0}
    rules = [
        {
            "Source": "Shared",
            "Targets": ["Eng", "Data", "Ops"],
            "Method": "FIXED",
            "Parameters": [
                {"Type": "ALLOCATION_PERCENTAGES", "Values": ["abc", "def", "ghi"]}
            ],
        }
    ]
    result = _apply_split_charge_redistribution(costs, rules)
    assert result["Shared"] == 0.0
    # EVEN fallback: 120 / 3 = 40 each
    assert result["Eng"] == 40.0
    assert result["Data"] == 40.0
    assert result["Ops"] == 40.0


def test_redistribution_multi_rule_uses_original_costs() -> None:
    """Test Issue 4: multiple rules each read from the original (pre-redistribution) costs.

    Rule 1: "Shared Services" → ["Eng", "Data"] via EVEN ($200 → $100 each)
    Rule 2: "Platform" → ["Eng"] via EVEN ($150 → $150 to Eng)

    After rule 1, Platform's cost in `result` is still $150 (unchanged from original).
    After rule 2, Eng gets another $150.  The snapshot ensures rule 2 reads the
    *original* Platform cost ($150), not any post-rule-1 value.
    """
    costs = {
        "Shared Services": 200.0,
        "Platform": 150.0,
        "Eng": 500.0,
        "Data": 300.0,
    }
    rules = [
        {
            "Source": "Shared Services",
            "Targets": ["Eng", "Data"],
            "Method": "EVEN",
            "Parameters": [],
        },
        {
            "Source": "Platform",
            "Targets": ["Eng"],
            "Method": "EVEN",
            "Parameters": [],
        },
    ]
    result = _apply_split_charge_redistribution(costs, rules)

    # Both sources should be zeroed
    assert result["Shared Services"] == 0.0
    assert result["Platform"] == 0.0

    # Eng: 500 (original) + 100 (half of Shared Services) + 150 (all of Platform) = 750
    assert result["Eng"] == 750.0

    # Data: 300 (original) + 100 (half of Shared Services) = 400
    assert result["Data"] == 400.0


def test_redistribution_fixed_percentages_not_summing_to_100() -> None:
    """Test Issue 5: partial percentages log a warning but still apply correctly.

    When FIXED percentages sum to 90% instead of 100%, 10% of the source cost
    is silently lost. The function should still distribute what it can.
    """
    costs = {"Shared": 200.0, "Eng": 300.0, "Data": 100.0}
    rules = [
        {
            "Source": "Shared",
            "Targets": ["Eng", "Data"],
            "Method": "FIXED",
            "Parameters": [
                # Only 60% + 30% = 90% — 10% of $200 = $20 is lost
                {
                    "Type": "ALLOCATION_PERCENTAGES",
                    "Values": ["Eng=60", "Data=30"],
                }
            ],
        }
    ]
    result = _apply_split_charge_redistribution(costs, rules)
    assert result["Shared"] == 0.0
    # Eng gets 60% of 200 = 120; total = 300 + 120 = 420
    assert result["Eng"] == 420.0
    # Data gets 30% of 200 = 60; total = 100 + 60 = 160
    assert result["Data"] == 160.0
    # $20 (10% of Shared) is correctly lost — behaviour is intentional


def test_redistribution_fixed_whitespace_in_values() -> None:
    """Test Issue 6: whitespace around '=' is stripped correctly.

    If AWS returns 'Eng = 70' instead of 'Eng=70', the target name must be
    stripped to 'Eng' and the percentage to '70', not ' Eng' and ' 70'.
    """
    costs = {"Shared": 200.0, "Eng": 300.0, "Data": 100.0}
    rules = [
        {
            "Source": "Shared",
            "Targets": ["Eng", "Data"],
            "Method": "FIXED",
            "Parameters": [
                {
                    "Type": "ALLOCATION_PERCENTAGES",
                    # Whitespace-padded values — should behave identically to "Eng=70"
                    "Values": ["Eng = 70", "Data = 30"],
                }
            ],
        }
    ]
    result = _apply_split_charge_redistribution(costs, rules)
    assert result["Shared"] == 0.0
    # Eng: 300 + 70% of 200 = 300 + 140 = 440
    assert result["Eng"] == 440.0
    # Data: 100 + 30% of 200 = 100 + 60 = 160
    assert result["Data"] == 160.0


# --- MTD processing tests ---


def _make_mtd_collected(
    current_groups: list[dict],
    prev_complete_groups: list[dict],
    prev_month_groups: list[dict],
    yoy_groups: list[dict],
    prev_month_partial_groups: list[dict],
    cc_mapping: dict[str, str] | None = None,
    prior_partial_dates: tuple[str, str] = ("2026-01-01", "2026-01-08"),
) -> dict:
    """Build a collected dict simulating normal daily (MTD) run output."""
    return {
        "now": datetime(2026, 2, 8, 6, 0, 0, tzinfo=timezone.utc),
        "is_mtd": True,
        "periods": {
            "current": ("2026-02-01", "2026-02-08"),
            "prev_complete": ("2026-01-01", "2026-02-01"),
            "prev_month": ("2025-12-01", "2026-01-01"),
            "yoy": ("2025-02-01", "2025-02-08"),
            "prev_month_partial": prior_partial_dates,
        },
        "period_labels": {
            "current": "2026-02",
            "prev_complete": "2026-01",
            "prev_month": "2025-12",
            "yoy": "2025-02",
            "prev_month_partial": "2026-01",
        },
        "raw_data": {
            "current": current_groups,
            "prev_complete": prev_complete_groups,
            "prev_month": prev_month_groups,
            "yoy": yoy_groups,
            "prev_month_partial": prev_month_partial_groups,
        },
        "cc_mapping": cc_mapping or {},
    }


def test_process_mtd_sets_is_mtd_flag() -> None:
    """process() with is_mtd=True sets is_mtd: true in summary."""
    collected = _make_collected(
        current_groups=[_make_group("app", "BoxUsage:m5.xlarge", 100, 10)],
        prev_groups=[],
        yoy_groups=[],
    )
    result = process(collected, is_mtd=True)
    assert result["summary"]["is_mtd"] is True


def test_process_non_mtd_sets_is_mtd_false() -> None:
    """process() without is_mtd=True sets is_mtd: false in summary."""
    collected = _make_collected(
        current_groups=[_make_group("app", "BoxUsage:m5.xlarge", 100, 10)],
        prev_groups=[],
        yoy_groups=[],
    )
    result = process(collected, is_mtd=False)
    assert result["summary"]["is_mtd"] is False


def test_process_mtd_includes_mtd_comparison() -> None:
    """process() with is_mtd=True and prev_month_partial data emits mtd_comparison."""
    collected = _make_mtd_collected(
        current_groups=[
            _make_group("web-app", "BoxUsage:m5.xlarge", 800, 100),
            _make_group("api", "BoxUsage:t3.medium", 200, 50),
        ],
        prev_complete_groups=[
            _make_group("web-app", "BoxUsage:m5.xlarge", 1000, 744),
        ],
        prev_month_groups=[
            _make_group("web-app", "BoxUsage:m5.xlarge", 900, 720),
        ],
        yoy_groups=[],
        prev_month_partial_groups=[
            _make_group("web-app", "BoxUsage:m5.xlarge", 250, 80),
            _make_group("api", "BoxUsage:t3.medium", 70, 25),
        ],
        cc_mapping={"web-app": "Engineering", "api": "Engineering"},
        prior_partial_dates=("2026-01-01", "2026-01-08"),
    )

    result = process(collected, is_mtd=True)
    summary = result["summary"]

    # is_mtd flag present
    assert summary["is_mtd"] is True

    # mtd_comparison must be present
    assert "mtd_comparison" in summary
    mtd_cmp = summary["mtd_comparison"]

    # Date range
    assert mtd_cmp["prior_partial_start"] == "2026-01-01"
    assert mtd_cmp["prior_partial_end_exclusive"] == "2026-01-08"

    # One cost center (Engineering) with combined prior partial cost
    assert len(mtd_cmp["cost_centers"]) == 1
    eng_cmp = mtd_cmp["cost_centers"][0]
    assert eng_cmp["name"] == "Engineering"
    assert eng_cmp["prior_partial_cost_usd"] == 320.0  # 250 + 70

    # Workloads in mtd_comparison
    wl_names = {w["name"] for w in eng_cmp["workloads"]}
    assert "web-app" in wl_names
    assert "api" in wl_names
    web_wl = next(w for w in eng_cmp["workloads"] if w["name"] == "web-app")
    assert web_wl["prior_partial_cost_usd"] == 250.0
    api_wl = next(w for w in eng_cmp["workloads"] if w["name"] == "api")
    assert api_wl["prior_partial_cost_usd"] == 70.0


def test_process_mtd_no_comparison_without_partial_data() -> None:
    """process() with is_mtd=True but no prev_month_partial data omits mtd_comparison."""
    collected = _make_collected(
        current_groups=[_make_group("app", "BoxUsage:m5.xlarge", 100, 10)],
        prev_groups=[],
        yoy_groups=[],
    )
    # No prev_month_partial in raw_data
    result = process(collected, is_mtd=True)
    assert result["summary"]["is_mtd"] is True
    assert "mtd_comparison" not in result["summary"]


def test_process_mtd_comparison_absent_when_not_mtd() -> None:
    """process() with is_mtd=False never emits mtd_comparison even with partial data."""
    collected = _make_mtd_collected(
        current_groups=[_make_group("app", "BoxUsage:m5.xlarge", 100, 10)],
        prev_complete_groups=[],
        prev_month_groups=[],
        yoy_groups=[],
        prev_month_partial_groups=[_make_group("app", "BoxUsage:m5.xlarge", 30, 5)],
    )
    result = process(collected, is_mtd=False)
    assert result["summary"]["is_mtd"] is False
    assert "mtd_comparison" not in result["summary"]


def test_process_summary_periods_excludes_internal_keys() -> None:
    """summary.periods only contains current, prev_month, yoy — not prev_complete or prev_month_partial."""
    collected = _make_mtd_collected(
        current_groups=[_make_group("app", "BoxUsage:m5.xlarge", 100, 10)],
        prev_complete_groups=[],
        prev_month_groups=[],
        yoy_groups=[],
        prev_month_partial_groups=[],
    )
    result = process(collected, is_mtd=True)
    periods = result["summary"]["periods"]
    assert "current" in periods
    assert "prev_month" in periods
    assert "yoy" in periods
    assert "prev_complete" not in periods
    assert "prev_month_partial" not in periods


def test_yoy_cost_uses_workload_sum_when_yoy_allocated_predates_cost_category() -> None:
    """Regression vector 1: YoY falls back to workload sums when YoY period predates
    the Cost Category definition entirely.

    Scenario (Jan 2026 run):
    - Current (Jan 2026): valid allocated_costs with real cost center names.
    - YoY (Jan 2025): CE returns costs under "No cost category" because the Cost
      Category didn't exist yet. yoy_allocated has no keys matching any cc_name.

    Bug (pre-fix): the shared gate `if current_allocated and cc_name in current_allocated`
    was True for Jan 2026, so the code took the allocated path for ALL periods and called
    `yoy_allocated.get(cc_name, 0)` — returning 0 for every cost center instead of
    the correct workload-summed total (~$13,425).

    Fix: each period checks its own allocated dict independently, so when
    `cc_name not in yoy_allocated` the YoY period falls back to workload sums.
    """
    # Jan 2026 workloads: ~$13,835 total across two cost centers
    current_groups = [
        _make_group("web-app", "BoxUsage:m5.xlarge", 8000, 744),
        _make_group("api", "BoxUsage:t3.medium", 3000, 1488),
        _make_group("shared-infra", "BoxUsage:t3.small", 2835, 744),
    ]
    # Jan 2025 workloads: ~$13,425 total — predates cost category
    yoy_groups = [
        _make_group("web-app", "BoxUsage:m5.xlarge", 7500, 744),
        _make_group("api", "BoxUsage:t3.medium", 2800, 1488),
        _make_group("shared-infra", "BoxUsage:t3.small", 3125, 744),
    ]
    # Dec 2025 workloads
    prev_groups = [
        _make_group("web-app", "BoxUsage:m5.xlarge", 7800, 720),
        _make_group("api", "BoxUsage:t3.medium", 2900, 1440),
        _make_group("shared-infra", "BoxUsage:t3.small", 2700, 720),
    ]

    collected = _make_collected(
        current_groups=current_groups,
        prev_groups=prev_groups,
        yoy_groups=yoy_groups,
        cc_mapping={
            "web-app": "Engineering",
            "api": "Engineering",
            "shared-infra": "Shared Services",
        },
    )

    # Simulate split charge: Shared Services redistributes to Engineering.
    # Jan 2026 has valid allocated_costs with cost center names after redistribution.
    # Jan 2025 (yoy) returns "No cost category" — predates Cost Category definition.
    collected["split_charge_categories"] = ["Shared Services"]
    collected["split_charge_rules"] = [
        {
            "Source": "Shared Services",
            "Targets": ["Engineering"],
            "Method": "PROPORTIONAL",
            "Parameters": [],
        }
    ]
    collected["allocated_costs"] = {
        "current": {
            # After redistribution: Shared Services cost added to Engineering
            "Engineering": 13835.0,
            "Shared Services": 2835.0,
        },
        "prev_month": {
            "Engineering": 13400.0,
            "Shared Services": 2700.0,
        },
        # YoY predates Cost Category — CE returns sentinel key, not real cc names
        "yoy": {
            "No cost category": 13425.0,
        },
    }

    result = process(collected)
    ccs = result["summary"]["cost_centers"]

    eng = next(cc for cc in ccs if cc["name"] == "Engineering")
    shared = next(cc for cc in ccs if cc["name"] == "Shared Services")

    # Current: uses allocated costs (after split charge redistribution applied by processor)
    # Shared Services cost 2835 is redistributed to Engineering proportionally.
    # Engineering already has all cost in allocated (13835), Shared Services has 2835.
    # After redistribution: Engineering = 13835 + 2835 = 16670, Shared = 0
    assert eng["current_cost_usd"] == 16670.0
    assert shared["current_cost_usd"] == 0.0
    assert shared["is_split_charge"] is True

    # YoY: "No cost category" key doesn't match "Engineering" or "Shared Services",
    # so the processor must fall back to workload sums.
    # Engineering workload sum from yoy_groups: web-app(7500) + api(2800) = 10300
    assert eng["yoy_cost_usd"] == 10300.0, (
        "Engineering YoY must use workload sum (10300) not $0 from missing "
        "yoy_allocated key — the pre-fix bug returned 0 here"
    )
    # Shared Services workload sum from yoy_groups: shared-infra(3125)
    # (then zeroed because is_split_charge)
    assert shared["yoy_cost_usd"] == 0.0  # zeroed by split charge logic

    # Total YoY across non-split-charge cost centers must reflect actual Jan 2025 spend
    yoy_total = sum(cc["yoy_cost_usd"] for cc in ccs if not cc.get("is_split_charge"))
    assert yoy_total == 10300.0, (
        f"Total YoY should be 10300 (workload sums), got {yoy_total}. "
        "The pre-fix bug returned 0 because yoy_allocated had no matching keys."
    )


def test_yoy_cost_not_double_redistributed_when_cost_category_rules_changed() -> None:
    """Regression vector 2: YoY allocated costs are not re-redistributed by current
    split charge rules when the Cost Category existed in the YoY period.

    CE's NetAmortizedCost already encodes the historically-correct split charge
    allocation for the YoY period. Re-applying the current period's rules (which may
    differ — e.g. FIXED percentages in Jan 2026 vs PROPORTIONAL in Jan 2025) would
    corrupt the YoY totals.

    Scenario:
    - Jan 2026: FIXED split charge rules (60% Eng, 40% Data from Shared Services $1000).
    - Jan 2025 (yoy): Cost Category existed but with PROPORTIONAL rules. CE returns
      yoy_allocated already redistributed: Eng=$6200, Data=$4800, Shared=$0.
      If we re-apply Jan 2026 FIXED rules: Shared source is $0, so no harm in this
      specific case — but the test also covers the case where yoy_allocated still has
      a non-zero source balance, which would cause double-redistribution.

    The fix: only apply _apply_split_charge_redistribution to current_allocated.
    Historical periods trust CE's own NetAmortizedCost which already applied the
    period-correct rules.
    """
    current_groups = [
        _make_group("eng-app", "BoxUsage:m5.xlarge", 5000, 744),
        _make_group("data-app", "BoxUsage:r5.xlarge", 3000, 744),
        _make_group("shared-svc", "BoxUsage:t3.medium", 1000, 744),
    ]
    # YoY: same workloads but Cost Category had PROPORTIONAL rules.
    # CE returned yoy_allocated already incorporating those PROPORTIONAL results.
    # At that time Eng had $6000 and Data $4000 base, Shared had $800.
    # PROPORTIONAL: Eng gets 6000/10000*800=480, Data gets 4000/10000*800=320.
    # CE baked this in: Eng=6480, Data=4320, Shared=0.
    yoy_groups = [
        _make_group("eng-app", "BoxUsage:m5.xlarge", 6000, 744),
        _make_group("data-app", "BoxUsage:r5.xlarge", 4000, 744),
        _make_group("shared-svc", "BoxUsage:t3.medium", 800, 744),
    ]

    collected = _make_collected(
        current_groups=current_groups,
        prev_groups=[],
        yoy_groups=yoy_groups,
        cc_mapping={
            "eng-app": "Engineering",
            "data-app": "Data",
            "shared-svc": "Shared Services",
        },
    )

    # Current period: FIXED split charge — 60% to Engineering, 40% to Data
    collected["split_charge_categories"] = ["Shared Services"]
    collected["split_charge_rules"] = [
        {
            "Source": "Shared Services",
            "Targets": ["Engineering", "Data"],
            "Method": "FIXED",
            "Parameters": [{"Type": "ALLOCATION_PERCENTAGES", "Values": ["60", "40"]}],
        }
    ]
    collected["allocated_costs"] = {
        "current": {
            # Pre-redistribution: raw CE allocated totals for Jan 2026
            "Engineering": 5000.0,
            "Data": 3000.0,
            "Shared Services": 1000.0,
        },
        "prev_month": {},
        # YoY: CE already applied PROPORTIONAL rules for Jan 2025.
        # These are the correct final values for that period.
        "yoy": {
            "Engineering": 6480.0,
            "Data": 4320.0,
            "Shared Services": 0.0,
        },
    }

    result = process(collected)
    ccs = result["summary"]["cost_centers"]

    eng = next(cc for cc in ccs if cc["name"] == "Engineering")
    data = next(cc for cc in ccs if cc["name"] == "Data")
    shared = next(cc for cc in ccs if cc["name"] == "Shared Services")

    # Current: processor applies FIXED rules to current_allocated.
    # Engineering: 5000 + 60% of 1000 = 5600
    # Data: 3000 + 40% of 1000 = 3400
    assert eng["current_cost_usd"] == 5600.0
    assert data["current_cost_usd"] == 3400.0
    assert shared["current_cost_usd"] == 0.0
    assert shared["is_split_charge"] is True

    # YoY: processor must NOT re-apply FIXED rules to yoy_allocated.
    # CE already allocated correctly for Jan 2025 using PROPORTIONAL rules.
    # Expected: use yoy_allocated values as-is (Eng=6480, Data=4320).
    # Double-redistribution bug would re-apply FIXED rules to yoy_allocated:
    #   Shared source is already 0, so targets unchanged — this specific case is
    #   harmless. The more dangerous variant is tested below with non-zero yoy source.
    assert eng["yoy_cost_usd"] == 6480.0, (
        "Engineering YoY must use CE's already-allocated value (6480), "
        "not a re-redistributed total"
    )
    assert data["yoy_cost_usd"] == 4320.0, (
        "Data YoY must use CE's already-allocated value (4320), "
        "not a re-redistributed total"
    )

    # Verify the totals are consistent: YoY non-split-charge total = 6480 + 4320
    yoy_total = sum(cc["yoy_cost_usd"] for cc in ccs if not cc.get("is_split_charge"))
    assert yoy_total == 10800.0


def test_yoy_cost_not_double_redistributed_with_nonzero_yoy_source() -> None:
    """Regression vector 2b: double-redistribution when yoy_allocated has a non-zero
    source balance (the most dangerous variant).

    If AWS's Cost Category definition changed between Jan 2025 and Jan 2026 such that
    the source cost center retained a non-zero balance in yoy_allocated (e.g. new
    workloads were added to the source in Jan 2026 that didn't exist in Jan 2025),
    re-applying current FIXED rules would incorrectly redistribute that historical
    source balance using the wrong percentages.

    Setup: yoy_allocated has Shared=$500 non-zero (CE didn't fully zero it for that
    period for some reason). The processor must NOT re-apply FIXED rules on top.
    """
    current_groups = [
        _make_group("eng-app", "BoxUsage:m5.xlarge", 5000, 744),
        _make_group("shared-svc", "BoxUsage:t3.medium", 1000, 744),
    ]
    yoy_groups = [
        _make_group("eng-app", "BoxUsage:m5.xlarge", 4000, 744),
        _make_group("shared-svc", "BoxUsage:t3.medium", 500, 744),
    ]

    collected = _make_collected(
        current_groups=current_groups,
        prev_groups=[],
        yoy_groups=yoy_groups,
        cc_mapping={"eng-app": "Engineering", "shared-svc": "Shared Services"},
    )

    collected["split_charge_categories"] = ["Shared Services"]
    collected["split_charge_rules"] = [
        {
            "Source": "Shared Services",
            "Targets": ["Engineering"],
            "Method": "FIXED",
            "Parameters": [{"Type": "ALLOCATION_PERCENTAGES", "Values": ["100"]}],
        }
    ]
    collected["allocated_costs"] = {
        "current": {
            "Engineering": 5000.0,
            "Shared Services": 1000.0,
        },
        "prev_month": {},
        # yoy_allocated: CE returned Shared=$500 non-zero (historically correct)
        "yoy": {
            "Engineering": 4200.0,  # CE already allocated some Shared cost here
            "Shared Services": 500.0,  # remaining non-zero balance for this period
        },
    }

    result = process(collected)
    ccs = result["summary"]["cost_centers"]

    eng = next(cc for cc in ccs if cc["name"] == "Engineering")
    shared = next(cc for cc in ccs if cc["name"] == "Shared Services")

    # Current: processor applies FIXED 100% rule. Engineering = 5000 + 1000 = 6000.
    assert eng["current_cost_usd"] == 6000.0
    assert shared["current_cost_usd"] == 0.0

    # YoY: the processor does NOT re-apply the current FIXED split charge rules to
    # yoy_allocated. Instead, it redistributes the YoY source balance (Shared=$500)
    # proportionally to targets using their YoY amounts as weights (Bug 1 fix).
    # Since Engineering is the only target, it absorbs the full $500.
    # CE returned Engineering=4200, Shared=500 — the processor preserves the global
    # total (4700) without reusing the current period's percentages.
    assert eng["yoy_cost_usd"] == 4700.0, (
        "Engineering YoY must be 4700: CE's 4200 plus the $500 Shared source "
        "redistributed proportionally (Bug 1 fix preserves global YoY total)."
    )
    assert shared["yoy_cost_usd"] == 0.0  # zeroed after redistribution to targets


def test_yoy_global_total_preserves_split_charge_source_cost() -> None:
    """Bug 1 validation: split charge source cost must not vanish from YoY total.

    For current/prev_month, _apply_split_charge_redistribution() runs BEFORE the
    cost center loop, moving source costs to targets. The is_split_charge guard then
    safely zeroes the source because its cost already lives in the targets.

    For YoY, redistribution is intentionally skipped (to avoid double-redistribution
    with historically-different rules). But the is_split_charge guard still zeroes
    cc_yoy for the source CC. If yoy_allocated has a non-zero source balance, that
    cost vanishes -- it was never redistributed to targets, yet the source is zeroed.

    This test creates a scenario where:
    - yoy_allocated has Engineering=$4000 and Shared Services=$600 (non-zero source)
    - No redistribution is applied to yoy (correct -- avoid double-redistribution)
    - The is_split_charge guard zeroes Shared Services to $0
    - Expected global YoY total: $4600 (the true total from CE)
    - Buggy global YoY total: $4000 (the $600 disappeared)
    """
    current_groups = [
        _make_group("eng-app", "BoxUsage:m5.xlarge", 5000, 744),
        _make_group("shared-svc", "BoxUsage:t3.medium", 1000, 744),
    ]
    yoy_groups = [
        _make_group("eng-app", "BoxUsage:m5.xlarge", 4000, 744),
        _make_group("shared-svc", "BoxUsage:t3.medium", 600, 744),
    ]

    collected = _make_collected(
        current_groups=current_groups,
        prev_groups=[],
        yoy_groups=yoy_groups,
        cc_mapping={"eng-app": "Engineering", "shared-svc": "Shared Services"},
    )

    collected["split_charge_categories"] = ["Shared Services"]
    collected["split_charge_rules"] = [
        {
            "Source": "Shared Services",
            "Targets": ["Engineering"],
            "Method": "PROPORTIONAL",
            "Parameters": [],
        }
    ]
    collected["allocated_costs"] = {
        "current": {
            "Engineering": 5000.0,
            "Shared Services": 1000.0,
        },
        "prev_month": {},
        # YoY: CE returned a non-zero source balance for the historical period.
        # This is the correct CE output -- it must be preserved in the global total.
        "yoy": {
            "Engineering": 4000.0,
            "Shared Services": 600.0,
        },
    }

    result = process(collected)
    ccs = result["summary"]["cost_centers"]

    eng = next(cc for cc in ccs if cc["name"] == "Engineering")
    shared = next(cc for cc in ccs if cc["name"] == "Shared Services")

    # Shared Services is zeroed after redistribution
    assert shared["yoy_cost_usd"] == 0.0

    # Engineering absorbs the Shared source balance via proportional redistribution
    assert eng["yoy_cost_usd"] == 4600.0

    # The critical check: global YoY total must equal the true CE total ($4600).
    true_yoy_total = 4000.0 + 600.0  # sum of all yoy_allocated values
    actual_yoy_total = sum(cc["yoy_cost_usd"] for cc in ccs)

    assert actual_yoy_total == true_yoy_total, (
        f"Bug 1 confirmed: global YoY total is ${actual_yoy_total} but should be "
        f"${true_yoy_total}. The split charge source cost (${600.0}) vanished because "
        f"is_split_charge zeroed the source CC without redistribution to targets."
    )


def test_yoy_double_count_untagged_in_allocated_and_uncategorized() -> None:
    """Bug 2 validation: Untagged costs double-counted via allocated + workload fallback.

    Scenario:
    - Cost Category allocates $1000 to "Engineering" (which internally includes
      $200 from Untagged resources attributed by CC rules).
    - The App-tag CE query also returns an "Untagged" workload with $200 cost
      in the YoY period.
    - "Untagged" is NOT in cc_mapping, so it maps to "Uncategorized".
    - yoy_allocated has "Engineering"=$1000 but no "Uncategorized" key.
    - The fallback at lines 447-448 sums workload costs for "Uncategorized",
      producing $200 from the "Untagged" workload.

    Expected: global YoY total = $1000 (not $1200 from double-counting).
    """
    # Engineering workload: $800 (tagged portion visible in CE App-tag query)
    # Untagged workload: $200 (untagged portion, also visible in CE App-tag query)
    # But yoy_allocated["Engineering"] = $1000 (CC rolls up both tagged + untagged)
    yoy_groups = [
        _make_group("eng-service", "BoxUsage:m5.xlarge", 800, 744),
        _make_group("", "BoxUsage:t3.micro", 200, 744),  # Untagged
    ]

    collected = _make_collected(
        current_groups=[
            _make_group("eng-service", "BoxUsage:m5.xlarge", 900, 744),
        ],
        prev_groups=[
            _make_group("eng-service", "BoxUsage:m5.xlarge", 850, 744),
        ],
        yoy_groups=yoy_groups,
        cc_mapping={"eng-service": "Engineering"},
        # Note: "Untagged" is NOT in cc_mapping -> maps to "Uncategorized"
    )

    collected["allocated_costs"] = {
        "current": {"Engineering": 900.0},
        "prev_month": {"Engineering": 850.0},
        # YoY allocated: CC attributes ALL $1000 to Engineering
        # (includes the $200 from untagged resources)
        "yoy": {"Engineering": 1000.0},
    }

    result = process(collected)
    summary = result["summary"]
    cc_map = {cc["name"]: cc for cc in summary["cost_centers"]}

    engineering = cc_map["Engineering"]
    uncategorized = cc_map.get("Uncategorized")

    # Engineering should use yoy_allocated value
    assert engineering["yoy_cost_usd"] == 1000.0

    # The global YoY total should be $1000, not $1200
    global_yoy = sum(cc["yoy_cost_usd"] for cc in summary["cost_centers"])
    assert global_yoy == 1000.0, (
        f"Global YoY total is ${global_yoy}, expected $1000. "
        f"Uncategorized YoY = ${uncategorized['yoy_cost_usd'] if uncategorized else 'N/A'}. "
        f"Bug 2 confirmed: Untagged costs double-counted in both Engineering "
        f"(via allocated) and Uncategorized (via workload sum fallback)."
    )
