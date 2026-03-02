"""Shared test fixtures."""

from __future__ import annotations

from datetime import datetime, timezone
from unittest.mock import patch

import pytest


@pytest.fixture(autouse=True)
def _aws_env(monkeypatch: pytest.MonkeyPatch) -> None:
    """Set fake AWS credentials so boto3 never hits real AWS."""
    monkeypatch.setenv("AWS_ACCESS_KEY_ID", "testing")
    monkeypatch.setenv("AWS_SECRET_ACCESS_KEY", "testing")
    monkeypatch.setenv("AWS_SECURITY_TOKEN", "testing")
    monkeypatch.setenv("AWS_SESSION_TOKEN", "testing")
    monkeypatch.setenv("AWS_DEFAULT_REGION", "us-east-1")


@pytest.fixture
def s3_bucket_env(monkeypatch: pytest.MonkeyPatch) -> str:
    """Set environment variables and return bucket name for handler tests.

    The test must use @mock_aws decorator and create the bucket itself.
    This fixture only sets up environment variables.

    Returns the bucket name for use in assertions.
    """
    bucket_name = "test-data-bucket"

    # Set environment variables
    monkeypatch.setenv("DATA_BUCKET", bucket_name)
    monkeypatch.setenv("COST_CATEGORY_NAME", "")
    monkeypatch.setenv("INCLUDE_EFS", "false")
    monkeypatch.setenv("INCLUDE_EBS", "false")

    return bucket_name


@pytest.fixture
def freeze_backfill_now():
    """Freeze datetime.now() in the handler module to 2026-02-15 UTC.

    Backfill tests assume "now" is February 2026 so that
    _generate_backfill_months() produces deterministic month lists
    (e.g. months=3 -> Jan 2026, Dec 2025, Nov 2025).
    Without this fixture the tests break whenever the real calendar advances.
    """
    frozen = datetime(2026, 2, 15, 12, 0, 0, tzinfo=timezone.utc)
    real_datetime = datetime

    class FrozenDatetime(real_datetime):
        @classmethod
        def now(cls, tz=None):
            return frozen

    with patch("dapanoskop.handler.datetime", FrozenDatetime):
        yield frozen
