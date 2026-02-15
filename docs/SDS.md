# Software Design Specification (SDS) — Dapanoskop

| Field               | Value                                      |
|---------------------|--------------------------------------------|
| Document ID         | SDS-DP                                     |
| Product             | Dapanoskop (DP)                            |
| System Type         | Non-regulated Software                     |
| Version             | 0.11 (Draft)                               |
| Date                | 2026-02-15                                 |

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
| Identity Pool | Cognito Identity Pool — exchanges ID tokens for temporary scoped AWS credentials |
| httpfs | DuckDB extension for querying remote files via HTTP(S) or S3 protocols |

---

## 2. Solution Strategy

| Quality Goal                 | Scenario                                                                  | Solution Approach                                                                   | Reference  |
|------------------------------|---------------------------------------------------------------------------|-------------------------------------------------------------------------------------|------------|
| Simplicity for Budget Owners | A non-technical user opens the app and immediately sees their cost report | Static pre-rendered report data; no interactive querying; 1-page layout             | §3.1       |
| Low operational cost         | The tool itself should not be a significant cost item                     | Serverless architecture (Lambda + S3 + CloudFront); no always-on compute            | §3.2, §5   |
| Easy deployment              | A DevOps engineer deploys in minutes                                      | Single Terraform module encapsulating all resources                                 | §3.3       |
| Data freshness               | Cost data is at most 1 day old                                            | Scheduled Lambda execution (daily) writing to S3                                    | §3.2, §4.1 |
| Security                     | Only authenticated users access cost data                                 | Cognito User Pool authentication + Identity Pool temporary AWS credentials; IAM-enforced S3 access; all authenticated users see all data | §3.1, §6.4, §7.7 |
| Self-contained deployment    | A DevOps engineer deploys without local build tools                       | Pre-built release artifacts (Lambda zip + SPA tarball) staged in a dedicated S3 artifacts bucket at deploy time; Lambda deployed from S3; SPA synced from artifacts bucket; runtime config.json instead of build-time env vars | §3.3, §6.7, §7.8 |

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
│  │  + Identity  │   │              │   │                  │     │
│  │    Pool      │   │              │   │                  │     │
│  └──────┬───────┘   └──────┬───────┘   └──────────────────┘     │
│         │                  │                                    │
│         │ reads (S3 SDK    │    writes                          │
│         │ + DuckDB httpfs) │                                    │
│         ▼                  ▼                                    │
│       ┌──────────────────────┐                                  │
│       │  SS-4                │                                  │
│       │  Data Store          │                                  │
│       │  (S3 Data Bucket)    │                                  │
│       │                      │                                  │
│       │  index.json +        │                                  │
│       │  summary.json +      │                                  │
│       │  parquet per period  │                                  │
│       └──────────────────────┘                                  │
└─────────────────────────────────────────────────────────────────┘
```

Note: The SPA static assets are hosted in a separate S3 App Bucket (part of SS-1). The Data Bucket (SS-4) stores only cost data files. The SPA accesses the Data Bucket directly via the AWS S3 SDK and DuckDB httpfs S3 protocol using temporary credentials from the Cognito Identity Pool — CloudFront serves only SPA static assets.

### 3.1 SS-1: Web Application

**Purpose / Responsibility**: Serves the cost report UI to authenticated users. A React SPA hosted on a dedicated S3 bucket, delivered via CloudFront, with authentication via Cognito User Pool and data access via temporary AWS credentials from Cognito Identity Pool.

**Interfaces**:
- **Inbound (User)**: HTTPS requests from browsers via CloudFront (SPA assets only)
- **Outbound (Data Store)**: Reads summary JSON via AWS S3 SDK and queries parquet via DuckDB httpfs S3, both directly to the data S3 bucket using temporary AWS credentials
- **Outbound (Auth)**: Redirects to Cognito hosted UI for authentication; validates JWT tokens
- **Outbound (Credentials)**: Exchanges Cognito ID token for temporary AWS credentials via Identity Pool enhanced authflow

**Variability**: Cognito Domain URL, Client ID, User Pool ID, Identity Pool ID, AWS region, and data bucket name are loaded at runtime from a `/config.json` file served alongside the SPA. The config file is written to S3 by Terraform at deploy time, allowing the same SPA build artifact to work across environments.

#### Level 2: Web Application Components

```
┌────────────────────────────────────────────────────────────┐
│                     SS-1: Web App                          │
│                                                            │
│  ┌──────────────┐  ┌──────────────┐  ┌─────────────────┐   │
│  │  C-1.1       │  │  C-1.3       │  │  C-1.2          │   │
│  │  Auth Module │  │  Credentials │  │  Report Renderer│   │
│  │              │  │  Module      │  │                 │   │
│  │  Cognito     │  │              │  │  S3 SDK for     │   │
│  │  OIDC flow,  │  │  Identity    │  │  JSON; DuckDB   │   │
│  │  token mgmt  │──│  Pool creds, │──│  httpfs S3 for  │   │
│  │              │  │  auto-refresh│  │  parquet        │   │
│  └──────────────┘  └──────────────┘  └─────────────────┘   │
│                                                            │
└────────────────────────────────────────────────────────────┘
```

##### 3.1.1 C-1.1: Auth Module

**Purpose / Responsibility**: Handles the Cognito OIDC authentication flow, token storage, and token refresh against a Cognito User Pool (existing or module-managed). When federation is configured, the Cognito hosted UI transparently redirects to the external IdP.

**Interfaces**:
- **Inbound**: Called by the SPA on page load and on token expiry
- **Outbound**: Cognito hosted UI (redirect), Cognito token endpoint (token exchange); config.json (runtime configuration)

**Variability**: Cognito Domain URL, Client ID, and redirect URI are loaded at runtime from `/config.json` via an async `initAuth()` call. During local development, the module falls back to `VITE_*` environment variables if config.json contains no values.

**[SDS-DP-010101] Implement OIDC Authorization Code Flow with PKCE**
The Auth Module implements the OAuth 2.0 Authorization Code flow with PKCE against the Cognito hosted UI. Tokens are stored in sessionStorage, preserving the session across page refreshes within the same browser tab while clearing automatically when the tab is closed. The module handles token refresh on expiry.
Refs: SRS-DP-310101, SRS-DP-310102, SRS-DP-310103, SRS-DP-410101, SRS-DP-410102

**[SDS-DP-010102] Load Configuration at Runtime**
The Auth Module fetches `/config.json` on first use via an async `getConfig()` singleton. The config file contains `cognitoDomain`, `cognitoClientId`, `userPoolId`, `identityPoolId`, `awsRegion`, `dataBucketName`, `redirectUri`, and `authBypass`. Each route calls `await initAuth()` before accessing auth state. The singleton ensures the config is fetched only once.
Refs: SRS-DP-310103

**[SDS-DP-010103] Clear Credentials on Logout**
When the user logs out, the Auth Module clears cached AWS credentials (C-1.3) before removing tokens and redirecting to the Cognito logout endpoint.
Refs: SRS-DP-450103

##### 3.1.3 C-1.3: Credentials Module

**Purpose / Responsibility**: Obtains temporary AWS credentials from the Cognito Identity Pool using the enhanced (simplified) authflow. Provides these credentials to the Report Renderer (C-1.2) for S3 data access.

**Interfaces**:
- **Inbound**: Called by C-1.2 (Report Renderer) before fetching data
- **Outbound**: Cognito Identity Pool API (`GetId`, `GetCredentialsForIdentity`)

**Variability**: Identity Pool ID and AWS region are loaded from runtime config (C-1.1).

**[SDS-DP-010301] Obtain Temporary AWS Credentials**
The Credentials Module implements the Cognito Identity Pool enhanced authflow: (1) `GetId` to obtain an identity ID using the ID token and Identity Pool ID, (2) `GetCredentialsForIdentity` to exchange the identity for temporary AWS credentials scoped to `s3:GetObject` on the data bucket. The identity ID is cached for reuse across credential refreshes.
Refs: SRS-DP-450101

**[SDS-DP-010302] Promise Deduplication and Auto-Refresh**
The Credentials Module caches credentials in memory and refreshes them 5 minutes before expiry. Concurrent callers share the same in-flight request via promise deduplication, preventing redundant Identity Pool API calls when multiple components request credentials simultaneously.
Refs: SRS-DP-450102

##### 3.1.2 C-1.2: Report Renderer

**Purpose / Responsibility**: Fetches pre-computed cost data directly from the data S3 bucket and renders the 1-page cost report showing all cost centers. Uses summary.json for the initial view and DuckDB-wasm to query parquet files for drill-down.

**Interfaces**:
- **Inbound**: Receives authenticated user context from C-1.1 and temporary AWS credentials from C-1.3
- **Outbound (JSON)**: AWS S3 SDK `GetObjectCommand` to fetch summary.json and index.json from the data bucket
- **Outbound (Parquet)**: DuckDB-wasm httpfs S3 protocol to query parquet files directly from the data bucket

**Variability**: Data bucket name and AWS region are loaded from runtime config (C-1.1).

**[SDS-DP-010201] Fetch Summary Data via S3 SDK**
The Report Renderer fetches `{year}-{month}/summary.json` for the selected reporting period using the AWS S3 SDK `GetObjectCommand` with temporary credentials from C-1.3. In local dev mode (auth bypass), it falls back to a plain HTTP fetch from the local dev server. It renders the 1-page cost report (global summary bar, cost center cards, storage metric cards). Period discovery in production reads `index.json` from S3; in local dev mode, it probes up to 36 months of candidate periods in parallel via `Promise.allSettled` to identify available summary.json files without requiring an index file.
Refs: SRS-DP-310201, SRS-DP-310211, SRS-DP-430102

**[SDS-DP-010202] Render Cost Center Cards**
The Report Renderer renders each cost center as an expandable card with summary (total, MoM, YoY, workload count, top mover) from summary.json. The cost center name is rendered as a `<Link to={/cost-center/${encodeURIComponent(name)}?period=${period}}>` component, navigating to the cost center detail page while preserving the current reporting period. The workload breakdown table is rendered within the expanded card.
Refs: SRS-DP-310201, SRS-DP-310202, SRS-DP-310203, SRS-DP-310212

**[SDS-DP-010203] Render Workload Table**
The Report Renderer renders the workload breakdown table from summary.json, with workloads sorted by current month cost descending and MoM/YoY deltas included.
Refs: SRS-DP-310204, SRS-DP-310205

**[SDS-DP-010204] Render Storage Metrics with Dynamic Tooltips**
The Report Renderer renders total storage cost, cost per TB, and hot tier percentage from the pre-computed summary.json. The `StorageOverview` component accepts a `storageConfig` prop (from `summary.json`) and dynamically generates tooltip text reflecting which storage services are included (e.g., "S3 only" or "S3, EFS, and EBS"). Tooltips include calculation formulas, interpretation guidance, and optimization suggestions.
Refs: SRS-DP-310206, SRS-DP-310207, SRS-DP-310208

**[SDS-DP-010206] Query Parquet via DuckDB-wasm httpfs S3**
For drill-down views (e.g., usage types within a workload), the Report Renderer initializes DuckDB-wasm and configures it with temporary AWS credentials via `SET s3_region`, `SET s3_access_key_id`, `SET s3_secret_access_key`, and `SET s3_session_token` SQL statements. It then queries the relevant parquet file (e.g., `s3://{bucket}/{year}-{month}/cost-by-usage-type.parquet`) using the S3 protocol. Credential values are escaped (single quotes doubled) for defense-in-depth. In local dev mode (auth bypass), DuckDB uses the HTTP protocol against the local dev server instead. The DuckDB WASM bundles (`duckdb-eh.wasm`, `duckdb-browser-eh.worker.js`) are self-hosted in `public/duckdb/` and served as static assets at `/duckdb/*` without Vite content-hashing. A Vite plugin copies them from `node_modules/@duckdb/duckdb-wasm/dist/` at build and dev server start. Workers are created using stable URLs (e.g., `new Worker("/duckdb/duckdb-browser-eh.worker.js")`) to ensure reliable WASM instantiation.
Refs: SRS-DP-310301, SRS-DP-430102

