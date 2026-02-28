"""Tests for cost collector."""

from __future__ import annotations

from datetime import datetime, timezone
from unittest.mock import MagicMock

from moto import mock_aws

from dapanoskop.collector import (
    _get_periods,
    _get_prior_partial_period,
    _month_range,
    collect,
    get_allocated_costs_by_category,
    get_cost_and_usage,
    get_cost_categories,
    get_split_charge_categories,
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
    """On Feb 10, current period (MTD) should be February, prev_complete is January."""
    now = datetime(2026, 2, 10, 12, 0, 0, tzinfo=timezone.utc)
    periods = _get_periods(now)

    # current = in-progress MTD month (Feb 2026, end = today exclusive)
    assert periods["current"][0] == "2026-02-01"
    assert periods["current"][1] == "2026-02-10"
    # prev_complete = most recently completed month (Jan 2026)
    assert periods["prev_complete"][0] == "2026-01-01"
    assert periods["prev_complete"][1] == "2026-02-01"
    # prev_month = the month before prev_complete (Dec 2025)
    assert periods["prev_month"][0] == "2025-12-01"
    # yoy = same as current month, prior year (Feb 2025)
    assert periods["yoy"][0] == "2025-02-01"
    # prev_month_partial = same days into prior month (Jan 1–10)
    assert periods["prev_month_partial"][0] == "2026-01-01"
    assert periods["prev_month_partial"][1] == "2026-01-10"


def test_get_periods_first_of_month() -> None:
    """On Mar 1, MTD window has zero width — skip current, only prev_complete."""
    now = datetime(2026, 3, 1, 6, 0, 0, tzinfo=timezone.utc)
    periods = _get_periods(now)

    # No MTD period on the 1st (zero-width window)
    assert "current" not in periods
    assert "yoy" not in periods
    assert "prev_month_partial" not in periods
    # Only prev_complete related periods
    assert periods["prev_complete"][0] == "2026-02-01"
    assert periods["prev_month"][0] == "2026-01-01"
    assert periods["yoy_prev_complete"][0] == "2025-02-01"


def test_get_periods_january() -> None:
    """On Jan 15, current (MTD) is January, prev_complete is December."""
    now = datetime(2026, 1, 15, 6, 0, 0, tzinfo=timezone.utc)
    periods = _get_periods(now)

    assert periods["current"][0] == "2026-01-01"
    assert periods["current"][1] == "2026-01-15"
    assert periods["prev_complete"][0] == "2025-12-01"
    assert periods["prev_month"][0] == "2025-11-01"
    assert periods["yoy"][0] == "2025-01-01"
    # prev_month_partial: Jan 1–15 in prior month = Dec 1–15
    assert periods["prev_month_partial"][0] == "2025-12-01"
    assert periods["prev_month_partial"][1] == "2025-12-15"


def test_get_periods_january_first() -> None:
    """On Jan 1, MTD window has zero width — skip current, only prev_complete."""
    now = datetime(2026, 1, 1, 6, 0, 0, tzinfo=timezone.utc)
    periods = _get_periods(now)

    # No MTD period on the 1st (zero-width window)
    assert "current" not in periods
    assert "yoy" not in periods
    assert "prev_month_partial" not in periods
    # Only prev_complete related periods
    assert periods["prev_complete"][0] == "2025-12-01"
    assert periods["prev_month"][0] == "2025-11-01"
    assert periods["yoy_prev_complete"][0] == "2024-12-01"


def test_get_periods_with_target_month() -> None:
    """Explicit target month overrides now parameter (backfill mode)."""
    now = datetime(2026, 2, 10, 12, 0, 0, tzinfo=timezone.utc)
    # Request data for March 2025
    periods = _get_periods(now, target_year=2025, target_month=3)

    assert periods["current"][0] == "2025-03-01"
    assert periods["prev_month"][0] == "2025-02-01"
    assert periods["yoy"][0] == "2024-03-01"
    # Backfill mode should NOT include MTD-specific keys
    assert "prev_complete" not in periods
    assert "prev_month_partial" not in periods


def test_get_periods_with_target_january() -> None:
    """Target January handles year rollover correctly (backfill mode)."""
    now = datetime(2026, 2, 10, 12, 0, 0, tzinfo=timezone.utc)
    periods = _get_periods(now, target_year=2025, target_month=1)

    assert periods["current"][0] == "2025-01-01"
    assert periods["prev_month"][0] == "2024-12-01"
    assert periods["yoy"][0] == "2024-01-01"
    assert "prev_complete" not in periods
    assert "prev_month_partial" not in periods


def test_get_prior_partial_period_normal() -> None:
    """Prior partial period for a normal mid-month MTD window."""
    # Feb 8 MTD: Feb 1 – Feb 8 → Jan 1 – Jan 8
    start, end = _get_prior_partial_period("2026-02-01", "2026-02-08")
    assert start == "2026-01-01"
    assert end == "2026-01-08"


def test_get_prior_partial_period_january() -> None:
    """Prior partial period when current month is January (year rollover)."""
    # Jan 15 MTD: Jan 1 – Jan 15 → Dec 1 – Dec 15
    start, end = _get_prior_partial_period("2026-01-01", "2026-01-15")
    assert start == "2025-12-01"
    assert end == "2025-12-15"


def test_get_prior_partial_period_clamp_short_prior_month() -> None:
    """Prior partial period is clamped when prior month is shorter than MTD window."""
    # March 30 MTD: Mar 1 – Mar 30 (29 days) → Feb 1 – Mar 1 (clamped, Feb has 28 days in 2026)
    start, end = _get_prior_partial_period("2026-03-01", "2026-03-30")
    assert start == "2026-02-01"
    assert end == "2026-03-01"  # clamped to start of current month


def test_get_prior_partial_period_clamp_leap_year() -> None:
    """Prior partial period NOT clamped when prior month (Feb 2024 leap) is long enough.

    March 29 MTD = 28 days. Feb 2024 has 29 days. Feb 1 + 28 days = Feb 29, valid.
    But March 30 MTD = 29 days → Feb 1 + 29 days = Mar 1, which exceeds Feb; clamped.
    """
    # March 29 MTD (28 days) in 2024: Feb 2024 has 29 days → NOT clamped
    start, end = _get_prior_partial_period("2024-03-01", "2024-03-29")
    assert start == "2024-02-01"
    assert end == "2024-02-29"  # valid: Feb 2024 has 29 days, not clamped

    # March 30 MTD (29 days) in 2024: Feb 1 + 29 days = Mar 1 → clamped
    start2, end2 = _get_prior_partial_period("2024-03-01", "2024-03-30")
    assert start2 == "2024-02-01"
    assert end2 == "2024-03-01"  # clamped to start of current month


def test_get_prior_partial_period_full_month_does_not_clamp() -> None:
    """Prior partial period for 15 days into March uses Feb 1–15 without clamping."""
    start, end = _get_prior_partial_period("2026-03-01", "2026-03-15")
    assert start == "2026-02-01"
    assert end == "2026-02-15"


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
                                "NetAmortizedCost": {"Amount": "100.0", "Unit": "USD"},
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
                                "NetAmortizedCost": {"Amount": "50.0", "Unit": "USD"},
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
                            "NetAmortizedCost": {"Amount": "100.0", "Unit": "USD"}
                        },
                    },
                    {
                        "Keys": ["App$api", "Environment$Development"],
                        "Metrics": {
                            "NetAmortizedCost": {"Amount": "50.0", "Unit": "USD"}
                        },
                    },
                ]
            }
        ],
    }

    name, mapping = get_cost_categories(mock_client, "", "2026-01-01", "2026-02-01")

    # Should have auto-discovered "Environment" as the category name
    assert name == "Environment"
    assert mapping == {"web-app": "Production", "api": "Development"}


