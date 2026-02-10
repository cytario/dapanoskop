# Software Design Specification (SDS) — Dapanoskop

| Field               | Value                                      |
|---------------------|--------------------------------------------|
| Document ID         | SDS-DP                                     |
| Product             | Dapanoskop (DP)                            |
| System Type         | Non-regulated Software                     |
| Version             | 0.1 (Draft)                                |
| Date                | 2026-02-08                                 |

---

## 1. Introduction

### 1.1 Purpose

This document describes the software architecture and design of Dapanoskop. It decomposes the system into sub-systems and components, describes their interfaces, and documents key design decisions.

### 1.2 Scope

This document covers the internal architecture of Dapanoskop: the static web application, the cost data collection pipeline, the data storage layer, and the Terraform deployment module.

### 1.3 Referenced Documents

| Document | Description                                        |
|----------|----------------------------------------------------|
| URS-DP   | User Requirements Specification for Dapanoskop     |
| SRS-DP   | Software Requirements Specification for Dapanoskop |

### 1.4 Definitions and Abbreviations

| Term | Definition                       |
|------|----------------------------------|
| SPA  | Single Page Application          |
| IaC  | Infrastructure as Code           |
| CE   | AWS Cost Explorer                |
| OAC  | CloudFront Origin Access Control |

---

## 2. Solution Strategy

| Quality Goal                 | Scenario                                                                  | Solution Approach                                                                   | Reference  |
|------------------------------|---------------------------------------------------------------------------|-------------------------------------------------------------------------------------|------------|
| Simplicity for Budget Owners | A non-technical user opens the app and immediately sees their cost report | Static pre-rendered report data; no interactive querying; 1-page layout             | §3.1       |
| Low operational cost         | The tool itself should not be a significant cost item                     | Serverless architecture (Lambda + S3 + CloudFront); no always-on compute            | §3.2, §5   |
| Easy deployment              | A DevOps engineer deploys in minutes                                      | Single Terraform module encapsulating all resources                                 | §3.3       |
| Data freshness               | Cost data is at most 1 day old                                            | Scheduled Lambda execution (daily) writing to S3                                    | §3.2, §4.1 |
| Security                     | Only authenticated users access cost data                                 | Cognito authentication via existing User Pool; all authenticated users see all data | §3.1, §6.4 |

---

## 3. Building Block View

### Level 1: System Decomposition

```
┌─────────────────────────────────────────────────────────────────┐
│                        D A P A N O S K O P                      │
│                                                                 │
│  ┌──────────────┐   ┌──────────────┐   ┌──────────────────┐     │
│  │  SS-1        │   │  SS-2        │   │  SS-3            │     │
│  │  Web App     │   │  Data        │   │  Terraform       │     │
│  │  (React SPA) │   │  Pipeline    │   │  Module          │     │
│  │              │   │              │   │                  │     │
│  │  S3 App +    │   │  Lambda +    │   │  IaC for all     │     │
│  │  CloudFront  │   │  EventBridge │   │  resources       │     │
│  │  + Cognito   │   │              │   │                  │     │
│  └──────┬───────┘   └──────┬───────┘   └──────────────────┘     │
│         │                  │                                    │
│         │    reads         │    writes                          │
│         ▼                  ▼                                    │
│       ┌──────────────────────┐                                  │
│       │  SS-4                │                                  │
│       │  Data Store          │                                  │
│       │  (S3 Data Bucket)    │                                  │
│       │                      │                                  │
│       │  summary.json +      │                                  │
│       │  parquet per period  │                                  │
│       └──────────────────────┘                                  │
└─────────────────────────────────────────────────────────────────┘
```

Note: The SPA static assets are hosted in a separate S3 App Bucket (part of SS-1). The Data Bucket (SS-4) stores only cost data JSON files.

### 3.1 SS-1: Web Application

**Purpose / Responsibility**: Serves the cost report UI to authenticated users. A React SPA hosted on a dedicated S3 bucket, delivered via CloudFront, with authentication via an existing Cognito User Pool.

**Interfaces**:
- **Inbound (User)**: HTTPS requests from browsers via CloudFront
- **Outbound (Data Store)**: Reads pre-computed cost data JSON files from the data S3 bucket via CloudFront
- **Outbound (Auth)**: Redirects to existing Cognito hosted UI for authentication; validates JWT tokens

