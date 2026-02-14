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
    collected = _make_collected(
        current_groups=[
            _make_group("web-app", "BoxUsage:m5.xlarge", 1000, 744),
            _make_group("web-app", "TimedStorage-ByteHrs", 200, 100000000),
            _make_group("api", "BoxUsage:t3.medium", 500, 1488),
        ],
        prev_groups=[
            _make_group("web-app", "BoxUsage:m5.xlarge", 900, 720),
            _make_group("web-app", "TimedStorage-ByteHrs", 180, 90000000),
            _make_group("api", "BoxUsage:t3.medium", 480, 1440),
        ],
        yoy_groups=[
            _make_group("web-app", "BoxUsage:m5.xlarge", 700, 744),
            _make_group("web-app", "TimedStorage-ByteHrs", 150, 80000000),
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
    """Test storage metric calculations."""
    collected = _make_collected(
        current_groups=[
            _make_group("app", "TimedStorage-ByteHrs", 500, 730_000_000_000),
            _make_group("app", "TimedStorage-INT-FA-ByteHrs", 200, 365_000_000_000),
            _make_group("app", "TimedStorage-GlacierStaging", 50, 730_000_000_000),
        ],
        prev_groups=[
            _make_group("app", "TimedStorage-ByteHrs", 450, 700_000_000_000),
        ],
        yoy_groups=[],
    )

    result = process(collected)
    sm = result["summary"]["storage_metrics"]

    assert sm["total_cost_usd"] == 750.0
    assert sm["prev_month_cost_usd"] == 450.0
    assert sm["total_volume_bytes"] > 0
    # Hot tier = (ByteHrs + INT-FA) / total = (730B + 365B) / (730B + 365B + 730B)
    expected_hot = (
        (730_000_000_000 + 365_000_000_000)
        / (730_000_000_000 + 365_000_000_000 + 730_000_000_000)
        * 100
    )
    assert abs(sm["hot_tier_percentage"] - round(expected_hot, 1)) < 0.2


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
