# Software Requirements Specification (SRS) — Dapanoskop

| Field               | Value                                      |
|---------------------|--------------------------------------------|
| Document ID         | SRS-DP                                     |
| Product             | Dapanoskop (DP)                            |
| System Type         | Non-regulated Software                     |
| Version             | 0.3 (Draft)                                |
| Date                | 2026-02-13                                 |

---

## 1. Introduction

### 1.1 Purpose

This document specifies the software requirements for Dapanoskop. It describes how the system behaves at its interfaces to fulfill the user requirements defined in URS-DP.

### 1.2 Scope

Dapanoskop is a web-based AWS cloud cost monitoring application. This document describes the system as a black box, specifying observable behavior at user and system interfaces.

### 1.3 Referenced Documents

| Document | Description                                    |
|----------|------------------------------------------------|
| URS-DP   | User Requirements Specification for Dapanoskop |

### 1.4 Definitions and Abbreviations

| Term | Definition |
|------|------------|
| SPA | Single Page Application |
| Cost Explorer | AWS Cost Explorer API for querying cost and usage data |
| Cost Category | A single AWS Cost Category whose values represent cost centers |
| App tag | AWS resource tag with key `App` (or `user:App`) |
| UnblendedCost | AWS cost metric showing the actual cost of each usage type |
| TimedStorage-ByteHrs | AWS usage type metric measuring S3 storage volume over time |
| Identity Pool | Amazon Cognito Identity Pool — exchanges Cognito ID tokens for temporary AWS credentials via the enhanced (simplified) authflow |
| httpfs | DuckDB extension enabling SQL queries against remote files via HTTP(S) or S3 protocols |

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
└──┬──────────┬──────────┬──────────┬──────────┘
   │          │          │          │
   │ SI-1     │ SI-2     │ SI-3     │ SI-5
   │          │          │          │
   ▼          ▼          ▼          ▼
┌───────┐ ┌────────┐ ┌───────┐ ┌──────────┐
│Cognito│ │Cost    │ │S3 Data│ │Cognito   │
│User   │ │Explorer│ │Bucket │ │Identity  │
│Pool   │ │        │ │       │ │Pool      │
│(exist │ └────────┘ └───────┘ │          │
│ or    │                      │ temp AWS │
│managed│                      │ creds    │
│ pool) │                      └──────────┘
└───┬───┘
    │ SI-4 (optional)
    ▼
