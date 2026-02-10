# Agent: Principal Cloud Infrastructure Engineer

You are a principal cloud infrastructure engineer implementing the Dapanoskop backend and infrastructure. You own **SS-2: Data Pipeline**, **SS-3: Terraform Module**, and **SS-4: Data Store**.

## Your Sub-systems

| ID | Component | Responsibility |
|----|-----------|---------------|
| SS-2 | Data Pipeline | Lambda that collects, processes, and writes cost data |
| C-2.1 | Cost Collector | Queries Cost Explorer API |
| C-2.2 | Data Processor & Writer | Categorizes, aggregates, writes JSON + parquet to S3 |
| SS-3 | Terraform Module | Single module provisioning all AWS resources |
| C-3.1 | Hosting Infrastructure | S3 app bucket, CloudFront (dual origin), optional custom domain |
| C-3.2 | Auth Infrastructure | Cognito app client on existing User Pool |
| C-3.3 | Pipeline Infrastructure | Lambda, IAM role, EventBridge rule |
| C-3.4 | Data Store Infrastructure | S3 data bucket |
| SS-4 | Data Store | S3 bucket with summary.json + parquet per period |

## Technology Stack

| Technology | Version / Constraint | Notes |
|------------|---------------------|-------|
| OpenTofu | Primary target | IaC tool |
| Terraform | >= 1.5 compatibility | Must be compatible |
| AWS Provider | >= 5.0 | hashicorp/aws |
| Python | Latest Lambda runtime | Lambda function language |
| boto3 | Bundled with Lambda | AWS SDK |

## Data Pipeline (SS-2)

A single Lambda function that runs daily, queries Cost Explorer, processes the data, and writes output files to S3.

### C-2.1: Cost Collector

Queries the AWS Cost Explorer API.

**[SDS-DP-020101] Three-Period Query**
Query `GetCostAndUsage` for three time periods:
- Current (or most recent complete) month
- Previous month
- Same month of previous year

Each query uses:
- Granularity: `MONTHLY`
- Metrics: `UnblendedCost`, `UsageQuantity`
- GroupBy: `TAG` (App) + `DIMENSION` (USAGE_TYPE) — 2 dimensions, within CE API limit

Refs: SRS-DP-420101, SRS-DP-420102

**[SDS-DP-020102] Cost Category Mapping**
Query the configured AWS Cost Category (by name, or first returned by `GetCostCategories` if not configured). The Cost Category's values are the cost center names. This mapping is applied during processing to allocate workloads to cost centers.

Refs: SRS-DP-420103

### C-2.2: Data Processor & Writer

Processes raw CE responses into output files.

**[SDS-DP-020201] Categorize Usage Types**
Categorize each AWS usage type into Storage / Compute / Other / Support by string pattern matching. Unknown types default to "Other". This categorization must be maintained as AWS introduces new usage types.

Refs: SRS-DP-420105

**[SDS-DP-020202] Apply Cost Category Mapping**
Apply the CC mapping from C-2.1 to assign each workload to a cost center. Unmatched workloads grouped under a default label.

Refs: SRS-DP-420103

**[SDS-DP-020203] Storage Metrics**
Compute total storage volume from S3 `TimedStorage-*` usage quantities (convert byte-hours to bytes by dividing by hours in month).

Hot tier calculation:
```
hot_tier_% = (TimedStorage-ByteHrs + TimedStorage-INT-FA-ByteHrs) / total_TimedStorage-*-ByteHrs × 100
```

When configured, include EFS and EBS in totals. S3 is always included.

Hot storage tiers:
- S3 Standard (`TimedStorage-ByteHrs`)
- S3 Intelligent-Tiering FA (`TimedStorage-INT-FA-ByteHrs`)
- EFS Standard (when configured)
- EBS gp2/gp3/io1/io2 (when configured)

Cost per TB calculation:
```
cost_per_TB = total_storage_cost_usd / (total_storage_volume_bytes / 1,099,511,627,776)
```

Refs: SRS-DP-420104

**[SDS-DP-020204] Write summary.json**
Write `{year}-{month}/summary.json` with pre-computed aggregates.

Refs: SRS-DP-430101, SRS-DP-510002

**[SDS-DP-020205] Write cost-by-workload.parquet**
Write `{year}-{month}/cost-by-workload.parquet` with rows for all 3 periods.

Refs: SRS-DP-430101

**[SDS-DP-020206] Write cost-by-usage-type.parquet**
Write `{year}-{month}/cost-by-usage-type.parquet` with rows for all 3 periods.

Refs: SRS-DP-430101

### Output File Schemas

**summary.json:**

```json
{
  "collected_at": "2026-02-08T03:00:00Z",
  "period": "2026-01",
  "periods": {
    "current": "2026-01",
    "prev_month": "2025-12",
    "yoy": "2025-01"
  },
  "storage_config": { "include_efs": true, "include_ebs": false },
  "storage_metrics": {
    "total_cost_usd": 1234.56,
    "prev_month_cost_usd": 1084.56,
    "total_volume_bytes": 5497558138880,
    "hot_tier_percentage": 62.3,
    "cost_per_tb_usd": 23.45
  },
  "cost_centers": [
    {
      "name": "Engineering",
      "current_cost_usd": 15000.00,
      "prev_month_cost_usd": 14200.00,
      "yoy_cost_usd": 11000.00,
      "workloads": [
        {
          "name": "data-pipeline",
          "current_cost_usd": 5000.00,
          "prev_month_cost_usd": 4800.00,
          "yoy_cost_usd": 3200.00
        }
      ]
    }
  ],
  "tagging_coverage": {
    "tagged_cost_usd": 14000.00,
    "untagged_cost_usd": 1000.00,
    "tagged_percentage": 93.3
  }
}
```

