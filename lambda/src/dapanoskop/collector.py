"""Cost Explorer API data collection."""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

import boto3

logger = logging.getLogger(__name__)


def _month_range(year: int, month: int) -> tuple[str, str]:
    """Return (start, end) date strings for a month (CE API uses exclusive end)."""
    start = f"{year:04d}-{month:02d}-01"
    # CE end date is exclusive — first day of next month
    if month == 12:
        end = f"{year + 1:04d}-01-01"
    else:
        end = f"{year:04d}-{month + 1:02d}-01"
    return start, end


def _get_periods(now: datetime) -> dict[str, tuple[str, str]]:
    """Compute the three reporting periods.

    Returns dict with keys: current, prev_month, yoy.
    Each value is (start_date, end_date) for CE API.

    "current" is the most recent complete month (i.e., the previous calendar month).
    The pipeline runs at 06:00 UTC daily, so by the 1st the previous month is complete.
    """
    year, month = now.year, now.month

    # Current period = previous complete month
    prev_year = year if month > 1 else year - 1
    prev_month = month - 1 if month > 1 else 12

    current_start, current_end = _month_range(prev_year, prev_month)

    # Previous month relative to current period
    pm_month = prev_month - 1 if prev_month > 1 else 12
    pm_year = prev_year if prev_month > 1 else prev_year - 1
    pm_start, pm_end = _month_range(pm_year, pm_month)

    # Year-over-year
    yoy_year = prev_year - 1
    yoy_start, yoy_end = _month_range(yoy_year, prev_month)

    return {
        "current": (current_start, current_end),
        "prev_month": (pm_start, pm_end),
        "yoy": (yoy_start, yoy_end),
    }


def _period_label(start: str) -> str:
    """Extract YYYY-MM label from a start date string."""
    return start[:7]


def get_cost_and_usage(
    ce_client: Any,
    start: str,
    end: str,
) -> list[dict[str, Any]]:
    """Query GetCostAndUsage with pagination, grouped by App tag + USAGE_TYPE."""
    results: list[dict[str, Any]] = []
    kwargs: dict[str, Any] = {
        "TimePeriod": {"Start": start, "End": end},
        "Granularity": "MONTHLY",
        "Metrics": ["UnblendedCost", "UsageQuantity"],
        "GroupBy": [
            {"Type": "TAG", "Key": "App"},
            {"Type": "DIMENSION", "Key": "USAGE_TYPE"},
        ],
    }

    while True:
        response = ce_client.get_cost_and_usage(**kwargs)
        for result_by_time in response.get("ResultsByTime", []):
            for group in result_by_time.get("Groups", []):
                results.append(group)
        token = response.get("NextPageToken")
        if not token:
            break
        kwargs["NextPageToken"] = token

    return results


def get_cost_categories(
    ce_client: Any,
    category_name: str,
    start: str,
    end: str,
) -> dict[str, str]:
    """Get Cost Category mapping: workload -> cost center name.

    If category_name is empty, uses the first category returned by the API.
    Returns a dict mapping App tag values to cost center names.
    """
    if not category_name:
        # Discover the first cost category
        resp = ce_client.get_cost_categories(
            TimePeriod={"Start": start, "End": end},
        )
        names = resp.get("CostCategoryNames", [])
        if not names:
            return {}
        category_name = names[0]

    # Get the values (cost center names) for this category
    resp = ce_client.get_cost_categories(
        TimePeriod={"Start": start, "End": end},
        CostCategoryName=category_name,
    )
    # The CE API doesn't directly return the rule mapping; we use the category
    # in a GetCostAndUsage query with GroupBy COST_CATEGORY to get the mapping.
    mapping: dict[str, str] = {}

    kwargs: dict[str, Any] = {
        "TimePeriod": {"Start": start, "End": end},
        "Granularity": "MONTHLY",
        "Metrics": ["UnblendedCost"],
        "GroupBy": [
            {"Type": "TAG", "Key": "App"},
            {"Type": "COST_CATEGORY", "Key": category_name},
        ],
    }

    while True:
        response = ce_client.get_cost_and_usage(**kwargs)
        for result_by_time in response.get("ResultsByTime", []):
            for group in result_by_time.get("Groups", []):
                keys = group.get("Keys", [])
                if len(keys) == 2:
                    app_tag = keys[0].removeprefix("App$")
                    cost_center = keys[1]
                    if app_tag and cost_center:
                        mapping[app_tag] = cost_center
        token = response.get("NextPageToken")
        if not token:
            break
        kwargs["NextPageToken"] = token

    return mapping


def collect(
    cost_category_name: str = "",
) -> dict[str, Any]:
    """Main collection entry point. Returns raw data for processing."""
    ce_client = boto3.client("ce")
    now = datetime.now(timezone.utc)
    periods = _get_periods(now)

    period_labels = {k: _period_label(v[0]) for k, v in periods.items()}
    logger.info("Collecting data for periods: %s", period_labels)

    # Collect cost data for all three periods
    raw_data: dict[str, list[dict[str, Any]]] = {}
    for period_key, (start, end) in periods.items():
        groups = get_cost_and_usage(ce_client, start, end)
        logger.info("Period %s: %d groups collected", period_key, len(groups))
        raw_data[period_key] = groups

    # Collect cost category mapping
    current_start, current_end = periods["current"]
    cc_mapping = get_cost_categories(
        ce_client, cost_category_name, current_start, current_end
    )
    logger.info("Cost category mapping: %d entries", len(cc_mapping))

    return {
        "now": now,
        "period_labels": period_labels,
        "raw_data": raw_data,
        "cc_mapping": cc_mapping,
    }
