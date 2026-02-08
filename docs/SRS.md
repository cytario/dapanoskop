# Software Requirements Specification (SRS) — Dapanoskop

| Field               | Value                                      |
|---------------------|--------------------------------------------|
| Document ID         | SRS-DP                                     |
| Product             | Dapanoskop (DP)                            |
| System Type         | Non-regulated Software                     |
| Version             | 0.1 (Draft)                                |
| Date                | 2026-02-08                                 |

---

## 1. Introduction

### 1.1 Purpose

This document specifies the software requirements for Dapanoskop. It describes how the system behaves at its interfaces to fulfill the user requirements defined in URS-DP.

### 1.2 Scope

Dapanoskop is a web-based AWS cloud cost monitoring application. It consists of a static web application for cost report viewing, a serverless data collection pipeline, and a Terraform module for deployment. This document treats the system as a black box, specifying observable behavior at user and system interfaces.

### 1.3 Referenced Documents

| Document | Description |
|----------|-------------|
| URS-DP | User Requirements Specification for Dapanoskop |

### 1.4 Definitions and Abbreviations

| Term | Definition |
|------|------------|
| SPA | Single Page Application |
| Cost Explorer | AWS Cost Explorer API for querying cost and usage data |
| Cost Category | AWS Cost Categories — a feature to map cost allocation rules |
| App tag | AWS resource tag with key `App` (or `user:App`) |
| UnblendedCost | AWS cost metric showing the actual cost of each usage type |
| TimedStorage-ByteHrs | AWS usage type metric measuring S3 storage volume over time |

---

## 2. Context Diagram

```
┌─────────────┐         ┌─────────────┐
│ Budget Owner │         │   DevOps    │
│   (Browser)  │         │  (Browser)  │
└──────┬───────┘         └──────┬──────┘
       │ UI-1: Web App          │ UI-1: Web App
       │                        │
       ▼                        ▼
┌──────────────────────────────────────────────┐
│                                              │
│              D A P A N O S K O P             │
│                                              │
└──┬──────────┬──────────┬─────────┬───────┬───┘
   │          │          │         │       │
   │ SI-1     │ SI-2     │ SI-3    │ SI-4  │ SI-5
   │          │          │         │       │
   ▼          ▼          ▼         ▼       ▼
┌──────┐ ┌────────┐ ┌───────┐ ┌───────┐ ┌────────┐
│Cognito│ │Cost    │ │S3 App │ │S3 Data│ │Cloud-  │
│(exist)│ │Explorer│ │Bucket │ │Bucket │ │Front   │
└───────┘ └────────┘ └───────┘ └───────┘ └────────┘
```

**User Interfaces:**
| ID   | Name     | Users                   | Description |
|------|----------|-------------------------|-------------|
| UI-1 | Web App  | Budget Owner, DevOps    | Static SPA served via CloudFront for viewing cost reports |

**System Interfaces:**
| ID   | Name           | Entity          | Description |
|------|----------------|-----------------|-------------|
| SI-1 | Auth           | Amazon Cognito  | User authentication and authorization |
| SI-2 | Cost Data      | AWS Cost Explorer API | Source of cost and usage data |
| SI-3 | App Hosting     | Amazon S3 (App bucket)  | Storage for static web app assets |
| SI-4 | Data Store      | Amazon S3 (Data bucket) | Storage for collected cost data |
| SI-5 | CDN            | Amazon CloudFront | Content delivery for the web application and cost data |

---

## 3. User Interfaces

### 3.1 UI-1: Web Application

The web application is a React SPA served from S3 via CloudFront. Users authenticate via an existing Cognito User Pool before accessing any content. All authenticated users can view all cost centers.

#### 3.1.1 Login Screen

**[SRS-DP-310101] Cognito Authentication Redirect**
The system redirects unauthenticated users to the Cognito hosted UI for login. Upon successful authentication, the user is redirected back to the application with a valid session.
Refs: URS-DP-10103, URS-DP-20301

**[SRS-DP-310102] Session Persistence**
The system maintains the user's authenticated session using Cognito tokens stored in the browser. The session remains valid until the token expires.
Refs: URS-DP-20301

Session duration follows the Cognito User Pool's default token expiry settings (1 hour for ID/access tokens).

#### 3.1.2 Cost Report Screen (1-Page Report)

This is the primary screen of the application. It presents a single-page cost report showing all cost centers.

##### Cost Center Summary Section

**[SRS-DP-310201] Display Cost Center Totals**
The system displays the total AWS cost for each cost center for the current reporting period (calendar month).
Refs: URS-DP-10301