**[SDS-DP-010207] Fetch Multi-Period Trend Data**
The Report Renderer includes a `useTrendData` hook that fetches all available periods' summary.json files in parallel via `Promise.allSettled`. For each successfully fetched summary, the hook extracts `current_cost_usd` per cost center and pivots it into a chart-ready data point `{ period, [costCenterName]: costUsd }`. Points are sorted chronologically (oldest first). Cost center names are collected and sorted by total cost descending (largest first, appearing at the bottom of the stacked chart). Failed period fetches are silently excluded — partial data is displayed rather than failing entirely. The hook exposes `{ points, costCenterNames, loading, error }`.
Refs: SRS-DP-310214

**[SDS-DP-010208] Render Cost Trend Chart with Moving Average and Time Range Toggle**
The Report Renderer includes a `CostTrendSection` component wrapping a lazy-loaded `CostTrendChart`. When more than 12 data points exist, a `TimeRangeToggle` component displays radio buttons for "1 Year" (last 12 months) and "All Time" (all available periods). The toggle state is managed via `useState<"1y" | "all">` with a default of "1y". A `filterPointsByRange` helper slices the last 12 points when range is "1y" and all points when range is "all" or when ≤12 points exist. The chart renders a Recharts `ComposedChart` combining stacked bars and a trend line. Each cost center is a separate `Bar` element with `stackId="cost"`. A 3-month simple moving average of the aggregate total cost (sum of all cost centers) is computed using a pure utility function (`computeMovingAverage` in `~/lib/moving-average.ts`) and overlaid as a `Line` element with dashed pink-700 styling (`stroke="#be185d"`, `strokeDasharray="6 3"`, labeled "3-Month Avg"). The first two data points have `null` moving average values (insufficient window). The chart uses a deterministic color palette (blue, violet, cyan, emerald, amber, red) assigned by cost center index. The X-axis formats periods using `formatPeriodLabel()` (e.g., "Dec '25"). The Y-axis uses compact USD formatting (e.g., "$15K"). A custom tooltip shows per-cost-center costs and a computed total; the moving average value is displayed in pink-700 text for visual consistency. The legend is positioned below the chart (`verticalAlign="bottom"`) to prevent overlap on narrow viewports. The chart component is loaded via `React.lazy` with a `Suspense` boundary showing a pulse skeleton, so the Recharts bundle (~105 KB gzipped) is code-split and does not block initial page paint. The trend section is positioned between the Global Summary and Storage Overview on the cost report page.
Refs: SRS-DP-310214, SRS-DP-310215

**[SDS-DP-010205] Apply Business-Friendly Labels**
The Report Renderer maps internal identifiers to business-friendly labels (e.g., App tag values displayed as "Workload", usage categories displayed without AWS terminology).
Refs: SRS-DP-310209

**[SDS-DP-010209] Inject Version from package.json**
The application version is injected at build time via Vite's `define` config, reading the `version` field from `package.json` and exposing it as `__APP_VERSION__` global constant. A shared `<Footer>` component renders the version string in the format "Dapanoskop vX.Y.Z".
Refs: SRS-DP-310216

**[SDS-DP-010210] Render Shared Header Component with Logo**
A shared `<Header>` component renders the application logo (inline SVG Greek delta on gradient background), title as a clickable `<Link>` preserving the current period query parameter, and an optional logout button. The header is used by both the cost report and workload detail routes. A matching `favicon.svg` is served from the `/public/` directory.
Refs: SRS-DP-310102, SRS-DP-310103, SRS-DP-310104

**[SDS-DP-010211] Render Shared Footer Component with Version**
A shared `<Footer>` component renders the application version using the `__APP_VERSION__` constant injected at build time. The footer is used by both the cost report and workload detail routes.
Refs: SRS-DP-310216

