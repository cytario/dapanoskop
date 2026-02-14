"""Shared test fixtures."""

from __future__ import annotations

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