**Variability**: Cognito Domain URL and Client ID are injected at deploy time via environment variables.

#### Level 2: Web Application Components

```
┌──────────────────────────────────────────┐
│              SS-1: Web App               │
│                                          │
│  ┌──────────────┐  ┌─────────────────┐   │
│  │  C-1.1       │  │  C-1.2          │   │
│  │  Auth Module │  │  Report Renderer│   │
│  │              │  │                 │   │
│  │  Cognito     │  │  Reads JSON,    │   │
│  │  OIDC flow,  │  │  renders 1-page │   │
│  │  token mgmt  │  │  cost report    │   │
│  └──────────────┘  └─────────────────┘   │
│                                          │
└──────────────────────────────────────────┘
```

##### 3.1.1 C-1.1: Auth Module

**Purpose / Responsibility**: Handles the Cognito OIDC authentication flow, token storage, and token refresh against an existing Cognito User Pool.

**Interfaces**:
- **Inbound**: Called by the SPA on page load and on token expiry
- **Outbound**: Cognito hosted UI (redirect), Cognito token endpoint (token exchange)

**Variability**: Cognito Domain URL and Client ID are injected at build/deploy time via environment variables (`VITE_COGNITO_DOMAIN`, `VITE_COGNITO_CLIENT_ID`).

**[SDS-DP-010101] Implement OIDC Authorization Code Flow with PKCE**
The Auth Module implements the OAuth 2.0 Authorization Code flow with PKCE against the Cognito hosted UI. Tokens are stored in sessionStorage, preserving the session across page refreshes within the same browser tab while clearing automatically when the tab is closed. The module handles token refresh on expiry.
Refs: SRS-DP-310101, SRS-DP-310102, SRS-DP-410101, SRS-DP-410102

##### 3.1.2 C-1.2: Report Renderer

**Purpose / Responsibility**: Fetches pre-computed cost data from the data S3 bucket (via CloudFront) and renders the 1-page cost report showing all cost centers. Uses summary.json for the initial view and DuckDB-wasm to query parquet files for drill-down.

**Interfaces**:
- **Inbound**: Receives authenticated user context from C-1.1
- **Outbound**: HTTP GET to CloudFront to fetch summary.json and parquet files

**Variability**: None.

**[SDS-DP-010201] Fetch Summary Data**
The Report Renderer fetches `{year}-{month}/summary.json` for the selected reporting period and renders the 1-page cost report (global summary bar, cost center cards, storage metric cards).
Refs: SRS-DP-310201, SRS-DP-310211

**[SDS-DP-010202] Render Cost Center Cards**
The Report Renderer renders each cost center as an expandable card with summary (total, MoM, YoY, workload count, top mover) from summary.json. The workload breakdown table is rendered within the expanded card.
Refs: SRS-DP-310201, SRS-DP-310202, SRS-DP-310203, SRS-DP-310212

**[SDS-DP-010203] Render Workload Table**
The Report Renderer renders the workload breakdown table from summary.json, with workloads sorted by current month cost descending and MoM/YoY deltas included.
Refs: SRS-DP-310204, SRS-DP-310205

**[SDS-DP-010204] Render Storage Metrics**
The Report Renderer renders total storage cost, cost per TB, and hot tier percentage from the pre-computed summary.json.
Refs: SRS-DP-310206, SRS-DP-310207, SRS-DP-310208

**[SDS-DP-010206] Query Parquet via DuckDB-wasm**
For drill-down views (e.g., usage types within a workload), the Report Renderer initializes DuckDB-wasm and queries the relevant parquet file (e.g., `{year}-{month}/cost-by-usage-type.parquet`) directly over HTTP. DuckDB-wasm supports querying remote parquet files via HTTP range requests, avoiding full file downloads.
Refs: SRS-DP-310301

**[SDS-DP-010205] Apply Business-Friendly Labels**
The Report Renderer maps internal identifiers to business-friendly labels (e.g., App tag values displayed as "Workload", usage categories displayed without AWS terminology).
Refs: SRS-DP-310209