**[SDS-DP-010212] Render InfoTooltip Components with Enriched Explanations**
A reusable `<InfoTooltip>` component renders a small circled "i" icon adjacent to metric labels. On hover or keyboard focus, it displays a concise explanatory tooltip using CSS-only positioning (no external library). The component is keyboard-accessible (`tabIndex={0}`) and includes `aria-label` and `role="tooltip"` for screen readers. Tooltips are applied to all metric cards across the cost report (GlobalSummary, StorageOverview, TaggingCoverage, CostCenterCard) and workload detail screens. Tooltip content includes specific calculation formulas, interpretation guidance (e.g., "Lower values indicate better storage cost efficiency"), and optimization suggestions where applicable (e.g., "High values may indicate optimization opportunities via lifecycle policies"). The StorageOverview component dynamically generates tooltip text based on the `storage_config` from summary.json (e.g., "S3 only" vs. "S3, EFS, and EBS").
Refs: SRS-DP-310209, SRS-DP-310206, SRS-DP-310207, SRS-DP-310208

**[SDS-DP-010213] Apply Responsive Layout Breakpoints**
All 3-column metric card grids (GlobalSummary, StorageOverview, workload detail summary cards, cost center detail summary cards) use Tailwind responsive breakpoints: `grid-cols-1 sm:grid-cols-3` (1 column below 640px, 3 columns above). The cost trend chart legend is positioned below the chart to prevent overlap on narrow viewports. Desktop remains the primary design target; mobile support ensures readability without full touch optimization.
Refs: SRS-DP-600002, SRS-DP-310211, SRS-DP-310214

**[SDS-DP-010214] Render Cost Center Detail Route**
The Report Renderer includes a dedicated route component at `/cost-center/:name` (route file: `routes/cost-center-detail.tsx`) for displaying a single cost center's detailed view. The route extracts the cost center name from the URL parameter via `useParams()`, decodes it using `decodeURIComponent()`, and reads the period from the query string via `useSearchParams()`. The route follows the same authentication, period discovery, and summary data fetching patterns as the main report route. The component renders the shared `<Header>` and `<Footer>` components, a back link to the main report, cost center summary cards, a cost center-specific trend chart, and the workload breakdown table.
Refs: SRS-DP-310302, SRS-DP-310306

**[SDS-DP-010215] Fetch Cost Center-Specific Trend Data**
The cost center detail route component fetches trend data for a single cost center using a `useEffect` hook that calls `Promise.allSettled(periods.map(p => fetchSummary(p)))` to load all periods' summary.json files in parallel. For each successfully fetched summary, the component finds the matching cost center by name and extracts its `current_cost_usd`, building an array of `TrendPoint[]` with shape `{ period, [costCenterName]: costUsd }`. Points are sorted chronologically. The trend data is passed as props to the reusable `CostTrendSection` component, which renders the cost center-specific trend chart with the same toggle and moving average features as the main report chart.
Refs: SRS-DP-310304

**[SDS-DP-010216] Render Cost Center Detail Page Layout**
The cost center detail page layout includes: (1) a back link (`<Link to={/?period=${selectedPeriod}}>`) to return to the main report while preserving the period selection; (2) the cost center name as a page heading; (3) three summary cards in a responsive grid showing total spend, MoM change, and YoY change for the selected period, sourced from the fetched summary.json and filtered to the specific cost center; (4) the `CostTrendSection` component with cost center-filtered trend data; (5) the reusable `WorkloadTable` component displaying the cost center's workload breakdown in an always-visible (non-expandable) format. The route is registered in `routes.ts` as `route("cost-center/:name", "routes/cost-center-detail.tsx")`.
Refs: SRS-DP-310302, SRS-DP-310303, SRS-DP-310304, SRS-DP-310305, SRS-DP-310306

Wireframes: See `docs/wireframes/cost-report.puml` and `docs/wireframes/workload-detail.puml`.
Cost direction indicators (color coding, direction arrows, +/- prefixes) and anomaly highlighting are implemented with Tailwind CSS utility classes.
Refs: SRS-DP-310210, SRS-DP-310213

### 3.2 SS-2: Data Pipeline

**Purpose / Responsibility**: Periodically collects cost data from the AWS Cost Explorer API, processes and categorizes it, and writes pre-computed summary JSON and parquet files to S3 for consumption by the web application.

**Interfaces**:
- **Inbound (Trigger)**: EventBridge scheduled rule triggers Lambda execution (daily mode); manual invocation with `{"backfill": true}` event payload triggers backfill mode
- **Outbound (Cost Explorer)**: Calls `GetCostAndUsage` API
- **Outbound (S3)**: Writes JSON cost data files, parquet files, and the `index.json` manifest to the data store bucket

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
The Cost Collector queries the configured AWS Cost Category (by name, or the first one returned by `GetCostCategories` if not configured) to obtain the mapping of workloads (App tag values) to cost centers. The AWS CE API returns cost category group keys with the format `{CategoryName}${Value}` (e.g., `CostCenter$IT`). The collector strips the `{CategoryName}$` prefix to extract the clean cost center name. This mapping is applied during data processing (C-2.2) to allocate workload costs to cost centers.
Refs: SRS-DP-420103

**[SDS-DP-020103] Support Parameterized Period Generation**
The Cost Collector supports generating target periods for an arbitrary month (specified by year and month) in addition to the default "current month" logic. This enables the backfill handler to request data for any historical month using the same collection logic.
Refs: SRS-DP-420106

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
The Data Processor computes total storage volume from S3 `TimedStorage-*` usage quantities and calculates the hot tier percentage as: `(TimedStorage-ByteHrs + TimedStorage-INT-FA-ByteHrs) / total TimedStorage-*-ByteHrs`. When configured, EFS and EBS storage usage types are included in the totals. **AWS Cost Explorer returns `UsageQuantity` for TimedStorage-* in GB-hours, not byte-hours.** The processor converts GB-hours to average bytes stored by multiplying by 1,000,000,000 (bytes per GB) and then dividing by the number of hours in the reporting month. The processor uses decimal terabytes (TB = 10^12 bytes) for all volume conversions, consistent with AWS Cost Explorer and billing practices. Note: Prior to v1.5.0, the constant `_BYTES_PER_TB` incorrectly used tebibytes (TiB = 2^40 = 1,099,511,627,776) instead of terabytes, causing a ~10% overstatement in cost per TB values. This was corrected to 1,000,000,000,000 (10^12). Prior to v1.6.0, the processor incorrectly treated GB-hours as byte-hours, producing storage volumes ~1 billion times too large and cost-per-TB values ~1 billion times too small.
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

**[SDS-DP-020207] Write Period Index Manifest**
After writing period-specific files, the Data Processor lists all `YYYY-MM/` prefixes in the data bucket (via S3 `ListObjectsV2` with delimiter), writes a root-level `index.json` containing `{"periods": [...]}` sorted in reverse chronological order. This enables the SPA to discover available periods without requiring `s3:ListBucket` IAM permissions for browser users. The index update can be called independently (without writing period data) to support backfill scenarios where the index is updated once after all months are processed.
Refs: SRS-DP-430103

**[SDS-DP-020208] Handle Backfill Mode**
The Lambda handler detects backfill mode via the event payload `{"backfill": true, "months": N, "force": false}`. In backfill mode, the handler generates a list of N target months (ending at the current month), processes each sequentially by invoking `collect_for_month()` (C-2.1) and `write_to_s3()` (C-2.2) per month with index updates suppressed. Before processing each month, the handler checks whether data already exists in S3 (by probing for `{year}-{month}/summary.json`) and skips existing months unless `force` is true. After all months are processed, the handler calls `update_index()` once to rebuild the period manifest. The response includes a multi-status report: `{"statusCode": 200|207, "succeeded": [...], "failed": [...], "skipped": [...]}`.
Refs: SRS-DP-420106

### 3.3 SS-3: Terraform Module

**Purpose / Responsibility**: Provides a single Terraform module that provisions all AWS resources needed for a complete Dapanoskop deployment.

**Interfaces**:
- **Inbound**: Terraform input variables from the deployer
- **Outbound**: Provisions AWS resources (S3 buckets, CloudFront distribution, Cognito User Pool or app client on existing pool, optional SAML/OIDC federation, Lambda function, EventBridge rule, IAM roles)

**Variability**: Configurable via Terraform variables (domain name, Cost Category name (optional, defaults to first), existing Cognito User Pool ID (optional — managed pool created if omitted), federation settings (SAML/OIDC), MFA configuration, schedule, storage services to include, release version, etc.).

#### Level 2: Terraform Module Components

