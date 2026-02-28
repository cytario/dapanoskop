"""Cost Explorer API data collection."""

from __future__ import annotations

import logging
from datetime import date, datetime, timedelta, timezone
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


def _get_prior_partial_period(
    mtd_start: str,
    mtd_end_exclusive: str,
) -> tuple[str, str]:
    """Compute the prior month's equivalent partial period for like-for-like MTD comparison.

    Given the MTD window [mtd_start, mtd_end_exclusive), returns the date range
    covering the same number of days in the prior calendar month.

    The end date is clamped to the first day of the current month (i.e., the last
    valid day of the prior month + 1) when the prior month is shorter than the MTD
    window (e.g., today is March 30 and the prior month is February with 28 days).

    Args:
        mtd_start: Start date string "YYYY-MM-DD" (first day of current month).
        mtd_end_exclusive: Exclusive end date string "YYYY-MM-DD" (today).

    Returns:
        Tuple of (prior_partial_start, prior_partial_end_exclusive) as date strings.
    """
    start_date = date.fromisoformat(mtd_start)
    end_date = date.fromisoformat(mtd_end_exclusive)
    mtd_days = (end_date - start_date).days

    # First day of the prior month
    if start_date.month == 1:
        prior_month_start = date(start_date.year - 1, 12, 1)
    else:
        prior_month_start = date(start_date.year, start_date.month - 1, 1)

    prior_partial_end = prior_month_start + timedelta(days=mtd_days)

    # Clamp to the boundary of the prior month (= first day of current month = mtd_start)
    if prior_partial_end > start_date:
        prior_partial_end = start_date

    return prior_month_start.isoformat(), prior_partial_end.isoformat()


def _get_periods(
    now: datetime,
    target_year: int | None = None,
    target_month: int | None = None,
) -> dict[str, tuple[str, str]]:
    """Compute reporting periods.

    Returns dict with keys: current, prev_month, yoy.
    Each value is (start_date, end_date) for CE API.

    If target_year and target_month are provided (backfill), use that as the
    target period ("current" is the specified completed month).

    Otherwise (normal daily run), "current" is the current in-progress calendar
    month (MTD period: [first_day_of_current_month, today)), and "prev_complete"
    is the most recently completed calendar month. "yoy_prev_complete" is the
    year-over-year period for prev_complete (same calendar month one year prior
    to prev_complete — different from "yoy" which is the MTD month's YoY).
    "prev_month_partial" is the prior month's equivalent partial period for
    like-for-like MTD comparison.
    """
    if target_year is not None and target_month is not None:
        # Backfill mode: use explicit target month as a completed period
        cur_year = target_year
        cur_month = target_month

        current_start, current_end = _month_range(cur_year, cur_month)

        # Previous month relative to target
        pm_month = cur_month - 1 if cur_month > 1 else 12
        pm_year = cur_year if cur_month > 1 else cur_year - 1
        pm_start, pm_end = _month_range(pm_year, pm_month)

        # Year-over-year
        yoy_start, yoy_end = _month_range(cur_year - 1, cur_month)

        return {
            "current": (current_start, current_end),
            "prev_month": (pm_start, pm_end),
            "yoy": (yoy_start, yoy_end),
        }

    # Normal daily run: current in-progress month as MTD period
    year, month = now.year, now.month
    today_str = now.strftime("%Y-%m-%d")
    mtd_start = f"{year:04d}-{month:02d}-01"
    mtd_end = today_str  # CE end is exclusive; today is not yet complete

    # Most recently completed calendar month
    prev_year = year if month > 1 else year - 1
    prev_month = month - 1 if month > 1 else 12
    prev_complete_start, prev_complete_end = _month_range(prev_year, prev_month)

    # Month before the most recently completed month (for prev_month comparison)
    pm2_month = prev_month - 1 if prev_month > 1 else 12
    pm2_year = prev_year if prev_month > 1 else prev_year - 1
    pm2_start, pm2_end = _month_range(pm2_year, pm2_month)

    # Year-over-year for the prev_complete month
    yoy_pc_start, yoy_pc_end = _month_range(prev_year - 1, prev_month)

    # On the 1st of the month, mtd_start == mtd_end (zero-width window).
    # Skip the MTD period entirely and only produce prev_complete.
    if mtd_start == mtd_end:
        return {
            "prev_complete": (prev_complete_start, prev_complete_end),
            "prev_month": (pm2_start, pm2_end),
            "yoy_prev_complete": (yoy_pc_start, yoy_pc_end),
        }

    # Year-over-year (same month last year) — based on current in-progress month
    yoy_start, yoy_end = _month_range(year - 1, month)

    # Prior partial period for like-for-like MTD comparison
    prior_partial_start, prior_partial_end = _get_prior_partial_period(
        mtd_start, mtd_end
    )

    return {
        "current": (mtd_start, mtd_end),
        "prev_complete": (prev_complete_start, prev_complete_end),
        "prev_month": (pm2_start, pm2_end),
        "yoy": (yoy_start, yoy_end),
        "yoy_prev_complete": (yoy_pc_start, yoy_pc_end),
        "prev_month_partial": (prior_partial_start, prior_partial_end),
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
        "Metrics": ["NetAmortizedCost", "UsageQuantity"],
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
) -> tuple[str, dict[str, str]]:
    """Get Cost Category mapping: workload -> cost center name.

    If category_name is empty, auto-discovers the first category returned by the API.
    Returns a tuple of (resolved_category_name, mapping) where mapping is a dict
    mapping App tag values to cost center names. When no categories are found,
    returns ("", {}).
    """
    if not category_name:
        # Discover the first cost category
        resp = ce_client.get_cost_categories(
            TimePeriod={"Start": start, "End": end},
        )
        names = resp.get("CostCategoryNames", [])
        if not names:
            return "", {}
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
        "Metrics": ["NetAmortizedCost"],
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
                    cost_center = keys[1].removeprefix(f"{category_name}$")
                    if cost_center:
                        workload_key = app_tag if app_tag else "Untagged"
                        mapping[workload_key] = cost_center
        token = response.get("NextPageToken")
        if not token:
            break
        kwargs["NextPageToken"] = token

    return category_name, mapping