┌────────┐
│External│
│IdP     │
│(SAML/  │
│ OIDC)  │
└────────┘
```

Note: The browser accesses the S3 Data Bucket directly (not via CloudFront) using temporary AWS credentials obtained from the Cognito Identity Pool (SI-5). CloudFront serves only the SPA static assets from the App Bucket.

**User Interfaces:**
| ID   | Name     | Users                   | Description |
|------|----------|-------------------------|-------------|
| UI-1 | Web App  | Budget Owner, DevOps    | Static SPA for viewing cost reports |

**System Interfaces:**
| ID   | Name           | Entity          | Description |
|------|----------------|-----------------|-------------|
| SI-1 | Auth           | Amazon Cognito User Pool (existing or managed) | User authentication via OIDC |
| SI-2 | Cost Data      | AWS Cost Explorer API | Source of cost and usage data |
| SI-3 | Data Store     | Amazon S3 (Data bucket) | Storage for collected cost data; accessed directly by browser with temporary credentials |
| SI-4 | Federation     | External IdP (SAML/OIDC) | Optional SSO identity provider (e.g., Azure Entra ID) federated through Cognito |
| SI-5 | Credentials    | Amazon Cognito Identity Pool | Exchanges Cognito ID tokens for temporary AWS credentials (enhanced authflow) |

---

## 3. User Interfaces

### 3.1 UI-1: Web Application

The web application is a SPA. Users authenticate via a Cognito User Pool (existing or module-managed) before accessing any content. All authenticated users can view all cost centers.

#### 3.1.1 Login Screen

**[SRS-DP-310101] Cognito Authentication Redirect**
The system redirects unauthenticated users to the Cognito hosted UI for login. The hosted UI is provided by the Cognito User Pool (existing or module-managed). When federation is configured, the Cognito hosted UI redirects the user to the external identity provider. Upon successful authentication, the user is redirected back to the application with a valid session.
Refs: URS-DP-10103, URS-DP-10104, URS-DP-20301

**[SRS-DP-310102] Session Persistence**
The system maintains the user's authenticated session using Cognito tokens stored in the browser. The session remains valid until the token expires.
Refs: URS-DP-20301

Session duration: 1 hour for ID and access tokens, 12 hours for refresh tokens.

**[SRS-DP-310103] Runtime Configuration**
The system loads deployment-specific configuration at runtime from a configuration file served alongside the SPA, rather than at build time. The configuration includes: Cognito domain, client ID, User Pool ID, Identity Pool ID, AWS region, and data bucket name. This allows the same SPA build artifact to be deployed to different environments.
Refs: URS-DP-10101, URS-DP-10103

#### 3.1.2 Cost Report Screen (1-Page Report)

This is the primary screen of the application. It presents a single-page cost report using progressive disclosure: a global summary at the top provides an instant overview, followed by cost center cards with expandable workload detail, and storage metrics at the bottom.

##### Global Summary

**[SRS-DP-310211] Display Global Cost Summary**
The system displays a summary bar at the top of the report showing three metrics: total spend across all cost centers for the current period, the MoM change (absolute and percentage combined), and the YoY change (absolute and percentage combined).
Refs: URS-DP-10301, URS-DP-10302

| No | Element | Data type | Value range | Other relevant information |
|----|---------|-----------|-------------|---------------------------|
| 1  | Total spend | Currency (USD) | ≥ 0 | Sum of all cost centers, formatted with 2 decimal places |
| 2  | MoM change | Currency + Percentage | Any | Combined display: "+$1,300 (+5.9%)" |
| 3  | YoY change | Currency + Percentage | Any | Shows "N/A" if prior year data unavailable |

##### Cost Center Cards

**[SRS-DP-310201] Display Cost Center Summary Cards**
The system displays each cost center as a card showing the cost center name, current period total, workload count, and the top mover (the workload with the highest absolute MoM change).
Refs: URS-DP-10301

**[SRS-DP-310202] Display MoM Cost Comparison**
Each cost center card displays the MoM change as a single combined element showing absolute difference and percentage change (e.g., "+$800 (+5.6%)").
Refs: URS-DP-10302

**[SRS-DP-310203] Display YoY Cost Comparison**
Each cost center card displays the YoY change as a single combined element showing absolute difference and percentage change.
Refs: URS-DP-10302

| No | Element | Data type | Value range | Other relevant information |
|----|---------|-----------|-------------|---------------------------|
| 1  | Cost center name | String | — | Value from the configured Cost Category |
| 2  | Current month cost | Currency (USD) | ≥ 0 | Formatted with 2 decimal places |
| 3  | MoM change | Currency + Percentage | Any | Combined: "+$800 (+5.6%)" with direction indicator |
| 4  | YoY change | Currency + Percentage | Any | Shows "N/A" if data not available |
| 5  | Workload count | Integer | ≥ 0 | Number of distinct workloads in the cost center |
| 6  | Top mover | String + Percentage | — | Workload name + its MoM percentage change |

**[SRS-DP-310212] Expandable Cost Center Detail**
Each cost center card is expandable to reveal the full workload breakdown table. The card shows a summary by default; users expand it to see per-workload data.
Refs: URS-DP-10303

##### Workload Breakdown Table

**[SRS-DP-310204] Display Workload Cost Table**
Within an expanded cost center card, the system displays a table of all workloads (App tag values) sorted by current month cost descending. Each row shows the workload name, current month cost, MoM change (absolute and percentage combined), and YoY change (absolute and percentage combined). Workload names are clickable to navigate to the drill-down.
Refs: URS-DP-10303, URS-DP-10304

**[SRS-DP-310205] Display Untagged Cost Row**
The system includes a row labeled "Untagged" (or equivalent) showing the cost of resources without an App tag within the cost center, so that tagging gaps are visible.
Refs: URS-DP-10202

| No | Element | Data type | Value range | Other relevant information |
|----|---------|-----------|-------------|---------------------------|
| 1  | Workload name | String | — | App tag value; "Untagged" for resources without App tag. Clickable link to drill-down. |
| 2  | Current month cost | Currency (USD) | ≥ 0 | |
| 3  | MoM change | Currency + Percentage | Any | Combined: "+$200 (+4.2%)" |
| 4  | YoY change | Currency + Percentage | Any | "N/A" if unavailable |

##### Storage Overview

The storage overview is displayed as three distinct metric cards at the bottom of the report.

**[SRS-DP-310206] Display Total Storage Cost**
The system displays the total storage cost as an aggregate across all cost centers, with MoM change (absolute and percentage combined). S3 storage is always included. EFS and EBS storage inclusion is configurable at deployment time.
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
| 2  | Storage cost MoM change | Currency + Percentage | Any | Combined: "+$150 (+3.7%)" |
| 3  | Cost per TB stored | Currency (USD/TB) | ≥ 0 | |
| 4  | Hot tier percentage | Percentage | 0–100% | Based on storage volume (bytes), not cost |

##### Report Presentation

**[SRS-DP-310209] Business-Friendly Terminology**
The system uses business-friendly labels throughout the report (e.g., "Workload" instead of "App tag", "Storage" instead of listing AWS service names). No AWS-specific terminology is exposed in the default report view.
Refs: URS-DP-10308

**[SRS-DP-310210] Visual Indicators for Cost Direction**
The system visually indicates whether cost changes are increases or decreases using color coding (green for decreases, red for increases), direction arrows, and sign prefixes (+/-).
Refs: URS-DP-10302

**[SRS-DP-310213] Anomaly Highlighting**
The system visually emphasizes workload rows with significant cost changes (e.g., MoM increase exceeding a threshold) so that anomalies are immediately noticeable without requiring the user to scan every row.
Refs: URS-DP-10304

Wireframes: See `docs/wireframes/cost-report.puml` and `docs/wireframes/workload-detail.puml`.

#### 3.1.3 Workload Detail Screen

**[SRS-DP-310301] Display Workload Usage Type Breakdown**
When a user selects a workload from the cost report, the system displays a breakdown of that workload's cost by usage type, sorted by cost descending. Each usage type row shows current month cost, MoM change (absolute and percentage combined), and YoY change (absolute and percentage combined).
Refs: URS-DP-10401

| No | Element | Data type | Value range | Other relevant information |
|----|---------|-----------|-------------|---------------------------|
| 1  | Usage type | String | — | Displayed with business-friendly label where possible |
| 2  | Category | String | Storage / Compute / Other / Support | Categorization of the usage type |
| 3  | Current month cost | Currency (USD) | ≥ 0 | |
| 4  | MoM change | Currency + Percentage | Any | Combined: "+$50 (+2.9%)" |
| 5  | YoY change | Currency + Percentage | Any | "N/A" if unavailable |

#### 3.1.4 Tagging Coverage Section

**[SRS-DP-310401] Display Tagging Coverage Summary**
The system displays the percentage of total cost attributed to tagged workloads versus untagged resources as a visual progress bar on the 1-page cost report. The bar shows tagged versus untagged proportion, with the percentage value and absolute cost amounts.
Refs: URS-DP-10201, URS-DP-10202

| No | Element | Data type | Value range | Other relevant information |
|----|---------|-----------|-------------|---------------------------|
| 1  | Tagged percentage | Percentage | 0–100% | Visualized as a progress bar |
| 2  | Tagged cost | Currency (USD) | ≥ 0 | |
| 3  | Untagged cost | Currency (USD) | ≥ 0 | |

#### 3.1.5 Report Period Selection

**[SRS-DP-310501] Select Reporting Month**
The system displays a horizontal month strip showing all available reporting periods. The user selects a month by clicking it. The current (incomplete) month is labeled "MTD" (Month-to-date). The default selection is the most recently completed month.
Refs: URS-DP-10301

| No | Element | Data type | Value range | Other relevant information |
|----|---------|-----------|-------------|---------------------------|
| 1  | Month strip | List of dates (month precision) | From earliest available data to current | Default: most recent complete month. Current month labeled "MTD". |

---

## 4. System Interfaces

### 4.1 SI-1: Amazon Cognito (Auth)

#### 4.1.1 Endpoints

**[SRS-DP-410101] OAuth 2.0 / OIDC Authentication Flow**
The system integrates with a Cognito User Pool (existing or module-managed) using the OAuth 2.0 / OIDC authorization code flow with PKCE. The SPA redirects to the Cognito hosted UI and receives tokens upon successful authentication.
Refs: URS-DP-10103, URS-DP-20301

**[SRS-DP-410102] Token Validation**
The system validates Cognito JWT tokens (ID token and access token) before granting access to cost data. Expired or invalid tokens result in a redirect to the login flow.
Refs: URS-DP-20301

**[SRS-DP-410103] Managed User Pool Provisioning**
When no existing Cognito User Pool ID is provided, the system creates and manages a Cognito User Pool with security-hardened defaults: 14-character minimum password, admin-only user creation, token revocation enabled, deletion protection active, and configurable MFA (OFF / OPTIONAL / ON, default OPTIONAL).
Refs: URS-DP-10103

**[SRS-DP-410104] SAML Federation**
When a SAML metadata URL is provided, the system configures the managed Cognito User Pool to federate with an external SAML identity provider (e.g., Azure Entra ID). The metadata URL must use HTTPS. When federation is active, the Cognito hosted UI redirects users to the external IdP and local password login is disabled.
Refs: URS-DP-10104

**[SRS-DP-410105] OIDC Federation**
When an OIDC issuer URL is provided, the system configures the managed Cognito User Pool to federate with an external OIDC identity provider. The issuer URL must use HTTPS. The OIDC client ID and client secret are required. When federation is active, the Cognito hosted UI redirects users to the external IdP and local password login is disabled.
Refs: URS-DP-10104

**[SRS-DP-410106] Federation IdP Configuration Outputs**
When SAML federation is configured, the system outputs the SAML Entity ID and ACS (Assertion Consumer Service) URL required to configure the identity provider.
Refs: URS-DP-10104

### 4.5 SI-5: Amazon Cognito Identity Pool (Credentials)

#### 4.5.1 Endpoints

**[SRS-DP-450101] Temporary AWS Credentials via Enhanced Authflow**
The system exchanges the authenticated user's Cognito ID token for temporary AWS credentials using the Cognito Identity Pool enhanced (simplified) authflow (`GetId` + `GetCredentialsForIdentity`). The temporary credentials grant read-only access to the data S3 bucket (SI-3).
Refs: URS-DP-20301

**[SRS-DP-450102] Credential Caching and Auto-Refresh**
The system caches temporary AWS credentials in memory and automatically refreshes them before expiry. Concurrent credential requests are deduplicated to prevent redundant Identity Pool API calls.
Refs: URS-DP-20301

**[SRS-DP-450103] Credential Lifecycle**
Temporary credentials are cleared from memory when the user logs out. Credential expiry (typically 1 hour) triggers a transparent re-fetch without user interaction.
Refs: URS-DP-20301

#### 4.5.2 Models

| Field | Type | Description |
|-------|------|-------------|
| AccessKeyId | String | Temporary AWS access key |
| SecretKey | String | Temporary AWS secret key |
| SessionToken | String | Temporary session token |
| Expiration | DateTime | Credential expiry timestamp |

#### 4.1.2 Models

| Field | Type | Description |
|-------|------|-------------|
| sub | String (UUID) | Cognito user identifier |
| email | String | User email |

### 4.4 SI-4: External Identity Provider (Federation)

#### 4.4.1 Endpoints

**[SRS-DP-440101] SAML 2.0 Protocol**
When SAML federation is configured, the external IdP communicates with Cognito via the SAML 2.0 protocol. The IdP sends signed SAML assertions to the Cognito ACS endpoint. The IdP's federation metadata is fetched from the configured HTTPS URL.
Refs: URS-DP-10104

**[SRS-DP-440102] OIDC Protocol**
When OIDC federation is configured, the external IdP communicates with Cognito via the OIDC protocol using the authorization code flow. The IdP's configuration is discovered from the OIDC issuer URL.
Refs: URS-DP-10104

#### 4.4.2 Models

**SAML Attribute Mapping (default):**

| SAML Claim | Cognito Attribute |
|------------|-------------------|
| `http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress` | email |

**OIDC Attribute Mapping (default):**

| OIDC Claim | Cognito Attribute |
|------------|-------------------|
| email | email |
| sub | username |

### 4.2 SI-2: AWS Cost Explorer API

#### 4.2.1 Endpoints

**[SRS-DP-420101] Query Cost by App Tag and Usage Type**
The system queries the Cost Explorer `GetCostAndUsage` API grouped by App tag (workload) and `USAGE_TYPE` to retrieve per-workload, per-usage-type cost data. Metric: `UnblendedCost` and `UsageQuantity`. Granularity: `MONTHLY`.
Refs: URS-DP-10301, URS-DP-10303, URS-DP-10401

**[SRS-DP-420102] Query Historical Cost Data**
The system queries Cost Explorer for the current month, the previous month, and the same month of the previous year to support MoM and YoY comparisons.
Refs: URS-DP-10302

**[SRS-DP-420103] Query Cost Category Mapping**
The system queries the configured AWS Cost Category (or the first one returned by the API if not explicitly configured) to obtain the mapping of workloads to cost centers. The Cost Category's values are the cost centers. This mapping is queried separately from the cost data and applied during data processing.
Refs: URS-DP-10102, URS-DP-10301

**[SRS-DP-420104] Query Storage Volume**
The system queries Cost Explorer for `TimedStorage-*` usage types (and optionally EFS/EBS usage types depending on configuration) with metric `UsageQuantity` to calculate total storage volume and hot tier distribution.
Refs: URS-DP-10306, URS-DP-10307

**[SRS-DP-420105] Categorize Usage Types**
The system categorizes AWS usage types into Storage, Compute, Other, and Support based on usage type string pattern matching.
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
| cost_center | String | A value from the configured Cost Category |
| workload | String | App tag value (or "Untagged") |
| cost_usd | Float | UnblendedCost in USD |
| category | String | Storage / Compute / Other / Support |
| usage_type | String | AWS usage type identifier |
| usage_quantity | Float | Usage amount in native unit |

### 4.3 SI-3: Amazon S3 (Data Bucket)

#### 4.3.1 Endpoints

**[SRS-DP-430101] Store Collected Cost Data**
The Lambda function writes collected and processed cost data to a dedicated data S3 bucket under a `{year}-{month}/` prefix, consisting of a summary JSON file and parquet files for detailed data.
Refs: URS-DP-10301

**[SRS-DP-430102] Read Cost Data from SPA**
The SPA reads cost data directly from the data S3 bucket using temporary AWS credentials obtained via the Identity Pool (SI-5). Summary JSON files are fetched via the AWS S3 SDK. Parquet files are queried via DuckDB-wasm using the S3 protocol (httpfs) with the same temporary credentials set via DuckDB configuration parameters.
Refs: URS-DP-10301, URS-DP-20301

**[SRS-DP-430103] Period Discovery via Index File**
The data bucket contains a root-level `index.json` file listing all available reporting periods, sorted in reverse chronological order. The SPA reads this file to populate the period selector without requiring S3 listing permissions. The index file is updated by the Lambda pipeline each time new data is written.
Refs: URS-DP-10301

**[SRS-DP-430104] S3 CORS for Browser Access**
The data S3 bucket is configured with CORS rules allowing browser-originated requests (GET, HEAD) from the CloudFront distribution domain. This is required because the SPA accesses S3 directly (not via CloudFront proxy) using the AWS S3 SDK and DuckDB httpfs.
Refs: URS-DP-10301, URS-DP-20301

#### 4.3.2 Models

**Data file layout:**

| File | Format | Purpose |
|------|--------|---------|
| `index.json` | JSON | Lists all available reporting periods (reverse chronological) |
| `{year}-{month}/summary.json` | JSON | Pre-computed aggregates for instant 1-page report rendering |
| `{year}-{month}/cost-by-workload.parquet` | Parquet | Per-workload cost data for all comparison periods |
| `{year}-{month}/cost-by-usage-type.parquet` | Parquet | Per-usage-type cost data for drill-down |

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

**[SRS-DP-520002] No Cost Explorer API Access from Browser**
The SPA does not make direct calls to the AWS Cost Explorer API. All cost data is pre-computed by the Lambda function. The SPA accesses pre-computed data files from S3 using temporary, scoped AWS credentials obtained via the Identity Pool (SI-5). These credentials grant only `s3:GetObject` on the data bucket — no other AWS API access.
Refs: URS-DP-20301

**[SRS-DP-520003] IAM-Enforced Data Access**
Access to cost data is enforced at the AWS IAM level. The Identity Pool issues temporary credentials scoped to `s3:GetObject` on the data bucket only. Unauthenticated users cannot obtain credentials and therefore cannot access data. This is server-side enforcement independent of client-side token checks.
Refs: URS-DP-20301

**[SRS-DP-520004] Managed Pool Security Hardening**
When using the module-managed Cognito User Pool, the system enforces: admin-only user creation (no self-signup), strong password policy (14-character minimum, upper + lower + number + symbol), configurable MFA, token revocation, prevention of user existence error leakage, optional advanced security (compromised credentials detection, adaptive authentication), and deletion protection.
Refs: URS-DP-20301, URS-DP-10103

**[SRS-DP-520005] Federation URL Validation**
The system validates that SAML metadata URLs and OIDC issuer URLs use HTTPS, rejecting insecure HTTP URLs at deployment time.
Refs: URS-DP-10104, URS-DP-20301

### 5.3 Service Requirements

**[SRS-DP-530001] Update via Terraform**
The system is updated to new versions by running `terraform apply` with the updated release version. Pre-built Lambda and SPA artifacts are downloaded from GitHub Releases. No local build tools (Node.js, Python) are required.
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
- Amazon CloudFront (CDN for SPA static assets)
- Amazon Cognito User Pool (authentication — existing or module-managed)
- Amazon Cognito Identity Pool (temporary AWS credentials for browser-to-S3 access)
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
| 0.2     | 2026-02-12 | —      | Add managed Cognito pool, SAML/OIDC federation, runtime config, release artifacts |
| 0.3     | 2026-02-13 | —      | Add Cognito Identity Pool (SI-5) for temporary AWS credentials; SPA accesses S3 directly (not via CloudFront); add index.json period discovery; IAM-enforced data access; S3 CORS; expanded runtime config |