Wireframes: See `docs/wireframes/cost-report.puml` and `docs/wireframes/workload-detail.puml`.
Cost direction indicators (color coding, direction arrows, +/- prefixes) and anomaly highlighting are implemented with Tailwind CSS utility classes.
Refs: SRS-DP-310210, SRS-DP-310213

### 3.2 SS-2: Data Pipeline

**Purpose / Responsibility**: Periodically collects cost data from the AWS Cost Explorer API, processes and categorizes it, and writes pre-computed summary JSON and parquet files to S3 for consumption by the web application.

**Interfaces**:
- **Inbound (Trigger)**: EventBridge scheduled rule triggers Lambda execution
- **Outbound (Cost Explorer)**: Calls `GetCostAndUsage` API
- **Outbound (S3)**: Writes JSON cost data files to the data store bucket

**Variability**: The cost categories to query and the usage type categorization patterns are configured at deploy time.

#### Level 2: Data Pipeline Components

```
┌──────────────────────────────────────────────┐
│           SS-2: Data Pipeline                │
│                                              │
│  ┌─────────────┐  ┌───────────────────────┐  │
│  │  C-2.1      │  │  C-2.2                │  │
│  │  Cost       │  │  Data Processor       │  │
│  │  Collector  │  │  & Writer             │  │
│  │             │  │                       │  │
│  │  Queries CE │  │  Categorizes usage    │  │
│  │  API        │  │  types, computes      │  │
│  │             │  │  aggregates, writes   │  │
│  │             │  │  JSON to S3           │  │
│  └─────────────┘  └───────────────────────┘  │
│                                              │
└──────────────────────────────────────────────┘
```

##### 3.2.1 C-2.1: Cost Collector

**Purpose / Responsibility**: Queries the AWS Cost Explorer API to retrieve raw cost and usage data for the reporting periods (current month, previous month, same month last year).

**Interfaces**:
- **Inbound**: Invoked by the Data Processor (C-2.2) or directly by the Lambda handler
- **Outbound**: AWS Cost Explorer `GetCostAndUsage` API

**Variability**: GroupBy dimensions are fixed (TAG:App + USAGE_TYPE). The Cost Category name is configurable (defaults to the first one returned by the API).

**[SDS-DP-020101] Query Cost Explorer for Three Periods**
The Cost Collector queries `GetCostAndUsage` for three time periods: the current (or most recent complete) month, the previous month, and the same month of the previous year. Each query uses `MONTHLY` granularity and requests `UnblendedCost` and `UsageQuantity` metrics, grouped by App tag and USAGE_TYPE (2 GroupBy dimensions, within the CE API limit).
Refs: SRS-DP-420101, SRS-DP-420102

**[SDS-DP-020102] Query Cost Category Mapping**
The Cost Collector queries the configured AWS Cost Category (by name, or the first one returned by `GetCostCategories` if not configured) to obtain the mapping of workloads (App tag values) to cost centers. The Cost Category's values are the cost center names. This mapping is applied during data processing (C-2.2) to allocate workload costs to cost centers.
Refs: SRS-DP-420103

##### 3.2.2 C-2.2: Data Processor & Writer

**Purpose / Responsibility**: Processes raw Cost Explorer responses, categorizes usage types, computes aggregates (totals, storage metrics, comparisons), and writes structured JSON files to S3.

**Interfaces**:
- **Inbound**: Raw Cost Explorer response data from C-2.1
- **Outbound**: Summary JSON and parquet files written to S3 via `PutObject`

**[SDS-DP-020201] Categorize Usage Types**
The Data Processor categorizes each AWS usage type into Storage, Compute, Other, or Support by matching the usage type string against known patterns.
Refs: SRS-DP-420105

**[SDS-DP-020202] Apply Cost Category Mapping**
The Data Processor applies the Cost Category mapping from C-2.1 to assign each workload's cost to a cost center. Workloads not matched by any Cost Category rule are grouped under a default label.
Refs: SRS-DP-420103

**[SDS-DP-020203] Compute Storage Volume and Hot Tier Metrics**
The Data Processor computes total storage volume from S3 `TimedStorage-*` usage quantities (converting byte-hours to bytes) and calculates the hot tier percentage as: `(TimedStorage-ByteHrs + TimedStorage-INT-FA-ByteHrs) / total TimedStorage-*-ByteHrs`. When configured, EFS and EBS storage usage types are included in the totals.
Refs: SRS-DP-420104