```
┌───────────────────────────────────────────────────────────────────┐
│                    SS-3: Terraform Module                         │
│                                                                   │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌────────┐  │
│  │ C-3.1    │ │ C-3.2    │ │ C-3.3    │ │ C-3.4    │ │ C-3.5  │  │
│  │ Hosting  │ │ Auth     │ │ Pipeline │ │ Data     │ │ Arti-  │  │
│  │ Infra    │ │ Infra    │ │ Infra    │ │ Store    │ │ facts  │  │
│  │          │ │          │ │          │ │ Infra    │ │        │  │
│  │ S3 App + │ │ Cognito  │ │ Lambda + │ │ S3 Data  │ │ S3 +   │  │
│  │ CF + DNS │ │ Pool/Clnt│ │ EB Rule  │ │ bucket   │ │ upload │  │
│  │ + config │ │ + Federn │ │          │ │          │ │        │  │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘ └────────┘  │
│                                                                   │
└───────────────────────────────────────────────────────────────────┘
```

##### 3.3.1 C-3.1: Hosting Infrastructure

**Purpose / Responsibility**: Provisions the S3 app bucket for static web app hosting, CloudFront distribution with OAC (single origin: app bucket only), and optional custom domain / TLS certificate. CloudFront serves only the SPA static assets — cost data is accessed directly from S3 by the browser using temporary credentials.

**[SDS-DP-030101] Provision Web Hosting Stack**
The module creates an S3 app bucket (private, website hosting disabled), a CloudFront distribution with OAC pointing to the app bucket as a single origin, and an S3 bucket policy granting CloudFront read access. The CloudFront response headers policy sets a Content Security Policy with: `script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'` (wasm-unsafe-eval required for DuckDB-wasm WebAssembly instantiation); `worker-src 'self' blob:` (for DuckDB web workers); `connect-src` includes the S3 data bucket endpoint and Cognito Identity endpoint; `font-src 'self'` (fonts are self-hosted).
Refs: SRS-DP-520001, SRS-DP-520003

The custom domain name and ACM certificate ARN are passed as optional Terraform input variables. The module does not create certificates or DNS records — those are managed externally.

**[SDS-DP-030102] Deploy SPA from Artifacts Bucket**
When S3 artifact references are provided (from C-3.5), the hosting module downloads the SPA tarball from the artifacts S3 bucket, extracts it to a temporary directory, and syncs the contents to the S3 app bucket (excluding `config.json`). The `spa_s3_object_version` serves as the change trigger — a new version triggers re-download, extract, sync, and CloudFront invalidation. After sync, it writes a `config.json` file to the bucket containing the Cognito domain URL, client ID, User Pool ID, Identity Pool ID, AWS region, and data bucket name, and invalidates the CloudFront cache.
Refs: SRS-DP-310103, SRS-DP-530001

**[SDS-DP-030103] App Bucket Lifecycle Policy**
The app bucket has a lifecycle configuration that aborts incomplete multipart uploads after 1 day and expires obsolete delete markers. No Intelligent-Tiering transition is applied because SPA assets are always hot (served via CloudFront). The logs bucket (when enabled) additionally expires objects after 90 days.
Refs: SRS-DP-510003

##### 3.3.2 C-3.2: Auth Infrastructure

**Purpose / Responsibility**: Provisions Cognito authentication for Dapanoskop. Either creates an app client on an existing Cognito User Pool, or creates and manages a complete User Pool with optional SAML/OIDC federation.

**[SDS-DP-030201] Create Cognito App Client**
The module creates a Cognito app client configured for authorization code flow with PKCE, token revocation enabled, and user-existence-error prevention. Callback URLs point to the CloudFront distribution domain. Token validity: 1 hour for ID/access tokens, 12 hours for refresh tokens. The app client references either the provided existing User Pool or the newly created managed pool.
Refs: SRS-DP-410101, SRS-DP-520004

**[SDS-DP-030202] Create Managed Cognito User Pool**
When `cognito_user_pool_id` is empty, the module creates a Cognito User Pool (`count`-conditional) with: email as username, admin-only user creation, 14-character password policy, configurable MFA with software TOTP, deletion protection, verified email recovery, and optional advanced security (ENFORCED mode). A Cognito domain is created using the configured domain prefix.
Refs: SRS-DP-410103, SRS-DP-520004

**[SDS-DP-030203] Configure SAML Identity Provider**
When `saml_metadata_url` is provided (and a managed pool is being created), the module creates a `SAML` identity provider on the managed User Pool using the metadata URL. Attribute mappings default to email. The app client's `supported_identity_providers` is set to the SAML provider name, disabling local Cognito login. Preconditions validate that `saml_provider_name` is non-empty and the metadata URL uses HTTPS.
Refs: SRS-DP-410104, SRS-DP-520005

**[SDS-DP-030204] Configure OIDC Identity Provider**
When `oidc_issuer` is provided (and a managed pool is being created), the module creates an `OIDC` identity provider on the managed User Pool. Preconditions validate that `oidc_provider_name`, `oidc_client_id`, and `oidc_client_secret` are non-empty and the issuer URL uses HTTPS.
Refs: SRS-DP-410105, SRS-DP-520005

**[SDS-DP-030205] Output Federation Configuration**
The module outputs `saml_entity_id` (format: `urn:amazon:cognito:sp:{pool_id}`) and `saml_acs_url` (format: `https://{domain_prefix}.auth.{region}.amazoncognito.com/saml2/idpresponse`) for IdP configuration.
Refs: SRS-DP-410106

**[SDS-DP-030206] Provision Cognito Identity Pool**
The module creates a Cognito Identity Pool configured with the Cognito User Pool as the sole identity provider. Unauthenticated identities are disabled. The classic (basic) authflow is disabled; only the enhanced (simplified) authflow is allowed. Server-side token validation is enabled.
Refs: SRS-DP-450101, SRS-DP-520003

**[SDS-DP-030207] Provision IAM Role for Authenticated Users**
The module creates an IAM role with an `AssumeRoleWithWebIdentity` trust policy restricted to the Identity Pool (`cognito-identity.amazonaws.com:aud` = pool ID, `amr` = `authenticated`). An inline policy grants only `s3:GetObject` on the data bucket. The role is attached to the Identity Pool as the default authenticated role.
Refs: SRS-DP-450101, SRS-DP-520003

##### 3.3.3 C-3.3: Pipeline Infrastructure

**Purpose / Responsibility**: Provisions the Lambda function for cost data collection, its IAM role (with Cost Explorer and S3 permissions), and the EventBridge scheduled rule.

**[SDS-DP-030301] Provision Lambda and Schedule**
The module creates a Lambda function (Python runtime) from a packaged deployment artifact, an IAM role with permissions for `ce:GetCostAndUsage`, `ce:GetCostCategories`, `s3:PutObject` (to the data bucket), and `s3:ListBucket` (on the data bucket, for index.json generation), and an EventBridge rule to trigger the Lambda on a daily schedule.
When S3 artifact references are provided (from C-3.5), the Lambda function is deployed using `s3_bucket`, `s3_key`, and `s3_object_version` — an `s3_object_version` change triggers a Lambda code update. Otherwise, the Lambda is packaged from the local source directory via Terraform's `archive_file` data source and deployed using `filename` and `source_code_hash`. Memory: 256 MB. Timeout: 5 minutes. EventBridge schedule: `cron(0 6 * * ? *)` (daily at 06:00 UTC).
Refs: SRS-DP-510002, SRS-DP-520002, SRS-DP-530001, SRS-DP-430103

##### 3.3.4 C-3.4: Data Store Infrastructure

**Purpose / Responsibility**: Provisions a dedicated S3 data bucket for cost data storage, separate from the app bucket.

**[SDS-DP-030401] Provision Data Bucket**
The module creates a dedicated S3 bucket for cost data with versioning enabled and server-side encryption (SSE-S3 or SSE-KMS). The bucket has no bucket policy granting CloudFront access — authenticated browser users access data directly using temporary IAM credentials from the Identity Pool (C-3.2).
Refs: SRS-DP-430101, SRS-DP-430102

