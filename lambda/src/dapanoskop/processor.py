"""Cost data processing and output file generation."""

from __future__ import annotations

import io
import json
import logging
from datetime import datetime
from typing import Any

import boto3
import pyarrow as pa
import pyarrow.parquet as pq

from dapanoskop.categories import categorize

logger = logging.getLogger(__name__)

_DEFAULT_CC = "Uncategorized"
_BYTES_PER_GB = 1_073_741_824  # 2^30 bytes per gibibyte (binary)
_BYTES_PER_TB = 1_099_511_627_776  # 2^40 bytes per tebibyte (binary)


def _parse_groups(
    groups: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Parse CE API group results into flat records."""
    rows = []
    for group in groups:
        keys = group.get("Keys", [])
        if len(keys) != 2:
            continue
        app_tag = keys[0].removeprefix("App$")
        usage_type = keys[1]
        metrics = group.get("Metrics", {})
        cost = float(metrics.get("UnblendedCost", {}).get("Amount", 0))
        quantity = float(metrics.get("UsageQuantity", {}).get("Amount", 0))
        rows.append(
            {
                "workload": app_tag or "Untagged",
                "usage_type": usage_type,
                "category": categorize(usage_type),
                "cost_usd": cost,
                "usage_quantity": quantity,
            }
        )
    return rows


def _compute_storage_metrics(
    rows: list[dict[str, Any]],
    prev_rows: list[dict[str, Any]],
    include_efs: bool,
    include_ebs: bool,
) -> dict[str, Any]:
    """Compute storage volume and hot tier metrics from usage data.

    Note: AWS Cost Explorer returns UsageQuantity for TimedStorage-* in GB-Months,
    which represents the average GB stored during the billing period.
    We convert GB-Months to bytes: GB-Months * 2^30 = average bytes stored (binary).
    """
    total_cost = 0.0
    prev_total_cost = 0.0
    total_gb_months = 0.0
    hot_gb_months = 0.0

    def _is_storage_volume(usage_type: str) -> bool:
        # Check EFS/EBS prefixes first — they may contain "TimedStorage"
        # (e.g. EFS:TimedStorage-ByteHrs) but should only count when enabled
        if "EFS:" in usage_type:
            return include_efs
        if "EBS:" in usage_type:
            return include_ebs
        # CE returns usage types with region prefixes (e.g. USE1-TimedStorage-ByteHrs)
        if "TimedStorage" in usage_type:
            return True
        return False

    def _is_hot_tier(usage_type: str) -> bool:
        # Match region-prefixed usage types (e.g. USE1-TimedStorage-ByteHrs)
        return usage_type.endswith("TimedStorage-ByteHrs") or usage_type.endswith(
            "TimedStorage-INT-FA-ByteHrs"
        )

    for row in rows:
        if row["category"] == "Storage":
            total_cost += row["cost_usd"]
        if _is_storage_volume(row["usage_type"]):
            total_gb_months += row["usage_quantity"]
            if _is_hot_tier(row["usage_type"]):
                hot_gb_months += row["usage_quantity"]

    for row in prev_rows:
        if row["category"] == "Storage":
            prev_total_cost += row["cost_usd"]

    # Convert GB-Months to bytes: GB-Months × 2^30 bytes/GiB = average bytes stored (binary)
    total_bytes = total_gb_months * _BYTES_PER_GB if total_gb_months else 0
    cost_per_tb = total_cost / (total_bytes / _BYTES_PER_TB) if total_bytes else 0
    hot_pct = (hot_gb_months / total_gb_months * 100) if total_gb_months else 0

    return {
        "total_cost_usd": round(total_cost, 2),
        "prev_month_cost_usd": round(prev_total_cost, 2),
        "total_volume_bytes": round(total_bytes),
        "hot_tier_percentage": round(hot_pct, 1),
        "cost_per_tb_usd": round(cost_per_tb, 2),
    }


def _aggregate_workloads(
    rows: list[dict[str, Any]],
) -> dict[str, float]:
    """Sum cost per workload from parsed rows."""
    totals: dict[str, float] = {}
    for row in rows:
        wl = row["workload"]
        totals[wl] = totals.get(wl, 0) + row["cost_usd"]
    return totals


def _compute_tagging_coverage(
    workload_costs: dict[str, float],
) -> dict[str, Any]:
    """Compute tagged vs untagged cost breakdown."""
    tagged = 0.0
    untagged = 0.0
    for wl, cost in workload_costs.items():
        if wl == "Untagged" or not wl:
            untagged += cost
        else:
            tagged += cost
    total = tagged + untagged
    pct = (tagged / total * 100) if total else 0
    return {
        "tagged_cost_usd": round(tagged, 2),
        "untagged_cost_usd": round(untagged, 2),
        "tagged_percentage": round(pct, 1),
    }


def _apply_split_charge_redistribution(
    category_costs: dict[str, float],
    rules: list[dict[str, Any]],
) -> dict[str, float]:
    """Redistribute split charge source costs to target categories.

    Applies AWS Cost Category split charge rules to redistribute source
    category costs to their targets. Supports three methods:
    - PROPORTIONAL: distribute proportional to existing target costs
    - EVEN: distribute equally among targets
    - FIXED: distribute by explicit percentage from Parameters

    Returns a new dict with source costs zeroed and redistributed to targets.
    """
    if not rules:
        return dict(category_costs)

    # Issue 1: Snapshot original costs so each rule reads from the pre-redistribution
    # amounts. AWS evaluates each rule against the original costs independently —
    # without this snapshot, a chained rule (A→B, B→C) would re-redistribute
    # the cost already moved by the first rule.
    original_costs = dict(category_costs)
    result = dict(category_costs)

    for rule in rules:
        source = rule["Source"]
        # Read source amount from the original snapshot, not the mutated result
        source_cost = original_costs.get(source, 0.0)
        if source_cost == 0.0:
            continue

        targets = rule.get("Targets", [])
        method = rule.get("Method", "PROPORTIONAL")
        parameters = rule.get("Parameters", [])

        if not targets:
            continue

        if method == "FIXED":
            # Parse explicit percentages from Parameters.
            # AWS CE API returns positional values: Values[i] maps to Targets[i].
            # E.g. Targets=["Ops","Lab","Research"], Values=["15","20","25"]
            param_map: dict[str, float] = {}
            for param in parameters:
                values = param.get("Values", [])
                if values and "=" in values[0]:
                    # Legacy "target=percentage" format
                    for val in values:
                        t_name, pct_str = val.split("=", 1)
                        t_name = t_name.strip()
                        pct_str = pct_str.strip()
                        try:
                            param_map[t_name] = float(pct_str) / 100.0
                        except ValueError:
                            logger.warning(
                                "Skipping malformed FIXED split charge value %r "
                                "(non-numeric percentage)",
                                val,
                            )
                else:
                    # Positional format: Values[i] is the percentage for Targets[i]
                    for i, val in enumerate(values):
                        if i >= len(targets):
                            logger.warning(
                                "FIXED split charge has more values than targets "
                                "for source %r, ignoring extra value %r",
                                source,
                                val,
                            )
                            break
                        try:
                            param_map[targets[i]] = float(val) / 100.0
                        except ValueError:
                            logger.warning(
                                "Skipping malformed FIXED split charge value %r "
                                "(non-numeric percentage) for target %r",
                                val,
                                targets[i],
                            )

            if param_map:
                # Warn when percentages don't sum to 100%
                total_fraction = sum(param_map.values())
                if abs(total_fraction - 1.0) > 0.001:
                    logger.warning(
                        "FIXED split charge percentages for source %r sum to %.1f%% "
                        "(expected 100%%). Cost difference will be lost.",
                        source,
                        total_fraction * 100,
                    )
                for target, fraction in param_map.items():
                    result[target] = result.get(target, 0.0) + source_cost * fraction
            else:
                # Fallback to EVEN if parameters can't be parsed
                share = source_cost / len(targets)
                for target in targets:
                    result[target] = result.get(target, 0.0) + share

        elif method == "EVEN":
            share = source_cost / len(targets)
            for target in targets:
                result[target] = result.get(target, 0.0) + share

        else:
            # PROPORTIONAL (default) — read target costs from the original snapshot
            # so that prior rules don't skew the proportions
            target_costs = {t: original_costs.get(t, 0.0) for t in targets}
            total_target_cost = sum(target_costs.values())

            if total_target_cost > 0:
                for target in targets:
                    fraction = target_costs[target] / total_target_cost
                    result[target] = result.get(target, 0.0) + source_cost * fraction
            else:
                # Fallback to EVEN when all targets have zero cost
                share = source_cost / len(targets)
                for target in targets:
                    result[target] = result.get(target, 0.0) + share

        # Zero out the source
        result[source] = 0.0

    return result


def _compute_mtd_comparison(
    raw_partial: list[dict[str, Any]],
    partial_dates: tuple[str, str],
    partial_allocated: dict[str, float],
    cc_groups: dict[str, list[str]],
    cc_mapping: dict[str, str],
    split_charge_cats: list[str],
    split_charge_rules: list[dict[str, Any]],
) -> dict[str, Any]:
    """Compute mtd_comparison aggregates from the prior partial period data.

    Returns the mtd_comparison dict to embed in summary.json.
    """
    prior_partial_start, prior_partial_end_exclusive = partial_dates
    partial_rows = _parse_groups(raw_partial)
    partial_costs = _aggregate_workloads(partial_rows)

    # Apply split charge redistribution to partial allocated costs if needed
    partial_alloc = dict(partial_allocated)
    if split_charge_rules:
        partial_alloc = _apply_split_charge_redistribution(
            partial_alloc, split_charge_rules
        )

    comparison_centers = []
    for cc_name in sorted(cc_groups):
        is_split_charge = cc_name in split_charge_cats
        wls = cc_groups[cc_name]

        workloads = []
        for wl_name in wls:
            workloads.append(
                {
                    "name": wl_name,
                    "prior_partial_cost_usd": round(partial_costs.get(wl_name, 0), 2),
                }
            )
        workloads.sort(
            key=lambda w: w["prior_partial_cost_usd"],
            reverse=True,  # type: ignore[return-value]
        )

        if partial_alloc and cc_name in partial_alloc:
            cc_partial = round(partial_alloc[cc_name], 2)
        else:
            cc_partial = round(sum(w["prior_partial_cost_usd"] for w in workloads), 2)

        if is_split_charge:
            cc_partial = 0.0

        cc_entry: dict[str, Any] = {
            "name": cc_name,
            "prior_partial_cost_usd": cc_partial,
            "workloads": workloads,
        }
        if is_split_charge:
            cc_entry["is_split_charge"] = True

        comparison_centers.append(cc_entry)

    comparison_centers.sort(
        key=lambda c: c["prior_partial_cost_usd"],
        reverse=True,  # type: ignore[return-value]
    )

    return {
        "prior_partial_start": prior_partial_start,
        "prior_partial_end_exclusive": prior_partial_end_exclusive,
        "cost_centers": comparison_centers,
    }


def process(
    collected: dict[str, Any],
    include_efs: bool = False,
    include_ebs: bool = False,
    is_mtd: bool = False,
) -> dict[str, Any]:
    """Process raw collected data into summary and parquet-ready structures.

    Args:
        collected: Raw data from collect().
        include_efs: Include EFS in storage metrics.
        include_ebs: Include EBS in storage metrics.
        is_mtd: When True, marks the period as in-progress and computes
                mtd_comparison from raw_data["prev_month_partial"] if present.
    """
    now: datetime = collected["now"]
    period_labels: dict[str, str] = collected["period_labels"]
    raw_data: dict[str, list[dict[str, Any]]] = collected["raw_data"]
    cc_mapping: dict[str, str] = collected["cc_mapping"]
    split_charge_cats: list[str] = collected.get("split_charge_categories", [])
    split_charge_rules: list[dict[str, Any]] = collected.get("split_charge_rules", [])
    allocated_costs: dict[str, dict[str, float]] = collected.get("allocated_costs", {})

    # Parse primary periods (exclude prev_month_partial — handled separately)
    primary_keys = ["current", "prev_month", "yoy"]
    parsed: dict[str, list[dict[str, Any]]] = {}
    for period_key in primary_keys:
        if period_key in raw_data:
            parsed[period_key] = _parse_groups(raw_data[period_key])
        else:
            parsed[period_key] = []

    current_rows = parsed["current"]
    prev_rows = parsed["prev_month"]
    yoy_rows = parsed["yoy"]

    # Workload cost sums per period
    current_costs = _aggregate_workloads(current_rows)
    prev_costs = _aggregate_workloads(prev_rows)
    yoy_costs = _aggregate_workloads(yoy_rows)

    # Group workloads into cost centers
    all_workloads = set(current_costs) | set(prev_costs) | set(yoy_costs)
    cc_groups: dict[str, list[str]] = {}
    for wl in all_workloads:
        cc = cc_mapping.get(wl, _DEFAULT_CC)
        cc_groups.setdefault(cc, []).append(wl)

    # Build cost center summaries — apply split charge redistribution to current and
    # prev_month periods only (not yoy).
    #
    # CE's NetAmortizedCost query already encodes the historically-correct split charge
    # allocation for each period. For the YoY period (12 months ago), the Cost Category
    # definition may have had different split charge rules — e.g. PROPORTIONAL in Jan 2025
    # vs FIXED percentages in Jan 2026. Re-applying Jan 2026's rules to Jan 2025's
    # allocated costs would double-redistribute with the wrong percentages.
    #
    # prev_month (last month) uses the same Cost Category definition as current and
    # CE returns pre-redistribution balances for it, so redistribution is applied there.
    # yoy_allocated is used as-is and falls back to workload sums via the per-period gate
    # if the keys don't match (e.g. "No cost category" for pre-category periods).
    current_allocated = allocated_costs.get("current", {})
    prev_allocated = allocated_costs.get("prev_month", {})
    yoy_allocated = allocated_costs.get("yoy", {})

    if split_charge_rules:
        current_allocated = _apply_split_charge_redistribution(
            current_allocated, split_charge_rules
        )
        prev_allocated = _apply_split_charge_redistribution(
            prev_allocated, split_charge_rules
        )

    cost_centers = []
    for cc_name in sorted(cc_groups):
        is_split_charge = cc_name in split_charge_cats
        wls = cc_groups[cc_name]
        workloads = []
        for wl_name in wls:
            workloads.append(
                {
                    "name": wl_name,
                    "current_cost_usd": round(current_costs.get(wl_name, 0), 2),
                    "prev_month_cost_usd": round(prev_costs.get(wl_name, 0), 2),
                    "yoy_cost_usd": round(yoy_costs.get(wl_name, 0), 2),
                }
            )
        # Sort workloads by current cost descending
        workloads.sort(key=lambda w: w["current_cost_usd"], reverse=True)

        # Use allocated costs from category-level query if available AND
        # the cost center name exists in that period's allocated costs dict.
        # Each period is checked independently — the YoY or prev_month periods
        # may predate the Cost Category definition and return sentinel keys like
        # "No cost category" instead of real cost center names, so a valid
        # current_allocated must not short-circuit the fallback for other periods.
        if current_allocated and cc_name in current_allocated:
            cc_current = round(current_allocated[cc_name], 2)
        else:
            cc_current = round(sum(w["current_cost_usd"] for w in workloads), 2)

        if prev_allocated and cc_name in prev_allocated:
            cc_prev = round(prev_allocated[cc_name], 2)
        else:
            cc_prev = round(sum(w["prev_month_cost_usd"] for w in workloads), 2)

        if yoy_allocated and cc_name in yoy_allocated:
            cc_yoy = round(yoy_allocated[cc_name], 2)
        else:
            cc_yoy = round(sum(w["yoy_cost_usd"] for w in workloads), 2)

        # Split charge categories have their cost redistributed to others;
        # show them with zero cost to avoid double-counting
        if is_split_charge:
            cc_current = 0.0
            cc_prev = 0.0
            cc_yoy = 0.0

        cc_entry: dict[str, Any] = {
            "name": cc_name,
            "current_cost_usd": cc_current,
            "prev_month_cost_usd": cc_prev,
            "yoy_cost_usd": cc_yoy,
            "workloads": workloads,
        }
        if is_split_charge:
            cc_entry["is_split_charge"] = True

        cost_centers.append(cc_entry)

    # Sort cost centers by current cost descending
    cost_centers.sort(key=lambda c: c["current_cost_usd"], reverse=True)

    storage_metrics = _compute_storage_metrics(
        current_rows, prev_rows, include_efs, include_ebs
    )
    tagging_coverage = _compute_tagging_coverage(current_costs)

    # Build the summary labels dict — only include the three standard comparison
    # periods (current, prev_month, yoy); prev_complete and prev_month_partial
    # are internal pipeline keys and should not appear in summary.periods.
    summary_period_labels = {
        k: v for k, v in period_labels.items() if k in ("current", "prev_month", "yoy")
    }

    summary: dict[str, Any] = {
        "collected_at": now.isoformat(),
        "period": period_labels["current"],
        "is_mtd": is_mtd,
        "periods": summary_period_labels,
        "storage_config": {"include_efs": include_efs, "include_ebs": include_ebs},
        "storage_metrics": storage_metrics,
        "cost_centers": cost_centers,
        "tagging_coverage": tagging_coverage,
    }

    # When this is the in-progress MTD period and prior partial data is present,
    # compute and attach the mtd_comparison aggregates.
    if is_mtd and "prev_month_partial" in raw_data:
        periods_raw: dict[str, tuple[str, str]] = collected.get("periods", {})
        partial_dates = periods_raw.get("prev_month_partial", ("", ""))
        partial_allocated = allocated_costs.get("prev_month_partial", {})

        mtd_comparison = _compute_mtd_comparison(
            raw_data["prev_month_partial"],
            partial_dates,
            partial_allocated,
            cc_groups,
            cc_mapping,
            split_charge_cats,
            split_charge_rules,
        )
        summary["mtd_comparison"] = mtd_comparison

    # Build parquet data (only primary periods)
    parquet_period_map: dict[str, dict[str, float]] = {
        "current": current_costs,
        "prev_month": prev_costs,
        "yoy": yoy_costs,
    }
    workload_rows = []
    for cc in cost_centers:
        for wl in cc["workloads"]:
            for period_key, cost_map in parquet_period_map.items():
                if period_key not in period_labels:
                    continue
                label = period_labels[period_key]
                workload_rows.append(
                    {
                        "cost_center": cc["name"],
                        "workload": wl["name"],
                        "period": label,
                        "cost_usd": round(cost_map.get(wl["name"], 0), 2),
                    }
                )

    usage_type_rows = []
    for period_key in primary_keys:
        if period_key not in period_labels:
            continue
        label = period_labels[period_key]
        for row in parsed[period_key]:
            usage_type_rows.append(
                {
                    "workload": row["workload"],
                    "usage_type": row["usage_type"],
                    "category": row["category"],
                    "period": label,
                    "cost_usd": round(row["cost_usd"], 2),
                    "usage_quantity": round(row["usage_quantity"], 6),
                }
            )

    return {
        "summary": summary,
        "workload_rows": workload_rows,
        "usage_type_rows": usage_type_rows,
    }


def update_index(bucket: str) -> None:
    """Scan S3 bucket and update index.json with all available periods."""
    s3 = boto3.client("s3")
    paginator = s3.get_paginator("list_objects_v2")
    periods: list[str] = []
    for page in paginator.paginate(Bucket=bucket, Delimiter="/"):
        for prefix_entry in page.get("CommonPrefixes", []):
            p = prefix_entry["Prefix"].rstrip("/")
            if len(p) == 7 and p[4] == "-" and p[:4].isdigit() and p[5:].isdigit():
                periods.append(p)
    periods.sort(reverse=True)

    s3.put_object(
        Bucket=bucket,
        Key="index.json",
        Body=json.dumps({"periods": periods}).encode(),
        ContentType="application/json",
    )


def write_to_s3(
    processed: dict[str, Any],
    bucket: str,
    update_index_file: bool = True,
) -> None:
    """Write summary.json and parquet files to S3.

    Args:
        processed: Processed data from process()
        bucket: S3 bucket name
        update_index_file: Whether to update index.json (default True, set False for batch operations)
    """
    s3 = boto3.client("s3")
    summary = processed["summary"]
    period = summary["period"]
    prefix = f"{period}/"

    # Write summary.json
    s3.put_object(
        Bucket=bucket,
        Key=f"{prefix}summary.json",
        Body=json.dumps(summary, indent=2).encode(),
        ContentType="application/json",
    )

    # Write cost-by-workload.parquet
    wl_rows = processed["workload_rows"]
    if wl_rows:
        wl_table = pa.table(
            {
                "cost_center": pa.array(
                    [r["cost_center"] for r in wl_rows], type=pa.string()
                ),
                "workload": pa.array(
                    [r["workload"] for r in wl_rows], type=pa.string()
                ),
                "period": pa.array([r["period"] for r in wl_rows], type=pa.string()),
                "cost_usd": pa.array(
                    [r["cost_usd"] for r in wl_rows], type=pa.float64()
                ),
            }
        )
        buf = io.BytesIO()
        pq.write_table(wl_table, buf)
        s3.put_object(
            Bucket=bucket,
            Key=f"{prefix}cost-by-workload.parquet",
            Body=buf.getvalue(),
            ContentType="application/octet-stream",
        )

    # Write cost-by-usage-type.parquet
    ut_rows = processed["usage_type_rows"]
    if ut_rows:
        ut_table = pa.table(
            {
                "workload": pa.array(
                    [r["workload"] for r in ut_rows], type=pa.string()
                ),
                "usage_type": pa.array(
                    [r["usage_type"] for r in ut_rows], type=pa.string()
                ),
                "category": pa.array(
                    [r["category"] for r in ut_rows], type=pa.string()
                ),
                "period": pa.array([r["period"] for r in ut_rows], type=pa.string()),
                "cost_usd": pa.array(
                    [r["cost_usd"] for r in ut_rows], type=pa.float64()
                ),
                "usage_quantity": pa.array(
                    [r["usage_quantity"] for r in ut_rows], type=pa.float64()
                ),
            }
        )
        buf = io.BytesIO()
        pq.write_table(ut_table, buf)
        s3.put_object(
            Bucket=bucket,
            Key=f"{prefix}cost-by-usage-type.parquet",
            Body=buf.getvalue(),
            ContentType="application/octet-stream",
        )

    if update_index_file:
        update_index(bucket)
