# Software Requirements Specification (SRS) — Dapanoskop

| Field               | Value                                      |
|---------------------|--------------------------------------------|
| Document ID         | SRS-DP                                     |
| Product             | Dapanoskop (DP)                            |
| System Type         | Non-regulated Software                     |
| Version             | 0.20 (Draft)                               |
| Date                | 2026-02-28                                 |

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
| UnblendedCost | AWS cost metric showing the on-demand cost of each usage type, without RI/SP amortization or enterprise discount adjustments; used for per-workload and per-usage-type data stored in parquet files |
| NetAmortizedCost | AWS cost metric that distributes RI and Savings Plan fees across the period and includes enterprise discount adjustments; matches the "Total allocated cost" column in the AWS Cost Categories console; used for cost center totals in summary.json when allocated costs are available |
| TimedStorage-ByteHrs | AWS usage type metric measuring S3 storage volume over time |
| Identity Pool | Amazon Cognito Identity Pool — exchanges Cognito ID tokens for temporary AWS credentials via the enhanced (simplified) authflow |
| httpfs | DuckDB extension enabling SQL queries against remote files via HTTP(S) or S3 protocols |
| MTD | Month-to-date — cost data for the current in-progress calendar month, collected daily and updated until the month closes |

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

**[SRS-DP-310102] Application Logo Display**
The system displays a logo (Greek letter δ) in the application header on all screens, visually reinforcing the product identity.
Refs: URS-DP-30103

**[SRS-DP-310103] Browser Favicon**
The system displays a favicon (Greek letter δ) in the browser tab, improving tab identification when multiple applications are open.
Refs: URS-DP-30103

**[SRS-DP-310104] Clickable Header Navigation**
The application header (logo + title) is clickable and navigates to the cost report home, preserving the current period selection if one was active.
Refs: URS-DP-30103

**[SRS-DP-310105] Session Persistence**
The system maintains the user's authenticated session using Cognito tokens stored in the browser. The session remains valid until the token expires.
Refs: URS-DP-20301

Session duration: 1 hour for ID and access tokens, 12 hours for refresh tokens.

**[SRS-DP-310106] Runtime Configuration**
The system loads deployment-specific configuration at runtime from a configuration file served alongside the SPA, rather than at build time. The configuration includes: Cognito domain, client ID, User Pool ID, Identity Pool ID, AWS region, and data bucket name. This allows the same SPA build artifact to be deployed to different environments.
Refs: URS-DP-10101, URS-DP-10103

#### 3.1.2 Cost Report Screen (1-Page Report)

This is the primary screen of the application. It presents a single-page cost report using progressive disclosure: a global summary at the top provides an instant overview, followed by cost center cards with expandable workload detail, and storage metrics at the bottom.

##### Global Summary

**[SRS-DP-310211] Display Global Cost Summary**
The system displays a summary bar at the top of the report showing three metrics: total spend for the current period, the MoM change (absolute and percentage combined), and the YoY change (absolute and percentage combined). On viewports narrower than 640px (Tailwind `sm` breakpoint), the three metrics stack vertically in a single column. The total spend and comparison deltas are sourced from the pre-computed `totals` object in summary.json (see SDS-DP-040002), which is computed from raw workload costs independent of cost category allocation, split charge rules, and cost category renames. This ensures the global totals remain stable across cost category configuration changes and correctly account for 100% of spend regardless of how cost centers are defined.
Refs: URS-DP-10301, URS-DP-10302, URS-DP-30104

| No | Element | Data type | Value range | Other relevant information |
|----|---------|-----------|-------------|---------------------------|
| 1  | Total spend | Currency (USD) | ≥ 0 | Pre-computed from raw workload costs (`totals.current_cost_usd`), formatted with 2 decimal places |
| 2  | MoM change | Currency + Percentage | Any | Derived from `totals.current_cost_usd` and `totals.prev_month_cost_usd`; combined display: "+$1,300 (+5.9%)" |
| 3  | YoY change | Currency + Percentage | Any | Derived from `totals.current_cost_usd` and `totals.yoy_cost_usd`; shows "N/A" if prior year data unavailable |

##### Cost Trend Chart

