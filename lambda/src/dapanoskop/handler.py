"""AWS Lambda entry point for Dapanoskop data pipeline."""

from __future__ import annotations

import json
import logging
import os
from typing import Any

from dapanoskop.collector import collect
from dapanoskop.processor import process, write_to_s3

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)


def handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    """Lambda handler for cost data collection and processing."""
    bucket = os.environ.get("DATA_BUCKET")
    if not bucket:
        raise ValueError("DATA_BUCKET environment variable is required")

    cost_category_name = os.environ.get("COST_CATEGORY_NAME", "")
    include_efs = os.environ.get("INCLUDE_EFS", "false").lower() == "true"
    include_ebs = os.environ.get("INCLUDE_EBS", "false").lower() == "true"

    try:
        logger.info("Starting data collection (bucket=%s)", bucket)
        collected = collect(cost_category_name=cost_category_name)

        logger.info("Processing collected data")
        processed = process(collected, include_efs=include_efs, include_ebs=include_ebs)

        logger.info("Writing to S3")
        write_to_s3(processed, bucket)

        period = processed["summary"]["period"]
        logger.info("Pipeline completed for period %s", period)
        return {
            "statusCode": 200,
            "body": json.dumps({"message": "ok", "period": period}),
        }
    except Exception:
        logger.exception("Pipeline failed")
        raise
