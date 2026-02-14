"""Tests for cost collector."""

from __future__ import annotations

from datetime import datetime, timezone
from unittest.mock import MagicMock

from moto import mock_aws

from dapanoskop.collector import (
    _get_periods,
    _month_range,
    get_cost_and_usage,
    get_cost_categories,
)


def test_month_range_regular() -> None:
    start, end = _month_range(2026, 3)
    assert start == "2026-03-01"
    assert end == "2026-04-01"


def test_month_range_december() -> None:
    start, end = _month_range(2025, 12)
    assert start == "2025-12-01"
    assert end == "2026-01-01"


def test_get_periods_mid_month() -> None:
    """On Feb 10, current period should be January."""
    now = datetime(2026, 2, 10, 12, 0, 0, tzinfo=timezone.utc)
    periods = _get_periods(now)

    assert periods["current"][0] == "2026-01-01"
    assert periods["prev_month"][0] == "2025-12-01"
    assert periods["yoy"][0] == "2025-01-01"


def test_get_periods_first_of_month() -> None:
    """On Mar 1, current period should be February (previous complete month)."""
    now = datetime(2026, 3, 1, 6, 0, 0, tzinfo=timezone.utc)
    periods = _get_periods(now)

    assert periods["current"][0] == "2026-02-01"
    assert periods["prev_month"][0] == "2026-01-01"
    assert periods["yoy"][0] == "2025-02-01"


def test_get_periods_january() -> None:
    """On Jan 15, current period should be December of previous year."""
    now = datetime(2026, 1, 15, 6, 0, 0, tzinfo=timezone.utc)
    periods = _get_periods(now)

    assert periods["current"][0] == "2025-12-01"
    assert periods["prev_month"][0] == "2025-11-01"
    assert periods["yoy"][0] == "2024-12-01"


def test_get_periods_january_first() -> None:
    """On Jan 1, current period should be December of previous year."""
    now = datetime(2026, 1, 1, 6, 0, 0, tzinfo=timezone.utc)
    periods = _get_periods(now)

    assert periods["current"][0] == "2025-12-01"
    assert periods["prev_month"][0] == "2025-11-01"
    assert periods["yoy"][0] == "2024-12-01"


def test_get_periods_with_target_month() -> None:
    """Explicit target month overrides now parameter."""
    now = datetime(2026, 2, 10, 12, 0, 0, tzinfo=timezone.utc)
    # Request data for March 2025
    periods = _get_periods(now, target_year=2025, target_month=3)

    assert periods["current"][0] == "2025-03-01"
    assert periods["prev_month"][0] == "2025-02-01"
    assert periods["yoy"][0] == "2024-03-01"


def test_get_periods_with_target_january() -> None:
    """Target January handles year rollover correctly."""
    now = datetime(2026, 2, 10, 12, 0, 0, tzinfo=timezone.utc)
    periods = _get_periods(now, target_year=2025, target_month=1)

    assert periods["current"][0] == "2025-01-01"
    assert periods["prev_month"][0] == "2024-12-01"
    assert periods["yoy"][0] == "2024-01-01"


def test_get_cost_and_usage_pagination_logic() -> None:
    """Test that pagination logic aggregates all pages correctly."""
    mock_client = MagicMock()

    # First call returns data with NextPageToken
    # Second call returns data without NextPageToken
    mock_client.get_cost_and_usage.side_effect = [
        {
            "ResultsByTime": [
                {
                    "Groups": [
                        {
                            "Keys": ["App$web-app", "BoxUsage:m5.xlarge"],
                            "Metrics": {
                                "UnblendedCost": {"Amount": "100.0", "Unit": "USD"},
                                "UsageQuantity": {"Amount": "744.0", "Unit": "N/A"},
                            },
                        }
                    ]
                }
            ],
            "NextPageToken": "page2token",
        },
        {
            "ResultsByTime": [
                {
                    "Groups": [
                        {
                            "Keys": ["App$api", "BoxUsage:t3.medium"],
                            "Metrics": {
                                "UnblendedCost": {"Amount": "50.0", "Unit": "USD"},
                                "UsageQuantity": {"Amount": "372.0", "Unit": "N/A"},
                            },
                        }
                    ]
                }
            ],
        },
    ]

    results = get_cost_and_usage(mock_client, "2026-01-01", "2026-02-01")

    # Should have called twice
    assert mock_client.get_cost_and_usage.call_count == 2

    # First call should not have NextPageToken
    first_call = mock_client.get_cost_and_usage.call_args_list[0]
    assert "NextPageToken" not in first_call[1]

    # Second call should have NextPageToken
    second_call = mock_client.get_cost_and_usage.call_args_list[1]
    assert second_call[1]["NextPageToken"] == "page2token"

    # Results should contain both groups
    assert len(results) == 2
    assert results[0]["Keys"][0] == "App$web-app"
    assert results[1]["Keys"][0] == "App$api"


@mock_aws
def test_get_cost_and_usage_single_page() -> None:
    """Test basic query with single page of results."""
    import boto3

    ce_client = boto3.client("ce", region_name="us-east-1")

    # moto returns empty results, but we can verify the function runs without error
    results = get_cost_and_usage(ce_client, "2026-01-01", "2026-02-01")

    # moto doesn't fully implement CE, so we just verify it returns a list
    assert isinstance(results, list)


@mock_aws
def test_get_cost_and_usage_empty_response() -> None:
    """Test that empty response returns empty list."""
    import boto3

    ce_client = boto3.client("ce", region_name="us-east-1")

    results = get_cost_and_usage(ce_client, "2026-01-01", "2026-02-01")

    assert results == []


def test_get_cost_categories_discovers_first_category() -> None:
    """Test that when category_name is empty, uses first discovered category."""
    mock_client = MagicMock()

    # First call to get_cost_categories returns category names
    # Second call gets the category values
    # get_cost_and_usage call returns the mapping
    mock_client.get_cost_categories.side_effect = [
        {"CostCategoryNames": ["Environment"]},
        {},
    ]
    mock_client.get_cost_and_usage.return_value = {
        "ResultsByTime": [
            {
                "Groups": [
                    {
                        "Keys": ["App$web-app", "Environment$Production"],
                        "Metrics": {
                            "UnblendedCost": {"Amount": "100.0", "Unit": "USD"}
                        },
                    },
                    {
                        "Keys": ["App$api", "Environment$Development"],
                        "Metrics": {"UnblendedCost": {"Amount": "50.0", "Unit": "USD"}},
                    },
                ]
            }
        ],
    }

    mapping = get_cost_categories(mock_client, "", "2026-01-01", "2026-02-01")

    # Should have discovered "Environment" as the first category
    assert mapping == {"web-app": "Production", "api": "Development"}


def test_get_cost_categories_empty() -> None:
    """Test that when no categories exist, returns empty dict."""
    mock_client = MagicMock()

    # get_cost_categories returns no category names
    mock_client.get_cost_categories.return_value = {"CostCategoryNames": []}

    mapping = get_cost_categories(mock_client, "", "2026-01-01", "2026-02-01")

    assert mapping == {}