**[SDS-DP-030403] Data Bucket Lifecycle Policy**
The data bucket has a lifecycle configuration that aborts incomplete multipart uploads after 1 day, expires obsolete delete markers, and transitions objects to S3 Intelligent-Tiering after 5 days. Intelligent-Tiering automatically moves infrequently accessed historical data to lower-cost tiers without retrieval fees or latency penalties. Archive tiers are not configured (omitting `aws_s3_intelligent_tiering_configuration`), so objects remain instantly accessible. No `NoncurrentVersionExpiration` is applied — all versioned data is retained indefinitely to preserve rollback capability.
Refs: SRS-DP-510003

**[SDS-DP-030402] Configure S3 CORS for Browser Access**
The module configures CORS on the data bucket allowing `GET` and `HEAD` methods from the CloudFront distribution origin. Allowed headers include `Authorization`, `Range`, `x-amz-*`, and `amz-sdk-*`. The `amz-sdk-*` pattern is required because AWS SDK v3 sends `amz-sdk-invocation-id` and `amz-sdk-request` headers that do not match the `x-amz-*` prefix — without this, S3 returns 403 without CORS headers, which browsers report as a CORS error. Exposed headers include `Content-Length`, `Content-Range`, and `ETag`. Max age: 300 seconds.
Refs: SRS-DP-430104

##### 3.3.5 C-3.5: Artifacts

**Purpose / Responsibility**: Creates a dedicated S3 artifacts bucket and stages pre-built Lambda and SPA deployment artifacts from a GitHub Release when a release version is specified. Provides S3 references for downstream modules.

**Interfaces**:
- **Inbound**: `release_version` and `github_repo` Terraform variables
- **Outbound**: Downloads `lambda.zip` and `spa.tar.gz` from GitHub Releases via `curl`, uploads them to a versioned S3 artifacts bucket; outputs S3 bucket, key, and object version for consumption by C-3.3 (Pipeline) and C-3.1 (Hosting)

**Variability**: When `release_version` is empty (local dev mode), the artifacts bucket is not created and all S3 outputs are empty strings. Downstream modules fall back to building from source (Pipeline) or skipping deployment (Hosting).

**[SDS-DP-030501] Stage Release Artifacts in S3**
When `release_version` is set, the module creates a dedicated S3 artifacts bucket (`dapanoskop-artifacts-*`) with versioning enabled, SSE-S3 encryption, public access blocked, and lifecycle rules (abort incomplete multipart uploads after 1 day, expire noncurrent versions after 30 days). A bucket policy grants `s3:GetObject` to the `lambda.amazonaws.com` service principal, scoped to the deploying account via `aws:SourceAccount`. Two `terraform_data` resources (`upload_lambda`, `upload_spa`) download artifacts from GitHub to temporary files and upload them to the bucket under the `{version}/` prefix. Data sources (`data "aws_s3_object"`) read the uploaded objects to obtain their `version_id` for change detection. The module outputs `lambda_s3_bucket`, `lambda_s3_key`, `lambda_s3_object_version`, `spa_s3_bucket`, `spa_s3_key`, `spa_s3_object_version`, and `use_release`. On first apply, data sources are deferred ("known after apply"). On subsequent plans, S3 objects exist and resolve at plan time. A version change triggers resource replacement, re-upload, and data source re-read.
Refs: SRS-DP-530001

### 3.4 SS-4: Data Store (S3 Data Bucket)

**Purpose / Responsibility**: Dedicated S3 bucket storing pre-computed cost data (summary JSON + parquet files). Separate from the app bucket that hosts the SPA.

**Interfaces**:
- **Inbound (Write)**: Lambda function writes summary JSON, parquet files, and index.json manifest
- **Outbound (Read)**: Browser accesses data files directly via AWS S3 SDK (JSON) and DuckDB httpfs S3 protocol (parquet) using temporary IAM credentials from the Identity Pool

**Variability**: Data partitioned by reporting period under date prefixes.

**[SDS-DP-040001] Data File Layout**
A root-level manifest and per-period data files:

```
index.json                       # Lists all available YYYY-MM periods (reverse chronological)
{year}-{month}/
  summary.json                   # Pre-computed aggregates for instant 1-page render
  cost-by-workload.parquet       # Detailed workload cost data for all 3 periods
  cost-by-usage-type.parquet     # Detailed usage type cost data for all 3 periods
```

Refs: SRS-DP-430101, SRS-DP-430102, SRS-DP-430103

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

The SPA discovers available periods by reading `index.json` from the data bucket (via S3 SDK in production, or HTTP fetch in local dev mode). The Lambda pipeline updates this file on every run by listing all `YYYY-MM/` prefixes in the bucket.

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
    │                         │                                               │
    │                         │── ListObjectsV2 (delimiter="/") ─────────────>│
    │                         │<── CommonPrefixes (YYYY-MM/) ────────────────│
    │                         │── PutObject index.json ──────────────────────>│
    │                         │<── 200 OK ────────────────────────────────────│
```

### 4.2 User Views Cost Report

```
Browser              CloudFront    S3 App    Cognito      Identity     S3 Data
                                             User Pool    Pool         Bucket
   │                     │          │           │            │            │
   │── GET / ───────────>│          │           │            │            │
   │                     │── read ─>│           │            │            │
   │<── index.html ──────│<── file ─│           │            │            │
   │                     │          │           │            │            │
   │ [SPA loads, Auth Module checks for valid token]                      │
   │                     │          │           │            │            │
   │── redirect ────────────────────────────────>│            │            │
   │<── Cognito login page ─────────────────────│            │            │
   │── credentials ─────────────────────────────>│            │            │
   │<── redirect with auth code ────────────────│            │            │
   │                     │          │           │            │            │
   │── exchange code ───────────────────────────>│            │            │
   │<── tokens (ID + access) ──────────────────│            │            │
   │                     │          │           │            │            │
   │ [Credentials Module: obtain temp AWS credentials]                    │
   │── GetId (ID token) ────────────────────────────────────>│            │
   │<── identityId ─────────────────────────────────────────│            │
   │── GetCredentialsForIdentity ───────────────────────────>│            │
   │<── AccessKeyId, SecretKey, SessionToken ───────────────│            │
   │                     │          │           │            │            │
   │── S3 GetObject index.json ──────────────────────────────────────────>│
   │<── {"periods": [...]} ──────────────────────────────────────────────│
   │                     │          │           │            │            │
   │── S3 GetObject {y}-{m}/summary.json ────────────────────────────────>│
   │<── summary JSON ────────────────────────────────────────────────────│
   │                     │          │           │            │            │
   │ [render 1-page report from summary.json]                             │
   │                     │          │           │            │            │
   │ [user clicks workload for drill-down]                                │
   │                     │          │           │            │            │
   │── DuckDB httpfs S3 (SET s3_* creds, then query) ───────────────────>│
   │   s3://{bucket}/{y}-{m}/cost-by-usage-type.parquet                   │
   │<── parquet bytes (range requests) ──────────────────────────────────│
   │                     │          │           │            │            │
   │ [DuckDB-wasm queries parquet, renders drill-down]                    │
```

### 4.3 Deployment

```
DevOps Engineer          Terraform           GitHub Releases       AWS
      │                      │                      │                │
      │── terraform init ───>│                      │                │
      │── terraform plan ───>│                      │                │
      │<── plan output ──────│                      │                │
      │── terraform apply ──>│                      │                │
      │                      │                      │                │
      │                      │── create S3 buckets (app, data, artifacts) ──>│
      │                      │── create CloudFront ────────────────────────>│
      │                      │── create Cognito + Identity Pool ──────────>│
      │                      │── create IAM roles ────────────────────────>│
      │                      │                      │                │
      │                      │── curl lambda.zip ──>│                │
      │                      │<── artifact ─────────│                │
      │                      │── aws s3 cp ──────────────────────────────>│
      │                      │   (to artifacts bucket)                    │
      │                      │                      │                │
      │                      │── curl spa.tar.gz ──>│                │
      │                      │<── artifact ─────────│                │
      │                      │── aws s3 cp ──────────────────────────────>│
      │                      │   (to artifacts bucket)                    │
      │                      │                      │                │
      │                      │── create Lambda (s3_bucket/s3_key) ───────>│
      │                      │── create EventBridge rule ────────────────>│
      │                      │                      │                │
      │                      │── download SPA from artifacts bucket ─────>│
      │                      │── extract + sync to app bucket ──────────>│
      │                      │── write config.json ─────────────────────>│
      │                      │── invalidate CloudFront ─────────────────>│
      │                      │<── all resources created ─────────────────│
      │<── apply complete ───│                      │                │
      │                      │                      │                │
      │ [output: CloudFront URL, Cognito details]                    │