def get_split_charge_categories(
    ce_client: Any,
    category_name: str,
) -> tuple[list[str], list[dict[str, Any]]]:
    """Detect split charge source categories by inspecting the Cost Category definition.

    Returns a tuple of:
    - list of category values that are split charge sources (their costs
      are allocated to other categories and should not be displayed directly)
    - list of full split charge rule dicts (Source, Targets, Method, Parameters)
    """
    if not category_name:
        return [], []

    # Find the category ARN from its name (paginated)
    try:
        target_arn = None
        list_kwargs: dict[str, Any] = {}
        while True:
            resp = ce_client.list_cost_category_definitions(**list_kwargs)
            for defn in resp.get("CostCategoryReferences", []):
                if defn.get("Name") == category_name:
                    target_arn = defn["CostCategoryArn"]
                    break
            if target_arn is not None:
                break
            token = resp.get("NextToken")
            if not token:
                break
            list_kwargs["NextToken"] = token
    except Exception:
        logger.warning("Failed to list cost category definitions", exc_info=True)
        return [], []

    if not target_arn:
        return [], []

    # Get the full definition including split charge rules
    try:
        defn_resp = ce_client.describe_cost_category_definition(
            CostCategoryArn=target_arn
        )
    except Exception:
        logger.warning("Failed to describe cost category definition", exc_info=True)
        return [], []

    cost_category = defn_resp.get("CostCategory", {})
    split_charge_rules = cost_category.get("SplitChargeRules", [])

    # Extract source values and full rules
    sources: set[str] = set()
    rules: list[dict[str, Any]] = []
    for rule in split_charge_rules:
        source = rule.get("Source")
        if source:
            sources.add(source)
            rules.append(
                {
                    "Source": source,
                    "Targets": rule.get("Targets", []),
                    "Method": rule.get("Method", "PROPORTIONAL"),
                    "Parameters": rule.get("Parameters", []),
                }
            )

    logger.info("Split charge sources: %s", sources)
    return sorted(sources), rules


def get_allocated_costs_by_category(
    ce_client: Any,
    category_name: str,
    start: str,
    end: str,
) -> dict[str, float]:
    """Get total allocated cost per cost category value using NetAmortizedCost.

    Uses NetAmortizedCost to match the AWS Cost Category console's
    "Total allocated cost" column. Queries CE grouped by COST_CATEGORY only
    (no App tag) to get the true allocated totals.
    """
    if not category_name:
        return {}

    totals: dict[str, float] = {}
    kwargs: dict[str, Any] = {
        "TimePeriod": {"Start": start, "End": end},
        "Granularity": "MONTHLY",
        "Metrics": ["NetAmortizedCost"],
        "GroupBy": [
            {"Type": "COST_CATEGORY", "Key": category_name},
        ],
    }

    while True:
        response = ce_client.get_cost_and_usage(**kwargs)
        for result_by_time in response.get("ResultsByTime", []):
            for group in result_by_time.get("Groups", []):
                keys = group.get("Keys", [])
                if keys:
                    cc_value = keys[0].removeprefix(f"{category_name}$")
                    cost = float(
                        group.get("Metrics", {})
                        .get("NetAmortizedCost", {})
                        .get("Amount", 0)
                    )
                    totals[cc_value] = totals.get(cc_value, 0) + cost
        token = response.get("NextPageToken")
        if not token:
            break
        kwargs["NextPageToken"] = token

    return totals


