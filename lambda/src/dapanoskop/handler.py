"""AWS Lambda entry point for Dapanoskop data pipeline."""

from __future__ import annotations

import json
import logging
import os
from datetime import datetime, timezone
from typing import Any

import boto3

from dapanoskop.collector import collect
from dapanoskop.processor import process, update_index, write_to_s3
from dapanoskop.storage_lens import get_storage_lens_metrics

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)


def _enrich_with_storage_lens(
    processed: dict[str, Any],
    storage_lens_config_id: str,
    target_year: int | None = None,
    target_month: int | None = None,
) -> None:
    """Add S3 Storage Lens data to the processed summary (in-place).

    When target_year/target_month are provided, queries Storage Lens for
    the end of that month instead of using the current date. This ensures
    backfill produces period-appropriate storage volumes.
    """
    logger.info(
        "Querying S3 Storage Lens metrics (config_id=%s)",
        storage_lens_config_id or "auto-discover",
    )
    try:
        # Compute period-appropriate time window for Storage Lens query
        sl_kwargs: dict[str, Any] = {"config_id": storage_lens_config_id}
        if target_year is not None and target_month is not None:
            # Query around the end of the target month
            if target_month == 12:
                end_dt = datetime(target_year + 1, 1, 1, tzinfo=timezone.utc)
            else:
                end_dt = datetime(target_year, target_month + 1, 1, tzinfo=timezone.utc)
            # Storage Lens data may lag a few days; use a 14-day window
            from datetime import timedelta

            start_dt = end_dt - timedelta(days=14)
            sl_kwargs["start_time"] = start_dt
            sl_kwargs["end_time"] = end_dt

        metrics = get_storage_lens_metrics(**sl_kwargs)
        if metrics is not None:
            # Add to storage_metrics
            processed["summary"]["storage_metrics"]["storage_lens_total_bytes"] = (
                metrics["total_bytes"]
            )

            # Recalculate cost_per_tb using Storage Lens volume (more accurate
            # than CE-derived GB-Months since it reflects actual storage, not
            # billing usage quantities that may include non-volume items)
            storage_metrics = processed["summary"]["storage_metrics"]
            total_bytes = metrics["total_bytes"]
            if total_bytes > 0:
                total_tb = total_bytes / 1_099_511_627_776  # 2^40 bytes per binary TB
                storage_metrics["cost_per_tb_usd"] = round(
                    storage_metrics["total_cost_usd"] / total_tb, 2
                )

            # Add storage_lens object to summary
            processed["summary"]["storage_lens"] = {
                "total_bytes": metrics["total_bytes"],
                "object_count": metrics["object_count"],
                "timestamp": metrics["timestamp"],
                "config_id": metrics["config_id"],
                "org_id": metrics["org_id"],
            }
            logger.info(
                "Storage Lens: %d bytes, %d objects (config: %s)",
                metrics["total_bytes"],
                metrics["object_count"],
                metrics["config_id"],
            )
    except Exception:
        logger.warning(
            "Failed to read S3 Storage Lens metrics, skipping", exc_info=True
        )


def _sanitize_error_message(error_msg: str) -> str:
    """Sanitize error messages to prevent AWS account ID leakage.

    Replaces 12-digit AWS account IDs with REDACTED.
    """
    import re

    # Replace 12-digit account IDs (commonly found in ARNs)
    return re.sub(r"\b\d{12}\b", "REDACTED", error_msg)


def _month_exists_in_s3(s3_client: Any, bucket: str, year: int, month: int) -> bool:
    """Check if data already exists for a given month in S3."""
    period = f"{year:04d}-{month:02d}"
    prefix = f"{period}/"
    try:
        response = s3_client.list_objects_v2(Bucket=bucket, Prefix=prefix, MaxKeys=1)
        return "Contents" in response and len(response["Contents"]) > 0
    except Exception:
        return False


def _generate_backfill_months(months: int) -> list[tuple[int, int]]:
    """Generate list of (year, month) tuples for backfill.

    Returns months from current month back N months, in reverse chronological order.
    """
    now = datetime.now(timezone.utc)
    result: list[tuple[int, int]] = []
    year, month = now.year, now.month

    for _ in range(months):
        # Move to previous month
        if month == 1:
            month = 12
            year -= 1
        else:
            month -= 1
        result.append((year, month))

    return result


