"""Generate mock fixture data for local development.

Produces summary.json and parquet files matching the SDS-DP-040002/040003 schemas.
Output: app/fixtures/{period}/summary.json, cost-by-workload.parquet, cost-by-usage-type.parquet
"""

from __future__ import annotations

import json
from pathlib import Path

import pyarrow as pa
import pyarrow.parquet as pq

FIXTURES_DIR = Path(__file__).resolve().parent.parent / "app" / "fixtures"

PERIODS = {
    "2026-01": {
        "current": "2026-01",
        "prev_month": "2025-12",
        "yoy": "2025-01",
    },
    "2025-12": {
        "current": "2025-12",
        "prev_month": "2025-11",
        "yoy": "2024-12",
    },
}

# ---------------------------------------------------------------------------
# Summary data (matches wireframe values)
# ---------------------------------------------------------------------------

SUMMARIES: dict[str, dict] = {
    "2026-01": {
        "collected_at": "2026-02-01T06:00:00Z",
        "period": "2026-01",
        "periods": PERIODS["2026-01"],
        "storage_config": {"include_efs": False, "include_ebs": False},
        "storage_metrics": {
            "total_cost_usd": 4200.00,
            "prev_month_cost_usd": 4050.00,
            "total_volume_bytes": 5497558138880,
            "hot_tier_percentage": 62.3,
            "cost_per_tb_usd": 23.45,
        },
        "cost_centers": [
            {
                "name": "Engineering",
                "current_cost_usd": 15000.00,
                "prev_month_cost_usd": 14200.00,
                "yoy_cost_usd": 11000.00,
                "workloads": [
                    {
                        "name": "data-pipeline",
                        "current_cost_usd": 5000.00,
                        "prev_month_cost_usd": 4800.00,
                        "yoy_cost_usd": 3200.00,
                    },
                    {
                        "name": "ml-training",
                        "current_cost_usd": 4200.00,
                        "prev_month_cost_usd": 4100.00,
                        "yoy_cost_usd": 3500.00,
                    },
                    {
                        "name": "web-platform",
                        "current_cost_usd": 3100.00,
                        "prev_month_cost_usd": 3000.00,
                        "yoy_cost_usd": 2800.00,
                    },
                    {
                        "name": "monitoring",
                        "current_cost_usd": 1700.00,
                        "prev_month_cost_usd": 1500.00,
                        "yoy_cost_usd": 1000.00,
                    },
                    {
                        "name": "Untagged",
                        "current_cost_usd": 1000.00,
                        "prev_month_cost_usd": 800.00,
                        "yoy_cost_usd": 500.00,
                    },
                ],
            },
            {
                "name": "Data Science",
                "current_cost_usd": 7000.00,
                "prev_month_cost_usd": 6800.00,
                "yoy_cost_usd": 5200.00,
                "workloads": [
                    {
                        "name": "analytics-platform",
                        "current_cost_usd": 3500.00,
                        "prev_month_cost_usd": 3400.00,
                        "yoy_cost_usd": 2600.00,
                    },
                    {
                        "name": "data-lake",
                        "current_cost_usd": 2500.00,
                        "prev_month_cost_usd": 2400.00,
                        "yoy_cost_usd": 1800.00,
                    },
                    {
                        "name": "batch-jobs",
                        "current_cost_usd": 1000.00,
                        "prev_month_cost_usd": 1000.00,
                        "yoy_cost_usd": 800.00,
                    },
                ],
            },
            {
                "name": "Platform",
                "current_cost_usd": 1500.00,
                "prev_month_cost_usd": 1200.00,
                "yoy_cost_usd": 800.00,
                "workloads": [
                    {
                        "name": "shared-services",
                        "current_cost_usd": 900.00,
                        "prev_month_cost_usd": 750.00,
                        "yoy_cost_usd": 500.00,
                    },
                    {
                        "name": "ci-cd",
                        "current_cost_usd": 600.00,
                        "prev_month_cost_usd": 450.00,
                        "yoy_cost_usd": 300.00,
                    },
                ],
            },
        ],
        "tagging_coverage": {
            "tagged_cost_usd": 22500.00,
            "untagged_cost_usd": 1000.00,
            "tagged_percentage": 95.7,
        },
    },
    "2025-12": {
        "collected_at": "2026-01-01T06:00:00Z",
        "period": "2025-12",
        "periods": PERIODS["2025-12"],
        "storage_config": {"include_efs": False, "include_ebs": False},
        "storage_metrics": {
            "total_cost_usd": 4050.00,
            "prev_month_cost_usd": 3900.00,
            "total_volume_bytes": 5200000000000,
            "hot_tier_percentage": 60.1,
            "cost_per_tb_usd": 22.80,
        },
        "cost_centers": [
            {
                "name": "Engineering",
                "current_cost_usd": 14200.00,
                "prev_month_cost_usd": 13800.00,
                "yoy_cost_usd": 10500.00,
                "workloads": [
                    {
                        "name": "data-pipeline",
                        "current_cost_usd": 4800.00,
                        "prev_month_cost_usd": 4600.00,
                        "yoy_cost_usd": 3000.00,
                    },
                    {
                        "name": "ml-training",
                        "current_cost_usd": 4100.00,
                        "prev_month_cost_usd": 4000.00,
                        "yoy_cost_usd": 3300.00,
                    },
                    {
                        "name": "web-platform",
                        "current_cost_usd": 3000.00,
                        "prev_month_cost_usd": 2900.00,
                        "yoy_cost_usd": 2700.00,
                    },
                    {
                        "name": "monitoring",
                        "current_cost_usd": 1500.00,
                        "prev_month_cost_usd": 1500.00,
                        "yoy_cost_usd": 1000.00,
                    },
                    {
                        "name": "Untagged",
                        "current_cost_usd": 800.00,
                        "prev_month_cost_usd": 800.00,
                        "yoy_cost_usd": 500.00,
                    },
                ],
            },
            {
                "name": "Data Science",
                "current_cost_usd": 6800.00,
                "prev_month_cost_usd": 6500.00,
                "yoy_cost_usd": 5000.00,
                "workloads": [
                    {
                        "name": "analytics-platform",
                        "current_cost_usd": 3400.00,
                        "prev_month_cost_usd": 3200.00,
                        "yoy_cost_usd": 2500.00,
                    },
                    {
                        "name": "data-lake",
                        "current_cost_usd": 2400.00,
                        "prev_month_cost_usd": 2300.00,
                        "yoy_cost_usd": 1700.00,
                    },
                    {
                        "name": "batch-jobs",
                        "current_cost_usd": 1000.00,
                        "prev_month_cost_usd": 1000.00,
                        "yoy_cost_usd": 800.00,
                    },
                ],
            },
            {
                "name": "Platform",
                "current_cost_usd": 1200.00,
                "prev_month_cost_usd": 1100.00,
                "yoy_cost_usd": 700.00,
                "workloads": [
                    {
                        "name": "shared-services",
                        "current_cost_usd": 750.00,
                        "prev_month_cost_usd": 700.00,
                        "yoy_cost_usd": 450.00,
                    },
                    {
                        "name": "ci-cd",
                        "current_cost_usd": 450.00,
                        "prev_month_cost_usd": 400.00,
                        "yoy_cost_usd": 250.00,
                    },
                ],
            },
        ],
        "tagging_coverage": {
            "tagged_cost_usd": 21400.00,
            "untagged_cost_usd": 800.00,
            "tagged_percentage": 96.4,
        },
    },
}

