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
        ("Requests-Tier1", "Storage"),
        ("Requests-Tier2", "Storage"),
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


@pytest.mark.parametrize(
    "usage_type,expected",
    [
        # Region-prefixed storage volume types
        ("USE1-TimedStorage-ByteHrs", "Storage"),
        ("EUW1-TimedStorage-ByteHrs", "Storage"),
        ("APN1-TimedStorage-INT-FA-ByteHrs", "Storage"),
        ("USE2-TimedStorage-GlacierByteHrs", "Storage"),
        ("USW2-TimedStorage-GlacierStaging", "Storage"),
        # Region-prefixed non-volume storage types
        ("EUW1-Requests-Tier1", "Storage"),
        ("USE1-Requests-Tier2", "Storage"),
        ("USE2-EarlyDelete-ByteHrs", "Storage"),
        ("APN1-Retrieval-SIA", "Storage"),
        ("EUW1-Select-Scanned-Bytes", "Storage"),
        ("USE1-TagStorage-TagHrs", "Storage"),
        ("USW2-Monitoring-AutoTag", "Storage"),
        # Region-prefixed compute types (should NOT become Storage)
        ("USE1-BoxUsage:m5.xlarge", "Compute"),
        ("EUW1-SpotUsage:c5.xlarge", "Compute"),
        # Region-prefixed support types (anchored with (^|-) so should still match)
        ("Tax-USEast", "Support"),
        ("USE1-Fee-Something", "Support"),
    ],
)
def test_categorize_region_prefixed_usage_types(usage_type: str, expected: str) -> None:
    """Test that region-prefixed usage types are correctly categorized (Categories fix).

    AWS Cost Explorer returns usage types with region prefixes like
    USE1-TimedStorage-ByteHrs. Regex patterns must not use ^ anchors
    that would prevent matching after the region prefix.
    """
    assert categorize(usage_type) == expected


def test_categorize_pattern_priority_timed_storage() -> None:
    """Test that TimedStorage is categorized as Storage (not Support).

    This verifies first-match-wins pattern ordering. Support patterns (Tax, Fee, etc.)
    are checked first but don't match TimedStorage. Then Storage patterns match.
    Reordering patterns could break this categorization.
    """
    assert categorize("TimedStorage-ByteHrs") == "Storage"
    assert categorize("TimedStorage-INT-FA-ByteHrs") == "Storage"
    assert categorize("TimedStorage-GlacierStaging") == "Storage"