def test_get_cost_categories_empty() -> None:
    """Test that when no categories exist, returns empty dict."""
    mock_client = MagicMock()

    # get_cost_categories returns no category names
    mock_client.get_cost_categories.return_value = {"CostCategoryNames": []}

    name, mapping = get_cost_categories(mock_client, "", "2026-01-01", "2026-02-01")

    assert name == ""
    assert mapping == {}


def test_collect_integration() -> None:
    """Test collect() end-to-end with mocked boto3 client (MTD mode)."""
    from unittest.mock import patch

    # Mock the entire boto3.client call to return a mock CE client
    mock_ce_client = MagicMock()

    # In MTD mode (no target), collect() queries (H1: per-period CC mappings):
    # 1-6:  raw cost data: current, prev_complete, prev_month, yoy, yoy_prev_complete, prev_month_partial
    # 7:    CC mapping: current (App tag + COST_CATEGORY)
    # 8:    CC mapping: prev_complete
    # 9:    CC mapping: prev_month
    # 10:   CC mapping: yoy
    # 11:   CC mapping: yoy_prev_complete
    # 12-17: allocated costs: current, prev_complete, prev_month, yoy, yoy_prev_complete, prev_month_partial
    mock_ce_client.get_cost_and_usage.side_effect = [
        # 1: current (MTD) — two groups
        {
            "ResultsByTime": [
                {
                    "Groups": [
                        {
                            "Keys": ["App$web-app", "BoxUsage:m5.xlarge"],
                            "Metrics": {
                                "NetAmortizedCost": {"Amount": "1000.0", "Unit": "USD"},
                                "UsageQuantity": {"Amount": "744.0", "Unit": "Hrs"},
                            },
                        },
                        {
                            "Keys": ["App$api", "TimedStorage-ByteHrs"],
                            "Metrics": {
                                "NetAmortizedCost": {"Amount": "100.0", "Unit": "USD"},
                                "UsageQuantity": {
                                    "Amount": "1000000.0",
                                    "Unit": "GB-Mo",
                                },
                            },
                        },
                    ]
                }
            ],
        },
        # 2: prev_complete — one group
        {
            "ResultsByTime": [
                {
                    "Groups": [
                        {
                            "Keys": ["App$web-app", "BoxUsage:m5.xlarge"],
                            "Metrics": {
                                "NetAmortizedCost": {"Amount": "950.0", "Unit": "USD"},
                                "UsageQuantity": {"Amount": "744.0", "Unit": "Hrs"},
                            },
                        }
                    ]
                }
            ],
        },
        # 3: prev_month — one group
        {
            "ResultsByTime": [
                {
                    "Groups": [
                        {
                            "Keys": ["App$web-app", "BoxUsage:m5.xlarge"],
                            "Metrics": {
                                "NetAmortizedCost": {"Amount": "900.0", "Unit": "USD"},
                                "UsageQuantity": {"Amount": "720.0", "Unit": "Hrs"},
                            },
                        }
                    ]
                }
            ],
        },
        # 4: yoy — one group
        {
            "ResultsByTime": [
                {
                    "Groups": [
                        {
                            "Keys": ["App$web-app", "BoxUsage:m5.xlarge"],
                            "Metrics": {
                                "NetAmortizedCost": {"Amount": "800.0", "Unit": "USD"},
                                "UsageQuantity": {"Amount": "700.0", "Unit": "Hrs"},
                            },
                        }
                    ]
                }
            ],
        },
        # 5: yoy_prev_complete — one group
        {
            "ResultsByTime": [
                {
                    "Groups": [
                        {
                            "Keys": ["App$web-app", "BoxUsage:m5.xlarge"],
                            "Metrics": {
                                "NetAmortizedCost": {"Amount": "750.0", "Unit": "USD"},
                                "UsageQuantity": {"Amount": "680.0", "Unit": "Hrs"},
                            },
                        }
                    ]
                }
            ],
        },
        # 6: prev_month_partial — one group
        {
            "ResultsByTime": [
                {
                    "Groups": [
                        {
                            "Keys": ["App$web-app", "BoxUsage:m5.xlarge"],
                            "Metrics": {
                                "NetAmortizedCost": {"Amount": "250.0", "Unit": "USD"},
                                "UsageQuantity": {"Amount": "200.0", "Unit": "Hrs"},
                            },
                        }
                    ]
                }
            ],
        },
        # 7: CC mapping: current (App tag + COST_CATEGORY)
        {
            "ResultsByTime": [
                {
                    "Groups": [
                        {
                            "Keys": ["App$web-app", "CostCenter$Engineering"],
                            "Metrics": {
                                "NetAmortizedCost": {"Amount": "1000.0", "Unit": "USD"}
                            },
                        },
                        {
                            "Keys": ["App$api", "CostCenter$Engineering"],
                            "Metrics": {
                                "NetAmortizedCost": {"Amount": "100.0", "Unit": "USD"}
                            },
                        },
                    ]
                }
            ],
        },
        # 8: CC mapping: prev_complete
        {
            "ResultsByTime": [
                {
                    "Groups": [
                        {
                            "Keys": ["App$web-app", "CostCenter$Engineering"],
                            "Metrics": {
                                "NetAmortizedCost": {"Amount": "950.0", "Unit": "USD"}
                            },
                        }
                    ]
                }
            ],
        },
        # 9: CC mapping: prev_month
        {
            "ResultsByTime": [
                {
                    "Groups": [
                        {
                            "Keys": ["App$web-app", "CostCenter$Engineering"],
                            "Metrics": {
                                "NetAmortizedCost": {"Amount": "900.0", "Unit": "USD"}
                            },
                        }
                    ]
                }
            ],
        },
        # 10: CC mapping: yoy
        {
            "ResultsByTime": [
                {
                    "Groups": [
                        {
                            "Keys": ["App$web-app", "CostCenter$Engineering"],
                            "Metrics": {
                                "NetAmortizedCost": {"Amount": "800.0", "Unit": "USD"}
                            },
                        }
                    ]
                }
            ],
        },
        # 11: CC mapping: yoy_prev_complete
        {
            "ResultsByTime": [
                {
                    "Groups": [
                        {
                            "Keys": ["App$web-app", "CostCenter$Engineering"],
                            "Metrics": {
                                "NetAmortizedCost": {"Amount": "750.0", "Unit": "USD"}
                            },
                        }
                    ]
                }
            ],
        },
        # 12: allocated costs: current
        {
            "ResultsByTime": [
                {
                    "Groups": [
                        {
                            "Keys": ["CostCenter$Engineering"],
                            "Metrics": {
                                "NetAmortizedCost": {"Amount": "1100.0", "Unit": "USD"}
                            },
                        }
                    ]
                }
            ],
        },
        # 9: allocated costs: prev_complete
        {
            "ResultsByTime": [
                {
                    "Groups": [
                        {
                            "Keys": ["CostCenter$Engineering"],
                            "Metrics": {
                                "NetAmortizedCost": {"Amount": "950.0", "Unit": "USD"}
                            },
                        }
                    ]
                }
            ],
        },
        # 10: allocated costs: prev_month
        {
            "ResultsByTime": [
                {
                    "Groups": [
                        {
                            "Keys": ["CostCenter$Engineering"],
                            "Metrics": {
                                "NetAmortizedCost": {"Amount": "900.0", "Unit": "USD"}
                            },
                        }
                    ]
                }
            ],
        },
        # 11: allocated costs: yoy
        {
            "ResultsByTime": [
                {
                    "Groups": [
                        {
                            "Keys": ["CostCenter$Engineering"],
                            "Metrics": {
                                "NetAmortizedCost": {"Amount": "800.0", "Unit": "USD"}
                            },
                        }
                    ]
                }
            ],
        },
        # 12: allocated costs: yoy_prev_complete
        {
            "ResultsByTime": [
                {
                    "Groups": [
                        {
                            "Keys": ["CostCenter$Engineering"],
                            "Metrics": {
                                "NetAmortizedCost": {"Amount": "750.0", "Unit": "USD"}
                            },
                        }
                    ]
                }
            ],
        },
        # 13: allocated costs: prev_month_partial
        {
            "ResultsByTime": [
                {
                    "Groups": [
                        {
                            "Keys": ["CostCenter$Engineering"],
                            "Metrics": {
                                "NetAmortizedCost": {"Amount": "250.0", "Unit": "USD"}
                            },
                        }
                    ]
                }
            ],
        },
    ]

    # Mock get_cost_categories response.
    # H1: Per-period CC mapping queries — one call per non-partial period.
    # Call 1: discovery with CostCategoryName=CostCenter (no auto-discovery needed)
    # Calls 2-5: per-period mapping for prev_complete, prev_month, yoy, yoy_prev_complete
    mock_ce_client.get_cost_categories.side_effect = [
        {},  # current: with explicit CostCategoryName (returns values, not names)
        {},  # prev_complete
        {},  # prev_month
        {},  # yoy
        {},  # yoy_prev_complete
    ]

    # Mock list_cost_category_definitions for split charge detection
    mock_ce_client.list_cost_category_definitions.return_value = {
        "CostCategoryReferences": [
            {
                "Name": "CostCenter",
                "CostCategoryArn": "arn:aws:ce::123456789012:costcategory/abc-123",
            }
        ]
    }

    # Mock describe_cost_category_definition for split charge rules
    mock_ce_client.describe_cost_category_definition.return_value = {
        "CostCategory": {
            "Name": "CostCenter",
            "SplitChargeRules": [],
        }
    }

    with patch("boto3.client", return_value=mock_ce_client):
        result = collect(cost_category_name="CostCenter")

    # Verify structure of returned data
    assert "now" in result
    assert "is_mtd" in result
    assert result["is_mtd"] is True
    assert "period_labels" in result
    assert "raw_data" in result
    assert "cc_mapping" in result
    assert "split_charge_categories" in result
    assert "allocated_costs" in result

    # Verify period labels (MTD mode includes extra keys)
    assert "current" in result["period_labels"]
    assert "prev_complete" in result["period_labels"]
    assert "prev_month" in result["period_labels"]
    assert "yoy" in result["period_labels"]
    assert "yoy_prev_complete" in result["period_labels"]
    assert "prev_month_partial" in result["period_labels"]

    # Verify raw_data contains all six periods
    assert "current" in result["raw_data"]
    assert "prev_complete" in result["raw_data"]
    assert "prev_month" in result["raw_data"]
    assert "yoy" in result["raw_data"]
    assert "yoy_prev_complete" in result["raw_data"]
    assert "prev_month_partial" in result["raw_data"]

    # Verify data was collected
    assert len(result["raw_data"]["current"]) == 2
    assert len(result["raw_data"]["prev_complete"]) == 1
    assert len(result["raw_data"]["prev_month"]) == 1
    assert len(result["raw_data"]["yoy"]) == 1
    assert len(result["raw_data"]["yoy_prev_complete"]) == 1
    assert len(result["raw_data"]["prev_month_partial"]) == 1

    # Verify cost category mapping (backward-compat key = current period mapping)
    assert result["cc_mapping"] == {"web-app": "Engineering", "api": "Engineering"}
    # Verify per-period mappings are present (H1)
    assert "cc_mappings" in result
    assert "current" in result["cc_mappings"]
    assert "prev_complete" in result["cc_mappings"]
    assert "prev_month" in result["cc_mappings"]
    assert "yoy" in result["cc_mappings"]
    assert "yoy_prev_complete" in result["cc_mappings"]
    # prev_month_partial is not included in cc_mappings
    assert "prev_month_partial" not in result["cc_mappings"]

    # Verify split charge categories and rules (should be empty in this test)
    assert result["split_charge_categories"] == []
    assert result["split_charge_rules"] == []

    # Verify allocated costs: current, prev_complete, prev_month, yoy, yoy_prev_complete, prev_month_partial
    assert "current" in result["allocated_costs"]
    assert "prev_complete" in result["allocated_costs"]
    assert "prev_month" in result["allocated_costs"]
    assert "yoy" in result["allocated_costs"]
    assert "yoy_prev_complete" in result["allocated_costs"]
    assert "prev_month_partial" in result["allocated_costs"]
    assert result["allocated_costs"]["current"] == {"Engineering": 1100.0}
    assert result["allocated_costs"]["prev_complete"] == {"Engineering": 950.0}
    assert result["allocated_costs"]["yoy_prev_complete"] == {"Engineering": 750.0}
    assert result["allocated_costs"]["prev_month_partial"] == {"Engineering": 250.0}

    # Verify get_cost_and_usage was called 17 times (H1: per-period CC mappings):
    # 6 periods + 5 for CC mappings (current + 4 non-partial periods) + 6 for allocated costs
    assert mock_ce_client.get_cost_and_usage.call_count == 17