# ---------------------------------------------------------------------------
# Usage type detail data for parquet files
# ---------------------------------------------------------------------------

USAGE_TYPE_DATA: dict[str, list[dict]] = {
    "2026-01": [
        # data-pipeline
        {"workload": "data-pipeline", "usage_type": "TimedStorage-ByteHrs", "category": "Storage", "period": "2026-01", "cost_usd": 1800.00, "usage_quantity": 500000000.0},
        {"workload": "data-pipeline", "usage_type": "TimedStorage-ByteHrs", "category": "Storage", "period": "2025-12", "cost_usd": 1750.00, "usage_quantity": 480000000.0},
        {"workload": "data-pipeline", "usage_type": "TimedStorage-ByteHrs", "category": "Storage", "period": "2025-01", "cost_usd": 1300.00, "usage_quantity": 350000000.0},
        {"workload": "data-pipeline", "usage_type": "BoxUsage:m5.2xlarge", "category": "Compute", "period": "2026-01", "cost_usd": 1200.00, "usage_quantity": 744.0},
        {"workload": "data-pipeline", "usage_type": "BoxUsage:m5.2xlarge", "category": "Compute", "period": "2025-12", "cost_usd": 1200.00, "usage_quantity": 744.0},
        {"workload": "data-pipeline", "usage_type": "BoxUsage:m5.2xlarge", "category": "Compute", "period": "2025-01", "cost_usd": 800.00, "usage_quantity": 496.0},
        {"workload": "data-pipeline", "usage_type": "DataTransfer-Out-Bytes", "category": "Other", "period": "2026-01", "cost_usd": 800.00, "usage_quantity": 8000.0},
        {"workload": "data-pipeline", "usage_type": "DataTransfer-Out-Bytes", "category": "Other", "period": "2025-12", "cost_usd": 700.00, "usage_quantity": 7000.0},
        {"workload": "data-pipeline", "usage_type": "DataTransfer-Out-Bytes", "category": "Other", "period": "2025-01", "cost_usd": 500.00, "usage_quantity": 5000.0},
        {"workload": "data-pipeline", "usage_type": "TimedStorage-INT-FA-ByteHrs", "category": "Storage", "period": "2026-01", "cost_usd": 500.00, "usage_quantity": 140000000.0},
        {"workload": "data-pipeline", "usage_type": "TimedStorage-INT-FA-ByteHrs", "category": "Storage", "period": "2025-12", "cost_usd": 480.00, "usage_quantity": 130000000.0},
        {"workload": "data-pipeline", "usage_type": "TimedStorage-INT-FA-ByteHrs", "category": "Storage", "period": "2025-01", "cost_usd": 300.00, "usage_quantity": 80000000.0},
        {"workload": "data-pipeline", "usage_type": "NatGateway-Hours", "category": "Other", "period": "2026-01", "cost_usd": 350.00, "usage_quantity": 744.0},
        {"workload": "data-pipeline", "usage_type": "NatGateway-Hours", "category": "Other", "period": "2025-12", "cost_usd": 340.00, "usage_quantity": 720.0},
        {"workload": "data-pipeline", "usage_type": "NatGateway-Hours", "category": "Other", "period": "2025-01", "cost_usd": 200.00, "usage_quantity": 744.0},
        {"workload": "data-pipeline", "usage_type": "Requests-Tier1", "category": "Other", "period": "2026-01", "cost_usd": 200.00, "usage_quantity": 50000000.0},
        {"workload": "data-pipeline", "usage_type": "Requests-Tier1", "category": "Other", "period": "2025-12", "cost_usd": 190.00, "usage_quantity": 47000000.0},
        {"workload": "data-pipeline", "usage_type": "Requests-Tier1", "category": "Other", "period": "2025-01", "cost_usd": 100.00, "usage_quantity": 25000000.0},
        {"workload": "data-pipeline", "usage_type": "EBS:VolumeUsage.gp3", "category": "Storage", "period": "2026-01", "cost_usd": 150.00, "usage_quantity": 2000.0},
        {"workload": "data-pipeline", "usage_type": "EBS:VolumeUsage.gp3", "category": "Storage", "period": "2025-12", "cost_usd": 140.00, "usage_quantity": 1800.0},
        # ml-training
        {"workload": "ml-training", "usage_type": "BoxUsage:p3.2xlarge", "category": "Compute", "period": "2026-01", "cost_usd": 3200.00, "usage_quantity": 500.0},
        {"workload": "ml-training", "usage_type": "BoxUsage:p3.2xlarge", "category": "Compute", "period": "2025-12", "cost_usd": 3100.00, "usage_quantity": 480.0},
        {"workload": "ml-training", "usage_type": "BoxUsage:p3.2xlarge", "category": "Compute", "period": "2025-01", "cost_usd": 2600.00, "usage_quantity": 400.0},
        {"workload": "ml-training", "usage_type": "TimedStorage-ByteHrs", "category": "Storage", "period": "2026-01", "cost_usd": 800.00, "usage_quantity": 220000000.0},
        {"workload": "ml-training", "usage_type": "TimedStorage-ByteHrs", "category": "Storage", "period": "2025-12", "cost_usd": 800.00, "usage_quantity": 210000000.0},
        {"workload": "ml-training", "usage_type": "TimedStorage-ByteHrs", "category": "Storage", "period": "2025-01", "cost_usd": 700.00, "usage_quantity": 190000000.0},
        {"workload": "ml-training", "usage_type": "DataTransfer-Out-Bytes", "category": "Other", "period": "2026-01", "cost_usd": 200.00, "usage_quantity": 2000.0},
        {"workload": "ml-training", "usage_type": "DataTransfer-Out-Bytes", "category": "Other", "period": "2025-12", "cost_usd": 200.00, "usage_quantity": 2000.0},
        {"workload": "ml-training", "usage_type": "DataTransfer-Out-Bytes", "category": "Other", "period": "2025-01", "cost_usd": 200.00, "usage_quantity": 2000.0},
        # web-platform
        {"workload": "web-platform", "usage_type": "BoxUsage:m5.xlarge", "category": "Compute", "period": "2026-01", "cost_usd": 2000.00, "usage_quantity": 1488.0},
        {"workload": "web-platform", "usage_type": "BoxUsage:m5.xlarge", "category": "Compute", "period": "2025-12", "cost_usd": 1900.00, "usage_quantity": 1440.0},
        {"workload": "web-platform", "usage_type": "BoxUsage:m5.xlarge", "category": "Compute", "period": "2025-01", "cost_usd": 1800.00, "usage_quantity": 1440.0},
        {"workload": "web-platform", "usage_type": "DataTransfer-Out-Bytes", "category": "Other", "period": "2026-01", "cost_usd": 600.00, "usage_quantity": 6000.0},
        {"workload": "web-platform", "usage_type": "DataTransfer-Out-Bytes", "category": "Other", "period": "2025-12", "cost_usd": 600.00, "usage_quantity": 6000.0},
        {"workload": "web-platform", "usage_type": "DataTransfer-Out-Bytes", "category": "Other", "period": "2025-01", "cost_usd": 500.00, "usage_quantity": 5000.0},
        {"workload": "web-platform", "usage_type": "TimedStorage-ByteHrs", "category": "Storage", "period": "2026-01", "cost_usd": 500.00, "usage_quantity": 130000000.0},
        {"workload": "web-platform", "usage_type": "TimedStorage-ByteHrs", "category": "Storage", "period": "2025-12", "cost_usd": 500.00, "usage_quantity": 125000000.0},
        {"workload": "web-platform", "usage_type": "TimedStorage-ByteHrs", "category": "Storage", "period": "2025-01", "cost_usd": 500.00, "usage_quantity": 120000000.0},
        # monitoring
        {"workload": "monitoring", "usage_type": "BoxUsage:t3.medium", "category": "Compute", "period": "2026-01", "cost_usd": 1000.00, "usage_quantity": 2976.0},
        {"workload": "monitoring", "usage_type": "BoxUsage:t3.medium", "category": "Compute", "period": "2025-12", "cost_usd": 900.00, "usage_quantity": 2880.0},
        {"workload": "monitoring", "usage_type": "BoxUsage:t3.medium", "category": "Compute", "period": "2025-01", "cost_usd": 600.00, "usage_quantity": 1440.0},
        {"workload": "monitoring", "usage_type": "TimedStorage-ByteHrs", "category": "Storage", "period": "2026-01", "cost_usd": 500.00, "usage_quantity": 140000000.0},
        {"workload": "monitoring", "usage_type": "TimedStorage-ByteHrs", "category": "Storage", "period": "2025-12", "cost_usd": 400.00, "usage_quantity": 110000000.0},
        {"workload": "monitoring", "usage_type": "TimedStorage-ByteHrs", "category": "Storage", "period": "2025-01", "cost_usd": 300.00, "usage_quantity": 80000000.0},
        {"workload": "monitoring", "usage_type": "CW:MetricMonitorUsage", "category": "Other", "period": "2026-01", "cost_usd": 200.00, "usage_quantity": 5000.0},
        {"workload": "monitoring", "usage_type": "CW:MetricMonitorUsage", "category": "Other", "period": "2025-12", "cost_usd": 200.00, "usage_quantity": 5000.0},
        {"workload": "monitoring", "usage_type": "CW:MetricMonitorUsage", "category": "Other", "period": "2025-01", "cost_usd": 100.00, "usage_quantity": 2500.0},
        # analytics-platform
        {"workload": "analytics-platform", "usage_type": "BoxUsage:r5.xlarge", "category": "Compute", "period": "2026-01", "cost_usd": 2200.00, "usage_quantity": 744.0},
        {"workload": "analytics-platform", "usage_type": "BoxUsage:r5.xlarge", "category": "Compute", "period": "2025-12", "cost_usd": 2100.00, "usage_quantity": 720.0},
        {"workload": "analytics-platform", "usage_type": "BoxUsage:r5.xlarge", "category": "Compute", "period": "2025-01", "cost_usd": 1600.00, "usage_quantity": 744.0},
        {"workload": "analytics-platform", "usage_type": "TimedStorage-ByteHrs", "category": "Storage", "period": "2026-01", "cost_usd": 1000.00, "usage_quantity": 270000000.0},
        {"workload": "analytics-platform", "usage_type": "TimedStorage-ByteHrs", "category": "Storage", "period": "2025-12", "cost_usd": 1000.00, "usage_quantity": 260000000.0},
        {"workload": "analytics-platform", "usage_type": "TimedStorage-ByteHrs", "category": "Storage", "period": "2025-01", "cost_usd": 800.00, "usage_quantity": 210000000.0},
        {"workload": "analytics-platform", "usage_type": "Requests-Tier1", "category": "Other", "period": "2026-01", "cost_usd": 300.00, "usage_quantity": 75000000.0},
        {"workload": "analytics-platform", "usage_type": "Requests-Tier1", "category": "Other", "period": "2025-12", "cost_usd": 300.00, "usage_quantity": 72000000.0},
        {"workload": "analytics-platform", "usage_type": "Requests-Tier1", "category": "Other", "period": "2025-01", "cost_usd": 200.00, "usage_quantity": 50000000.0},
        # data-lake
        {"workload": "data-lake", "usage_type": "TimedStorage-ByteHrs", "category": "Storage", "period": "2026-01", "cost_usd": 1800.00, "usage_quantity": 490000000.0},
        {"workload": "data-lake", "usage_type": "TimedStorage-ByteHrs", "category": "Storage", "period": "2025-12", "cost_usd": 1700.00, "usage_quantity": 470000000.0},
        {"workload": "data-lake", "usage_type": "TimedStorage-ByteHrs", "category": "Storage", "period": "2025-01", "cost_usd": 1300.00, "usage_quantity": 350000000.0},
        {"workload": "data-lake", "usage_type": "Requests-Tier1", "category": "Other", "period": "2026-01", "cost_usd": 400.00, "usage_quantity": 100000000.0},
        {"workload": "data-lake", "usage_type": "Requests-Tier1", "category": "Other", "period": "2025-12", "cost_usd": 400.00, "usage_quantity": 95000000.0},
        {"workload": "data-lake", "usage_type": "Requests-Tier1", "category": "Other", "period": "2025-01", "cost_usd": 300.00, "usage_quantity": 75000000.0},
        {"workload": "data-lake", "usage_type": "TimedStorage-INT-FA-ByteHrs", "category": "Storage", "period": "2026-01", "cost_usd": 300.00, "usage_quantity": 80000000.0},
        {"workload": "data-lake", "usage_type": "TimedStorage-INT-FA-ByteHrs", "category": "Storage", "period": "2025-12", "cost_usd": 300.00, "usage_quantity": 75000000.0},
        {"workload": "data-lake", "usage_type": "TimedStorage-INT-FA-ByteHrs", "category": "Storage", "period": "2025-01", "cost_usd": 200.00, "usage_quantity": 55000000.0},
        # batch-jobs
        {"workload": "batch-jobs", "usage_type": "BoxUsage:c5.2xlarge", "category": "Compute", "period": "2026-01", "cost_usd": 800.00, "usage_quantity": 300.0},
        {"workload": "batch-jobs", "usage_type": "BoxUsage:c5.2xlarge", "category": "Compute", "period": "2025-12", "cost_usd": 800.00, "usage_quantity": 300.0},
        {"workload": "batch-jobs", "usage_type": "BoxUsage:c5.2xlarge", "category": "Compute", "period": "2025-01", "cost_usd": 650.00, "usage_quantity": 240.0},
        {"workload": "batch-jobs", "usage_type": "DataTransfer-Out-Bytes", "category": "Other", "period": "2026-01", "cost_usd": 200.00, "usage_quantity": 2000.0},
        {"workload": "batch-jobs", "usage_type": "DataTransfer-Out-Bytes", "category": "Other", "period": "2025-12", "cost_usd": 200.00, "usage_quantity": 2000.0},
        {"workload": "batch-jobs", "usage_type": "DataTransfer-Out-Bytes", "category": "Other", "period": "2025-01", "cost_usd": 150.00, "usage_quantity": 1500.0},
        # shared-services
        {"workload": "shared-services", "usage_type": "BoxUsage:t3.large", "category": "Compute", "period": "2026-01", "cost_usd": 600.00, "usage_quantity": 1488.0},
        {"workload": "shared-services", "usage_type": "BoxUsage:t3.large", "category": "Compute", "period": "2025-12", "cost_usd": 500.00, "usage_quantity": 1440.0},
        {"workload": "shared-services", "usage_type": "BoxUsage:t3.large", "category": "Compute", "period": "2025-01", "cost_usd": 350.00, "usage_quantity": 744.0},
        {"workload": "shared-services", "usage_type": "NatGateway-Hours", "category": "Other", "period": "2026-01", "cost_usd": 300.00, "usage_quantity": 744.0},
        {"workload": "shared-services", "usage_type": "NatGateway-Hours", "category": "Other", "period": "2025-12", "cost_usd": 250.00, "usage_quantity": 720.0},
        {"workload": "shared-services", "usage_type": "NatGateway-Hours", "category": "Other", "period": "2025-01", "cost_usd": 150.00, "usage_quantity": 744.0},
        # ci-cd
        {"workload": "ci-cd", "usage_type": "BoxUsage:t3.medium", "category": "Compute", "period": "2026-01", "cost_usd": 400.00, "usage_quantity": 1488.0},
        {"workload": "ci-cd", "usage_type": "BoxUsage:t3.medium", "category": "Compute", "period": "2025-12", "cost_usd": 300.00, "usage_quantity": 1440.0},
        {"workload": "ci-cd", "usage_type": "BoxUsage:t3.medium", "category": "Compute", "period": "2025-01", "cost_usd": 200.00, "usage_quantity": 744.0},
        {"workload": "ci-cd", "usage_type": "TimedStorage-ByteHrs", "category": "Storage", "period": "2026-01", "cost_usd": 200.00, "usage_quantity": 55000000.0},
        {"workload": "ci-cd", "usage_type": "TimedStorage-ByteHrs", "category": "Storage", "period": "2025-12", "cost_usd": 150.00, "usage_quantity": 40000000.0},
        {"workload": "ci-cd", "usage_type": "TimedStorage-ByteHrs", "category": "Storage", "period": "2025-01", "cost_usd": 100.00, "usage_quantity": 27000000.0},
        # Untagged
        {"workload": "Untagged", "usage_type": "BoxUsage:t3.small", "category": "Compute", "period": "2026-01", "cost_usd": 600.00, "usage_quantity": 2976.0},
        {"workload": "Untagged", "usage_type": "BoxUsage:t3.small", "category": "Compute", "period": "2025-12", "cost_usd": 500.00, "usage_quantity": 2880.0},
        {"workload": "Untagged", "usage_type": "BoxUsage:t3.small", "category": "Compute", "period": "2025-01", "cost_usd": 300.00, "usage_quantity": 1440.0},
        {"workload": "Untagged", "usage_type": "DataTransfer-Out-Bytes", "category": "Other", "period": "2026-01", "cost_usd": 400.00, "usage_quantity": 4000.0},
        {"workload": "Untagged", "usage_type": "DataTransfer-Out-Bytes", "category": "Other", "period": "2025-12", "cost_usd": 300.00, "usage_quantity": 3000.0},
        {"workload": "Untagged", "usage_type": "DataTransfer-Out-Bytes", "category": "Other", "period": "2025-01", "cost_usd": 200.00, "usage_quantity": 2000.0},
    ],
}