**[SDS-DP-020204] Write Summary JSON**
The Data Processor writes `{year}-{month}/summary.json` containing pre-computed aggregates for the 1-page report: cost center totals (current, prev month, YoY), workload breakdown per cost center (sorted by cost descending, with MoM/YoY), storage metrics (total cost, cost/TB, hot tier %), and a `collected_at` ISO 8601 timestamp.
Refs: SRS-DP-430101, SRS-DP-510002

**[SDS-DP-020205] Write Workload Parquet**
The Data Processor writes `{year}-{month}/cost-by-workload.parquet` containing per-workload cost data with columns: `cost_center`, `workload`, `period`, `cost_usd`. Rows for all three periods (current, previous month, YoY month) are included so the SPA can compute comparisons via DuckDB queries.
Refs: SRS-DP-430101

**[SDS-DP-020206] Write Usage Type Parquet**
The Data Processor writes `{year}-{month}/cost-by-usage-type.parquet` containing per-usage-type cost data with columns: `workload`, `usage_type`, `category`, `period`, `cost_usd`, `usage_quantity`. Rows for all three periods are included.
Refs: SRS-DP-430101

### 3.3 SS-3: Terraform Module

**Purpose / Responsibility**: Provides a single Terraform module that provisions all AWS resources needed for a complete Dapanoskop deployment.

**Interfaces**:
- **Inbound**: Terraform input variables from the deployer
- **Outbound**: Provisions AWS resources (S3 buckets, CloudFront distribution, Cognito app client on existing User Pool, Lambda function, EventBridge rule, IAM roles)

**Variability**: Configurable via Terraform variables (domain name, Cost Category name (optional, defaults to first), existing Cognito User Pool ID, schedule, storage services to include, etc.).

#### Level 2: Terraform Module Components

```
┌────────────────────────────────────────────────────────┐
│              SS-3: Terraform Module                    │
│                                                        │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐   │
│  │ C-3.1    │ │ C-3.2    │ │ C-3.3    │ │ C-3.4    │   │
│  │ Hosting  │ │ Auth     │ │ Pipeline │ │ Data     │   │
│  │ Infra    │ │ Infra    │ │ Infra    │ │ Store    │   │
│  │          │ │          │ │          │ │ Infra    │   │
│  │ S3 App + │ │ Cognito  │ │ Lambda + │ │ S3 Data  │   │
│  │ CF + DNS │ │ App Clnt │ │ EB Rule  │ │ bucket   │   │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘   │
│                                                        │
└────────────────────────────────────────────────────────┘
```

##### 3.3.1 C-3.1: Hosting Infrastructure

**Purpose / Responsibility**: Provisions the S3 app bucket for static web app hosting, CloudFront distribution with OAC (dual origin: app bucket + data bucket), and optional custom domain / TLS certificate.

**[SDS-DP-030101] Provision Web Hosting Stack**
The module creates an S3 app bucket (private, website hosting disabled), a CloudFront distribution with OAC pointing to both the app bucket and the data bucket as separate origins, and S3 bucket policies granting CloudFront read access.
Refs: SRS-DP-520001, SRS-DP-520003

The custom domain name and ACM certificate ARN are passed as optional Terraform input variables. The module does not create certificates or DNS records — those are managed externally.

##### 3.3.2 C-3.2: Auth Infrastructure

**Purpose / Responsibility**: Creates a Cognito app client on an existing Cognito User Pool for Dapanoskop authentication.

**[SDS-DP-030201] Create Cognito App Client**
The module creates a Cognito app client on the existing User Pool (provided via input variable), configured for authorization code flow with PKCE. Callback URLs point to the CloudFront distribution domain.
Refs: SRS-DP-410101

##### 3.3.3 C-3.3: Pipeline Infrastructure

**Purpose / Responsibility**: Provisions the Lambda function for cost data collection, its IAM role (with Cost Explorer and S3 permissions), and the EventBridge scheduled rule.