**[SRS-DP-310214] Display Multi-Period Cost Trend Chart**
The system displays a stacked bar chart showing cost totals for available reporting periods, broken down by cost center. The default view shows the most recent 13 months, enabling visual year-over-year comparison of the last completed month against the same month one year prior. When more than 13 periods are available, the system displays a time range toggle with options "13 Months" (most recent 13 months, default) and "All Time" (all available periods); the toggle is hidden when 13 or fewer periods exist. The chart loads independently of the selected reporting period. Periods are displayed chronologically (oldest on the left). Cost centers are stacked within each bar, with the largest cost center at the bottom. A tooltip displays the per-cost-center cost and computed total for the hovered period. The MTD bar (current in-progress month) is visually distinguished from completed-month bars using reduced opacity. The chart loads asynchronously after the initial report render and displays a loading skeleton while data is being fetched. The legend is collapsible and hidden by default; users can expand it to see cost center color assignments.
Refs: URS-DP-10309, URS-DP-10302, URS-DP-30104

| No | Element | Data type | Value range | Other relevant information |
|----|---------|-----------|-------------|---------------------------|
| 1  | Stacked bar chart | Chart | — | One bar per available period, stacked by cost center |
| 2  | X-axis | Month labels | All available periods | Formatted as abbreviated month + 2-digit year (e.g., "Dec '25") |
| 3  | Y-axis | Currency (USD) | ≥ 0 | Compact format (e.g., "$15K") |
| 4  | Tooltip | Currency (USD) per cost center + total | ≥ 0 | Shows on hover; includes all cost centers and a total |
| 5  | MTD bar | Visual distinction | — | Rendered at reduced opacity to signal in-progress partial month |
| 6  | Legend | Cost center names | — | Collapsible; hidden by default; one entry per cost center with color indicator |

**[SRS-DP-310215] Display Cost Trend Line**
The system overlays a dashed line on the cost trend chart showing the 3-month simple moving average of aggregate total cost (sum of all cost centers), enabling users to distinguish short-term volatility from sustained cost trajectory changes. The first two data points have no trend line value (insufficient window). The trend line is not configurable.
Refs: URS-DP-10310