# Use 2026-01 data shifted for 2025-12 (simplified — same structure, already have prev_month data in summaries)
USAGE_TYPE_DATA["2025-12"] = USAGE_TYPE_DATA["2026-01"]

# ---------------------------------------------------------------------------
# Build cost-center -> workload mapping for workload parquet
# ---------------------------------------------------------------------------

WORKLOAD_CC_MAP: dict[str, dict[str, str]] = {}
for period_key, summary in SUMMARIES.items():
    WORKLOAD_CC_MAP[period_key] = {}
    for cc in summary["cost_centers"]:
        for wl in cc["workloads"]:
            WORKLOAD_CC_MAP[period_key][wl["name"]] = cc["name"]


def generate_workload_parquet_rows(period_key: str) -> list[dict]:
    """Build rows for cost-by-workload.parquet from summary data."""
    rows = []
    summary = SUMMARIES[period_key]
    periods_map = summary["periods"]
    for cc in summary["cost_centers"]:
        for wl in cc["workloads"]:
            rows.append({"cost_center": cc["name"], "workload": wl["name"], "period": periods_map["current"], "cost_usd": wl["current_cost_usd"]})
            rows.append({"cost_center": cc["name"], "workload": wl["name"], "period": periods_map["prev_month"], "cost_usd": wl["prev_month_cost_usd"]})
            if wl["yoy_cost_usd"] is not None:
                rows.append({"cost_center": cc["name"], "workload": wl["name"], "period": periods_map["yoy"], "cost_usd": wl["yoy_cost_usd"]})
    return rows


