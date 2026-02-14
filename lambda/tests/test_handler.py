"""Tests for Lambda handler with moto mocking."""

from __future__ import annotations

import json

import boto3
import pytest
from moto import mock_aws


@mock_aws
def test_handler_integration(
    s3_bucket_env: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Integration test: handler collects, processes, writes to S3."""
    s3 = boto3.client("s3", region_name="us-east-1")
    s3.create_bucket(Bucket=s3_bucket_env)

    # Mock the collector to return test data
    from datetime import datetime, timezone

    from dapanoskop import handler as handler_module

    def mock_collect(cost_category_name: str = "") -> dict:
        return {
            "now": datetime(2026, 2, 1, 6, 0, 0, tzinfo=timezone.utc),
            "period_labels": {
                "current": "2026-01",
                "prev_month": "2025-12",
                "yoy": "2025-01",
            },
            "raw_data": {
                "current": [
                    {
                        "Keys": ["App$web-app", "BoxUsage:m5.xlarge"],
                        "Metrics": {
                            "UnblendedCost": {"Amount": "1000", "Unit": "USD"},
                            "UsageQuantity": {"Amount": "744", "Unit": "Hrs"},
                        },
                    }
                ],
                "prev_month": [
                    {
                        "Keys": ["App$web-app", "BoxUsage:m5.xlarge"],
                        "Metrics": {
                            "UnblendedCost": {"Amount": "900", "Unit": "USD"},
                            "UsageQuantity": {"Amount": "720", "Unit": "Hrs"},
                        },
                    }
                ],
                "yoy": [],
            },
            "cc_mapping": {"web-app": "Engineering"},
        }

    monkeypatch.setattr(handler_module, "collect", mock_collect)

    from dapanoskop.handler import handler

    result = handler({}, None)

    assert result["statusCode"] == 200
    body = json.loads(result["body"])
    assert body["period"] == "2026-01"

    # Verify files were written to S3
    objects = s3.list_objects_v2(Bucket=s3_bucket_env)
    keys = [obj["Key"] for obj in objects.get("Contents", [])]
    assert "2026-01/summary.json" in keys
    assert "2026-01/cost-by-workload.parquet" in keys
    assert "2026-01/cost-by-usage-type.parquet" in keys
    assert "index.json" in keys

    # Verify summary.json content
    summary_obj = s3.get_object(Bucket=s3_bucket_env, Key="2026-01/summary.json")
    summary = json.loads(summary_obj["Body"].read())
    assert summary["period"] == "2026-01"
    assert len(summary["cost_centers"]) == 1
    assert summary["cost_centers"][0]["name"] == "Engineering"

    # Verify index.json content
    index_obj = s3.get_object(Bucket=s3_bucket_env, Key="index.json")
    index_data = json.loads(index_obj["Body"].read())
    assert "2026-01" in index_data["periods"]


@mock_aws
def test_handler_backfill_mode(
    s3_bucket_env: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Test backfill mode processes multiple months."""
    s3 = boto3.client("s3", region_name="us-east-1")
    s3.create_bucket(Bucket=s3_bucket_env)

    from datetime import datetime, timezone

    from dapanoskop import handler as handler_module

    call_count = [0]
    collected_periods: list[str] = []

    def mock_collect(
        cost_category_name: str = "",
        target_year: int | None = None,
        target_month: int | None = None,
    ) -> dict:
        call_count[0] += 1
        # Track which periods were collected
        if target_year and target_month:
            period = f"{target_year:04d}-{target_month:02d}"
            collected_periods.append(period)
        return {
            "now": datetime(2026, 2, 1, 6, 0, 0, tzinfo=timezone.utc),
            "period_labels": {
                "current": f"{target_year:04d}-{target_month:02d}"
                if target_year and target_month
                else "2026-01",
                "prev_month": "2025-12",
                "yoy": "2025-01",
            },
            "raw_data": {
                "current": [
                    {
                        "Keys": ["App$web-app", "BoxUsage:m5.xlarge"],
                        "Metrics": {
                            "UnblendedCost": {"Amount": "100", "Unit": "USD"},
                            "UsageQuantity": {"Amount": "100", "Unit": "Hrs"},
                        },
                    }
                ],
                "prev_month": [],
                "yoy": [],
            },
            "cc_mapping": {"web-app": "Engineering"},
        }

    monkeypatch.setattr(handler_module, "collect", mock_collect)

    from dapanoskop.handler import handler

    # Request backfill for 3 months
    event = {"backfill": True, "months": 3}
    result = handler(event, None)

    assert result["statusCode"] == 200
    body = json.loads(result["body"])
    assert body["message"] == "backfill_complete"
    assert len(body["succeeded"]) == 3
    assert len(body["failed"]) == 0
    assert len(body["skipped"]) == 0

    # Verify all three months were processed
    assert call_count[0] == 3

    # Verify the periods collected are in reverse chronological order
    # Current date in mock is Feb 2026, so backfill should process Jan, Dec, Nov
    assert "2026-01" in collected_periods
    assert "2025-12" in collected_periods
    assert "2025-11" in collected_periods

    # Verify files were written to S3 for each period
    objects = s3.list_objects_v2(Bucket=s3_bucket_env)
    keys = [obj["Key"] for obj in objects.get("Contents", [])]

    for period in collected_periods:
        assert f"{period}/summary.json" in keys

    # Verify index.json was updated once at the end
    assert "index.json" in keys


@mock_aws
def test_handler_backfill_skip_existing(
    s3_bucket_env: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Test backfill skips months that already exist unless force=True."""
    s3 = boto3.client("s3", region_name="us-east-1")
    s3.create_bucket(Bucket=s3_bucket_env)

    # Pre-populate S3 with data for 2026-01
    s3.put_object(
        Bucket=s3_bucket_env,
        Key="2026-01/summary.json",
        Body=json.dumps({"period": "2026-01"}).encode(),
    )

    from datetime import datetime, timezone

    from dapanoskop import handler as handler_module

    call_count = [0]

    def mock_collect(
        cost_category_name: str = "",
        target_year: int | None = None,
        target_month: int | None = None,
    ) -> dict:
        call_count[0] += 1
        return {
            "now": datetime(2026, 2, 1, 6, 0, 0, tzinfo=timezone.utc),
            "period_labels": {
                "current": f"{target_year:04d}-{target_month:02d}"
                if target_year and target_month
                else "2026-01",
                "prev_month": "2025-12",
                "yoy": "2025-01",
            },
            "raw_data": {
                "current": [
                    {
                        "Keys": ["App$web-app", "BoxUsage:m5.xlarge"],
                        "Metrics": {
                            "UnblendedCost": {"Amount": "100", "Unit": "USD"},
                            "UsageQuantity": {"Amount": "100", "Unit": "Hrs"},
                        },
                    }
                ],
                "prev_month": [],
                "yoy": [],
            },
            "cc_mapping": {},
        }

    monkeypatch.setattr(handler_module, "collect", mock_collect)

    from dapanoskop.handler import handler

    # Request backfill for 2 months (should skip 2026-01)
    event = {"backfill": True, "months": 2}
    result = handler(event, None)

    body = json.loads(result["body"])
    assert len(body["skipped"]) == 1
    assert "2026-01" in body["skipped"]
    assert len(body["succeeded"]) == 1  # Only 2025-12 processed
    # collect() called once (skipped month doesn't call collect)
    assert call_count[0] == 1


@mock_aws
def test_handler_backfill_force_reprocess(
    s3_bucket_env: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Test backfill force=True reprocesses existing months."""
    s3 = boto3.client("s3", region_name="us-east-1")
    s3.create_bucket(Bucket=s3_bucket_env)

    # Pre-populate S3 with data for 2026-01
    s3.put_object(
        Bucket=s3_bucket_env,
        Key="2026-01/summary.json",
        Body=json.dumps({"period": "2026-01"}).encode(),
    )

    from datetime import datetime, timezone

    from dapanoskop import handler as handler_module

    call_count = [0]

    def mock_collect(
        cost_category_name: str = "",
        target_year: int | None = None,
        target_month: int | None = None,
    ) -> dict:
        call_count[0] += 1
        return {
            "now": datetime(2026, 2, 1, 6, 0, 0, tzinfo=timezone.utc),
            "period_labels": {
                "current": f"{target_year:04d}-{target_month:02d}"
                if target_year and target_month
                else "2026-01",
                "prev_month": "2025-12",
                "yoy": "2025-01",
            },
            "raw_data": {
                "current": [
                    {
                        "Keys": ["App$web-app", "BoxUsage:m5.xlarge"],
                        "Metrics": {
                            "UnblendedCost": {"Amount": "100", "Unit": "USD"},
                            "UsageQuantity": {"Amount": "100", "Unit": "Hrs"},
                        },
                    }
                ],
                "prev_month": [],
                "yoy": [],
            },
            "cc_mapping": {},
        }

    monkeypatch.setattr(handler_module, "collect", mock_collect)

    from dapanoskop.handler import handler

    # Request backfill with force=True
    event = {"backfill": True, "months": 1, "force": True}
    result = handler(event, None)

    body = json.loads(result["body"])
    assert len(body["skipped"]) == 0  # Nothing skipped
    assert len(body["succeeded"]) == 1  # 2026-01 reprocessed
    assert "2026-01" in body["succeeded"]
    assert call_count[0] == 1


@mock_aws
def test_handler_backfill_partial_failure(
    s3_bucket_env: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Test backfill returns 207 status with mixed results when one month fails."""
    s3 = boto3.client("s3", region_name="us-east-1")
    s3.create_bucket(Bucket=s3_bucket_env)

    from datetime import datetime, timezone

    from dapanoskop import handler as handler_module

    call_count = [0]

    def mock_collect(
        cost_category_name: str = "",
        target_year: int | None = None,
        target_month: int | None = None,
    ) -> dict:
        call_count[0] += 1
        # Fail on the second month (2025-12)
        if target_year == 2025 and target_month == 12:
            raise RuntimeError("Simulated collection failure")

        return {
            "now": datetime(2026, 2, 1, 6, 0, 0, tzinfo=timezone.utc),
            "period_labels": {
                "current": f"{target_year:04d}-{target_month:02d}"
                if target_year and target_month
                else "2026-01",
                "prev_month": "2025-12",
                "yoy": "2025-01",
            },
            "raw_data": {
                "current": [
                    {
                        "Keys": ["App$web-app", "BoxUsage:m5.xlarge"],
                        "Metrics": {
                            "UnblendedCost": {"Amount": "100", "Unit": "USD"},
                            "UsageQuantity": {"Amount": "100", "Unit": "Hrs"},
                        },
                    }
                ],
                "prev_month": [],
                "yoy": [],
            },
            "cc_mapping": {},
        }

    monkeypatch.setattr(handler_module, "collect", mock_collect)

    from dapanoskop.handler import handler

    # Request backfill for 3 months
    event = {"backfill": True, "months": 3}
    result = handler(event, None)

    # Should return 207 Multi-Status for partial success
    assert result["statusCode"] == 207

    body = json.loads(result["body"])
    assert body["message"] == "backfill_complete"
    assert len(body["succeeded"]) == 2  # 2026-01 and 2025-11
    assert len(body["failed"]) == 1  # 2025-12
    assert body["failed"][0]["period"] == "2025-12"
    assert "Simulated collection failure" in body["failed"][0]["error"]


@mock_aws
def test_handler_backfill_s3_write_failure(
    s3_bucket_env: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Test backfill captures S3 write failures per-month."""
    s3 = boto3.client("s3", region_name="us-east-1")
    s3.create_bucket(Bucket=s3_bucket_env)

    from datetime import datetime, timezone

    from dapanoskop import handler as handler_module

    def mock_collect(
        cost_category_name: str = "",
        target_year: int | None = None,
        target_month: int | None = None,
    ) -> dict:
        return {
            "now": datetime(2026, 2, 1, 6, 0, 0, tzinfo=timezone.utc),
            "period_labels": {
                "current": f"{target_year:04d}-{target_month:02d}"
                if target_year and target_month
                else "2026-01",
                "prev_month": "2025-12",
                "yoy": "2025-01",
            },
            "raw_data": {
                "current": [
                    {
                        "Keys": ["App$web-app", "BoxUsage:m5.xlarge"],
                        "Metrics": {
                            "UnblendedCost": {"Amount": "100", "Unit": "USD"},
                            "UsageQuantity": {"Amount": "100", "Unit": "Hrs"},
                        },
                    }
                ],
                "prev_month": [],
                "yoy": [],
            },
            "cc_mapping": {},
        }

    def mock_write_to_s3(*args, **kwargs):
        raise RuntimeError("S3 write failed")

    monkeypatch.setattr(handler_module, "collect", mock_collect)
    monkeypatch.setattr(handler_module, "write_to_s3", mock_write_to_s3)

    from dapanoskop.handler import handler

    event = {"backfill": True, "months": 2}
    result = handler(event, None)

    assert result["statusCode"] == 207
    body = json.loads(result["body"])
    assert len(body["succeeded"]) == 0
    assert len(body["failed"]) == 2
    assert all("S3 write failed" in fail["error"] for fail in body["failed"])


@mock_aws
def test_handler_missing_data_bucket_env(monkeypatch: pytest.MonkeyPatch) -> None:
    """Test handler raises error when DATA_BUCKET env var is missing."""
    # Unset DATA_BUCKET (override the fixture)
    monkeypatch.delenv("DATA_BUCKET", raising=False)

    from dapanoskop.handler import handler

    with pytest.raises(
        ValueError, match="DATA_BUCKET environment variable is required"
    ):
        handler({}, None)


def test_handler_normal_mode_exception(
    s3_bucket_env: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Test that exceptions in normal mode propagate to caller."""
    from dapanoskop import handler as handler_module

    def mock_collect(cost_category_name: str = "") -> dict:
        raise RuntimeError("Cost Explorer API error")

    monkeypatch.setattr(handler_module, "collect", mock_collect)

    from dapanoskop.handler import handler

    # Normal mode should let exceptions propagate
    with pytest.raises(RuntimeError, match="Cost Explorer API error"):
        handler({}, None)


@mock_aws
def test_handler_error_response_no_arn_leak(
    s3_bucket_env: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Verify error messages in backfill response don't contain AWS account IDs."""
    import re

    s3 = boto3.client("s3", region_name="us-east-1")
    s3.create_bucket(Bucket=s3_bucket_env)

    from dapanoskop import handler as handler_module

    def mock_collect(
        cost_category_name: str = "",
        target_year: int | None = None,
        target_month: int | None = None,
    ) -> dict:
        # Simulate an error with an ARN containing account ID
        raise RuntimeError(
            "AccessDenied: User arn:aws:iam::123456789012:user/test is not authorized"
        )

    monkeypatch.setattr(handler_module, "collect", mock_collect)

    from dapanoskop.handler import handler

    event = {"backfill": True, "months": 1}
    result = handler(event, None)

    body = json.loads(result["body"])
    assert len(body["failed"]) == 1

    error_message = body["failed"][0]["error"]

    # Verify error message contains the error but NOT the account ID
    assert "AccessDenied" in error_message or "not authorized" in error_message
    assert "REDACTED" in error_message

    # Check that no 12-digit AWS account IDs are present
    account_id_pattern = r"\b\d{12}\b"
    matches = re.findall(account_id_pattern, error_message)
    assert len(matches) == 0, f"Account IDs leaked in error message: {matches}"
