"""AWS Lambda entry point for Dapanoskop data pipeline."""

from __future__ import annotations

import json
import os
from typing import Any

from dapanoskop.collector import collect
from dapanoskop.processor import process, write_to_s3


def handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    """Lambda handler for cost data collection and processing."""
    bucket = os.environ["DATA_BUCKET"]
    cost_category_name = os.environ.get("COST_CATEGORY_NAME", "")
    include_efs = os.environ.get("INCLUDE_EFS", "false").lower() == "true"
    include_ebs = os.environ.get("INCLUDE_EBS", "false").lower() == "true"

    collected = collect(cost_category_name=cost_category_name)
    processed = process(collected, include_efs=include_efs, include_ebs=include_ebs)
    write_to_s3(processed, bucket)

    period = processed["summary"]["period"]
    return {
        "statusCode": 200,
        "body": json.dumps({"message": "ok", "period": period}),
    }