```

### 4.4 Backfill Historical Data

```
DevOps Engineer          Lambda (handler)              Cost Explorer       S3 Data Bucket
      │                         │                            │                  │
      │── invoke with           │                            │                  │
      │   {"backfill":true,     │                            │                  │
      │    "months":13}  ──────>│                            │                  │
      │                         │                            │                  │
      │                         │ [generate list of 13 target months]           │
      │                         │                            │                  │
      │                         │── for each month:          │                  │
      │                         │   HeadObject summary.json ────────────────────>│
      │                         │<── 404 (not found) ───────────────────────────│
      │                         │                            │                  │
      │                         │   [month not yet collected — proceed]         │
      │                         │                            │                  │
      │                         │── collect_for_month() ────>│                  │
      │                         │   (queries CE for 3 periods)                  │
      │                         │<── cost data ──────────────│                  │
      │                         │                            │                  │
      │                         │── write_to_s3() ──────────────────────────────>│
      │                         │   (summary.json + parquet, index update off)  │
      │                         │                            │                  │
      │                         │   [repeat for remaining months]               │
      │                         │                            │                  │
      │                         │── update_index() ─────────────────────────────>│
      │                         │   (rebuild index.json once)                   │
      │                         │                            │                  │
      │<── {"statusCode":200,   │                            │                  │
      │     "succeeded":[...],  │                            │                  │
      │     "skipped":[...]}  ──│                            │                  │
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
│  │                 │       │  SPA assets │  │  Cost data +   │  │
│  │  HTTPS endpoint │       └──────▲──────┘  │  CORS enabled  │  │
│  │  (SPA only)     │             │ sync    └───────┬────────┘  │
│  └────────┬────────┘             │           ▲     │ direct    │
│           │              ┌───────┴────────┐  │     │ S3 access │
│           │              │  S3 Artifacts  │  │     │           │
│           │              │  Bucket        │  │PutOb│           │
│           │              │  lambda.zip +  │  │     │           │
│           │              │  spa.tar.gz    │  │     │           │
│           │              └───────┬────────┘  │     │           │
│           │                 s3_  │           │     │           │
│           │                 src  │           │     │           │
│  ┌────────┴────────┐  ┌─────────┴───┐  ┌────┴─────┴────────┐  │
│  │  Cognito        │  │  Cognito    │  │  Lambda Function    │  │
│  │  User Pool      │  │  Identity   │  │  (Python)           │  │
│  │  (existing or   │  │  Pool       │  │                     │  │
│  │   managed)      │  │             │  │  Cost Collector +   │  │
│  │                 │  │  IAM role:  │  │  Data Processor +   │  │
│  │  App Client +   │  │  s3:GetObj  │  │  Index Generator    │  │
│  │  opt. SAML/OIDC │  │  (data bkt) │  └─────────┬───────────┘  │
│  └─────────────────┘  └─────────────┘            │              │
│                                          ┌───────┴───────────┐  │
│                                          │  EventBridge       │  │
│                                          │  Scheduled Rule    │  │
│                                          │  (daily cron)      │  │
│                                          └───────────────────┘  │
│                                                                  │
│                                          ┌───────────────────┐  │
│                                          │  Cost Explorer API │  │
│                                          │  (AWS service)     │  │
│                                          └───────────────────┘  │
└──────────────────────────────────────────────────────────────────┘
```

The browser accesses S3 Data Bucket directly (CORS-enabled) using temporary credentials from the Identity Pool. CloudFront serves only SPA static assets from the App Bucket. The Artifacts Bucket stages release assets during deployment — Lambda deploys from S3, and the SPA is extracted and synced to the App Bucket.

**Deployable Artifacts:**

| Artifact | Content | Deployed To |
|----------|---------|-------------|
| `spa.tar.gz` | HTML, CSS, JS (compiled React app) | S3 Artifacts Bucket → extracted + synced to S3 App Bucket by Terraform |
| `lambda.zip` | Python code (deployment package) | S3 Artifacts Bucket → Lambda function deployed via S3 reference |
| `config.json` | Runtime configuration (Cognito domain, client ID, User Pool ID, Identity Pool ID, AWS region, data bucket name) | S3 App Bucket (written by Terraform) |
| Terraform module | HCL files | Executed by DevOps engineer |

When `release_version` is specified, `spa.tar.gz` and `lambda.zip` are downloaded from GitHub Releases and staged in a dedicated S3 artifacts bucket. The Lambda function is deployed directly from S3 using `s3_bucket`/`s3_key`/`s3_object_version`. The SPA is downloaded from the artifacts bucket, extracted, and synced to the app bucket. When not specified (local dev), they are built from source.

**Execution Nodes:**

| Node | Type | Purpose |
|------|------|---------|
| CloudFront | AWS managed CDN | Serve SPA static assets to users globally |
| S3 App Bucket | AWS managed object store | Host React SPA static assets |
| S3 Artifacts Bucket | AWS managed object store | Stage deployment artifacts (Lambda zip, SPA tarball) from GitHub Releases |
| S3 Data Bucket | AWS managed object store | Host pre-computed cost data (direct browser access via S3 SDK and httpfs) |
| Lambda | AWS managed serverless compute | Run cost data collection and index generation |
| Cognito User Pool | AWS managed identity (existing or managed) | User authentication (optional SAML/OIDC federation) |
| Cognito Identity Pool | AWS managed identity federation | Issue temporary scoped AWS credentials to authenticated users |
| EventBridge | AWS managed event bus | Schedule Lambda invocations |

---

## 6. Crosscutting Concepts

### 6.1 Data Flow and Pre-computation

Dapanoskop follows a **two-tier data pattern**:

1. **summary.json** — Pre-computed aggregates for the 1-page report. Small, fast to fetch, renders instantly.
2. **Parquet files** — Detailed cost data queryable via DuckDB-wasm for drill-down. Parquet's columnar format and DuckDB's HTTP range request support mean only the needed byte ranges are fetched, not the full file.

All data is collected and processed by the Lambda function (server-side, scheduled). The SPA never calls the Cost Explorer API. The SPA accesses pre-computed data from S3 using temporary, narrowly-scoped AWS credentials obtained via the Cognito Identity Pool.

The cost trend chart introduces a third access pattern: it fetches all available periods' summary.json files in parallel (up to 12 requests) to build a multi-month view. This is heavier than the single-period fetch but uses the same small summary.json files. The chart loads asynchronously after the initial report render (via `React.lazy`), so it does not block the primary report display.

This design:

- Enforces data access at the IAM level (server-side, not client-side token checks)
- Scopes browser credentials to `s3:GetObject` on the data bucket only
- Enables instant report loading via small summary.json
- Enables powerful drill-down via DuckDB-wasm + parquet without a backend API
- Reduces Cost Explorer API costs (queries happen once daily, not per user visit)

### 6.2 Labeling and Version Injection

The software version follows semantic versioning (SemVer) and is displayed in the footer of the web application after sign-in. Versioning is automated via conventional commits and semantic-release.

**Version injection mechanism**: The version is stored in the `version` field of the SPA's `package.json` and injected at build time via Vite's `define` config. The build process exposes `__APP_VERSION__` as a global constant that can be referenced in any component. A shared `<Footer>` component renders the version string. This approach ensures the displayed version always matches the release artifact without requiring runtime configuration or manual updates.

### 6.3 Usage Type Categorization

The usage type categorization logic (mapping AWS usage types to Storage / Compute / Other / Support) uses string pattern matching against known AWS usage type patterns. The categorization is applied during data processing in the Lambda function (C-2.2).

This categorization must be maintained as AWS introduces new usage types. Unknown usage types default to the "Other" category.

### 6.4 Security — IAM-Enforced Data Access

All authenticated users can access all cost data. The security model is:
1. The Lambda writes pre-computed data files to S3 (all cost centers in one dataset)
2. The SPA static assets are served via CloudFront + OAC (no direct app bucket access)
3. The SPA authenticates users via Cognito User Pool (OIDC + PKCE)
4. After authentication, the SPA exchanges the Cognito ID token for temporary AWS credentials via the Cognito Identity Pool (enhanced authflow)
5. These credentials are scoped to `s3:GetObject` on the data bucket only — enforced by IAM, not client-side logic
6. The data S3 bucket has no public access and no CloudFront origin — the only read path is via these temporary credentials
7. User management is handled via the Cognito User Pool console (existing pool), AWS CLI admin-create-user (managed pool), or automatically via IdP federation (SSO)

When using the managed pool, security hardening is applied by default: admin-only signup prevents unauthorized account creation, strong password policy, configurable MFA, token revocation, and optional advanced security (compromised credentials detection). When federation is active, local Cognito password login is disabled — users must authenticate through the external IdP.

This IAM-enforced model is stronger than the previous CloudFront-proxied approach because unauthenticated requests cannot reach the data at all (no public CloudFront path to the data bucket). See §7.7 for the design decision rationale.

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
cost_per_TB = total_storage_cost_usd / (total_storage_volume_bytes / 1_000_000_000_000)
```