**[SDS-DP-030301] Provision Lambda and Schedule**
The module creates a Lambda function (Python runtime) from a packaged deployment artifact, an IAM role with permissions for `ce:GetCostAndUsage`, `ce:GetCostCategories`, and `s3:PutObject` (to the data bucket), and an EventBridge rule to trigger the Lambda on a daily schedule.
The Lambda is packaged as a zip file from the local source directory via Terraform's `archive_file` data source and deployed directly (not via S3). Memory: 256 MB. Timeout: 5 minutes. EventBridge schedule: `cron(0 6 * * ? *)` (daily at 06:00 UTC).
Refs: SRS-DP-510002, SRS-DP-520002

##### 3.3.4 C-3.4: Data Store Infrastructure

**Purpose / Responsibility**: Provisions a dedicated S3 data bucket for cost data storage, separate from the app bucket.

**[SDS-DP-030401] Provision Data Bucket**
The module creates a dedicated S3 bucket for cost data with versioning enabled, server-side encryption (SSE-S3 or SSE-KMS), and a bucket policy granting the Lambda function write access and CloudFront read access.
Refs: SRS-DP-430101, SRS-DP-430102

No lifecycle rules — all historical data is retained indefinitely. Storage cost is negligible (a few KB per period).

### 3.4 SS-4: Data Store (S3 Data Bucket)

**Purpose / Responsibility**: Dedicated S3 bucket storing pre-computed cost data (summary JSON + parquet files). Separate from the app bucket that hosts the SPA.

**Interfaces**:
- **Inbound (Write)**: Lambda function writes summary JSON and parquet files
- **Outbound (Read)**: CloudFront serves data files to the SPA (JSON fetched directly, parquet queried via DuckDB-wasm HTTP range requests)

**Variability**: Data partitioned by reporting period under date prefixes.

**[SDS-DP-040001] Data File Layout**
Each reporting period is stored under a `{year}-{month}/` prefix containing:

```
{year}-{month}/
  summary.json                 # Pre-computed aggregates for instant 1-page render
  cost-by-workload.parquet     # Detailed workload cost data for all 3 periods
  cost-by-usage-type.parquet   # Detailed usage type cost data for all 3 periods
```

Refs: SRS-DP-430101, SRS-DP-430102

**[SDS-DP-040002] summary.json Schema**

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

Refs: SRS-DP-430101, SRS-DP-430102

**[SDS-DP-040003] Parquet File Schemas**

**cost-by-workload.parquet:**

| Column | Type | Description |
|--------|------|-------------|
| cost_center | STRING | A value from the configured Cost Category |
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

Both parquet files contain rows for all three periods (current, previous month, YoY) to support comparison queries.

Refs: SRS-DP-430101

The SPA discovers available periods using a two-step approach: it first attempts to fetch an `index.json` file listing available periods; if that fails, it probes the last 13 months by making HEAD requests to `{year}-{month}/summary.json` and collects those that return 200.

---

## 4. Runtime View

### 4.1 Daily Cost Data Collection

```
EventBridge          Lambda (C-2.1 + C-2.2)          Cost Explorer       S3 Data Bucket
    │                         │                            │                  │
    │──── trigger ───────────>│                            │                  │
    │                         │                            │                  │
    │                         │── GetCostCategories ──────>│                  │
    │                         │<── CC→workload mapping ────│                  │
    │                         │                            │                  │
    │                         │── GetCostAndUsage ────────>│                  │
    │                         │   (current month,          │                  │
    │                         │    GroupBy: App + USAGE_TYPE)                  │
    │                         │<── response ───────────────│                  │
    │                         │                            │                  │
    │                         │── GetCostAndUsage ────────>│                  │
    │                         │   (prev month, same)       │                  │
    │                         │<── response ───────────────│                  │
    │                         │                            │                  │
    │                         │── GetCostAndUsage ────────>│                  │
    │                         │   (YoY month, same)        │                  │
    │                         │<── response ───────────────│                  │
    │                         │                            │                  │
    │                         │ [apply CC mapping,         │                  │
    │                         │  categorize, aggregate,    │                  │
    │                         │  compute storage metrics]  │                  │
    │                         │                            │                  │
    │                         │── PutObject ──────────────────────────────────>│
    │                         │   {y}-{m}/summary.json                        │
    │                         │   {y}-{m}/cost-by-workload.parquet            │
    │                         │   {y}-{m}/cost-by-usage-type.parquet          │
    │                         │<── 200 OK ────────────────────────────────────│
```

