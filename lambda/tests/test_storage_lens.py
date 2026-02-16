"""Tests for S3 Storage Lens metrics reader."""

from __future__ import annotations

from datetime import datetime, timezone
from unittest.mock import MagicMock, patch

from dapanoskop.storage_lens import get_storage_lens_metrics


def test_storage_lens_successful_retrieval() -> None:
    """Test successful retrieval of Storage Lens metrics."""
    timestamp = datetime(2026, 2, 15, 12, 0, 0, tzinfo=timezone.utc)

    # Mock the boto3 clients and responses
    with patch("dapanoskop.storage_lens.boto3.client") as mock_client:
        # Mock STS
        mock_sts = MagicMock()
        mock_sts.get_caller_identity.return_value = {"Account": "123456789012"}

        # Mock S3 Control
        mock_s3control = MagicMock()
        mock_s3control.list_storage_lens_configurations.return_value = {
            "StorageLensConfigurationList": [
                {
                    "Id": "org-config",
                    "StorageLensArn": "arn:aws:s3:us-east-1:123456789012:storage-lens/org-config",
                }
            ]
        }
        mock_s3control.get_storage_lens_configuration.return_value = {
            "StorageLensConfiguration": {
                "Id": "org-config",
                "AwsOrg": {
                    "Arn": "arn:aws:organizations::123456789012:organization/o-abc123"
                },
                "DataExport": {"CloudWatchMetrics": {"IsEnabled": True}},
            }
        }

        # Mock CloudWatch
        mock_cloudwatch = MagicMock()
        mock_cloudwatch.get_paginator.return_value.paginate.return_value = [
            {
                "Metrics": [
                    {
                        "Namespace": "AWS/S3/Storage-Lens",
                        "MetricName": "StorageBytes",
                        "Dimensions": [
                            {"Name": "organization_id", "Value": "o-abc123"},
                            {"Name": "record_type", "Value": "ORGANIZATION"},
                        ],
                    },
                    {
                        "Namespace": "AWS/S3/Storage-Lens",
                        "MetricName": "ObjectCount",
                        "Dimensions": [
                            {"Name": "organization_id", "Value": "o-abc123"},
                            {"Name": "record_type", "Value": "ORGANIZATION"},
                        ],
                    },
                ]
            }
        ]
        mock_cloudwatch.get_metric_data.return_value = {
            "MetricDataResults": [
                {
                    "Id": "m0",
                    "Label": "StorageBytes",
                    "Timestamps": [timestamp],
                    "Values": [1000000000],
                },
                {
                    "Id": "m1",
                    "Label": "ObjectCount",
                    "Timestamps": [timestamp],
                    "Values": [500],
                },
            ]
        }

        def client_factory(service_name, **kwargs):
            if service_name == "sts":
                return mock_sts
            elif service_name == "s3control":
                return mock_s3control
            elif service_name == "cloudwatch":
                return mock_cloudwatch
            raise ValueError(f"Unexpected service: {service_name}")

        mock_client.side_effect = client_factory

        result = get_storage_lens_metrics(config_id="")

        assert result is not None
        assert result["total_bytes"] == 1000000000
        assert result["object_count"] == 500
        assert result["config_id"] == "org-config"
        assert result["org_id"] == "o-abc123"


def test_storage_lens_specific_config_id() -> None:
    """Test querying with a specific config ID."""
    timestamp = datetime(2026, 2, 15, 12, 0, 0, tzinfo=timezone.utc)

    with patch("dapanoskop.storage_lens.boto3.client") as mock_client:
        mock_sts = MagicMock()
        mock_sts.get_caller_identity.return_value = {"Account": "123456789012"}

        mock_s3control = MagicMock()
        mock_s3control.list_storage_lens_configurations.return_value = {
            "StorageLensConfigurationList": [
                {
                    "Id": "my-custom-config",
                    "StorageLensArn": "arn:aws:s3:us-east-1:123456789012:storage-lens/my-custom-config",
                }
            ]
        }
        mock_s3control.get_storage_lens_configuration.return_value = {
            "StorageLensConfiguration": {
                "Id": "my-custom-config",
                "AwsOrg": {
                    "Arn": "arn:aws:organizations::123456789012:organization/o-xyz789"
                },
                "DataExport": {"CloudWatchMetrics": {"IsEnabled": True}},
            }
        }

        mock_cloudwatch = MagicMock()
        mock_cloudwatch.get_paginator.return_value.paginate.return_value = [
            {
                "Metrics": [
                    {
                        "Namespace": "AWS/S3/Storage-Lens",
                        "MetricName": "StorageBytes",
                        "Dimensions": [
                            {"Name": "organization_id", "Value": "o-xyz789"},
                            {"Name": "record_type", "Value": "ORGANIZATION"},
                        ],
                    }
                ]
            }
        ]
        mock_cloudwatch.get_metric_data.return_value = {
            "MetricDataResults": [
                {
                    "Id": "m0",
                    "Label": "StorageBytes",
                    "Timestamps": [timestamp],
                    "Values": [5000000000],
                }
            ]
        }

        def client_factory(service_name, **kwargs):
            if service_name == "sts":
                return mock_sts
            elif service_name == "s3control":
                return mock_s3control
            elif service_name == "cloudwatch":
                return mock_cloudwatch
            raise ValueError(f"Unexpected service: {service_name}")

        mock_client.side_effect = client_factory

        result = get_storage_lens_metrics(config_id="my-custom-config")

        assert result is not None
        assert result["config_id"] == "my-custom-config"
        assert result["org_id"] == "o-xyz789"