**[SRS-DP-310202] Display MoM Cost Comparison**
The system displays the cost center total alongside the previous month's total, showing both the absolute difference (in USD) and the percentage change.
Refs: URS-DP-10302

**[SRS-DP-310203] Display YoY Cost Comparison**
The system displays the cost center total alongside the same month of the previous year, showing both the absolute difference (in USD) and the percentage change.
Refs: URS-DP-10302

| No | Element | Data type | Value range | Other relevant information |
|----|---------|-----------|-------------|---------------------------|
| 1  | Current month cost | Currency (USD) | ≥ 0 | Formatted with 2 decimal places |
| 2  | Previous month cost | Currency (USD) | ≥ 0 | |
| 3  | MoM absolute change | Currency (USD) | Any | Positive = increase, negative = decrease |
| 4  | MoM percentage change | Percentage | Any | |
| 5  | Same month last year cost | Currency (USD) | ≥ 0 | Shows "N/A" if data not available |
| 6  | YoY absolute change | Currency (USD) | Any | |
| 7  | YoY percentage change | Percentage | Any | |

##### Workload Breakdown Section

**[SRS-DP-310204] Display Workload Cost Table**
The system displays a table of all workloads (App tag values) within each cost center, sorted by current month cost descending. Each row shows:
- Workload name (App tag value)
- Current month cost
- Previous month cost
- MoM absolute and percentage change
- Same month last year cost
- YoY absolute and percentage change

Refs: URS-DP-10303, URS-DP-10304

**[SRS-DP-310205] Display Untagged Cost Row**
The system includes a row labeled "Untagged" (or equivalent) showing the cost of resources without an App tag within the cost center, so that tagging gaps are visible.
Refs: URS-DP-10202

| No | Element | Data type | Value range | Other relevant information |
|----|---------|-----------|-------------|---------------------------|
| 1  | Workload name | String | — | App tag value; "Untagged" for resources without App tag |
| 2  | Current month cost | Currency (USD) | ≥ 0 | |
| 3  | Previous month cost | Currency (USD) | ≥ 0 | |
| 4  | MoM change ($) | Currency (USD) | Any | |
| 5  | MoM change (%) | Percentage | Any | |
| 6  | Same month last year | Currency (USD) | ≥ 0 | "N/A" if unavailable |
| 7  | YoY change ($) | Currency (USD) | Any | |
| 8  | YoY change (%) | Percentage | Any | |

##### Storage Cost Section

**[SRS-DP-310206] Display Total Storage Cost**
The system displays the total storage cost as an aggregate across all cost centers. S3 storage is always included. EFS and EBS storage inclusion is configurable at deployment time. This includes MoM and YoY comparison columns.
Refs: URS-DP-10305, URS-DP-10302

**[SRS-DP-310207] Display Cost per TB Stored**
The system displays the cost per terabyte stored, calculated from total storage cost divided by total storage volume.
Refs: URS-DP-10306

**[SRS-DP-310208] Display Hot Tier Percentage**
The system displays the percentage of total data volume (in bytes) stored in hot storage tiers (S3 Standard, S3 Intelligent-Tiering Frequent Access, and optionally EFS/EBS depending on configuration).
Refs: URS-DP-10307

| No | Element | Data type | Value range | Other relevant information |
|----|---------|-----------|-------------|---------------------------|
| 1  | Total storage cost | Currency (USD) | ≥ 0 | Aggregated across configured storage services |
| 2  | Storage cost MoM change ($) | Currency (USD) | Any | |
| 3  | Storage cost MoM change (%) | Percentage | Any | |
| 4  | Storage cost YoY change ($) | Currency (USD) | Any | |
| 5  | Storage cost YoY change (%) | Percentage | Any | |
| 6  | Cost per TB stored | Currency (USD/TB) | ≥ 0 | |
| 7  | Hot tier percentage | Percentage | 0–100% | Based on storage volume (bytes), not cost |

##### Report Presentation

**[SRS-DP-310209] Business-Friendly Terminology**
The system uses business-friendly labels throughout the report (e.g., "Workload" instead of "App tag", "Storage" instead of listing AWS service names). No AWS-specific terminology is exposed in the default report view.
Refs: URS-DP-10308

**[SRS-DP-310210] Visual Indicators for Cost Direction**
The system visually indicates whether cost changes are increases or decreases using color coding (green for decreases, red for increases) and sign prefixes (+/-).
Refs: URS-DP-10302

Wireframes: See `docs/wireframes/cost-report.puml` and `docs/wireframes/workload-detail.puml`.

#### 3.1.3 Workload Detail Screen