### 4.2 User Views Cost Report

```
Browser              CloudFront       S3 App    S3 Data    Cognito (existing)
   │                     │              │          │              │
   │── GET / ───────────>│              │          │              │
   │                     │── read ─────>│          │              │
   │<── index.html ──────│<── file ─────│          │              │
   │                     │              │          │              │
   │ [SPA loads, Auth Module checks for valid token]              │
   │                     │              │          │              │
   │── redirect ─────────────────────────────────────────────────>│
   │<── Cognito login page ──────────────────────────────────────│
   │── credentials ──────────────────────────────────────────────>│
   │<── redirect with auth code ─────────────────────────────────│
   │                     │              │          │              │
   │── exchange code ────────────────────────────────────────────>│
   │<── tokens (ID + access) ────────────────────────────────────│
   │                     │              │          │              │
   │── GET /data/{y}-{m}/summary.json ──>│          │              │
   │                     │──────────────────read──>│              │
   │                     │<─────────────────file───│              │
   │<── summary JSON ───│              │          │              │
   │                     │              │          │              │
   │ [render 1-page report from summary.json]                     │
   │                     │              │          │              │
   │ [user clicks workload for drill-down]                        │
   │                     │              │          │              │
   │── DuckDB HTTP range req ──────────>│          │              │
   │   /data/{y}-{m}/cost-by-usage-type.parquet    │              │
   │                     │──────────────────read──>│              │
   │                     │<─────────────────bytes──│              │
   │<── parquet bytes ──│              │          │              │
   │                     │              │          │              │
   │ [DuckDB-wasm queries parquet, renders drill-down]            │
```

### 4.3 Deployment

```
DevOps Engineer          Terraform          AWS
      │                      │                │
      │── terraform init ───>│                │
      │── terraform plan ───>│                │
      │<── plan output ──────│                │
      │── terraform apply ──>│                │
      │                      │── create S3 buckets ────────>│
      │                      │── create CloudFront ────────>│
      │                      │── create Cognito app client ─>│
      │                      │── create Lambda ────────────>│
      │                      │── create EventBridge rule ──>│
      │                      │── create IAM roles ─────────>│
      │                      │── upload SPA assets ────────>│
      │                      │<── all resources created ────│
      │<── apply complete ───│                │
      │                      │                │
      │ [output: CloudFront URL, Cognito details]           │
```

---

## 5. Deployment View

```
┌──────────────────────────────────────────────────────────────────┐
│                        AWS Account                               │
│                                                                  │
│  ┌─────────────────┐       ┌─────────────┐  ┌────────────────┐  │
│  │  CloudFront     │       │  S3 App     │  │  S3 Data       │  │
│  │  Distribution   │──OAC──│  Bucket     │  │  Bucket        │  │
│  │                 │──OAC──│  SPA assets │  │  Cost JSON     │  │
│  │  HTTPS endpoint │       └─────────────┘  └────────────────┘  │
│  └────────┬────────┘                              ▲              │
│           │                                       │ PutObject    │
│  ┌────────┴────────┐                     ┌────────┴──────────┐   │
│  │  Cognito        │                     │  Lambda Function   │   │
│  │  (existing      │                     │  (Python)          │   │
│  │   User Pool)    │                     │                    │   │
│  │                 │                     │  Cost Collector +  │   │
│  │  App Client     │                     │  Data Processor    │   │
│  │  (created by TF)│                     └────────┬───────────┘   │
│  └─────────────────┘                              │              │
│                                          ┌────────┴──────────┐   │
│                                          │  EventBridge       │   │
│                                          │  Scheduled Rule    │   │
│                                          │  (daily cron)      │   │
│                                          └───────────────────┘   │
│                                                                  │
│                                          ┌───────────────────┐   │
│                                          │  Cost Explorer API │   │
│                                          │  (AWS service)     │   │
│                                          └───────────────────┘   │
└──────────────────────────────────────────────────────────────────┘
```

**Deployable Artifacts:**