def test_storage_lens_no_config_found() -> None:
    """Test graceful handling when no Storage Lens config exists."""
    with patch("dapanoskop.storage_lens.boto3.client") as mock_client:
        mock_sts = MagicMock()
        mock_sts.get_caller_identity.return_value = {"Account": "123456789012"}

        mock_s3control = MagicMock()
        mock_s3control.list_storage_lens_configurations.return_value = {
            "StorageLensConfigurationList": []
        }

        def client_factory(service_name, **kwargs):
            if service_name == "sts":
                return mock_sts
            elif service_name == "s3control":
                return mock_s3control
            raise ValueError(f"Unexpected service: {service_name}")

        mock_client.side_effect = client_factory

        result = get_storage_lens_metrics(config_id="")
        assert result is None


def test_storage_lens_cloudwatch_disabled() -> None:
    """Test handling when CloudWatch metrics are disabled."""
    with patch("dapanoskop.storage_lens.boto3.client") as mock_client:
        mock_sts = MagicMock()
        mock_sts.get_caller_identity.return_value = {"Account": "123456789012"}

        mock_s3control = MagicMock()
        mock_s3control.list_storage_lens_configurations.return_value = {
            "StorageLensConfigurationList": [
                {
                    "Id": "no-cloudwatch-config",
                    "StorageLensArn": "arn:aws:s3:us-east-1:123456789012:storage-lens/no-cloudwatch-config",
                }
            ]
        }
        mock_s3control.get_storage_lens_configuration.return_value = {
            "StorageLensConfiguration": {
                "Id": "no-cloudwatch-config",
                "AwsOrg": {
                    "Arn": "arn:aws:organizations::123456789012:organization/o-abc123"
                },
                "DataExport": {"CloudWatchMetrics": {"IsEnabled": False}},
            }
        }

        def client_factory(service_name, **kwargs):
            if service_name == "sts":
                return mock_sts
            elif service_name == "s3control":
                return mock_s3control
            raise ValueError(f"Unexpected service: {service_name}")

        mock_client.side_effect = client_factory

        result = get_storage_lens_metrics(config_id="")
        assert result is None


def test_storage_lens_non_org_config() -> None:
    """Test that non-org-wide configs are skipped."""
    with patch("dapanoskop.storage_lens.boto3.client") as mock_client:
        mock_sts = MagicMock()
        mock_sts.get_caller_identity.return_value = {"Account": "123456789012"}

        mock_s3control = MagicMock()
        mock_s3control.list_storage_lens_configurations.return_value = {
            "StorageLensConfigurationList": [
                {
                    "Id": "account-only-config",
                    "StorageLensArn": "arn:aws:s3:us-east-1:123456789012:storage-lens/account-only-config",
                }
            ]
        }
        # Config without AwsOrg (account-level only)
        mock_s3control.get_storage_lens_configuration.return_value = {
            "StorageLensConfiguration": {
                "Id": "account-only-config",
                "DataExport": {"CloudWatchMetrics": {"IsEnabled": True}},
            }
        }

        def client_factory(service_name, **kwargs):
            if service_name == "sts":
                return mock_sts
            elif service_name == "s3control":
                return mock_s3control
            raise ValueError(f"Unexpected service: {service_name}")

        mock_client.side_effect = client_factory

        result = get_storage_lens_metrics(config_id="")
        assert result is None


def test_storage_lens_config_not_found() -> None:
    """Test handling when specified config ID doesn't exist."""
    with patch("dapanoskop.storage_lens.boto3.client") as mock_client:
        mock_sts = MagicMock()
        mock_sts.get_caller_identity.return_value = {"Account": "123456789012"}

        mock_s3control = MagicMock()
        mock_s3control.list_storage_lens_configurations.return_value = {
            "StorageLensConfigurationList": [
                {
                    "Id": "existing-config",
                    "StorageLensArn": "arn:aws:s3:us-east-1:123456789012:storage-lens/existing-config",
                }
            ]
        }

        def client_factory(service_name, **kwargs):
            if service_name == "sts":
                return mock_sts
            elif service_name == "s3control":
                return mock_s3control
            raise ValueError(f"Unexpected service: {service_name}")

        mock_client.side_effect = client_factory

        # Request non-existent config
        result = get_storage_lens_metrics(config_id="nonexistent-config")
        assert result is None


