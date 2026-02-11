[![CI](https://github.com/cytario/dapanoskop/actions/workflows/ci.yml/badge.svg)](https://github.com/cytario/dapanoskop/actions/workflows/ci.yml)
[![Release](https://github.com/cytario/dapanoskop/actions/workflows/release.yml/badge.svg)](https://github.com/cytario/dapanoskop/actions/workflows/release.yml)
[![GitHub release](https://img.shields.io/github/v/release/cytario/dapanoskop)](https://github.com/cytario/dapanoskop/releases)
[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](https://www.gnu.org/licenses/gpl-3.0)

# Dapanoskop

> From Greek δαπάνη (dapáni, "cost") + σκοπέω (skopéo, "to observe") — the cost observer.

Dapanoskop is an opinionated approach to cloud cost monitoring. Rather than trying to be everything to everyone, it makes deliberate architectural choices about how cloud spending should be tracked, analyzed, and acted upon.

## How It Works

A daily Lambda queries AWS Cost Explorer, aggregates costs by workload and cost center, and writes pre-computed `summary.json` and Parquet files to S3. The SPA loads the summary for instant rendering and uses DuckDB-wasm for in-browser SQL on Parquet files when drilling down into usage-type details.

```
app/          React SPA — cost report with drill-down via DuckDB-wasm
lambda/       Python Lambda — collects AWS Cost Explorer data, writes JSON + Parquet to S3
terraform/    OpenTofu/Terraform module — provisions all AWS infrastructure
```

## Prerequisites

- AWS account with [Cost Explorer enabled](https://docs.aws.amazon.com/cost-management/latest/userguide/ce-enable.html)
- An existing [Cognito User Pool](https://docs.aws.amazon.com/cognito/latest/developerguide/cognito-user-pool-as-user-directory.html) for authentication
- [OpenTofu](https://opentofu.org/) >= 1.5 (or Terraform >= 1.5)

## Getting Started

Add the module to your Terraform config, point it at a release, and apply:

```hcl
module "dapanoskop" {
  source = "git::https://github.com/cytario/dapanoskop.git//terraform?ref=v1.2.0"

  release_version      = "v1.2.0"
  cognito_user_pool_id = "eu-west-1_XXXXXXX"
  cognito_domain       = "https://auth.example.com"
}
```

```bash
tofu init && tofu apply
```

That's it. The module downloads pre-built Lambda and SPA artifacts from the GitHub release, deploys them, and writes the runtime config to S3. No Node.js, no Python, no manual S3 sync.

Navigate to the CloudFront URL from `tofu output cloudfront_url` and log in with your Cognito user credentials.

### Local development mode

When `release_version` is not set, the module builds the Lambda zip from source via `archive_file` and skips SPA deployment (deploy manually with `aws s3 sync`).

## Configuration

### Terraform Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `cognito_user_pool_id` | Yes | Existing Cognito User Pool ID |
| `release_version` | No | GitHub release tag (e.g. `v1.2.0`). Downloads pre-built artifacts. |
| `cognito_domain` | No | Cognito domain for auth and CSP (e.g. `https://auth.example.com`) |
| `github_repo` | No | GitHub repo for release artifacts (default: `cytario/dapanoskop`) |
| `cost_category_name` | No | AWS Cost Category for cost center mapping |
| `domain_name` | No | Custom domain for CloudFront |
| `acm_certificate_arn` | No | ACM certificate ARN (required with `domain_name`) |
| `schedule_expression` | No | EventBridge cron (default: `cron(0 6 * * ? *)`) |
| `include_efs` | No | Include EFS in storage metrics (default: `false`) |
| `include_ebs` | No | Include EBS in storage metrics (default: `false`) |
| `enable_access_logging` | No | Enable S3 and CloudFront access logging (default: `false`) |

### Terraform Outputs

| Output | Description |
|--------|-------------|
| `cloudfront_url` | URL of the CloudFront distribution |
| `data_bucket_name` | S3 bucket for cost data |
| `app_bucket_name` | S3 bucket for SPA assets |
| `cognito_client_id` | Cognito app client ID |
| `lambda_function_name` | Lambda function name |

### SPA Configuration

In production, the SPA reads `/config.json` from S3 (written by Terraform). For local development, it falls back to `VITE_*` env vars:

| Variable | Default | Description |
|----------|---------|-------------|
| `VITE_AUTH_BYPASS` | `false` | Skip auth for local dev |
| `VITE_COGNITO_DOMAIN` | — | Cognito hosted UI domain (fallback) |
| `VITE_COGNITO_CLIENT_ID` | — | Cognito app client ID (fallback) |
| `VITE_REDIRECT_URI` | `window.location.origin + "/"` | OAuth redirect URI |
| `VITE_DATA_BASE_URL` | `"/data"` | Base URL for cost data files |

### Lambda Environment Variables

These are set by Terraform automatically:

| Variable | Required | Description |
|----------|----------|-------------|
| `DATA_BUCKET` | Yes | S3 bucket name for output files |
| `COST_CATEGORY_NAME` | No | AWS Cost Category name (auto-discovers if empty) |
| `INCLUDE_EFS` | No | Include EFS in storage metrics |
| `INCLUDE_EBS` | No | Include EBS in storage metrics |

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