def write_period(period_key: str) -> None:
    """Write all fixture files for a single period."""
    out_dir = FIXTURES_DIR / period_key
    out_dir.mkdir(parents=True, exist_ok=True)

    # summary.json
    with open(out_dir / "summary.json", "w") as f:
        json.dump(SUMMARIES[period_key], f, indent=2)
    print(f"  {out_dir / 'summary.json'}")

    # cost-by-workload.parquet
    wl_rows = generate_workload_parquet_rows(period_key)
    wl_table = pa.table(
        {
            "cost_center": pa.array([r["cost_center"] for r in wl_rows], type=pa.string()),
            "workload": pa.array([r["workload"] for r in wl_rows], type=pa.string()),
            "period": pa.array([r["period"] for r in wl_rows], type=pa.string()),
            "cost_usd": pa.array([r["cost_usd"] for r in wl_rows], type=pa.float64()),
        }
    )
    pq.write_table(wl_table, out_dir / "cost-by-workload.parquet")
    print(f"  {out_dir / 'cost-by-workload.parquet'}")

    # cost-by-usage-type.parquet
    ut_rows = USAGE_TYPE_DATA[period_key]
    ut_table = pa.table(
        {
            "workload": pa.array([r["workload"] for r in ut_rows], type=pa.string()),
            "usage_type": pa.array([r["usage_type"] for r in ut_rows], type=pa.string()),
            "category": pa.array([r["category"] for r in ut_rows], type=pa.string()),
            "period": pa.array([r["period"] for r in ut_rows], type=pa.string()),
            "cost_usd": pa.array([r["cost_usd"] for r in ut_rows], type=pa.float64()),
            "usage_quantity": pa.array([r["usage_quantity"] for r in ut_rows], type=pa.float64()),
        }
    )
    pq.write_table(ut_table, out_dir / "cost-by-usage-type.parquet")
    print(f"  {out_dir / 'cost-by-usage-type.parquet'}")


def main() -> None:
    print("Generating fixtures...")
    for period_key in SUMMARIES:
        print(f"\nPeriod: {period_key}")
        write_period(period_key)
    print("\nDone.")


if __name__ == "__main__":
    main()