def collect(
    cost_category_name: str = "",
    target_year: int | None = None,
    target_month: int | None = None,
) -> dict[str, Any]:
    """Main collection entry point. Returns raw data for processing.

    Args:
        cost_category_name: AWS Cost Category name for workload grouping
        target_year: Optional target year for backfill (uses current if not provided)
        target_month: Optional target month for backfill (uses current if not provided)

    When called without target_year/target_month (normal daily run), the result
    includes is_mtd=True and additional keys:
      - raw_data["current"]: current in-progress month (MTD period)
      - raw_data["prev_complete"]: most recently completed calendar month
      - raw_data["yoy_prev_complete"]: year-over-year for prev_complete month
      - raw_data["prev_month_partial"]: prior partial period for like-for-like comparison
      - period_labels["prev_complete"]: label for the completed month
      - period_labels["yoy_prev_complete"]: label for prev_complete's YoY
      - period_labels["prev_month_partial"]: label for the prior partial period
    """
    is_mtd = target_year is None and target_month is None

    ce_client = boto3.client("ce")
    now = datetime.now(timezone.utc)
    periods = _get_periods(now, target_year, target_month)

    period_labels = {k: _period_label(v[0]) for k, v in periods.items()}
    logger.info("Collecting data for periods: %s", period_labels)

    # Collect cost data for all periods
    # For the prior_month_partial period, only collect when is_mtd (it's a partial date
    # range within the prior month and not meaningful for completed backfill months).
    raw_data: dict[str, list[dict[str, Any]]] = {}
    for period_key, (start, end) in periods.items():
        groups = get_cost_and_usage(ce_client, start, end)
        logger.info("Period %s: %d groups collected", period_key, len(groups))
        raw_data[period_key] = groups

    # Collect cost category mappings per period.
    # Discover the category name once from the primary period (current if available,
    # otherwise prev_complete for 1st-of-month runs), then query each period
    # independently so that workload-to-cost-center assignments reflect the CC
    # rules that were active during that period.
    discovery_key = "current" if "current" in periods else "prev_complete"
    discovery_start, discovery_end = periods[discovery_key]
    resolved_cc_name, discovery_cc_mapping = get_cost_categories(
        ce_client, cost_category_name, discovery_start, discovery_end
    )
    logger.info(
        "Cost category mapping (%s): %d entries",
        discovery_key,
        len(discovery_cc_mapping),
    )

    # Query mapping for every period except prev_month_partial (partial window
    # within the prior month; used only for MTD comparison aggregates, not CC
    # assignment) and the discovery period (already queried above).
    cc_mappings: dict[str, dict[str, str]] = {discovery_key: discovery_cc_mapping}
    if resolved_cc_name:
        for period_key, (start, end) in periods.items():
            if period_key in (discovery_key, "prev_month_partial"):
                continue
            _, period_mapping = get_cost_categories(
                ce_client, resolved_cc_name, start, end
            )
            logger.info(
                "Cost category mapping (%s): %d entries",
                period_key,
                len(period_mapping),
            )
            cc_mappings[period_key] = period_mapping
    else:
        # No CC configured — fill all periods with the empty mapping
        for period_key in periods:
            if period_key not in cc_mappings:
                cc_mappings[period_key] = {}

    # For backward compatibility, expose discovery period's mapping as cc_mapping
    cc_mapping = discovery_cc_mapping

    # Detect split charge categories and get allocated totals using the
    # resolved name so auto-discovered categories are handled correctly.
    split_charge_categories, split_charge_rules = get_split_charge_categories(
        ce_client, resolved_cc_name
    )
    allocated_costs: dict[str, dict[str, float]] = {}
    if resolved_cc_name:
        for period_key, (start, end) in periods.items():
            # Skip prior partial period for allocated costs — the partial period
            # is only used for MTD comparison aggregates, not for cost center totals.
            if period_key == "prev_month_partial":
                continue
            allocated_costs[period_key] = get_allocated_costs_by_category(
                ce_client, resolved_cc_name, start, end
            )

        # For the MTD prior partial period, also collect category-level allocated costs
        # so the processor can build mtd_comparison cost center totals.
        if is_mtd and "prev_month_partial" in periods:
            partial_start, partial_end = periods["prev_month_partial"]
            allocated_costs["prev_month_partial"] = get_allocated_costs_by_category(
                ce_client, resolved_cc_name, partial_start, partial_end
            )

    return {
        "now": now,
        "is_mtd": is_mtd,
        "periods": periods,
        "period_labels": period_labels,
        "raw_data": raw_data,
        "cc_mapping": cc_mapping,
        "cc_mappings": cc_mappings,
        "split_charge_categories": split_charge_categories,
        "split_charge_rules": split_charge_rules,
        "allocated_costs": allocated_costs,
    }