def _handle_backfill(
    bucket: str,
    cost_category_name: str,
    include_efs: bool,
    include_ebs: bool,
    months: int,
    force: bool,
    storage_lens_config_id: str = "",
) -> dict[str, Any]:
    """Handle backfill mode: process multiple historical months."""
    logger.info("Starting backfill for %d months (force=%s)", months, force)

    s3 = boto3.client("s3")
    backfill_months = _generate_backfill_months(months)

    succeeded: list[str] = []
    failed: list[dict[str, Any]] = []
    skipped: list[str] = []

    for year, month in backfill_months:
        period_label = f"{year:04d}-{month:02d}"
        try:
            # Check if already exists (unless force=True)
            if not force and _month_exists_in_s3(s3, bucket, year, month):
                logger.info("Skipping %s (already exists)", period_label)
                skipped.append(period_label)
                continue

            logger.info("Collecting data for %s", period_label)
            collected = collect(
                cost_category_name=cost_category_name,
                target_year=year,
                target_month=month,
            )

            # Guard: skip periods where CE returned no cost groups at all.
            # This happens for very recent months (data not yet available) or
            # accounts with no activity. force=True does not override this check
            # because the data simply isn't there to process.
            if not collected["raw_data"].get("current"):
                logger.warning(
                    "Skipping %s (no cost data returned by Cost Explorer)",
                    period_label,
                )
                skipped.append(period_label)
                continue

            logger.info("Processing data for %s", period_label)
            processed = process(
                collected, include_efs=include_efs, include_ebs=include_ebs
            )

            # Enrich with S3 Storage Lens data if configured
            if storage_lens_config_id is not None:
                _enrich_with_storage_lens(
                    processed, storage_lens_config_id, year, month
                )

            logger.info("Writing to S3 for %s", period_label)
            write_to_s3(processed, bucket, update_index_file=False)

            succeeded.append(period_label)
            logger.info("Completed %s", period_label)

        except Exception as e:
            error_str = str(e)
            # Check if this is a "no data available" error from Cost Explorer
            # CE returns DataUnavailableException or similar errors for months without data
            is_no_data_error = (
                "DataUnavailableException" in error_str
                or "No data available" in error_str
            )

            if is_no_data_error:
                logger.info(
                    "Skipping %s (no data available in Cost Explorer)", period_label
                )
                skipped.append(period_label)
            else:
                logger.exception("Failed to process %s", period_label)
                failed.append(
                    {
                        "period": period_label,
                        "error": _sanitize_error_message(error_str),
                    }
                )

    # Update index once at the end (always, even if some months failed)
    logger.info("Updating index.json")
    try:
        update_index(bucket)
    except Exception:
        logger.exception("Failed to update index.json")
        # Don't fail the entire backfill if index update fails

    logger.info(
        "Backfill complete: %d succeeded, %d failed, %d skipped",
        len(succeeded),
        len(failed),
        len(skipped),
    )

    return {
        "statusCode": 200
        if not failed
        else 207,  # 207 Multi-Status for partial success
        "body": json.dumps(
            {
                "message": "backfill_complete",
                "succeeded": succeeded,
                "failed": failed,
                "skipped": skipped,
            }
        ),
    }


