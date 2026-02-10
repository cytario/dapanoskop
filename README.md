# Dapanoskop

> From Greek δαπάνη (dapáni, "cost") + σκοπέω (skopéo, "to observe") — the cost observer.

Dapanoskop is an opinionated approach to cloud cost monitoring. Rather than trying to be everything to everyone, it makes deliberate architectural choices about how cloud spending should be tracked, analyzed, and acted upon.

## Architecture

```
app/          React SPA — cost report with drill-down via DuckDB-wasm
lambda/       Python Lambda — collects AWS Cost Explorer data, writes JSON + Parquet to S3
terraform/    OpenTofu/Terraform module — provisions all AWS infrastructure
```

A daily Lambda queries AWS Cost Explorer, aggregates costs by workload and cost center, and writes pre-computed `summary.json` and Parquet files to S3. The SPA loads the summary for instant rendering and uses DuckDB-wasm for in-browser SQL on Parquet files when drilling down into usage-type details.

## Prerequisites

- [Node.js](https://nodejs.org/) >= 22
- [uv](https://docs.astral.sh/uv/) (Python package manager)
- Python >= 3.12
- [OpenTofu](https://opentofu.org/) >= 1.5 (or Terraform >= 1.5)
- AWS account with Cost Explorer enabled

## Getting Started

### 1. Clone and install

```bash
git clone <repo-url> && cd dapanoskop

# Frontend
cd app && npm install && cd ..

# Python Lambda
cd lambda && uv sync && uv pip install -e . && cd ..
```

### 2. Generate fixture data

```bash
uv run python scripts/generate-fixtures.py
```

This creates mock cost data in `app/fixtures/` for local development.

### 3. Run the SPA locally

```bash
cd app
VITE_AUTH_BYPASS=true npm run dev
```

The dev server serves fixture data at `/data/` automatically. Auth is bypassed so no Cognito setup is needed for local development.

Open [http://localhost:5173](http://localhost:5173).

### 4. Run the Lambda tests

```bash
cd lambda
uv run pytest
```

## Environment Variables

### SPA (`app/`)

| Variable | Default | Description |
|----------|---------|-------------|
| `VITE_AUTH_BYPASS` | — | Set to `"true"` to skip Cognito auth locally |
| `VITE_COGNITO_DOMAIN` | — | Cognito hosted UI domain (e.g. `https://mypool.auth.eu-west-1.amazoncognito.com`) |
| `VITE_COGNITO_CLIENT_ID` | — | Cognito app client ID |
| `VITE_REDIRECT_URI` | `window.location.origin + "/"` | OAuth redirect URI |
| `VITE_DATA_BASE_URL` | `"/data"` | Base URL for cost data files |

### Lambda

| Variable | Required | Description |
|----------|----------|-------------|
| `DATA_BUCKET` | Yes | S3 bucket name for output files |
| `COST_CATEGORY_NAME` | No | AWS Cost Category name (auto-discovers if empty) |
| `INCLUDE_EFS` | No | Include EFS in storage metrics (`"true"` / `"false"`) |
| `INCLUDE_EBS` | No | Include EBS in storage metrics (`"true"` / `"false"`) |

## Deployment

### Terraform

```bash
cd terraform
tofu init
tofu plan -var="cognito_user_pool_id=eu-west-1_XXXXXXX"
tofu apply -var="cognito_user_pool_id=eu-west-1_XXXXXXX"
```

#### Input Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `cognito_user_pool_id` | Yes | Existing Cognito User Pool ID |
| `cost_category_name` | No | AWS Cost Category for cost center mapping |
| `domain_name` | No | Custom domain for CloudFront |
| `acm_certificate_arn` | No | ACM certificate ARN (required with `domain_name`) |
| `schedule_expression` | No | EventBridge cron (default: `cron(0 6 * * ? *)`) |
| `include_efs` | No | Include EFS in storage metrics (default: `false`) |
| `include_ebs` | No | Include EBS in storage metrics (default: `false`) |

#### Outputs

| Output | Description |
|--------|-------------|
| `cloudfront_url` | URL of the CloudFront distribution |
| `data_bucket_name` | S3 bucket for cost data |
| `app_bucket_name` | S3 bucket for SPA assets |
| `cognito_client_id` | Cognito app client ID |
| `lambda_function_name` | Lambda function name |

### Deploy the SPA

```bash
cd app
npm run build
aws s3 sync build/client/ s3://$(cd ../terraform && tofu output -raw app_bucket_name)/
```

### Deploy the Lambda

```bash
cd lambda
zip -r lambda.zip src/dapanoskop/
aws lambda update-function-code \
  --function-name $(cd ../terraform && tofu output -raw lambda_function_name) \
  --zip-file fileb://lambda.zip
```

## Quality Gates

```bash
# Frontend
cd app
npx prettier --check .
npx eslint .
npx react-router typegen && npx tsc --noEmit
npm run build

# Python
cd lambda
uv run ruff check .
uv run ruff format --check .
uv run pytest

# Terraform
cd terraform
tofu fmt -check -recursive
tofu validate
tflint
```

## CI/CD

GitHub Actions runs all quality gates on push to `main` and on pull requests. Merges to `main` trigger [semantic-release](https://semantic-release.gitbook.io/) for automated versioning and GitHub releases.

Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/):
- `feat:` — new feature (minor version bump)
- `fix:` — bug fix (patch version bump)
- `feat!:` or `BREAKING CHANGE:` — breaking change (major version bump)

## License

Private.