def test_collect_with_target_month() -> None:
    """Test collect() with explicit target_month generates correct date ranges (backfill mode)."""
    from unittest.mock import patch

    mock_ce_client = MagicMock()

    # In backfill mode (target provided), only 3 periods are queried (no MTD extras)
    mock_ce_client.get_cost_and_usage.return_value = {"ResultsByTime": [{"Groups": []}]}
    mock_ce_client.get_cost_categories.return_value = {"CostCategoryNames": []}
    # Mock split charge detection calls (won't be called since category_name is empty, but safe to mock)
    mock_ce_client.list_cost_category_definitions.return_value = {
        "CostCategoryReferences": []
    }
    mock_ce_client.describe_cost_category_definition.return_value = {
        "CostCategory": {"SplitChargeRules": []}
    }

    with patch("boto3.client", return_value=mock_ce_client):
        result = collect(
            cost_category_name="",
            target_year=2025,
            target_month=6,
        )

    # Verify is_mtd is False in backfill mode
    assert result["is_mtd"] is False

    # Verify period labels reflect the target month (no MTD-specific keys)
    assert result["period_labels"]["current"] == "2025-06"
    assert result["period_labels"]["prev_month"] == "2025-05"
    assert result["period_labels"]["yoy"] == "2024-06"
    assert "prev_complete" not in result["period_labels"]
    assert "prev_month_partial" not in result["period_labels"]

    # Verify get_cost_and_usage was called with correct date ranges
    calls = mock_ce_client.get_cost_and_usage.call_args_list

    # First call should be for current period (2025-06)
    first_call_time_period = calls[0][1]["TimePeriod"]
    assert first_call_time_period["Start"] == "2025-06-01"
    assert first_call_time_period["End"] == "2025-07-01"

    # Second call should be for prev_month (2025-05)
    second_call_time_period = calls[1][1]["TimePeriod"]
    assert second_call_time_period["Start"] == "2025-05-01"
    assert second_call_time_period["End"] == "2025-06-01"

    # Third call should be for yoy (2024-06)
    third_call_time_period = calls[2][1]["TimePeriod"]
    assert third_call_time_period["Start"] == "2024-06-01"
    assert third_call_time_period["End"] == "2024-07-01"

    # Only 3 CE calls (no category, no allocated costs)
    assert mock_ce_client.get_cost_and_usage.call_count == 3


