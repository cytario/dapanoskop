"""Data-contract test: Lambda parquet output vs SPA DuckDB projection.

Guards against Lambda-side schema changes silently breaking the SPA.
The expected schemas below are derived from the DuckDB SELECT column lists in:
  app/app/routes/workload-detail.tsx (line ~100)
  app/app/routes/storage-cost-detail.tsx (line ~104)

If either the SPA query or the Lambda writer changes a column name or type,
this test must be updated in lockstep.
"""

from __future__ import annotations

import io
from datetime import datetime, timezone

import boto3
import pyarrow as pa
import pyarrow.parquet as pq
from moto import mock_aws

from dapanoskop.processor import process, write_to_s3

# ---------------------------------------------------------------------------
# Expected schemas — mirrors the SPA SELECT projections exactly
# ---------------------------------------------------------------------------

# Both workload-detail.tsx and storage-cost-detail.tsx project:
#   SELECT workload, usage_type, category, period, cost_usd, usage_quantity
#   FROM read_parquet(...)
EXPECTED_USAGE_TYPE_SCHEMA: dict[str, pa.DataType] = {
    "workload": pa.string(),
    "usage_type": pa.string(),
    "category": pa.string(),
    "period": pa.string(),
    "cost_usd": pa.float64(),
    "usage_quantity": pa.float64(),
}

# cost-by-workload.parquet is not queried by the SPA directly (it reads
# summary.json for workload aggregates), but we assert its schema here to
# catch regressions before they reach the index.
EXPECTED_WORKLOAD_SCHEMA: dict[str, pa.DataType] = {
    "cost_center": pa.string(),
    "workload": pa.string(),
    "period": pa.string(),
    "cost_usd": pa.float64(),
}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_group(app: str, usage_type: str, cost: float, quantity: float) -> dict:
    return {
        "Keys": [f"App${app}", usage_type],
        "Metrics": {
            "NetAmortizedCost": {"Amount": str(cost), "Unit": "USD"},
            "UsageQuantity": {"Amount": str(quantity), "Unit": "N/A"},
        },
    }


def _make_collected() -> dict:
    return {
        "now": datetime(2026, 2, 1, 6, 0, 0, tzinfo=timezone.utc),
        "period_labels": {
            "current": "2026-01",
            "prev_month": "2025-12",
            "yoy": "2025-01",
        },
        "raw_data": {
            "current": [
                _make_group("web-app", "BoxUsage:m5.xlarge", 1000.0, 744.0),
                _make_group("web-app", "TimedStorage-ByteHrs", 50.0, 200.0),
                _make_group("api", "Lambda-GB-Second", 20.0, 500.0),
            ],
            "prev_month": [
                _make_group("web-app", "BoxUsage:m5.xlarge", 900.0, 720.0),
                _make_group("api", "Lambda-GB-Second", 18.0, 480.0),
            ],
            "yoy": [
                _make_group("web-app", "BoxUsage:m5.xlarge", 700.0, 744.0),
            ],
        },
        "cc_mapping": {"web-app": "Engineering", "api": "Engineering"},
    }


def _read_parquet_from_s3(s3_client, bucket: str, key: str) -> pa.Table:
    obj = s3_client.get_object(Bucket=bucket, Key=key)
    return pq.read_table(io.BytesIO(obj["Body"].read()))


# ---------------------------------------------------------------------------
# Contract tests
# ---------------------------------------------------------------------------


@mock_aws
def test_cost_by_usage_type_parquet_schema_matches_spa_projection() -> None:
    """cost-by-usage-type.parquet columns and types must match the SPA SELECT."""
    bucket = "contract-test-bucket"
    s3 = boto3.client("s3", region_name="us-east-1")
    s3.create_bucket(Bucket=bucket)

    collected = _make_collected()
    processed = process(collected)
    write_to_s3(processed, bucket, update_index_file=False)

    table = _read_parquet_from_s3(s3, bucket, "2026-01/cost-by-usage-type.parquet")
    schema = table.schema

    actual = {field.name: field.type for field in schema}

    assert actual == EXPECTED_USAGE_TYPE_SCHEMA, (
        f"cost-by-usage-type.parquet schema mismatch.\n"
        f"  Expected: {EXPECTED_USAGE_TYPE_SCHEMA}\n"
        f"  Actual:   {actual}\n"
        "Update EXPECTED_USAGE_TYPE_SCHEMA and the SPA SELECT in lockstep."
    )


@mock_aws
def test_cost_by_usage_type_parquet_column_order_matches_spa_getchildat() -> None:
    """Column order must match the SPA's positional getChildAt(0..5) calls."""
    bucket = "contract-test-bucket"
    s3 = boto3.client("s3", region_name="us-east-1")
    s3.create_bucket(Bucket=bucket)

    collected = _make_collected()
    processed = process(collected)
    write_to_s3(processed, bucket, update_index_file=False)

    table = _read_parquet_from_s3(s3, bucket, "2026-01/cost-by-usage-type.parquet")

    expected_order = list(EXPECTED_USAGE_TYPE_SCHEMA.keys())
    actual_order = table.schema.names

    assert actual_order == expected_order, (
        f"cost-by-usage-type.parquet column order mismatch.\n"
        f"  Expected: {expected_order}\n"
        f"  Actual:   {actual_order}\n"
        "The SPA uses getChildAt(0..5) positionally — order is load-bearing."
    )


@mock_aws
def test_cost_by_workload_parquet_schema() -> None:
    """cost-by-workload.parquet columns and types are stable."""
    bucket = "contract-test-bucket"
    s3 = boto3.client("s3", region_name="us-east-1")
    s3.create_bucket(Bucket=bucket)

    collected = _make_collected()
    processed = process(collected)
    write_to_s3(processed, bucket, update_index_file=False)

    table = _read_parquet_from_s3(s3, bucket, "2026-01/cost-by-workload.parquet")
    schema = table.schema

    actual = {field.name: field.type for field in schema}

    assert actual == EXPECTED_WORKLOAD_SCHEMA, (
        f"cost-by-workload.parquet schema mismatch.\n"
        f"  Expected: {EXPECTED_WORKLOAD_SCHEMA}\n"
        f"  Actual:   {actual}"
    )


@mock_aws
def test_cost_by_usage_type_parquet_rows_are_non_empty() -> None:
    """Parquet file must contain at least one row for non-trivial input."""
    bucket = "contract-test-bucket"
    s3 = boto3.client("s3", region_name="us-east-1")
    s3.create_bucket(Bucket=bucket)

    collected = _make_collected()
    processed = process(collected)
    write_to_s3(processed, bucket, update_index_file=False)

    table = _read_parquet_from_s3(s3, bucket, "2026-01/cost-by-usage-type.parquet")

    assert table.num_rows > 0, "cost-by-usage-type.parquet must not be empty"


@mock_aws
def test_cost_by_usage_type_parquet_no_null_key_columns() -> None:
    """workload, usage_type, category, and period must never be null."""
    bucket = "contract-test-bucket"
    s3 = boto3.client("s3", region_name="us-east-1")
    s3.create_bucket(Bucket=bucket)

    collected = _make_collected()
    processed = process(collected)
    write_to_s3(processed, bucket, update_index_file=False)

    table = _read_parquet_from_s3(s3, bucket, "2026-01/cost-by-usage-type.parquet")

    for col in ("workload", "usage_type", "category", "period"):
        null_count = table.column(col).null_count
        assert null_count == 0, f"Column '{col}' contains {null_count} null value(s)"