| No | Element | Data type | Value range | Other relevant information |
|----|---------|-----------|-------------|---------------------------|
| 1  | Trend line | Line chart overlay | ≥ 0 | 3-month moving average; dashed pink line (pink-700, #be185d); labeled "3-Month Avg" |

##### Cost Center Cards

**[SRS-DP-310201] Display Cost Center Summary Cards**
The system displays each cost center as a card showing the cost center name, current period total, workload count, and the top mover (the workload with the highest absolute MoM change). The cost center name is a clickable link that navigates to the cost center detail page, preserving the current reporting period as a query parameter. Cost centers using AWS Cost Category split charge rules display a "Split Charge" badge and show "Allocated" instead of a dollar amount, with explanatory text that costs are allocated to other cost centers.
Refs: URS-DP-10301, URS-DP-10311, URS-DP-10403

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
The system displays the total storage cost as an aggregate across all cost centers, with MoM change (absolute and percentage combined). S3 storage is always included. EFS and EBS storage inclusion is configurable at deployment time. A tooltip dynamically explains which storage services are included based on the deployment configuration (e.g., "S3 only" or "S3, EFS, and EBS").
Refs: URS-DP-10305, URS-DP-10302, URS-DP-30102

**[SRS-DP-310207] Display Cost per TB Stored**
The system displays the cost per terabyte stored, calculated from total storage cost divided by total storage volume (in decimal terabytes, 10^12 bytes). A tooltip explains the calculation formula: "Total storage cost divided by the total volume of data stored, measured in terabytes (TB). Lower values indicate better storage cost efficiency."
Refs: URS-DP-10306, URS-DP-30102

**[SRS-DP-310208] Display Hot Tier Percentage**
The system displays the percentage of total data volume (in bytes) stored in hot storage tiers (S3 Standard, S3 Intelligent-Tiering Frequent Access, and optionally EFS/EBS depending on configuration). A tooltip explains which tiers are considered "hot" and suggests optimization: "Percentage of stored data in frequently accessed tiers (e.g., S3 Standard, EFS Standard). High values may indicate optimization opportunities via lifecycle policies."
Refs: URS-DP-10307, URS-DP-30102

**[SRS-DP-310217] Display Actual Total Storage Volume**
When S3 Storage Lens integration is configured, the system displays an additional storage metric card showing the actual total storage volume (in bytes, formatted as TB) read from S3 Storage Lens CloudWatch metrics. The card includes a timestamp indicating when the metric was collected. If Storage Lens data is unavailable or not configured, this metric is not displayed.
Refs: URS-DP-10312

**[SRS-DP-310218] Navigate to Storage Deep Dive** (Removed)
This requirement has been removed. The storage deep dive page (`/storage`) providing per-bucket breakdown is not implemented in the current S3 Storage Lens CloudWatch-only integration (Option A). Per-bucket detail would require a different integration option.
Refs: URS-DP-10313

| No | Element | Data type | Value range | Other relevant information |
|----|---------|-----------|-------------|---------------------------|
| 1  | Total storage cost | Currency (USD) | ≥ 0 | Aggregated across configured storage services; tooltip present |
| 2  | Storage cost MoM change | Currency + Percentage | Any | Combined: "+$150 (+3.7%)"; tooltip present |
| 3  | Cost per TB stored | Currency (USD/TB) | ≥ 0 | Tooltip explains calculation |
| 4  | Hot tier percentage | Percentage | 0–100% | Based on storage volume (bytes), not cost; tooltip explains tier definitions |

##### Report Presentation

**[SRS-DP-310209] Business-Friendly Terminology**
The system uses business-friendly labels throughout the report (e.g., "Workload" instead of "App tag", "Storage" instead of listing AWS service names). No AWS-specific terminology is exposed in the default report view. Contextual tooltips provide concise, specific explanations for calculated metrics and comparisons, including formulas, interpretation guidance, and optimization suggestions where applicable.
Refs: URS-DP-10308, URS-DP-30102

**[SRS-DP-310216] Application Version Display**
The system displays the application version in the footer after sign-in, following semantic versioning. The version string is injected at build time from package.json and displayed in the format "Dapanoskop vX.Y.Z".
Refs: URS-DP-30102

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

#### 3.1.4 Cost Center Detail Screen

**[SRS-DP-310302] Display Cost Center Detail View**
When a user navigates to a cost center detail page (via clickable cost center name from the main report), the system displays a dedicated view for that single cost center at route `/cost-center/:name` with the reporting period preserved as a query parameter. The page includes a back link to the main report, cost center summary metrics, a cost center-specific trend chart, and the workload breakdown table.
Refs: URS-DP-10311

**[SRS-DP-310303] Display Cost Center Summary Metrics**
The cost center detail page displays three summary cards showing the cost center's total spend for the selected period, MoM change (absolute and percentage combined), and YoY change (absolute and percentage combined).
Refs: URS-DP-10311

| No | Element | Data type | Value range | Other relevant information |
|----|---------|-----------|-------------|---------------------------|
| 1  | Total spend | Currency (USD) | ≥ 0 | Cost center total for selected period |
| 2  | MoM change | Currency + Percentage | Any | Combined: "+$800 (+5.6%)" |
| 3  | YoY change | Currency + Percentage | Any | Shows "N/A" if unavailable |

**[SRS-DP-310304] Display Cost Center Trend Chart**
The cost center detail page displays a cost trend chart filtered to show only the selected cost center's monthly totals across all available periods. The chart supports the same time range toggle as the main report (1 Year / All Time) when more than 12 periods are available.
Refs: URS-DP-10311, URS-DP-10309

**[SRS-DP-310305] Display Cost Center Workload Breakdown**
The cost center detail page displays the workload breakdown table for the cost center in an always-visible (non-expandable) format, showing the same data as the expandable card view on the main report: workload names (clickable links to workload detail), current period cost, MoM change, and YoY change.
Refs: URS-DP-10311, URS-DP-10303

**[SRS-DP-310306] Navigate Back to Main Report**
The cost center detail page includes a back link that returns the user to the main cost report, preserving the currently selected reporting period.
Refs: URS-DP-30103

#### 3.1.5 Storage Deep Dive Screen (Removed)

The storage deep dive screen has been removed. The current S3 Storage Lens integration (Option A: CloudWatch-only) provides organization-wide storage totals but does not support per-bucket breakdowns.

#### 3.1.6 Tagging Coverage Section

**[SRS-DP-310401] Display Tagging Coverage Summary**
The system displays the percentage of total cost attributed to tagged workloads versus untagged resources as a visual progress bar on the 1-page cost report. The bar shows tagged versus untagged proportion, with the percentage value and absolute cost amounts.
Refs: URS-DP-10201, URS-DP-10202

| No | Element | Data type | Value range | Other relevant information |
|----|---------|-----------|-------------|---------------------------|
| 1  | Tagged percentage | Percentage | 0–100% | Visualized as a progress bar |
| 2  | Tagged cost | Currency (USD) | ≥ 0 | |
| 3  | Untagged cost | Currency (USD) | ≥ 0 | |

#### 3.1.7 Report Period Selection

**[SRS-DP-310501] Select Reporting Month**
The system displays a horizontal month strip showing all available reporting periods derived from the `index.json` period manifest. The user selects a month by clicking it. The default selection is the most recently completed calendar month (not the MTD entry).

**MTD entry**: The data pipeline (SI-2) collects cost data for the current in-progress calendar month on every daily run. As a result, the period selector always contains an MTD (month-to-date) entry as the first (most recent) item, representing costs accrued in the current month up to the previous day. The system labels this entry "MTD" in the period strip to indicate that the data is incomplete and will be refreshed again on the next daily run. The MTD entry is visually distinguished from completed-month entries (see SRS-DP-310219). When the month ends and a new daily run executes, the former MTD entry transitions to a completed-month entry and a new MTD entry appears for the newly started month.

Note: The cost trend chart (SRS-DP-310214) operates independently of this selector and always displays all available periods, including the MTD period.
Refs: URS-DP-10301, URS-DP-10314

| No | Element | Data type | Value range | Other relevant information |
|----|---------|-----------|-------------|---------------------------|
| 1  | Month strip | List of dates (month precision) | From earliest available data to current in-progress month | Default: most recently completed month (not MTD). MTD entry always present as first item; labeled "MTD" with visual distinction. |

**[SRS-DP-310219] Visual Distinction for MTD Period**
The system visually distinguishes the MTD period entry in the period selector and throughout the report to communicate to the user that the data is in-progress and will change. The MTD entry in the period strip displays the abbreviated month name followed by an "MTD" badge (e.g., "Feb '26 MTD"), giving the user both the month context and an in-progress indicator. When the MTD period is selected, the report displays a visible indicator (e.g., a banner or badge) stating that the figures shown are month-to-date and will be updated daily until the month closes.
Refs: URS-DP-10314, URS-DP-10302

| No | Element | Data type | Value range | Other relevant information |
|----|---------|-----------|-------------|---------------------------|
| 1  | MTD label | String | "{Mon 'YY} MTD" | Month abbreviation with appended "MTD" badge (e.g., "Feb '26 MTD") in the period strip |
| 2  | MTD indicator | Banner / badge | — | Shown on report when MTD period is selected; text: "Month-to-date — figures update daily" |

**[SRS-DP-310220] Like-for-Like MTD Change Annotations**
When the MTD period is selected, the system displays MoM change annotations (absolute dollar difference and percentage change) computed against the equivalent partial period of the prior month rather than against the prior month's full-month total. The equivalent prior period spans from the first day of the prior month through the same day-of-month as the last day of the current MTD window (inclusive). For example, if today is March 8 and the MTD period covers March 1–7, the comparison period covers February 1–7. This like-for-like comparison removes the distortion caused by comparing an incomplete month against a full completed month. A tooltip or inline label explains the nature of the comparison (e.g., "Compared to [Month] 1–[Day], [Year]"). YoY change is not displayed for the MTD period because a reliable equivalent day-of-year prior period is not collected.
Refs: URS-DP-10315, URS-DP-10302

| No | Element | Data type | Value range | Other relevant information |
|----|---------|-----------|-------------|---------------------------|
| 1  | Like-for-like MoM annotation | Currency + Percentage | Any | Combined: "+$800 (+5.6%)" comparing MTD range against same date range of prior month |
| 2  | Comparison period label | String | — | Displayed as tooltip or inline note, e.g., "vs. Feb 1–7" |
| 3  | YoY annotation | — | — | Not displayed for MTD period; replaced with "N/A (MTD)" or equivalent |

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
When no existing Cognito User Pool ID is provided, the system creates and manages a Cognito User Pool with security-hardened defaults: 14-character minimum password, admin-only user creation, token revocation enabled, deletion protection active, and configurable MFA (OFF / OPTIONAL / ON, default OPTIONAL). The managed pool uses Cognito Managed Login version 2 (new Hosted UI) with default branding. All existing user sessions will be invalidated after initial deployment or upgrade to v2.
Refs: URS-DP-10103

**[SRS-DP-410107] Token Revocation on Logout**
When a user logs out, the system revokes the refresh token via the Cognito `/oauth2/revoke` endpoint before redirecting to the logout URL. This ensures that existing sessions cannot be resumed with cached tokens.
Refs: URS-DP-20301

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

**[SRS-DP-420102] Query Cost Data for Completed Months and Current Month-to-Date**
The system queries Cost Explorer for cost data covering both completed months and the current in-progress calendar month (MTD). For each normal daily run, the pipeline collects data for: the current in-progress calendar month (the MTD period, as the primary entry written to S3 and shown first in the period selector), the most recently completed calendar month (for MoM comparison and as the second selectable period), the month before that (for further MoM comparison), and the correct year-ago period for each selectable period (for YoY comparison). Each selectable period's YoY figure must compare against the same calendar month one year prior to that specific period — not a shared or offset year-ago period. The MTD data reflects costs accrued through the day before the pipeline runs. Because the current month has not closed, the cost figures in the MTD period will change on each subsequent daily run until the month ends and the period transitions to a completed-month entry.
Refs: URS-DP-10302, URS-DP-10314

**[SRS-DP-420103] Query Cost Category Mapping**
The system queries the configured AWS Cost Category (or the first one returned by the API if not explicitly configured) to obtain the mapping of workloads to cost centers. The Cost Category's values are the cost centers. This mapping is queried separately from the cost data and applied during data processing. The system also queries category-level allocated costs to properly handle split charge rules.
Refs: URS-DP-10102, URS-DP-10301, URS-DP-10403

**[SRS-DP-420107] Detect Split Charge Categories and Pass Rule Structure to Processor**
The system queries the Cost Explorer `ListCostCategoryDefinitions` and `DescribeCostCategoryDefinition` APIs to identify which cost categories use split charge rules. Categories with split charge rules have their costs allocated to other categories rather than appearing as direct spend. The system passes the complete split charge rule structure — not just the list of split charge category names — to the data processor so that redistribution logic can be applied before cost center totals are computed. Each rule specifies a Source cost center, a list of Target cost centers (or the sentinel `"ALL_OTHER"`), a redistribution Method (`PROPORTIONAL`, `EVEN`, or `FIXED`), and optional Parameters (percentage allocations for the `FIXED` method). The system uses this information to display split charge categories differently in the UI (showing "Allocated" instead of cost totals) and to query category-level allocated costs (`NetAmortizedCost`) for accurate totals.
Refs: URS-DP-10403

**[SRS-DP-420104] Query Storage Volume**
The system queries Cost Explorer for `TimedStorage-*` usage types (and optionally EFS/EBS usage types depending on configuration) with metric `UsageQuantity` to calculate total storage volume and hot tier distribution.
Refs: URS-DP-10306, URS-DP-10307

**[SRS-DP-420105] Categorize Usage Types**
The system categorizes AWS usage types into Storage, Compute, Other, and Support based on usage type string pattern matching.
Refs: URS-DP-10305, URS-DP-10401

**[SRS-DP-420106] Backfill Historical Cost Data**
The system supports a backfill mode that collects cost data for all available historical months in Cost Explorer (up to 13 months). Backfill processes months sequentially, skips months for which data already exists in the data store (unless forced), and updates the period index once upon completion. The backfill returns a per-month status report indicating which months succeeded, failed, or were skipped.
Refs: URS-DP-10105

**[SRS-DP-420111] Skip Write When CE Returns Empty Cost Data**
When the Cost Explorer `GetCostAndUsage` API returns a response with zero result groups for the primary period of a given month (i.e., `ResultsByTime[0].Groups` is empty and no exception was raised), the system must not write any data files for that month. The month is reported as skipped in the backfill status response. This requirement applies to both backfill mode and the normal daily run. The intent is to preserve any previously collected data for periods that have aged out of Cost Explorer's retention window, preventing valid historical records from being overwritten with zero-cost summaries. A `DataUnavailableException` raised by the CE API is already treated as a skip; this requirement addresses the silent empty-response case.
Refs: URS-DP-20402, URS-DP-10105

**[SRS-DP-420108] Query S3 Storage Lens for Actual Storage Volume**
When S3 Storage Lens integration is configured (via optional `storage_lens_config_id` variable), the system queries S3 Storage Lens CloudWatch metrics to obtain the actual total storage volume (in bytes) across the organization. The system auto-discovers the first available organization-level Storage Lens configuration if no config ID is provided (by calling `s3control:ListStorageLensConfigurations` and `s3control:GetStorageLensConfiguration`), then queries the CloudWatch `AWS/S3/Storage-Lens` namespace for the `StorageBytes` metric (statistic: `Average`) for the reporting period. If Storage Lens data is unavailable or not configured, this step is skipped and storage metrics rely solely on Cost Explorer usage quantities.
Refs: URS-DP-10106, URS-DP-10312

**[SRS-DP-420109] Refresh Month-to-Date Data on Every Daily Run**
The system overwrites the MTD period data in the data store on every daily pipeline execution. Each daily run queries Cost Explorer for the current in-progress calendar month using a time range from the first day of the month to the current date (exclusive end), replacing the previous day's MTD summary.json and parquet files with updated figures. The MTD period entry is always present in `index.json` at the first position (most recent period) during a calendar month. When the month ends and the first daily run of the new month executes, the former MTD period transitions to a completed-month period (no longer labeled MTD) and a new MTD entry is created for the newly started month. The period selector default selection remains the most recently completed calendar month, not the MTD entry.
Refs: URS-DP-10314

**[SRS-DP-420110] Query Prior Month's Equivalent Partial Period for MTD Comparison**
When collecting MTD data, the system performs an additional Cost Explorer `GetCostAndUsage` query for the equivalent date range in the prior calendar month. The prior partial period spans from the first day of the prior month through the day-of-month corresponding to the last day of the current MTD window (exclusive end). For example, if today is March 8 and the MTD period covers March 1–7, the prior partial period query covers February 1–7. The query uses the same grouping and metric parameters as the MTD query (grouped by App tag and USAGE_TYPE, metric: `UnblendedCost` and `UsageQuantity`, granularity: `MONTHLY`). A separate `NetAmortizedCost` cost-center-level query is also executed for the prior partial period to support allocated cost center totals. The resulting data is processed to produce cost center and workload totals for the prior partial period and stored alongside the MTD summary data. When the MTD window starts on day 1 of the current month and the prior month has fewer days than the current day-of-month window end (e.g., February only has 28 days and today is March 30), the prior partial period end date is clamped to the last day of the prior month.
Refs: URS-DP-10315, URS-DP-10302

#### 4.2.2 Models

**Cost Explorer Query Parameters — workload and usage-type queries (SRS-DP-420101):**

| Field | Type | Description |
|-------|------|-------------|
| TimePeriod.Start | String (YYYY-MM-DD) | First day of the queried month |
| TimePeriod.End | String (YYYY-MM-DD) | First day of the following month |
| Granularity | String | Always `MONTHLY` |
| Metrics | List[String] | `UnblendedCost`, `UsageQuantity` |
| GroupBy | List[Object] | `TAG` (App) and `DIMENSION` (USAGE_TYPE) |

**Cost Explorer Query Parameters — cost center allocated totals query (SRS-DP-420107):**

| Field | Type | Description |
|-------|------|-------------|
| TimePeriod.Start | String (YYYY-MM-DD) | First day of the queried month |
| TimePeriod.End | String (YYYY-MM-DD) | First day of the following month |
| Granularity | String | Always `MONTHLY` |
| Metrics | List[String] | `NetAmortizedCost` |
| GroupBy | List[Object] | `COST_CATEGORY` (configured category name) |

**Cost Explorer Query Parameters — prior month partial period queries (SRS-DP-420110):**

Two queries are executed for the prior month's equivalent partial period: one workload/usage-type query (`UnblendedCost`) and one cost-center allocated totals query (`NetAmortizedCost`). The time range differs from the full-month queries.

| Field | Type | Description |
|-------|------|-------------|
| TimePeriod.Start | String (YYYY-MM-DD) | First day of the prior calendar month (e.g., `2026-02-01` when current month is March) |
| TimePeriod.End | String (YYYY-MM-DD) | Day after the last equivalent day in the prior month (e.g., `2026-02-08` when MTD covers March 1–7). Clamped to the first day of the current month if the prior month is shorter. |
| Granularity | String | Always `MONTHLY` |
| Metrics | List[String] | `UnblendedCost`, `UsageQuantity` (workload query); `NetAmortizedCost` (cost-center query) |
| GroupBy | List[Object] | Same as respective full-period queries |

**Metric Usage by Data Destination:**

The system uses two different Cost Explorer metrics for two distinct purposes:

| Destination | Metric | Rationale |
|-------------|--------|-----------|
| Parquet files (`cost-by-workload.parquet`, `cost-by-usage-type.parquet`) | `UnblendedCost` | Per-workload and per-usage-type on-demand cost data for drill-down queries |
| `summary.json` cost center totals (when allocated costs are available) | `NetAmortizedCost` | Matches the "Total allocated cost" column in the AWS Cost Categories console, including RI/SP amortization and enterprise discount adjustments |

As a consequence, summing the usage-type costs visible in a workload drill-down will not necessarily equal the cost center total shown on the summary card. The gap reflects RI/SP amortization and enterprise discount adjustments that are included in `NetAmortizedCost` but not in `UnblendedCost`.

**Cost Data Record (parquet files):**

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
The data S3 bucket is configured with CORS rules allowing browser-originated requests (GET, HEAD) from the CloudFront distribution domain. Allowed headers include `Authorization`, `Range`, `x-amz-*`, and `amz-sdk-*` (the latter required by AWS SDK v3 which sends `amz-sdk-invocation-id` and `amz-sdk-request` headers). This is required because the SPA accesses S3 directly (not via CloudFront proxy) using the AWS S3 SDK and DuckDB httpfs.
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

**[SRS-DP-510003] Storage Cost Optimization**
All S3 buckets have lifecycle policies to minimize storage cost: incomplete multipart uploads are aborted after 1 day, obsolete delete markers are expired, and data bucket objects are transitioned to S3 Intelligent-Tiering after 5 days. Intelligent-Tiering archive tiers are not enabled, so all data remains instantly accessible. The artifacts bucket expires noncurrent object versions after 30 days to prevent unbounded version accumulation.
Refs: URS-DP-10101

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
The system is updated to new versions by running `terraform apply` with the updated release version. Pre-built Lambda and SPA artifacts are downloaded from GitHub Releases and staged in a dedicated S3 artifacts bucket. The Lambda function is deployed directly from S3, and the SPA is extracted from the artifacts bucket and synced to the app bucket. Subsequent plans detect changes via S3 object versions. No local build tools (Node.js, Python) are required.
Refs: URS-DP-10101

**[SRS-DP-530002] Zero-Downtime Updates**
Updating the system to a new version does not require downtime. The web application and data pipeline can be updated independently.
Refs: URS-DP-10101

**[SRS-DP-530003] Resource Tagging via Default Tags**
The system applies user-defined resource tags to all AWS resources via the AWS provider `default_tags` mechanism. Tags are specified as a map of key-value pairs at deployment time and automatically applied to all taggable resources created by the module.
Refs: URS-DP-10101

**[SRS-DP-530004] IAM Permissions Boundary**
The system optionally attaches an IAM permissions boundary policy (specified by ARN) to all IAM roles created by the module (pipeline Lambda role, authenticated user role). This enables compliance with organizational IAM policies that require boundaries on all roles. When not configured, no boundary is attached.
Refs: URS-DP-10101

### 5.4 Applicable Standards and Regulations

None — non-regulated software.

---

## 6. Run-time Environment

**[SRS-DP-600001] AWS Cloud Environment**
The system runs entirely on AWS. Required AWS services:
- Amazon S3 (static hosting, data storage, and deployment artifact staging)
- Amazon CloudFront (CDN for SPA static assets)
- Amazon Cognito User Pool (authentication — existing or module-managed)
- Amazon Cognito Identity Pool (temporary AWS credentials for browser-to-S3 access)
- AWS Lambda (data collection)
- AWS Cost Explorer API (data source)

Refs: URS-DP-10101

**[SRS-DP-600002] Browser Compatibility**
The web application runs in modern web browsers (latest versions of Chrome, Firefox, Safari, Edge) on both desktop and mobile devices. Layouts use responsive design patterns to adapt to narrow viewports (stacking columns, repositioning legends). Desktop browsers remain the primary design target; mobile support ensures content is accessible and readable but may not be fully optimized for touch interaction.
Refs: URS-DP-10308, URS-DP-30104

**[SRS-DP-600003] Terraform Version**
The Terraform module targets OpenTofu and is compatible with Terraform >= 1.5. It requires the AWS provider >= 5.95 (for Cognito Managed Login v2 support).
Refs: URS-DP-10101

---

## 7. Change History

| Version | Date       | Author | Description       |
|---------|------------|--------|-------------------|
| 0.1     | 2026-02-08 | —      | Initial draft     |
| 0.2     | 2026-02-12 | —      | Add managed Cognito pool, SAML/OIDC federation, runtime config, release artifacts |
| 0.3     | 2026-02-13 | —      | Add Cognito Identity Pool (SI-5) for temporary AWS credentials; SPA accesses S3 directly (not via CloudFront); add index.json period discovery; IAM-enforced data access; S3 CORS; expanded runtime config; S3 lifecycle policies for storage cost optimization |
| 0.4     | 2026-02-13 | —      | Release artifacts staged in dedicated S3 artifacts bucket; Lambda deployed from S3; SPA synced from artifacts bucket; S3 version-based change detection; artifacts bucket lifecycle policy |
| 0.5     | 2026-02-14 | —      | Add backfill historical data capability (SRS-DP-420106); update S3 CORS to include `amz-sdk-*` headers for AWS SDK v3 compatibility |
| 0.6     | 2026-02-15 | —      | Add multi-period cost trend chart (SRS-DP-310214); note trend chart independence from period selector (SRS-DP-310501) |
| 0.7     | 2026-02-15 | —      | Add logo/favicon/header navigation (SRS-DP-310102-104), cost trend line (SRS-DP-310215), contextual tooltips (SRS-DP-310206-209 updates), version display (SRS-DP-310216), mobile responsiveness (SRS-DP-310211, 310214, 600002 updates); note decimal TB in cost per TB (SRS-DP-310207) |
| 0.8     | 2026-02-15 | —      | Enhance trendline visibility (SRS-DP-310215: gray→pink-700); enrich tooltip explanations with formulas, interpretation guidance, and optimization suggestions (SRS-DP-310206-209); add dynamic storage service inclusion text in storage cost tooltip |
| 0.9     | 2026-02-15 | —      | Add cost trend time range toggle (SRS-DP-310214 update); add clickable cost center names (SRS-DP-310201 update); add Cost Center Detail Screen (§3.1.4, SRS-DP-310302-310306); renumber Tagging Coverage (§3.1.4→§3.1.5) and Report Period Selection (§3.1.5→§3.1.6) |
| 0.10    | 2026-02-16 | —      | Add S3 Inventory integration (SRS-DP-420108); actual storage volume display (SRS-DP-310217); storage deep dive navigation (SRS-DP-310218); Storage Deep Dive Screen (§3.1.5, SRS-DP-310307); split charge category detection (SRS-DP-420107); split charge badge display (SRS-DP-310201 update); token revocation on logout (SRS-DP-410107); Managed Login v2 requirement (SRS-DP-410103 update); resource tags (SRS-DP-530003); permissions boundary (SRS-DP-530004); AWS provider version bump to >= 5.95 (SRS-DP-600003 update); renumber Tagging Coverage and Report Period Selection sections (§3.1.5→§3.1.6, §3.1.6→§3.1.7) |
| 0.11    | 2026-02-16 | —      | Replace S3 Inventory with S3 Storage Lens CloudWatch integration (SRS-DP-420108 rewrite); remove storage deep dive screen (§3.1.5 removed, SRS-DP-310307 removed); remove storage deep dive navigation (SRS-DP-310218 marked removed); update actual storage volume display to use Storage Lens (SRS-DP-310217 update) |
| 0.12    | 2026-02-19 | —      | Document dual-metric architecture: `NetAmortizedCost` for cost center allocated totals in summary.json, `UnblendedCost` for parquet drill-down data (§4.2.2 new tables + note); add `NetAmortizedCost` definition (§1.4); update SRS-DP-420107 to specify that the complete split charge rule structure (Source, Targets, Method, Parameters) is passed to the processor for redistribution, not just category names |
| 0.13    | 2026-02-27 | —      | Clarify completed-months-only scope constraint: update SRS-DP-420102 to explicitly state the pipeline only queries fully completed calendar months; update SRS-DP-310501 to document that the period selector normally never shows an MTD entry (pipeline does not collect current in-progress month), and that "MTD" labeling only applies to a current-month period that was written via a mid-month backfill run |
| 0.14    | 2026-02-27 | —      | Add MTD as a supported feature: reverse completed-months-only constraint in SRS-DP-420102 (pipeline now collects current in-progress month on every daily run); update SRS-DP-310501 to document MTD as always-present first entry in period selector with visual distinction; add SRS-DP-420109 (daily MTD refresh); add SRS-DP-310219 (MTD visual distinction in period selector and report); add MTD definition (§1.4) |
| 0.15    | 2026-02-27 | —      | Add like-for-like MTD partial-month comparison: add SRS-DP-420110 (pipeline query for prior month equivalent partial period); update SRS-DP-310219 (remove MoM note now covered separately); add SRS-DP-310220 (like-for-like MTD change annotations in UI, no YoY for MTD) |
| 0.16    | 2026-02-28 | —      | Clarify MTD period-strip label (SRS-DP-310219 update): the MTD entry displays the month abbreviation with an appended "MTD" badge (e.g., "Feb '26 MTD") rather than replacing the abbreviation entirely, giving users both the month context and an in-progress indicator |
| 0.17    | 2026-02-28 | —      | Add empty CE response skip requirement (SRS-DP-420111): pipeline must not write data for a month when CE returns zero result groups, preserving existing historical data for periods beyond CE retention window |
| 0.18    | 2026-02-28 | —      | Bug fix documentation: update SRS-DP-420102 to clarify that each selectable period's YoY comparison must use the correct year-ago period for that specific period (not a shared offset year-ago period) — fixes previously ambiguous wording that implied a single shared YoY period sufficed for both the MTD and completed-month entries |
| 0.19    | 2026-02-28 | —      | Update cost trend chart defaults and behaviors (SRS-DP-310214): change default period window from 12 months to 13 months to enable visual YoY comparison of the last completed month; update time range toggle options accordingly ("13 Months" / "All Time"); add MTD bar visual distinction (reduced opacity); add collapsible legend (hidden by default) |
| 0.20    | 2026-02-28 | —      | Update global cost summary data source (SRS-DP-310211): total spend and MoM/YoY deltas are now sourced from pre-computed `totals` object in summary.json (computed from raw workload costs, independent of cost category allocation and split charge rules) rather than summed from cost center values |