Where `total_storage_volume_bytes` is derived from S3 `TimedStorage-*` usage quantities (and optionally EFS/EBS when configured). **AWS Cost Explorer returns these usage quantities in GB-hours, not byte-hours.** The conversion to average bytes stored is:

```
total_bytes = (GB-hours × 1_000_000_000) / hours_in_month
```

**Unit note**: The divisor is 10^12 (decimal terabytes, TB), not 2^40 (binary tebibytes, TiB). AWS Cost Explorer and billing use decimal units. Prior to v1.5.0, the constant incorrectly used 1,099,511,627,776 (TiB), causing a ~10% overstatement. The frontend `formatBytes` utility also aligns to decimal TB for display consistency.

**Bug fix note**: Prior to v1.6.0, the processor incorrectly treated GB-hours as byte-hours, producing storage volumes ~1 billion times too large and cost-per-TB values ~1 billion times too small. This was corrected by adding the GB→bytes conversion (multiply by 1e9) before dividing by hours.

### 6.7 Runtime Configuration

The SPA loads authentication configuration at runtime from `/config.json` (served from the S3 app bucket) rather than embedding values at build time via `VITE_*` environment variables. This decouples the SPA build artifact from the deployment environment, enabling the same pre-built tarball to be deployed to different AWS accounts with different Cognito configurations.

The `config.json` file is written to S3 by the Terraform hosting module (C-3.1) after extracting the SPA archive. It contains:

```json
{
  "cognitoDomain": "https://dapanoskop-myorg.auth.eu-west-1.amazoncognito.com",
  "cognitoClientId": "abc123...",
  "userPoolId": "eu-west-1_XXXXXXX",
  "identityPoolId": "eu-west-1:xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
  "awsRegion": "eu-west-1",
  "dataBucketName": "dapanoskop-data-xxxxxxxxxx"
}
```

The config module (`getConfig()`) fetches this file once via an async singleton. In local development, values fall back to `VITE_*` environment variables. The `authBypass` flag is derived from `VITE_AUTH_BYPASS=true` and is not present in the production config.json — when set, it bypasses authentication and uses local HTTP fetches instead of S3 SDK/Identity Pool.

### 6.8 Design System

The web application follows the Cytario design system (documented in `DESIGN.md`). Key design tokens:

- **Typography**: Self-hosted Montserrat variable font (`woff2-variations` format, weight range 200–900), loaded via `@font-face` in the SPA stylesheet. No external font CDN dependency.
- **Color palette**: Primary purple (`#6C2BD9`) and secondary teal (`#0D9488`), defined as Tailwind v4 `@theme` custom tokens (`--color-primary-*`, `--color-secondary-*`).
- **Visual patterns**: Gradient headers (`bg-cytario-gradient`), card hover effects (`hover:shadow-md`), and color-coded cost direction indicators (green for decreases, red for increases).

The design system is enforced through Tailwind utility classes using the custom color tokens. All components reference `primary-*` and `secondary-*` palette names rather than hard-coded color values.

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

### 7.5 Managed Cognito Pool vs. BYO-Only

#### 7.5.1 Issue
Should the Terraform module require an existing Cognito User Pool, or optionally create and manage one?

#### 7.5.2 Boundary Conditions
- Many deployers may not have a pre-existing Cognito User Pool
- Enterprise deployers need SSO integration (SAML/OIDC)
- The module should remain simple for the common case

#### 7.5.3 Assumptions
- Most new deployers prefer the module to handle authentication end-to-end
- Existing-pool users already have their own security settings

#### 7.5.4 Considered Alternatives

| Option | Pros | Cons |
|--------|------|------|
| **A: Optional managed pool (default) + BYO** | Lower barrier to entry; SSO support built-in; security-hardened defaults | More complex auth module; conditional resources |
| B: BYO pool only | Simpler module; no responsibility for pool security | Requires users to create and configure a pool manually |
| C: IAM Identity Center integration | Native AWS SSO; no Cognito needed | Complex, requires Organization-level permissions; limited browser token support |

#### 7.5.5 Decision
**Option A: Optional managed pool with BYO fallback**. The managed pool provides the simplest deployment path for new users while retaining backward compatibility. IAM Identity Center (Option C) was evaluated and rejected due to complexity, limited SPA token support, and overly broad Organization-level permissions.

### 7.6 Runtime Config vs. Build-Time Environment Variables

#### 7.6.1 Issue
How should the SPA obtain deployment-specific configuration (Cognito domain, client ID)?

#### 7.6.2 Boundary Conditions
- Self-contained deployment requires using a pre-built SPA artifact
- Build-time `VITE_*` env vars are baked into the JS bundle at build time
- Different deployments target different AWS accounts with different Cognito configs

#### 7.6.3 Assumptions
- A single SPA build artifact should work across any deployment environment
- The configuration values are not sensitive (public Cognito client ID, domain URL)

#### 7.6.4 Considered Alternatives

| Option | Pros | Cons |
|--------|------|------|
| **A: Runtime config.json fetched on load** | Same build artifact across environments; Terraform writes config at deploy time | Requires async fetch before auth; slightly more complex auth init |
| B: Build-time VITE_* env vars | Simple; standard Vite pattern | Requires building the SPA per environment; incompatible with release artifacts |
| C: Server-side rendering with env injection | Standard for SSR apps | Requires a server; contradicts the static SPA architecture |

#### 7.6.5 Decision
**Option A: Runtime config.json**. The async fetch adds minimal complexity (one HTTP request, cached by the singleton) and enables the self-contained deployment model where Terraform downloads and deploys pre-built artifacts. Build-time env vars are retained as a fallback for local development.

### 7.7 Direct S3 Access via Identity Pool vs. CloudFront Data Path

#### 7.7.1 Issue
How should the browser access cost data (JSON and parquet) stored in the data S3 bucket? The data must be accessible only to authenticated users.

#### 7.7.2 Boundary Conditions
- DuckDB-wasm httpfs requires direct HTTP(S) access to files (it cannot use CloudFront signed cookies due to browser cookie scope issues)
- CloudFront `custom_error_response` with 403→200 rewrite would expose all data publicly
- Lambda@Edge for cookie validation adds latency and complexity
- The data bucket must not have public access

#### 7.7.3 Assumptions
- Temporary credential lifetime (1 hour) is sufficient for typical user sessions
- Browser-originated S3 requests require CORS headers
- The number of concurrent users is small, so S3 direct access is acceptable (no CDN caching needed for data)

#### 7.7.4 Considered Alternatives