def test_get_split_charge_categories_returns_rules() -> None:
    """Test that split charge rules include full Source/Targets/Method/Parameters."""
    mock_client = MagicMock()

    mock_client.list_cost_category_definitions.return_value = {
        "CostCategoryReferences": [
            {
                "Name": "CostCenter",
                "CostCategoryArn": "arn:aws:ce::123456789012:costcategory/abc-123",
            }
        ]
    }
    mock_client.describe_cost_category_definition.return_value = {
        "CostCategory": {
            "Name": "CostCenter",
            "SplitChargeRules": [
                {
                    "Source": "Shared Services",
                    "Targets": ["Engineering", "Data"],
                    "Method": "PROPORTIONAL",
                },
                {
                    "Source": "Platform",
                    "Targets": ["Engineering"],
                    "Method": "EVEN",
                    "Parameters": [],
                },
            ],
        }
    }

    sources, rules = get_split_charge_categories(mock_client, "CostCenter")

    assert sources == ["Platform", "Shared Services"]
    assert len(rules) == 2
    assert rules[0]["Source"] == "Platform" or rules[0]["Source"] == "Shared Services"
    # Verify all rules have required keys
    for rule in rules:
        assert "Source" in rule
        assert "Targets" in rule
        assert "Method" in rule
        assert "Parameters" in rule