**[SRS-DP-310301] Display Workload Usage Type Breakdown**
When a user selects a workload from the cost report, the system displays a breakdown of that workload's cost by usage type, sorted by cost descending. Each usage type row shows current month cost, MoM and YoY comparisons.
Refs: URS-DP-10401

| No | Element | Data type | Value range | Other relevant information |
|----|---------|-----------|-------------|---------------------------|
| 1  | Usage type | String | — | Displayed with business-friendly label where possible |
| 2  | Category | String | Storage / Compute / Other / Support | Categorization of the usage type |
| 3  | Current month cost | Currency (USD) | ≥ 0 | |
| 4  | MoM change ($) | Currency (USD) | Any | |
| 5  | MoM change (%) | Percentage | Any | |
| 6  | YoY change ($) | Currency (USD) | Any | |
| 7  | YoY change (%) | Percentage | Any | |

#### 3.1.4 Tagging Coverage Section

**[SRS-DP-310401] Display Tagging Coverage Summary**
The system displays the percentage of total cost that is attributed to tagged workloads versus untagged resources as a section on the 1-page cost report.
Refs: URS-DP-10201, URS-DP-10202

#### 3.1.5 Report Period Selection

**[SRS-DP-310501] Select Reporting Month**
The system allows the user to select which month's report to view, including the current (incomplete) month. When viewing the current month, the system displays a clear "Month-to-date" indicator. The default is the most recently completed month.
Refs: URS-DP-10301

| No | Element | Data type | Value range | Other relevant information |
|----|---------|-----------|-------------|---------------------------|
| 1  | Month/Year selector | Date (month precision) | From earliest available data to current | Default: most recent complete month |

---

## 4. System Interfaces

### 4.1 SI-1: Amazon Cognito (Auth)

#### 4.1.1 Endpoints

**[SRS-DP-410101] OAuth 2.0 / OIDC Authentication Flow**
The system integrates with an existing Cognito User Pool using the OAuth 2.0 / OIDC authorization code flow with PKCE. The SPA redirects to the Cognito hosted UI and receives tokens upon successful authentication.
Refs: URS-DP-10103, URS-DP-20301

**[SRS-DP-410102] Token Validation**
The system validates Cognito JWT tokens (ID token and access token) before granting access to cost data. Expired or invalid tokens result in a redirect to the login flow.
Refs: URS-DP-20301

#### 4.1.2 Models

| Field | Type | Description |
|-------|------|-------------|
| sub | String (UUID) | Cognito user identifier |
| email | String | User email |

### 4.2 SI-2: AWS Cost Explorer API

#### 4.2.1 Endpoints

**[SRS-DP-420101] Query Cost by App Tag and Usage Type**
The system queries the Cost Explorer `GetCostAndUsage` API grouped by App tag (workload) and `USAGE_TYPE` to retrieve per-workload, per-usage-type cost data. Metric: `UnblendedCost` and `UsageQuantity`. Granularity: `MONTHLY`.
Refs: URS-DP-10301, URS-DP-10303, URS-DP-10401

**[SRS-DP-420102] Query Historical Cost Data**
The system queries Cost Explorer for the current month, the previous month, and the same month of the previous year to support MoM and YoY comparisons.
Refs: URS-DP-10302

**[SRS-DP-420103] Query Cost Category Mapping**
The system queries AWS Cost Categories to obtain the mapping of workloads to cost centers. This is queried separately from the cost data and used to allocate workload costs to cost centers during data processing.
Refs: URS-DP-10301

**[SRS-DP-420104] Query Storage Volume**
The system queries Cost Explorer for `TimedStorage-*` usage types (and optionally EFS/EBS usage types depending on configuration) with metric `UsageQuantity` to calculate total storage volume and hot tier distribution.
Refs: URS-DP-10306, URS-DP-10307

**[SRS-DP-420105] Categorize Usage Types**
The system categorizes AWS usage types into Storage, Compute, Other, and Support based on usage type string pattern matching, consistent with the categorization logic established in the vz_aws origin tool.
Refs: URS-DP-10305, URS-DP-10401

#### 4.2.2 Models

**Cost Explorer Query Parameters:**

| Field | Type | Description |
|-------|------|-------------|
| TimePeriod.Start | String (YYYY-MM-DD) | First day of the queried month |
| TimePeriod.End | String (YYYY-MM-DD) | First day of the following month |
| Granularity | String | Always `MONTHLY` |
| Metrics | List[String] | `UnblendedCost`, `UsageQuantity` |
| GroupBy | List[Object] | `TAG` (App) and `DIMENSION` (USAGE_TYPE) |

**Cost Data Record:**

