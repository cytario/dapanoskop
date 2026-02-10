"""Tests for usage type categorization."""

from __future__ import annotations

import pytest

from dapanoskop.categories import categorize


@pytest.mark.parametrize(
    "usage_type,expected",
    [
        # Storage
        ("TimedStorage-ByteHrs", "Storage"),
        ("TimedStorage-INT-FA-ByteHrs", "Storage"),
        ("TimedStorage-GlacierStaging", "Storage"),
        ("EarlyDeleteBytesHrs", "Storage"),
        ("EBS:VolumeUsage.gp3", "Storage"),
        ("EFS:StorageUsage", "Storage"),
        # Compute
        ("BoxUsage:m5.2xlarge", "Compute"),
        ("BoxUsage:t3.medium", "Compute"),
        ("SpotUsage:c5.xlarge", "Compute"),
        ("Lambda-GB-Second", "Compute"),
        ("Fargate-vCPU-Hours:perCPU", "Compute"),
        # Other
        ("DataTransfer-Out-Bytes", "Other"),
        ("NatGateway-Hours", "Other"),
        ("Requests-Tier1", "Other"),
        ("Requests-Tier2", "Other"),
        ("CW:MetricMonitorUsage", "Other"),
        ("SomeUnknownUsageType", "Other"),
        # Support
        ("Tax-USEast", "Support"),
        ("Fee-Something", "Support"),
        ("Premium-Support", "Support"),
    ],
)
def test_categorize(usage_type: str, expected: str) -> None:
    assert categorize(usage_type) == expected
