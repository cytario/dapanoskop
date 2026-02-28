[![CI](https://github.com/cytario/dapanoskop/actions/workflows/ci.yml/badge.svg)](https://github.com/cytario/dapanoskop/actions/workflows/ci.yml)
[![Release](https://github.com/cytario/dapanoskop/actions/workflows/release.yml/badge.svg)](https://github.com/cytario/dapanoskop/actions/workflows/release.yml)
[![GitHub release](https://img.shields.io/github/v/release/cytario/dapanoskop)](https://github.com/cytario/dapanoskop/releases)
[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](https://www.gnu.org/licenses/gpl-3.0)
![Frontend Tests](https://img.shields.io/badge/frontend_tests-71-blue)
![Python Tests](https://img.shields.io/badge/python_tests-61-blue)
![Python Coverage](https://img.shields.io/badge/coverage-98%25-brightgreen)

# Dapanoskop

> From Greek δαπάνη (dapáni, "cost") + σκοπέω (skopéo, "to observe") — the cost observer.

Dapanoskop is an opinionated approach to cloud cost monitoring. Rather than trying to be everything to everyone, it makes deliberate architectural choices about how cloud spending should be tracked, analyzed, and acted upon.

## How It Works

A daily Lambda queries AWS Cost Explorer, aggregates costs by workload and cost center, and writes pre-computed `summary.json`, Parquet files, and an `index.json` manifest to S3. The SPA authenticates via Cognito, obtains temporary AWS credentials from a Cognito Identity Pool, and accesses S3 directly — JSON via the AWS S3 SDK, Parquet via DuckDB-wasm's native S3 support (httpfs). Data access is enforced at the IAM level: only authenticated users receive scoped `s3:GetObject` credentials.

Each daily run also collects the current in-progress month (month-to-date). The MTD period appears first in the period selector with a "MTD" badge; the report displays a banner and like-for-like change annotations comparing the current partial month against the same date range of the prior month (e.g., Feb 1–7 vs. Jan 1–7). The default period selection remains the most recently completed month.

For initial setup, the Lambda supports backfill mode to populate up to 13 months of historical Cost Explorer data in a single invocation.

```
app/          React SPA — cost report with drill-down via DuckDB-wasm
lambda/       Python Lambda — collects AWS Cost Explorer data, writes JSON + Parquet to S3
terraform/    OpenTofu/Terraform module — provisions all AWS infrastructure
```

### Multi-account setup

Dapanoskop queries Cost Explorer in the account where it's deployed. For org-wide visibility you have two options:

- **Management (payer) account** — sees consolidated costs across all member accounts.
- **Delegated member account** — designate a member account as [Cost Management administrator](https://docs.aws.amazon.com/cost-management/latest/userguide/management-account-delegation.html) to avoid deploying in the management account.

Deploying in a regular member account (without delegation) shows only that account's costs.

## Prerequisites

- AWS account with [Cost Explorer enabled](https://docs.aws.amazon.com/cost-management/latest/userguide/ce-enable.html)
- [OpenTofu](https://opentofu.org/) >= 1.5 (or Terraform >= 1.5)

## Getting Started

### Option A: Managed Cognito User Pool (recommended)

The module creates and manages a Cognito User Pool for you:

```hcl
module "dapanoskop" {
  source = "git::https://github.com/cytario/dapanoskop.git//terraform?ref=v1.3.0"

  release_version       = "v1.3.0"
  cognito_domain_prefix = "dapanoskop-myorg"
}
```

```bash
tofu init && tofu apply
```

The managed pool comes with security-hardened defaults: strong password policy, MFA support, token revocation, and admin-only user creation. To add users, use the AWS Console or CLI:

```bash
aws cognito-idp admin-create-user \
  --user-pool-id $(tofu output -raw cognito_user_pool_id) \
  --username user@example.com
```

### Option B: Bring your own Cognito User Pool

If you already have a Cognito User Pool:

```hcl
module "dapanoskop" {
  source = "git::https://github.com/cytario/dapanoskop.git//terraform?ref=v1.3.0"

  release_version      = "v1.3.0"
  cognito_user_pool_id = "eu-west-1_XXXXXXX"
  cognito_domain       = "https://auth.example.com"
}
```

### SSO federation (Azure Entra ID)

Add SAML federation to the managed pool for single sign-on:

```hcl
module "dapanoskop" {
  source = "git::https://github.com/cytario/dapanoskop.git//terraform?ref=v1.3.0"

  release_version       = "v1.3.0"
  cognito_domain_prefix = "dapanoskop-myorg"

  saml_provider_name = "AzureAD"
  saml_metadata_url  = "https://login.microsoftonline.com/{tenant-id}/federationmetadata/2007-06/federationmetadata.xml"
}
```

After `tofu apply`, configure your IdP with the Terraform outputs:

```bash
tofu output saml_entity_id  # Set as Entity ID / Identifier in Azure
tofu output saml_acs_url    # Set as Reply URL in Azure
```

When federation is active, local Cognito password login is automatically disabled — users must authenticate through the IdP.

### Release deployment

When `release_version` is set, the module creates a dedicated S3 artifacts bucket, downloads `lambda.zip` and `spa.tar.gz` from the GitHub Release, and uploads them to the bucket. The Lambda function is deployed directly from S3, and the SPA is extracted from the artifacts bucket and synced to the app bucket. Subsequent `tofu plan` runs detect changes via S3 object versions — no local files needed.

### Local development mode

When `release_version` is not set, no artifacts bucket is created. The module builds the Lambda zip from source via `archive_file` and skips SPA deployment (deploy manually with `aws s3 sync`).

### Backfilling historical data

After deployment, you can populate historical cost data (up to 13 months) by invoking the Lambda with a backfill event:

```bash
aws lambda invoke \
  --function-name $(tofu output -raw lambda_function_name) \
  --payload '{"backfill": true, "months": 13, "force": false}' \
  response.json
```

Parameters:

- `backfill` (boolean, required): Set to `true` to enable backfill mode
- `months` (integer, optional): Number of historical months to process (default: 13)
- `force` (boolean, optional): Reprocess months that already exist in S3 (default: false)

Backfill processes months sequentially, skips existing data unless forced, and returns a status report showing which months succeeded, failed, or were skipped. This is idempotent and safe to run multiple times. See [lambda/BACKFILL.md](lambda/BACKFILL.md) for detailed usage examples.

## Configuration

### Terraform Variables

| Variable                    | Required | Description                                                                              |
| --------------------------- | -------- | ---------------------------------------------------------------------------------------- |
| `cognito_user_pool_id`      | No       | Existing Cognito User Pool ID. Leave empty for a managed pool.                           |
| `cognito_domain_prefix`     | No       | Domain prefix for managed pool hosted UI (required if no `cognito_user_pool_id`)         |
| `cognito_domain`            | No       | Cognito domain for CSP (only needed with BYO pool)                                       |
| `cognito_mfa_configuration` | No       | MFA for managed pool: `OFF`, `OPTIONAL` (default), or `ON`                               |
| `saml_provider_name`        | No       | SAML IdP display name (e.g. `AzureAD`)                                                   |
| `saml_metadata_url`         | No       | SAML federation metadata URL from your IdP                                               |
| `saml_attribute_mapping`    | No       | SAML claim-to-attribute mapping                                                          |
| `oidc_provider_name`        | No       | OIDC IdP display name                                                                    |
| `oidc_issuer`               | No       | OIDC issuer URL                                                                          |
| `oidc_client_id`            | No       | OIDC client ID                                                                           |
| `oidc_client_secret`        | No       | OIDC client secret (sensitive — prefer SAML to avoid secrets in state)                   |
| `release_version`           | No       | GitHub release tag (e.g. `v1.3.0`). Stages pre-built artifacts in a dedicated S3 bucket. |
| `github_repo`               | No       | GitHub repo for release artifacts (default: `cytario/dapanoskop`)                        |
| `cost_category_name`        | No       | AWS Cost Category for cost center mapping                                                |
| `domain_name`               | No       | Custom domain for CloudFront                                                             |
| `acm_certificate_arn`       | No       | ACM certificate ARN (required with `domain_name`)                                        |
| `schedule_expression`       | No       | EventBridge cron (default: `cron(0 6 * * ? *)`)                                          |
| `include_efs`               | No       | Include EFS in storage metrics (default: `false`)                                        |
| `include_ebs`               | No       | Include EBS in storage metrics (default: `false`)                                        |
| `storage_lens_config_id`    | No       | S3 Storage Lens configuration ID (auto-discovers if empty). Leave empty to disable Storage Lens integration. |
| `tags`                      | No       | Map of tags to apply to all resources via AWS provider `default_tags`                    |
| `permissions_boundary`      | No       | ARN of IAM permissions boundary to attach to all IAM roles. Leave empty to skip.         |
| `enable_access_logging`     | No       | Enable S3 and CloudFront access logging (default: `false`)                               |

### Terraform Outputs

| Output                 | Description                               |
| ---------------------- | ----------------------------------------- |
| `cloudfront_url`       | URL of the CloudFront distribution        |
| `data_bucket_name`     | S3 bucket for cost data                   |
| `app_bucket_name`      | S3 bucket for SPA assets                  |
| `cognito_client_id`    | Cognito app client ID                     |
| `cognito_user_pool_id` | Cognito User Pool ID                      |
| `cognito_domain_url`   | Cognito hosted UI URL (managed pool only) |
| `saml_entity_id`       | SAML Entity ID for IdP configuration      |
| `saml_acs_url`         | SAML ACS URL for IdP configuration        |
| `lambda_function_name` | Lambda function name                      |
| `identity_pool_id`     | Cognito Identity Pool ID                  |

### SPA Configuration

In production, the SPA reads `/config.json` from S3 (written by Terraform) with the following fields:

| Field             | Description                         |
| ----------------- | ----------------------------------- |
| `cognitoDomain`   | Cognito hosted UI domain            |
| `cognitoClientId` | Cognito app client ID               |
| `userPoolId`      | Cognito User Pool ID                |
| `identityPoolId`  | Cognito Identity Pool ID            |
| `awsRegion`       | AWS region for S3 and Cognito calls |
| `dataBucketName`  | S3 bucket containing cost data      |

For local development, the SPA falls back to `VITE_*` env vars:

| Variable                 | Default                        | Description              |
| ------------------------ | ------------------------------ | ------------------------ |
| `VITE_AUTH_BYPASS`       | `false`                        | Skip auth for local dev  |
| `VITE_COGNITO_DOMAIN`    | —                              | Cognito hosted UI domain |
| `VITE_COGNITO_CLIENT_ID` | —                              | Cognito app client ID    |
| `VITE_REDIRECT_URI`      | `window.location.origin + "/"` | OAuth redirect URI       |

### Lambda Environment Variables

These are set by Terraform automatically:

| Variable                 | Required | Description                                                                   |
| ------------------------ | -------- | ----------------------------------------------------------------------------- |
| `DATA_BUCKET`            | Yes      | S3 bucket name for output files                                               |
| `COST_CATEGORY_NAME`     | No       | AWS Cost Category name (auto-discovers if empty)                              |
| `INCLUDE_EFS`            | No       | Include EFS in storage metrics                                                |
| `INCLUDE_EBS`            | No       | Include EBS in storage metrics                                                |
| `STORAGE_LENS_CONFIG_ID` | No       | S3 Storage Lens configuration ID (optional — auto-discovers if empty)         |

## Testing

The project maintains automated tests across all three sub-systems, run in CI on every push and pull request.

| Sub-system | Framework                | Tests | Coverage |
| ---------- | ------------------------ | ----: | -------- |
| Frontend   | Vitest + Testing Library |    71 | —        |
| Lambda     | pytest + moto            |    61 | 98%      |
| Terraform  | checkov + tofu test      |    15 | —        |

**Frontend** — Unit tests for utility functions (`format.ts`, `aggregate.ts`, `auth.ts`, `config.ts`, `duckdb-config.ts`, `data.ts`) and component tests for key UI elements (`WorkloadTable`, `CostCenterCard`, `PeriodSelector`, `ErrorBoundary`, `SummaryHeader`, `Layout`).

**Lambda** — Full handler integration tests with moto-mocked AWS services, plus unit tests for the collector, processor, and category modules. Coverage is enforced at 70% minimum via `pytest-cov`.

**Terraform** — Checkov security scanning, TFLint linting, and `.tftest.hcl` contract tests using `mock_provider` for CSP header construction, auth input validations, and IAM policy least-privilege regression.

## Development

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, code style, and PR process. Quick start:

```bash
# Install dependencies
make install

# Run the SPA with fixture data (no AWS needed)
cd app && VITE_AUTH_BYPASS=true npm run dev

# Run all linters and tests
make lint && make test
```

## License

This project is licensed under the [GNU General Public License v3.0](LICENSE).

A commercial license is available through [Cytario](https://cytario.com) for use cases where the GPL is not suitable.
