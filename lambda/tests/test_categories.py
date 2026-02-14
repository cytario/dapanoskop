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


def test_categorize_pattern_priority_ebs() -> None:
    """Test that EBS volumes are categorized as Storage (not Other).

    This verifies first-match-wins pattern ordering. EBS: pattern comes before
    catch-all patterns, ensuring EBS volumes are correctly categorized as Storage.
    Reordering patterns could break this categorization.
    """
    assert categorize("EBS:VolumeUsage") == "Storage"
    assert categorize("EBS:VolumeUsage.gp3") == "Storage"
    assert categorize("EBS:SnapshotUsage") == "Storage"


def test_categorize_pattern_priority_timed_storage() -> None:
    """Test that TimedStorage is categorized as Storage (not Support).

    This verifies first-match-wins pattern ordering. Support patterns (Tax, Fee, etc.)
    are checked first but don't match TimedStorage. Then Storage patterns match.
    Reordering patterns could break this categorization.
    """
    assert categorize("TimedStorage-ByteHrs") == "Storage"
    assert categorize("TimedStorage-INT-FA-ByteHrs") == "Storage"
    assert categorize("TimedStorage-GlacierStaging") == "Storage"
