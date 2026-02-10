"""Cost data processing and output file generation."""

from __future__ import annotations

import io
import json
from datetime import datetime
from typing import Any

import boto3
import pyarrow as pa
import pyarrow.parquet as pq

from dapanoskop.categories import categorize

_DEFAULT_CC = "Uncategorized"
_HOURS_IN_MONTH = 730  # Average hours in a month
_BYTES_PER_TB = 1_099_511_627_776


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
    """Compute storage volume and hot tier metrics from usage data."""
    total_cost = 0.0
    prev_total_cost = 0.0
    total_byte_hours = 0.0
    hot_byte_hours = 0.0

    def _is_storage_volume(usage_type: str) -> bool:
        if usage_type.startswith("TimedStorage"):
            return True
        if include_efs and usage_type.startswith("EFS:"):
            return True
        if include_ebs and usage_type.startswith("EBS:"):
            return True
        return False

    def _is_hot_tier(usage_type: str) -> bool:
        return usage_type in ("TimedStorage-ByteHrs", "TimedStorage-INT-FA-ByteHrs")

    for row in rows:
        if row["category"] == "Storage":
            total_cost += row["cost_usd"]
        if _is_storage_volume(row["usage_type"]):
            total_byte_hours += row["usage_quantity"]
            if _is_hot_tier(row["usage_type"]):
                hot_byte_hours += row["usage_quantity"]

    for row in prev_rows:
        if row["category"] == "Storage":
            prev_total_cost += row["cost_usd"]

    total_bytes = total_byte_hours / _HOURS_IN_MONTH if total_byte_hours else 0
    cost_per_tb = total_cost / (total_bytes / _BYTES_PER_TB) if total_bytes else 0
    hot_pct = (hot_byte_hours / total_byte_hours * 100) if total_byte_hours else 0

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


def process(
    collected: dict[str, Any],
    include_efs: bool = False,
    include_ebs: bool = False,
) -> dict[str, Any]:
    """Process raw collected data into summary and parquet-ready structures."""
    now: datetime = collected["now"]
    period_labels: dict[str, str] = collected["period_labels"]
    raw_data: dict[str, list[dict[str, Any]]] = collected["raw_data"]
    cc_mapping: dict[str, str] = collected["cc_mapping"]

    # Parse all periods
    parsed: dict[str, list[dict[str, Any]]] = {}
    for period_key, groups in raw_data.items():
        parsed[period_key] = _parse_groups(groups)

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

    # Build cost center summaries
    cost_centers = []
    for cc_name in sorted(cc_groups):
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

        cc_current = sum(w["current_cost_usd"] for w in workloads)
        cc_prev = sum(w["prev_month_cost_usd"] for w in workloads)
        cc_yoy = sum(w["yoy_cost_usd"] for w in workloads)

        cost_centers.append(
            {
                "name": cc_name,
                "current_cost_usd": round(cc_current, 2),
                "prev_month_cost_usd": round(cc_prev, 2),
                "yoy_cost_usd": round(cc_yoy, 2),
                "workloads": workloads,
            }
        )

    # Sort cost centers by current cost descending
    cost_centers.sort(key=lambda c: c["current_cost_usd"], reverse=True)

    storage_metrics = _compute_storage_metrics(
        current_rows, prev_rows, include_efs, include_ebs
    )
    tagging_coverage = _compute_tagging_coverage(current_costs)

    summary = {
        "collected_at": now.isoformat(),
        "period": period_labels["current"],
        "periods": period_labels,
        "storage_config": {"include_efs": include_efs, "include_ebs": include_ebs},
        "storage_metrics": storage_metrics,
        "cost_centers": cost_centers,
        "tagging_coverage": tagging_coverage,
    }

    # Build parquet data
    workload_rows = []
    for cc in cost_centers:
        for wl in cc["workloads"]:
            for period_key, label in period_labels.items():
                cost_map = {
                    "current": current_costs,
                    "prev_month": prev_costs,
                    "yoy": yoy_costs,
                }
                workload_rows.append(
                    {
                        "cost_center": cc["name"],
                        "workload": wl["name"],
                        "period": label,
                        "cost_usd": round(cost_map[period_key].get(wl["name"], 0), 2),
                    }
                )

    usage_type_rows = []
    for period_key, rows in parsed.items():
        label = period_labels[period_key]
        for row in rows:
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


def write_to_s3(
    processed: dict[str, Any],
    bucket: str,
) -> None:
    """Write summary.json and parquet files to S3."""
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