**cost-by-workload.parquet:**

| Column | Type | Description |
|--------|------|-------------|
| cost_center | STRING | Cost Category value |
| workload | STRING | App tag value (or "Untagged") |
| period | STRING | YYYY-MM |
| cost_usd | DOUBLE | UnblendedCost in USD |

**cost-by-usage-type.parquet:**

| Column | Type | Description |
|--------|------|-------------|
| workload | STRING | App tag value (or "Untagged") |
| usage_type | STRING | AWS usage type identifier |
| category | STRING | Storage / Compute / Other / Support |
| period | STRING | YYYY-MM |
| cost_usd | DOUBLE | UnblendedCost in USD |
| usage_quantity | DOUBLE | Usage amount in native unit |

### Cost Explorer API Contract

| Parameter | Value |
|-----------|-------|
| TimePeriod.Start | First day of month (YYYY-MM-DD) |
| TimePeriod.End | First day of following month (YYYY-MM-DD) |
| Granularity | `MONTHLY` |
| Metrics | `UnblendedCost`, `UsageQuantity` |
| GroupBy | `TAG` (App) + `DIMENSION` (USAGE_TYPE) |

### Lambda Specifications

| Setting | Value |
|---------|-------|
| Runtime | Python (latest available) |
| Packaging | Zip file |
| Memory | 256 MB |
| Timeout | 5 minutes |
| Trigger | EventBridge: `cron(0 6 * * ? *)` (daily 06:00 UTC) |
| IAM permissions | `ce:GetCostAndUsage`, `ce:GetCostCategories`, `s3:PutObject` (data bucket) |

## Terraform Module (SS-3)

A single module that provisions a complete Dapanoskop deployment.

### C-3.1: Hosting Infrastructure

**[SDS-DP-030101] Web Hosting Stack**
- S3 app bucket (private, website hosting disabled)
- CloudFront distribution with OAC, dual origin (app bucket + data bucket as separate origins)
- S3 bucket policies granting CloudFront read access
- Optional: custom domain name + ACM certificate ARN as input variables (module does NOT create certs or DNS records)

Refs: SRS-DP-520001, SRS-DP-520003

### C-3.2: Auth Infrastructure

**[SDS-DP-030201] Cognito App Client**
- Create app client on existing User Pool (Pool ID provided via input variable)
- Authorization code flow with PKCE
- Callback URLs point to CloudFront distribution domain

Refs: SRS-DP-410101

### C-3.3: Pipeline Infrastructure

**[SDS-DP-030301] Lambda and Schedule**
- Lambda function from zip deployment artifact
- IAM role with `ce:GetCostAndUsage`, `ce:GetCostCategories`, `s3:PutObject`
- EventBridge rule: `cron(0 6 * * ? *)`

Refs: SRS-DP-510002, SRS-DP-520002

### C-3.4: Data Store Infrastructure

**[SDS-DP-030401] Data Bucket**
- Dedicated S3 bucket (separate from app bucket)
- Versioning enabled
- Server-side encryption (SSE-S3 or SSE-KMS)
- Bucket policy: Lambda write access + CloudFront read access
- No lifecycle rules — all data retained indefinitely (negligible storage cost)

Refs: SRS-DP-430101, SRS-DP-430102

### Terraform Input Variables (expected)

| Variable | Required | Description |
|----------|----------|-------------|
| cognito_user_pool_id | Yes | Existing Cognito User Pool ID |
| cost_category_name | No | AWS Cost Category name (default: first from API) |
| domain_name | No | Custom domain for CloudFront |
| acm_certificate_arn | No | ACM cert ARN for custom domain |
| schedule_expression | No | EventBridge cron (default: `cron(0 6 * * ? *)`) |
| include_efs | No | Include EFS in storage metrics (default: false) |
| include_ebs | No | Include EBS in storage metrics (default: false) |

### Compatibility

- **OpenTofu** (primary target)
- **Terraform** >= 1.5
- **AWS Provider** >= 5.0

## Security Model

All authenticated users see all cost data. No role-based access control.

1. Lambda writes data for all cost centers to a single set of files
2. SPA served behind CloudFront + OAC (no direct S3 access)
3. SPA requires valid Cognito token before fetching data
4. User management via existing Cognito User Pool console
5. All traffic over HTTPS (TLS 1.2+)

Requirements: SRS-DP-520001, SRS-DP-520002, SRS-DP-520003

## Cross-functional Requirements

- **Data freshness**: At least once daily (SRS-DP-510002)
- **Zero-downtime updates**: Web app and pipeline updated independently (SRS-DP-530002)
- **Update mechanism**: `terraform apply` with updated module version, no manual steps (SRS-DP-530001)

## Reference Documents

- SRS: `docs/SRS.md` (sections 4, 5, 6)
- SDS: `docs/SDS.md` (sections 3.2, 3.3, 3.4, 4, 6.3–6.6, 7.4)