| Field | Type | Description |
|-------|------|-------------|
| period | String (YYYY-MM) | Reporting month |
| cost_center | String | Cost Category value |
| workload | String | App tag value (or "Untagged") |
| cost_usd | Float | UnblendedCost in USD |
| category | String | Storage / Compute / Other / Support |
| usage_type | String | AWS usage type identifier |
| usage_quantity | Float | Usage amount in native unit |

### 4.3 SI-3: Amazon S3 (Data Store)

#### 4.3.1 Endpoints

**[SRS-DP-430101] Serve Static Web App**
The system serves the React SPA's static assets (HTML, CSS, JS) from a dedicated app S3 bucket behind CloudFront.
Refs: URS-DP-10308

#### 4.3.2 Models

N/A — static assets only.

### 4.4 SI-4: Amazon S3 — Data Bucket

#### 4.4.1 Endpoints

**[SRS-DP-440101] Store Collected Cost Data**
The Lambda function writes collected and processed cost data to a dedicated data S3 bucket under a `{year}-{month}/` prefix, consisting of a summary JSON file and parquet files for detailed data.
Refs: URS-DP-10301

**[SRS-DP-440102] Read Cost Data from SPA**
The SPA reads summary JSON for the 1-page report and queries parquet files via DuckDB-wasm for drill-down, all served from the data S3 bucket via CloudFront. No direct AWS API calls are made from the browser.
Refs: URS-DP-10301

#### 4.4.2 Models

**Data file layout per reporting period:**

| File | Format | Purpose |
|------|--------|---------|
| `{year}-{month}/summary.json` | JSON | Pre-computed aggregates for instant 1-page report rendering |
| `{year}-{month}/cost-by-workload.parquet` | Parquet | Per-workload cost data for all comparison periods |
| `{year}-{month}/cost-by-usage-type.parquet` | Parquet | Per-usage-type cost data for drill-down |

### 4.5 SI-5: Amazon CloudFront (CDN)

#### 4.5.1 Endpoints

**[SRS-DP-450101] Serve Application and Data**
CloudFront serves both the static web application assets (from the app bucket) and the cost data files (from the data bucket) via separate origins. All access is over HTTPS.
Refs: URS-DP-10308, URS-DP-20301

---

## 5. Cross-functional Requirements

### 5.1 Performance Requirements

**[SRS-DP-510001] Report Load Time**
The cost report screen loads and renders within 2 seconds after authentication, assuming standard broadband connectivity.

**[SRS-DP-510002] Data Freshness**
Cost data is refreshed at least once per day. The report displays the timestamp of the last data collection.
Refs: URS-DP-20401

### 5.2 Safety & Security Requirements

**[SRS-DP-520001] HTTPS Only**
All communication between the user's browser and the system is encrypted via HTTPS (TLS 1.2 or higher).
Refs: URS-DP-20301

**[SRS-DP-520002] No Direct AWS API Access from Browser**
The SPA does not make direct calls to the AWS Cost Explorer API. All cost data is pre-computed by the Lambda function and served as static files.
Refs: URS-DP-20301

**[SRS-DP-520003] Authentication-Gated Access**
All authenticated users can access all cost data. Unauthenticated access to cost data is prevented. The SPA enforces authentication before fetching data files.
Refs: URS-DP-20301

### 5.3 Service Requirements

**[SRS-DP-530001] Update via Terraform**
The system is updated to new versions by running `terraform apply` with the updated module version. No manual steps beyond Terraform are required for updates.
Refs: URS-DP-10101

**[SRS-DP-530002] Zero-Downtime Updates**
Updating the system to a new version does not require downtime. The web application and data pipeline can be updated independently.
Refs: URS-DP-10101

### 5.4 Applicable Standards and Regulations

None — non-regulated software.

---

## 6. Run-time Environment

**[SRS-DP-600001] AWS Cloud Environment**
The system runs entirely on AWS. Required AWS services:
- Amazon S3 (static hosting + data storage)
- Amazon CloudFront (CDN)
- Amazon Cognito (authentication — existing User Pool)
- AWS Lambda (data collection)
- AWS Cost Explorer API (data source)

Refs: URS-DP-10101

**[SRS-DP-600002] Browser Compatibility**
The web application runs in modern web browsers (latest versions of Chrome, Firefox, Safari, Edge).
Refs: URS-DP-10308

No mobile optimization is provided initially. Desktop browsers only.

**[SRS-DP-600003] Terraform Version**
The Terraform module targets OpenTofu and is compatible with Terraform >= 1.5. It requires the AWS provider >= 5.0.
Refs: URS-DP-10101

---

## 7. Change History

| Version | Date       | Author | Description       |
|---------|------------|--------|-------------------|
| 0.1     | 2026-02-08 | —      | Initial draft     |
