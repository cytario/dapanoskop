"""Tests for Lambda handler with moto mocking."""

from __future__ import annotations

import json

import boto3
import pytest
from moto import mock_aws


@mock_aws
def test_handler_integration(monkeypatch: pytest.MonkeyPatch) -> None:
    """Integration test: handler collects, processes, writes to S3."""
    # Create S3 bucket
    s3 = boto3.client("s3", region_name="us-east-1")
    s3.create_bucket(Bucket="test-data-bucket")

    monkeypatch.setenv("DATA_BUCKET", "test-data-bucket")
    monkeypatch.setenv("COST_CATEGORY_NAME", "")
    monkeypatch.setenv("INCLUDE_EFS", "false")
    monkeypatch.setenv("INCLUDE_EBS", "false")

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
    objects = s3.list_objects_v2(Bucket="test-data-bucket")
    keys = [obj["Key"] for obj in objects.get("Contents", [])]
    assert "2026-01/summary.json" in keys
    assert "2026-01/cost-by-workload.parquet" in keys
    assert "2026-01/cost-by-usage-type.parquet" in keys
    assert "index.json" in keys

    # Verify summary.json content
    summary_obj = s3.get_object(Bucket="test-data-bucket", Key="2026-01/summary.json")
    summary = json.loads(summary_obj["Body"].read())
    assert summary["period"] == "2026-01"
    assert len(summary["cost_centers"]) == 1
    assert summary["cost_centers"][0]["name"] == "Engineering"

    # Verify index.json content
    index_obj = s3.get_object(Bucket="test-data-bucket", Key="index.json")
    index_data = json.loads(index_obj["Body"].read())
    assert "2026-01" in index_data["periods"]
