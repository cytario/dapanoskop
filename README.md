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
- [Node.js](https://nodejs.org/) >= 22 (to build the SPA)
- [uv](https://docs.astral.sh/uv/) + Python >= 3.12 (to package the Lambda)

## Getting Started

### 1. Provision infrastructure

```bash
git clone https://github.com/cytario/dapanoskop.git && cd dapanoskop/terraform

tofu init
tofu plan -var="cognito_user_pool_id=eu-west-1_XXXXXXX"
tofu apply -var="cognito_user_pool_id=eu-west-1_XXXXXXX"
```

Or reference the module from your own Terraform config:

```hcl
module "dapanoskop" {
  source = "git::https://github.com/cytario/dapanoskop.git//terraform?ref=v1.0.0"

  cognito_user_pool_id = "eu-west-1_XXXXXXX"
}
```

### 2. Deploy the SPA

```bash
cd app
npm ci
npm run build
aws s3 sync build/client/ s3://$(cd ../terraform && tofu output -raw app_bucket_name)/
```

### 3. Deploy the Lambda

```bash
cd lambda
zip -r lambda.zip src/dapanoskop/
aws lambda update-function-code \
  --function-name $(cd ../terraform && tofu output -raw lambda_function_name) \
  --zip-file fileb://lambda.zip
```

### 4. Open the dashboard

```bash
tofu output cloudfront_url
```

Navigate to the URL and log in with your Cognito user credentials.

## Configuration

### Terraform Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `cognito_user_pool_id` | Yes | Existing Cognito User Pool ID |
| `cost_category_name` | No | AWS Cost Category for cost center mapping |
| `domain_name` | No | Custom domain for CloudFront |
| `acm_certificate_arn` | No | ACM certificate ARN (required with `domain_name`) |
| `cognito_domain` | No | Cognito domain for CSP connect-src |
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

### SPA Environment Variables

These are set at build time (baked into the static bundle):

| Variable | Default | Description |
|----------|---------|-------------|
| `VITE_COGNITO_DOMAIN` | — | Cognito hosted UI domain |
| `VITE_COGNITO_CLIENT_ID` | — | Cognito app client ID (from Terraform output) |
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