| Artifact | Content | Deployed To |
|----------|---------|-------------|
| SPA bundle | HTML, CSS, JS (compiled React app) | S3 App Bucket |
| Lambda package | Python code (zip file from `archive_file`) | Lambda function |
| Terraform module | HCL files | Executed by DevOps engineer |

**Execution Nodes:**

| Node | Type | Purpose |
|------|------|---------|
| CloudFront | AWS managed CDN | Serve SPA and data to users globally |
| S3 App Bucket | AWS managed object store | Host React SPA static assets |
| S3 Data Bucket | AWS managed object store | Host pre-computed summary JSON and parquet files |
| Lambda | AWS managed serverless compute | Run cost data collection |
| Cognito | AWS managed identity (existing User Pool) | User authentication |
| EventBridge | AWS managed event bus | Schedule Lambda invocations |

---

## 6. Crosscutting Concepts

### 6.1 Data Flow and Pre-computation

Dapanoskop follows a **two-tier data pattern**:

1. **summary.json** — Pre-computed aggregates for the 1-page report. Small, fast to fetch, renders instantly.
2. **Parquet files** — Detailed cost data queryable via DuckDB-wasm for drill-down. Parquet's columnar format and DuckDB's HTTP range request support mean only the needed byte ranges are fetched, not the full file.

All data is collected and processed by the Lambda function (server-side, scheduled). The SPA never calls the Cost Explorer API. This design:

- Eliminates the need for AWS credentials in the browser
- Enables instant report loading via small summary.json
- Enables powerful drill-down via DuckDB-wasm + parquet without a backend API
- Reduces Cost Explorer API costs (queries happen once daily, not per user visit)

### 6.2 Labeling

The software version follows semantic versioning (SemVer) and is displayed in the footer of the web application after sign-in. Versioning is automated via conventional commits and semantic-release.

### 6.3 Usage Type Categorization

The usage type categorization logic (mapping AWS usage types to Storage / Compute / Other / Support) uses string pattern matching against known AWS usage type patterns. The categorization is applied during data processing in the Lambda function (C-2.2).

This categorization must be maintained as AWS introduces new usage types. Unknown usage types default to the "Other" category.

### 6.4 Security — Authentication-Gated Access

All authenticated users can access all cost data. The security model is:
1. The Lambda writes a single JSON file containing data for all cost centers
2. The SPA is served behind CloudFront + OAC (no direct S3 access)
3. The SPA requires a valid Cognito token before fetching data
4. User management is handled via the existing Cognito User Pool console

This is appropriate for an internal cost monitoring tool where all stakeholders should have visibility into the full cost picture.

### 6.5 Hot Tier Calculation

Hot storage tiers are defined as:
- **S3 Standard** (`TimedStorage-ByteHrs`)
- **S3 Intelligent-Tiering Frequent Access** (`TimedStorage-INT-FA-ByteHrs`)
- **EFS Standard** (when configured to include EFS)
- **EBS gp2/gp3/io1/io2** (when configured to include EBS)

Which storage services are included is configurable at deployment time via Terraform variables. S3 is always included.

The hot tier percentage is calculated as:

```
hot_tier_% = (hot_tier_byte_hours / total_byte_hours) × 100
```


### 6.6 Cost per TB Calculation

Cost per TB is calculated as:

```
cost_per_TB = total_storage_cost_usd / (total_storage_volume_bytes / 1,099,511,627,776)
```

Where `total_storage_volume_bytes` is derived from `TimedStorage-*-ByteHrs` usage quantities (and optionally EFS/EBS when configured). Byte-hours are converted to bytes by dividing by the number of hours in the reporting month.

---

## 7. Design Decisions

### 7.1 Static SPA vs. Server-Rendered Application

#### 7.1.1 Issue
How should the web UI be built and served? This affects hosting cost, complexity, and security model.

#### 7.1.2 Boundary Conditions
- Must be deployable via Terraform to AWS
- Budget owners need a simple, fast experience
- Operational cost of Dapanoskop itself should be minimal
- No real-time data requirements (daily refresh is sufficient)

#### 7.1.3 Assumptions
- Cost data changes at most daily
- Number of concurrent users is small (tens, not thousands)
- Budget owners access reports periodically, not continuously

#### 7.1.4 Considered Alternatives