def test_storage_lens_empty_metrics() -> None:
    """Test handling when CloudWatch returns no metrics."""
    with patch("dapanoskop.storage_lens.boto3.client") as mock_client:
        mock_sts = MagicMock()
        mock_sts.get_caller_identity.return_value = {"Account": "123456789012"}

        mock_s3control = MagicMock()
        mock_s3control.list_storage_lens_configurations.return_value = {
            "StorageLensConfigurationList": [
                {
                    "Id": "org-storage-lens",
                    "StorageLensArn": "arn:aws:s3:us-east-1:123456789012:storage-lens/org-storage-lens",
                }
            ]
        }
        mock_s3control.get_storage_lens_configuration.return_value = {
            "StorageLensConfiguration": {
                "Id": "org-storage-lens",
                "AwsOrg": {
                    "Arn": "arn:aws:organizations::123456789012:organization/o-abc123"
                },
                "DataExport": {"CloudWatchMetrics": {"IsEnabled": True}},
            }
        }

        mock_cloudwatch = MagicMock()
        # Return empty metrics list
        mock_cloudwatch.get_paginator.return_value.paginate.return_value = [
            {"Metrics": []}
        ]

        def client_factory(service_name, **kwargs):
            if service_name == "sts":
                return mock_sts
            elif service_name == "s3control":
                return mock_s3control
            elif service_name == "cloudwatch":
                return mock_cloudwatch
            raise ValueError(f"Unexpected service: {service_name}")

        mock_client.side_effect = client_factory

        result = get_storage_lens_metrics(config_id="")
        assert result is None


def test_storage_lens_aggregates_across_dimensions() -> None:
    """Test that metrics split across storage classes/regions are summed correctly."""
    timestamp = datetime(2026, 2, 15, 12, 0, 0, tzinfo=timezone.utc)

    with patch("dapanoskop.storage_lens.boto3.client") as mock_client:
        mock_sts = MagicMock()
        mock_sts.get_caller_identity.return_value = {"Account": "123456789012"}

        mock_s3control = MagicMock()
        mock_s3control.list_storage_lens_configurations.return_value = {
            "StorageLensConfigurationList": [
                {
                    "Id": "org-config",
                    "StorageLensArn": "arn:aws:s3:us-east-1:123456789012:storage-lens/org-config",
                }
            ]
        }
        mock_s3control.get_storage_lens_configuration.return_value = {
            "StorageLensConfiguration": {
                "Id": "org-config",
                "AwsOrg": {
                    "Arn": "arn:aws:organizations::123456789012:organization/o-abc123"
                },
                "DataExport": {"CloudWatchMetrics": {"IsEnabled": True}},
            }
        }

        mock_cloudwatch = MagicMock()
        # Return multiple metric combinations (e.g. different storage classes)
        mock_cloudwatch.get_paginator.return_value.paginate.return_value = [
            {
                "Metrics": [
                    {
                        "Namespace": "AWS/S3/Storage-Lens",
                        "MetricName": "StorageBytes",
                        "Dimensions": [
                            {"Name": "organization_id", "Value": "o-abc123"},
                            {"Name": "record_type", "Value": "ORGANIZATION"},
                            {"Name": "storage_class", "Value": "STANDARD"},
                        ],
                    },
                    {
                        "Namespace": "AWS/S3/Storage-Lens",
                        "MetricName": "StorageBytes",
                        "Dimensions": [
                            {"Name": "organization_id", "Value": "o-abc123"},
                            {"Name": "record_type", "Value": "ORGANIZATION"},
                            {"Name": "storage_class", "Value": "GLACIER"},
                        ],
                    },
                ]
            }
        ]
        # Return data split across two dimension combinations at same timestamp
        mock_cloudwatch.get_metric_data.return_value = {
            "MetricDataResults": [
                {
                    "Id": "m0",
                    "Label": "StorageBytes",
                    "Timestamps": [timestamp],
                    "Values": [3000000000],  # 3 GB in STANDARD
                },
                {
                    "Id": "m1",
                    "Label": "StorageBytes",
                    "Timestamps": [timestamp],
                    "Values": [7000000000],  # 7 GB in GLACIER
                },
            ]
        }

        def client_factory(service_name, **kwargs):
            if service_name == "sts":
                return mock_sts
            elif service_name == "s3control":
                return mock_s3control
            elif service_name == "cloudwatch":
                return mock_cloudwatch
            raise ValueError(f"Unexpected service: {service_name}")

        mock_client.side_effect = client_factory

        result = get_storage_lens_metrics(config_id="")

        assert result is not None
        # Values should be summed: 3 GB + 7 GB = 10 GB
        assert result["total_bytes"] == 10000000000
        # object_count defaults to 0 when no ObjectCount metrics returned
        assert result["object_count"] == 0


def test_storage_lens_sts_failure_returns_none() -> None:
    """Test graceful handling when STS call fails."""
    from botocore.exceptions import ClientError

    with patch("dapanoskop.storage_lens.boto3.client") as mock_client:
        mock_sts = MagicMock()
        mock_sts.get_caller_identity.side_effect = ClientError(
            {"Error": {"Code": "AccessDenied", "Message": "Forbidden"}},
            "GetCallerIdentity",
        )

        def client_factory(service_name, **kwargs):
            if service_name == "sts":
                return mock_sts
            raise ValueError(f"Unexpected service: {service_name}")

        mock_client.side_effect = client_factory

        result = get_storage_lens_metrics(config_id="")
        assert result is None