| Option | Pros | Cons |
|--------|------|------|
| A: CloudFront dual-origin with OAC | Simple; all traffic through CDN; caching | No auth enforcement on `/data/*` path — either fully public or requires Lambda@Edge; CloudFront 403→200 rewrite exposes all data; DuckDB cannot attach cookies to httpfs requests |
| B: CloudFront + signed cookies | Server-side enforcement via cookie validation | Lambda@Edge required for cookie exchange; DuckDB-wasm httpfs does not propagate cookies; cookie domain scoping issues with S3 origins |
| C: Presigned S3 URLs | Temporary, scoped URLs; no CORS needed | Must generate a URL per file; complex for DuckDB-wasm which reads parquet in multiple range requests; URL management overhead |
| **D: Cognito Identity Pool + direct S3 access** | IAM-enforced (server-side); works with both S3 SDK and DuckDB httpfs S3 protocol; no Lambda@Edge; least-privilege (`s3:GetObject` only) | Requires CORS on bucket; additional Cognito resource; temporary credentials in browser memory |

#### 7.7.5 Decision
**Option D: Cognito Identity Pool with direct S3 access**. This approach provides true server-side enforcement (IAM policy, not client-side token checks) and works natively with both the AWS S3 SDK (for JSON fetches) and DuckDB-wasm httpfs S3 protocol (for parquet queries). Options A and B were rejected because CloudFront cannot enforce authentication on the data path without Lambda@Edge, and DuckDB-wasm does not support cookies for httpfs requests. Option C was rejected because presigned URLs add management complexity for DuckDB-wasm, which issues multiple range requests per parquet file.

### 7.8 Dedicated Artifacts S3 Bucket vs. Local Files or App Bucket

#### 7.8.1 Issue
Where should release artifacts (Lambda zip, SPA tarball) be stored during and after deployment? The original approach downloaded artifacts to the local filesystem, but Terraform evaluates `filebase64sha256()` and `filemd5()` at plan time — before `local-exec` provisioners run at apply time — causing failures when the files don't yet exist.

#### 7.8.2 Boundary Conditions
- Terraform data functions (`filebase64sha256`, `filemd5`) execute at plan time
- `local-exec` provisioners execute at apply time (after plan)
- Lambda supports deployment from S3 via `s3_bucket`/`s3_key`/`s3_object_version`
- The app bucket is served via CloudFront and subject to `s3 sync --delete`
- Change detection must work reliably across plan/apply cycles

#### 7.8.3 Assumptions
- First apply will have data sources as "known after apply" (acceptable)
- Subsequent plans will resolve S3 data sources at plan time
- S3 versioning provides reliable change detection via `version_id`

#### 7.8.4 Considered Alternatives

| Option | Pros | Cons |
|--------|------|------|
| A: Local filesystem (original) | Simple; no additional resources | `filebase64sha256`/`filemd5` fail at plan time before files exist; artifacts lost on workspace cleanup |
| B: Reuse app bucket | No additional bucket | Artifacts exposed via CloudFront; `s3 sync --delete` during SPA deploy would delete the artifacts; mixing deployment and runtime concerns |
| **C: Dedicated artifacts S3 bucket** | Clean separation; no CloudFront exposure; no sync collision; S3 versioning enables reliable change detection; Lambda deploys directly from S3 | One additional S3 bucket |

#### 7.8.5 Decision
**Option C: Dedicated artifacts S3 bucket**. This avoids the plan-time/apply-time mismatch entirely by using S3 data sources (deferred on first apply, resolved at plan time thereafter). The dedicated bucket prevents CloudFront exposure of raw deployment artifacts and avoids collision with `s3 sync --delete` during SPA deployment. S3 object versions provide reliable change detection for both Lambda code updates and SPA redeployment.

### 7.9 Chart Library for Cost Trend Visualization

#### 7.9.1 Issue
Which charting library should be used to render the multi-period cost trend stacked bar chart?

#### 7.9.2 Boundary Conditions
- Must support stacked bar charts with tooltips and legends
- Must work in a React SPA (component-based API)
- Should be code-splittable (lazy-loadable) to avoid bloating the initial bundle
- The chart is read-only — no interactive editing or animation requirements

#### 7.9.3 Assumptions
- Only one chart type (stacked bar) is needed initially
- The dataset is small (up to 12 data points with 3-5 series)

#### 7.9.4 Considered Alternatives

| Option | Pros | Cons |
|--------|------|------|
| **A: Recharts** | React-native; declarative component API; good defaults for bar/stacked charts; responsive container; ~105 KB gzipped | Built on D3 internals; slightly larger than minimal options |
| B: Victory | React-native; flexible theming | Larger bundle; more complex API for simple use cases |
| C: Nivo | Beautiful defaults; React-native | Heavier; more dependencies; overkill for one chart |
| D: D3 (direct) | Maximum flexibility; smallest core size | Imperative API; requires manual React integration; much more code |

#### 7.9.5 Decision
**Option A: Recharts**. Its declarative React component API (`BarChart`, `Bar`, `XAxis`, etc.) aligns with the existing component architecture and requires minimal code for a stacked bar chart. The ~105 KB gzipped bundle is mitigated by code-splitting via `React.lazy`. D3 was rejected because the imperative API would require significantly more code for a single chart type.

---

## 8. Change History

| Version | Date       | Author | Description       |
|---------|------------|--------|-------------------|
| 0.1     | 2026-02-08 | —      | Initial draft     |
| 0.2     | 2026-02-10 | —      | Align with implementation: period discovery, Lambda deployment, auth config |
| 0.3     | 2026-02-12 | —      | Add managed Cognito pool (C-3.2), SAML/OIDC federation, artifacts module (C-3.5), runtime config (§6.7), design decisions 7.5–7.6 |
| 0.4     | 2026-02-13 | —      | Replace CloudFront data path with Cognito Identity Pool + direct S3 access; add C-1.3 Credentials Module; DuckDB httpfs S3 protocol; index.json manifest; S3 CORS; IAM-enforced data access (§6.4, §7.7); S3 lifecycle policies (§3.3.1, §3.3.4) |
| 0.5     | 2026-02-13 | —      | Replace local artifact download with dedicated S3 artifacts bucket; C-3.5 now creates bucket and uploads artifacts; C-3.3 Lambda deployed from S3; C-3.1 SPA synced from artifacts bucket; S3 version-based change detection; new design decision §7.8 |
| 0.6     | 2026-02-14 | —      | Add backfill mode (SDS-DP-020103, 020208, §4.4); CSP updated with wasm-unsafe-eval and self-hosted fonts (SDS-DP-030101); CORS updated with amz-sdk-* headers (SDS-DP-030402); cost center prefix stripping (SDS-DP-020102); Cytario design system (§6.8) |
| 0.7     | 2026-02-15 | —      | Add multi-period cost trend chart: useTrendData hook (SDS-DP-010207), CostTrendChart component (SDS-DP-010208), Recharts library decision (§7.9), update data flow documentation (§6.1) |
| 0.8     | 2026-02-15 | —      | Add version injection mechanism (SDS-DP-010209, §6.2), shared Header/Footer components (SDS-DP-010210, 010211), InfoTooltip component (SDS-DP-010212), responsive breakpoints (SDS-DP-010213), 3-month moving average trend line (SDS-DP-010208 update); document TB (10^12) vs TiB (2^40) correction in cost per TB calculation (SDS-DP-020203, §6.6) |
| 0.9     | 2026-02-15 | —      | Bug fix documentation: Clarify AWS Cost Explorer returns GB-hours (not byte-hours) for TimedStorage-* usage quantities; document GB→bytes conversion formula (SDS-DP-020203, §6.6); add self-hosted DuckDB WASM bundle deployment via Vite copy plugin (SDS-DP-010206) |
| 0.10    | 2026-02-15 | —      | Phase 2 enhancements: Change trendline color from gray to pink-700 for improved contrast (SDS-DP-010208); enrich InfoTooltip content with formulas, interpretation guidance, and optimization suggestions (SDS-DP-010212); add dynamic storage service tooltip generation in StorageOverview (SDS-DP-010204); extend local dev period discovery from 13 to 36 months with parallel probing (SDS-DP-010201) |
| 0.11    | 2026-02-15 | —      | Phase 3 enhancements: Add time range toggle to cost trend chart (SDS-DP-010208 update); add clickable cost center name navigation (SDS-DP-010202 update); add cost center detail route, trend data fetching, and page layout (SDS-DP-010214, 010215, 010216); update responsive breakpoints documentation (SDS-DP-010213) |