| Option | Pros | Cons |
|--------|------|------|
| **A: Static SPA on S3/CloudFront** | Zero compute cost for serving; simple deployment; scales infinitely; no server to maintain | SPA framework needed |
| B: Server-rendered (ECS/Fargate) | Traditional web app | Always-on compute cost; more complex deployment; more to maintain |
| C: API Gateway + Lambda + SPA | Serverless; moderate cost | More complex; API latency; more Lambda invocations |

#### 7.1.5 Decision
**Option A: Static SPA on S3/CloudFront**. The pre-computation model means the SPA only needs to render static data. All authenticated users see all data, so there is no need for server-side filtering. Server-side rendering adds cost and complexity for a use case where daily data freshness is sufficient and the user base is small.

### 7.2 Pre-computed Data vs. On-Demand Queries

#### 7.2.1 Issue
Should cost data be queried on-demand when a user views a report, or pre-computed and stored?

#### 7.2.2 Boundary Conditions
- AWS Cost Explorer API has a cost per query ($0.01 per request)
- Cost data for a completed month does not change significantly
- Multiple users may view the same data

#### 7.2.3 Assumptions
- Daily data freshness is acceptable for cost monitoring
- Cost Explorer query costs could become significant with many users and frequent access

#### 7.2.4 Considered Alternatives

| Option | Pros | Cons |
|--------|------|------|
| **A: Pre-computed (Lambda writes JSON to S3)** | Fixed cost (1 Lambda run/day); fast report loading; no user-facing API needed | Data up to 24h stale; storage cost for JSON files (negligible) |
| B: On-demand (API per user request) | Always fresh data; no storage needed | Cost Explorer API cost per request; slower report loading; requires API layer |

#### 7.2.5 Decision
**Option A: Pre-computed data**. Daily freshness is sufficient for budget monitoring. Pre-computation eliminates per-user API costs and enables the static SPA architecture.

### 7.3 SPA Technology

#### 7.3.1 Issue
Which technology should be used for the static SPA?

#### 7.3.2 Boundary Conditions
- Must produce static assets deployable to S3
- Must handle Cognito OIDC flow
- Must render tabular data with comparison columns

#### 7.3.3 Assumptions
- The SPA is simple (1-2 screens, read-only data)

#### 7.3.4 Considered Alternatives

| Option | Pros | Cons |
|--------|------|------|
| **A: React** | Widely known; large ecosystem; strong Cognito library support | Heavier than alternatives for a simple app |
| B: Vue / Svelte | Lighter weight; simpler for small apps | Smaller ecosystem; less familiar |
| C: Plain HTML/CSS/JS | No build tooling; simplest | Manual DOM manipulation; harder to maintain |

#### 7.3.5 Decision
**Option A: React with React Router v7 in framework mode**. Pre-rendering and hydration only (no server-side rendering), producing static assets that can be hosted on S3/CloudFront. React Router v7 framework mode provides file-based routing conventions and built-in pre-rendering support while keeping the deployment model fully static.

### 7.4 Lambda Runtime Language

#### 7.4.1 Issue
What programming language should the Lambda function use?

#### 7.4.2 Boundary Conditions
- Must support AWS SDK (Cost Explorer API)
- Existing categorization logic is written in Python

#### 7.4.3 Assumptions
- The data processing logic is moderate complexity (categorization, aggregation, JSON output)

#### 7.4.4 Considered Alternatives

| Option | Pros | Cons |
|--------|------|------|
| **A: Python** | Reuse of existing categorization logic; mature AWS SDK (boto3) | Lambda cold start slightly slower than compiled languages |
| B: Node.js / TypeScript | Same language as SPA (if JS); fast Lambda cold starts | Cannot directly reuse existing categorization logic |
| C: Go / Rust | Fastest cold starts; compiled binary | No reuse of existing Python code; smaller ecosystem for this use case |

#### 7.4.5 Decision
**Option A: Python**. Reuse of existing categorization logic is a significant advantage. The Lambda runs daily on a schedule, so cold start performance is not critical.

---

## 8. Change History

| Version | Date       | Author | Description       |
|---------|------------|--------|-------------------|
| 0.1     | 2026-02-08 | —      | Initial draft     |
| 0.2     | 2026-02-10 | —      | Align with implementation: period discovery, Lambda deployment, auth config |
