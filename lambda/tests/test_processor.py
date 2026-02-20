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