def test_get_allocated_costs_uses_net_amortized() -> None:
    """Verify get_allocated_costs_by_category reads NetAmortizedCost from API response."""
    mock_client = MagicMock()
    mock_client.get_cost_and_usage.return_value = {
        "ResultsByTime": [
            {
                "Groups": [
                    {
                        "Keys": ["CostCenter$Engineering"],
                        "Metrics": {
                            "NetAmortizedCost": {"Amount": "1500.0", "Unit": "USD"},
                        },
                    }
                ]
            }
        ],
    }

    result = get_allocated_costs_by_category(
        mock_client, "CostCenter", "2026-01-01", "2026-02-01"
    )

    assert result == {"Engineering": 1500.0}
    # Verify the API was called with NetAmortizedCost metric
    call_kwargs = mock_client.get_cost_and_usage.call_args[1]
    assert call_kwargs["Metrics"] == ["NetAmortizedCost"]


def test_get_cost_categories_untagged_resources() -> None:
    """Test that empty app tags map to 'Untagged' instead of being dropped."""
    mock_client = MagicMock()
    mock_client.get_cost_and_usage.return_value = {
        "ResultsByTime": [
            {
                "Groups": [
                    {
                        "Keys": ["App$web-app", "CostCenter$Engineering"],
                        "Metrics": {
                            "NetAmortizedCost": {"Amount": "100.0", "Unit": "USD"}
                        },
                    },
                    {
                        "Keys": ["App$", "CostCenter$Shared"],
                        "Metrics": {
                            "NetAmortizedCost": {"Amount": "50.0", "Unit": "USD"}
                        },
                    },
                ]
            }
        ],
    }

    name, mapping = get_cost_categories(
        mock_client, "CostCenter", "2026-01-01", "2026-02-01"
    )

    assert name == "CostCenter"
    assert mapping == {"web-app": "Engineering", "Untagged": "Shared"}