def _build_prev_complete_collected(collected: dict[str, Any]) -> dict[str, Any]:
    """Build a process()-compatible collected dict for the prev_complete period.

    Remaps the keys from the MTD-era collected dict so that:
      - "prev_complete" becomes "current"
      - "prev_month" (the month before prev_complete) stays as "prev_month"
      - "yoy_prev_complete" becomes "yoy" (same calendar month one year prior
        to prev_complete, NOT the MTD month's YoY)
    Strips MTD-specific keys (prev_month_partial, is_mtd).
    """
    raw_data = collected["raw_data"]
    period_labels = collected["period_labels"]
    allocated_costs = collected.get("allocated_costs", {})
    periods_raw = collected.get("periods", {})

    return {
        "now": collected["now"],
        "is_mtd": False,
        "periods": {
            "current": periods_raw.get("prev_complete", ("", "")),
            "prev_month": periods_raw.get("prev_month", ("", "")),
            "yoy": periods_raw.get("yoy_prev_complete", ("", "")),
        },
        "period_labels": {
            "current": period_labels.get("prev_complete", ""),
            "prev_month": period_labels.get("prev_month", ""),
            "yoy": period_labels.get("yoy_prev_complete", ""),
        },
        "raw_data": {
            "current": raw_data.get("prev_complete", []),
            "prev_month": raw_data.get("prev_month", []),
            "yoy": raw_data.get("yoy_prev_complete", []),
        },
        "cc_mapping": collected.get("cc_mapping", {}),
        "split_charge_categories": collected.get("split_charge_categories", []),
        "split_charge_rules": collected.get("split_charge_rules", []),
        "allocated_costs": {
            "current": allocated_costs.get("prev_complete", {}),
            "prev_month": allocated_costs.get("prev_month", {}),
            "yoy": allocated_costs.get("yoy_prev_complete", {}),
        },
    }


def handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    """Lambda handler for cost data collection and processing.

    Event payload:
        backfill (bool): Enable backfill mode (default: False)
        months (int): Number of months to backfill (default: 13)
        force (bool): Force re-process existing months (default: False)
    """
    bucket = os.environ.get("DATA_BUCKET")
    if not bucket:
        raise ValueError("DATA_BUCKET environment variable is required")

    cost_category_name = os.environ.get("COST_CATEGORY_NAME", "")
    include_efs = os.environ.get("INCLUDE_EFS", "false").lower() == "true"
    include_ebs = os.environ.get("INCLUDE_EBS", "false").lower() == "true"
    storage_lens_config_id = os.environ.get("STORAGE_LENS_CONFIG_ID", "")

    # Check for backfill mode
    backfill = event.get("backfill", False)
    if backfill:
        months = event.get("months", 13)
        force = event.get("force", False)
        return _handle_backfill(
            bucket,
            cost_category_name,
            include_efs,
            include_ebs,
            months,
            force,
            storage_lens_config_id,
        )

    # Normal mode: collect MTD period + most recently completed month
    try:
        logger.info("Starting data collection (bucket=%s)", bucket)
        collected = collect(cost_category_name=cost_category_name)

        # --- Write MTD period (current in-progress month) ---
        logger.info("Processing MTD period data")
        processed_mtd = process(
            collected, include_efs=include_efs, include_ebs=include_ebs, is_mtd=True
        )

        if storage_lens_config_id is not None:
            period_label = processed_mtd["summary"]["period"]
            p_year, p_month = int(period_label[:4]), int(period_label[5:7])
            _enrich_with_storage_lens(
                processed_mtd, storage_lens_config_id, p_year, p_month
            )

        logger.info("Writing MTD period to S3")
        write_to_s3(processed_mtd, bucket, update_index_file=False)
        mtd_period = processed_mtd["summary"]["period"]
        logger.info("MTD period written: %s", mtd_period)

        # --- Write most recently completed month ---
        # Build a collected-like dict for the prev_complete period using the
        # data already fetched (prev_complete + prev_month + yoy).
        prev_complete_label = collected["period_labels"].get("prev_complete")
        if prev_complete_label:
            logger.info("Processing prev_complete period: %s", prev_complete_label)
            prev_collected = _build_prev_complete_collected(collected)
            processed_prev = process(
                prev_collected,
                include_efs=include_efs,
                include_ebs=include_ebs,
                is_mtd=False,
            )

            if storage_lens_config_id is not None:
                pc_year = int(prev_complete_label[:4])
                pc_month = int(prev_complete_label[5:7])
                _enrich_with_storage_lens(
                    processed_prev, storage_lens_config_id, pc_year, pc_month
                )

            logger.info("Writing prev_complete period to S3")
            write_to_s3(processed_prev, bucket, update_index_file=False)
            logger.info("prev_complete period written: %s", prev_complete_label)

        # Update index once after both writes
        logger.info("Updating index.json")
        update_index(bucket)

        logger.info("Pipeline completed: MTD=%s", mtd_period)
        return {
            "statusCode": 200,
            "body": json.dumps({"message": "ok", "period": mtd_period}),
        }
    except Exception:
        logger.exception("Pipeline failed")
        raise
