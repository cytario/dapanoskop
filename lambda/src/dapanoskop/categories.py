"""Usage type categorization (Storage / Compute / Other / Support)."""

from __future__ import annotations

import re

# Pattern-based categorization of AWS usage types into business categories.
# Order matters: first match wins.
_PATTERNS: list[tuple[re.Pattern[str], str]] = [
    # Support
    (re.compile(r"^(Tax|Fee|Refund|Credit|Premium)", re.IGNORECASE), "Support"),
    # Storage — S3
    (re.compile(r"TimedStorage"), "Storage"),
    (re.compile(r"^EarlyDelete"), "Storage"),
    # Storage — EBS
    (re.compile(r"^EBS:"), "Storage"),
    # Storage — EFS
    (re.compile(r"^EFS:"), "Storage"),
    # Compute — EC2 / Lambda / ECS / Fargate
    (re.compile(r"BoxUsage"), "Compute"),
    (re.compile(r"SpotUsage"), "Compute"),
    (re.compile(r"^Lambda"), "Compute"),
    (re.compile(r"^Fargate"), "Compute"),
    (re.compile(r"^ECS"), "Compute"),
    # S3 request tiers
    (re.compile(r"Requests-"), "Other"),
    # Data transfer
    (re.compile(r"DataTransfer"), "Other"),
    (re.compile(r"^NatGateway"), "Other"),
    # CloudWatch
    (re.compile(r"^CW:"), "Other"),
]


def categorize(usage_type: str) -> str:
    """Categorize an AWS usage type string into Storage/Compute/Other/Support."""
    for pattern, category in _PATTERNS:
        if pattern.search(usage_type):
            return category
    return "Other"