def test_collect_auto_discovers_category_name() -> None:
    """When cost_category_name="" is passed to collect(), the auto-discovered
    category name must be used for split charge detection and allocated cost queries.
    """
    from unittest.mock import patch

    mock_ce_client = MagicMock()

    # Three periods of raw cost data (current, prev_month, yoy)
    empty_period = {"ResultsByTime": [{"Groups": []}]}

    # Cost category mapping query (App tag + COST_CATEGORY GroupBy)
    cc_mapping_response = {
        "ResultsByTime": [
            {
                "Groups": [
                    {
                        "Keys": ["App$api", "CostCenter$Platform"],
                        "Metrics": {
                            "NetAmortizedCost": {"Amount": "200.0", "Unit": "USD"}
                        },
                    }
                ]
            }
        ],
    }

    # Allocated costs by category (COST_CATEGORY only, NetAmortizedCost)
    allocated_response = {
        "ResultsByTime": [
            {
                "Groups": [
                    {
                        "Keys": ["CostCenter$Platform"],
                        "Metrics": {
                            "NetAmortizedCost": {"Amount": "200.0", "Unit": "USD"}
                        },
                    }
                ]
            }
        ],
    }

    # get_cost_and_usage call order in MTD mode (H1: per-period CC mappings):
    # 1-6:  six periods (raw cost data: current, prev_complete, prev_month, yoy, yoy_prev_complete, prev_month_partial)
    # 7:    CC mapping: current (App + COST_CATEGORY)
    # 8-11: CC mappings: prev_complete, prev_month, yoy, yoy_prev_complete
    # 12-17: allocated costs per period
    mock_ce_client.get_cost_and_usage.side_effect = [
        empty_period,  # current (MTD) raw data
        empty_period,  # prev_complete raw data
        empty_period,  # prev_month raw data
        empty_period,  # yoy raw data
        empty_period,  # yoy_prev_complete raw data
        empty_period,  # prev_month_partial raw data
        cc_mapping_response,  # CC mapping: current
        empty_period,  # CC mapping: prev_complete
        empty_period,  # CC mapping: prev_month
        empty_period,  # CC mapping: yoy
        empty_period,  # CC mapping: yoy_prev_complete
        allocated_response,  # allocated costs: current
        allocated_response,  # allocated costs: prev_complete
        allocated_response,  # allocated costs: prev_month
        allocated_response,  # allocated costs: yoy
        allocated_response,  # allocated costs: yoy_prev_complete
        allocated_response,  # allocated costs: prev_month_partial
    ]

    # Auto-discovery: first call returns the list of category names;
    # second call (with CostCategoryName kwarg) is for the current mapping query.
    # Subsequent calls (4 more) are for per-period mappings.
    mock_ce_client.get_cost_categories.side_effect = [
        {"CostCategoryNames": ["CostCenter"]},
        {},  # current period get_cost_categories values call
        {},  # prev_complete
        {},  # prev_month
        {},  # yoy
        {},  # yoy_prev_complete
    ]

    # Split charge rule present on the auto-discovered category
    mock_ce_client.list_cost_category_definitions.return_value = {
        "CostCategoryReferences": [
            {
                "Name": "CostCenter",
                "CostCategoryArn": "arn:aws:ce::123456789012:costcategory/xyz-999",
            }
        ]
    }
    mock_ce_client.describe_cost_category_definition.return_value = {
        "CostCategory": {
            "Name": "CostCenter",
            "SplitChargeRules": [
                {
                    "Source": "Shared",
                    "Targets": ["Platform"],
                    "Method": "PROPORTIONAL",
                },
            ],
        }
    }

    with patch("boto3.client", return_value=mock_ce_client):
        result = collect(cost_category_name="")

    # The auto-discovered name must have been forwarded to downstream calls,
    # so allocated_costs and split_charge_categories must NOT be empty.
    assert result["allocated_costs"] != {}, (
        "allocated_costs should be populated when a category is auto-discovered"
    )
    assert "current" in result["allocated_costs"]
    assert result["allocated_costs"]["current"] == {"Platform": 200.0}

    assert result["split_charge_categories"] != [], (
        "split_charge_categories should be populated when a category is auto-discovered"
    )
    assert result["split_charge_categories"] == ["Shared"]

    # cc_mapping should also reflect the auto-discovered category
    assert result["cc_mapping"] == {"api": "Platform"}
