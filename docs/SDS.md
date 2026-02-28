# Software Design Specification (SDS) — Dapanoskop

| Field               | Value                                      |
|---------------------|--------------------------------------------|
| Document ID         | SDS-DP                                     |
| Product             | Dapanoskop (DP)                            |
| System Type         | Non-regulated Software                     |
| Version             | 0.22 (Draft)                               |
| Date                | 2026-02-28                                 |

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

**MTD default selection**: After reading `index.json`, the Report Renderer identifies the default reporting period as the most recently completed month. The first entry in `index.json` (the current month) is the MTD period and is detected by inspecting the `is_mtd` field of its summary.json, or by comparing the period string to the current calendar month. The default period is set to the first entry in `index.json` whose `is_mtd` flag is `false` (i.e., the most recently completed month). The MTD period is selectable but not the default, consistent with SRS-DP-310501. When the MTD period is selected, the Report Renderer reads the `is_mtd` field from the fetched summary.json and passes it as a prop to layout components, which conditionally render the MTD indicator banner (SRS-DP-310219).
Refs: SRS-DP-310201, SRS-DP-310211, SRS-DP-310219, SRS-DP-430102, SRS-DP-310501

**[SDS-DP-010202] Render Cost Center Cards**
The Report Renderer renders each cost center as an expandable card with summary (total, MoM, YoY, workload count, top mover) from summary.json. The cost center name is rendered as a `<Link to={/cost-center/${encodeURIComponent(name)}?period=${period}}>` component, navigating to the cost center detail page while preserving the current reporting period. The workload breakdown table is rendered within the expanded card.
Refs: SRS-DP-310201, SRS-DP-310202, SRS-DP-310203, SRS-DP-310212

**[SDS-DP-010203] Render Workload Table**
The Report Renderer renders the workload breakdown table from summary.json, with workloads sorted by current month cost descending and MoM/YoY deltas included.
Refs: SRS-DP-310204, SRS-DP-310205

**[SDS-DP-010204] Render Storage Metrics with Dynamic Tooltips and Navigation**
The Report Renderer renders total storage cost, cost per TB, and hot tier percentage from the pre-computed summary.json. The `StorageOverview` component accepts a `storageConfig` prop (from `summary.json`) and a `period` prop. It dynamically generates tooltip text reflecting which storage services are included (e.g., "S3 only" or "S3, EFS, and EBS"). Tooltips include calculation formulas, interpretation guidance, and optimization suggestions. The "Storage Cost" metric card is rendered as a clickable `<Link to={/storage-cost?period=${period}}>` that navigates to the storage cost breakdown detail page while preserving the current reporting period.
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

**[SDS-DP-010217] Render Storage Deep Dive Route** (Removed)
This component has been removed. The storage deep dive route (`/storage`) providing per-bucket breakdown is not implemented in the current S3 Storage Lens CloudWatch-only integration. The `StorageLens` type replaces `StorageInventory` in the summary.json schema, and the frontend displays only organization-wide totals (no per-bucket table).
Refs: SRS-DP-310307

**[SDS-DP-010218] Render Split Charge Badge and Allocated Label**
The `CostCenterCard` component conditionally renders a "Split Charge" badge (gray background, small text) next to the cost center name when `costCenter.is_split_charge` is true. When a split charge category is detected, the card displays "Allocated" (in gray, small font) instead of the current cost amount, and replaces MoM/YoY change rows with explanatory text: "Costs allocated to other cost centers". This visual distinction prevents confusion about zero-dollar cost centers whose costs are redistributed to other categories.
Refs: SRS-DP-310201

**[SDS-DP-010219] Render Storage Cost Breakdown Route**
The Report Renderer includes a dedicated route component at `/storage-cost` (route file: `routes/storage-cost-detail.tsx`) for displaying a breakdown of storage costs by usage type across all workloads. The route reads the period from the query string via `useSearchParams()` and follows the same authentication pattern as other detail routes. The component fetches the summary.json for context (storage metrics, periods), then initializes DuckDB-wasm and queries the `cost-by-usage-type.parquet` file with a `WHERE category = 'Storage'` filter, sorted by `cost_usd DESC`. The query returns columns: `workload`, `usage_type`, `category`, `period`, `cost_usd`, `usage_quantity`. The component renders the shared `<Header>` and `<Footer>` components, a back link to the main report (`<Link to={/?period=${period}}>`), a page heading "Storage Cost Breakdown", two summary cards showing total storage cost and MoM change from summary.json, and a lazy-loaded `<UsageTypeTable>` component displaying the query results. The table displays all storage usage types across all workloads, providing a cross-workload view of storage cost drivers. The route is registered in `routes.ts` as `route("storage-cost", "routes/storage-cost-detail.tsx")`.
Refs: SRS-DP-310206, SRS-DP-430102

**[SDS-DP-010220] Render Storage Tier Breakdown Route**
The Report Renderer includes a dedicated route component at `/storage-detail` (route file: `routes/storage-detail.tsx`) for displaying storage volume distribution across S3 storage tiers (S3 Standard, Intelligent-Tiering access tiers, Glacier tiers, etc.). The route is accessed by clicking the "Total Stored" card in the StorageOverview component, which passes the current period as a query parameter. The component reads the period from the query string via `useSearchParams()` and follows the same authentication pattern as other detail routes. The component fetches the summary.json for context (storage metrics, periods), then initializes DuckDB-wasm and queries the `cost-by-usage-type.parquet` file with a `WHERE usage_type LIKE '%TimedStorage%'` filter, grouped by `usage_type` and sorted by `usage_quantity DESC`. The query returns columns: `usage_type`, `gb_months` (sum of usage_quantity), `cost_usd`. The component maps AWS usage type suffixes (e.g., "TimedStorage-ByteHrs", "TimedStorage-INT-FA-ByteHrs") to friendly tier names ("S3 Standard", "IT Frequent Access") using a predefined mapping. The component renders the shared `<Header>` and `<Footer>` components, a back link to the main report, three summary cards showing Total Stored (from Storage Lens), Hot Tier %, and Cost/TB (all sourced from summary.json), a pie chart (Recharts `<PieChart>`) showing tier distribution by volume with color-coded segments (warm-to-cool palette matching hot-to-cold tiers), and a table displaying tier name, volume (formatted GB or TB), cost, and percentage of total. The route is registered in `routes.ts` as `route("storage-detail", "routes/storage-detail.tsx")`. This feature provides tier-level drill-down; per-bucket detail (URS-DP-10313) remains deferred.
Refs: SRS-DP-310207, SRS-DP-310208, SRS-DP-310217

**[SDS-DP-010221] Render Like-for-Like MTD Change Annotations**
The Report Renderer conditionally renders like-for-like MTD change annotations when the selected period is the MTD period (i.e., when the fetched `summary.json` has `is_mtd: true`) and when the `mtd_comparison` field is present. The annotations replace the standard MoM change display across all components that show per-cost-center or per-workload change figures (global summary bar, cost center cards, workload table rows). The rendering logic is as follows:

- **Annotation source**: The `prior_partial_cost_usd` value for each cost center and workload is read from `summary.json.mtd_comparison.cost_centers[*]` and its `.workloads[*]` arrays, matched by `name` field.
- **Delta computation**: `delta_usd` = `current_cost_usd` − `prior_partial_cost_usd`; `delta_pct` = `delta_usd / prior_partial_cost_usd × 100` (if `prior_partial_cost_usd` > 0, otherwise displayed as "N/A").
- **Display format**: Same combined format as standard MoM (e.g., "+$800 (+5.6%)"), using the same color-coded direction indicators (SRS-DP-310210).
- **Comparison label**: A helper `formatPartialPeriodLabel(start: string, endExclusive: string): string` constructs a human-readable label from `mtd_comparison.prior_partial_start` and `mtd_comparison.prior_partial_end_exclusive` (e.g., `"Jan 1–7"` when start=`"2026-01-01"` and end_exclusive=`"2026-01-08"`). This label is rendered as a tooltip or inline annotation (e.g., "vs. Jan 1–7").
- **YoY suppression**: When `is_mtd` is `true`, the YoY change column/row is replaced with "N/A (MTD)" to avoid displaying a full-year comparison against a partial current period.
- **Fallback**: If `mtd_comparison` is absent from the fetched summary.json (e.g., data was written by an older pipeline version), the component falls back to the standard full-month MoM display using `prev_month_cost_usd`, consistent with prior SRS-DP-310219 behavior.

The `is_mtd` flag and the `mtd_comparison` object are passed as props down the component tree from the top-level page component (which fetches summary.json) to `GlobalSummary`, `CostCenterCard`, and `WorkloadTable`.
Refs: SRS-DP-310219, SRS-DP-310220

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
┌────────────────────────────────────────────────────────┐
│               SS-2: Data Pipeline                      │
│                                                        │
│  ┌─────────────┐  ┌───────────────────┐  ┌─────────┐  │
│  │  C-2.1      │  │  C-2.2            │  │  C-2.3  │  │
│  │  Cost       │  │  Data Processor   │  │  Storage│  │
│  │  Collector  │  │  & Writer         │  │  Lens   │  │
│  │             │  │                   │  │  Reader │  │
│  │  Queries CE │  │  Categorizes,     │  │  Reads  │  │
│  │  API +      │  │  aggregates,      │  │  S3     │  │
│  │  split chg  │  │  writes JSON      │  │  Storage│  │
│  │             │  │                   │  │  Lens   │  │
│  └─────────────┘  └───────────────────┘  └─────────┘  │
│                                                        │
└────────────────────────────────────────────────────────┘
```

##### 3.2.1 C-2.1: Cost Collector

**Purpose / Responsibility**: Queries the AWS Cost Explorer API to retrieve raw cost and usage data for three completed reporting periods: the most recently completed month, the month before that, and the same month of the previous year.

**Interfaces**:
- **Inbound**: Invoked by the Data Processor (C-2.2) or directly by the Lambda handler
- **Outbound**: AWS Cost Explorer `GetCostAndUsage` API

**Variability**: GroupBy dimensions are fixed (TAG:App + USAGE_TYPE). The Cost Category name is configurable (defaults to the first one returned by the API).

**[SDS-DP-020101] Query Cost Explorer for Current MTD Period and Comparison Periods**
The Cost Collector queries `GetCostAndUsage` for five time periods on each normal daily invocation: (1) the current in-progress calendar month (the MTD period — from the first day of the current month to today exclusive), (2) the prior month's equivalent partial period (same day range as the MTD window, from the first day of the prior month to the same day-of-month exclusive — see SDS-DP-020210 for the date computation), (3) the most recently completed calendar month (for MoM comparison and as a standalone selectable period), (4) the month before that (for further MoM comparison), and (5) the same month of the previous year (for YoY comparison). Each query uses `MONTHLY` granularity and requests `UnblendedCost` and `UsageQuantity` metrics, grouped by App tag and USAGE_TYPE (2 GroupBy dimensions, within the CE API limit).

**MTD period generation**: In normal daily invocation (no `target_year`/`target_month` parameters), the `_get_periods()` function returns the current calendar month as the primary period using a time range `[first_day_of_current_month, today)`. The MTD period's summary.json is written under the `{current_year}-{current_month}/` prefix and always appears as the first (most recent) entry in `index.json`. Because the month is in progress, the figures will change on each subsequent daily run until the month ends.

**Month transition**: When the month ends and the first daily run of the new month executes, the former MTD period (`{year}-{month}/summary.json`) is overwritten with the full completed-month data and the `is_mtd` flag is set to `false`. A new MTD entry is simultaneously created for the newly started month. This transition is seamless — the S3 prefix for the former MTD period does not change, only its content and metadata.

**Backfill interaction**: When the backfill handler (`_generate_backfill_months()`) generates its target month list, it starts from the current calendar month and works backwards N months, consistent with normal MTD collection. Backfill runs behave the same as daily runs for the current month — they write or overwrite the MTD entry. The prior month's equivalent partial period query (SDS-DP-020210) is only executed for the current in-progress month (backfill months for past periods are already complete and do not require like-for-like partial comparison).
Refs: SRS-DP-420101, SRS-DP-420102, SRS-DP-420109, SRS-DP-420110

**[SDS-DP-020102] Query Cost Category Mapping and Detect Split Charges**
The Cost Collector queries the configured AWS Cost Category (by name, or the first one returned by `GetCostCategories` if not configured) to obtain the mapping of workloads (App tag values) to cost centers. The AWS CE API returns cost category group keys with the format `{CategoryName}${Value}` (e.g., `CostCenter$IT`). The collector strips the `{CategoryName}$` prefix to extract the clean cost center name. Resources without an App tag (empty string key) are mapped to the label "Untagged" during this step. Additionally, the collector calls `ListCostCategoryDefinitions` and `DescribeCostCategoryDefinition` to identify cost categories with split charge rules (indicated by the presence of `SplitChargeRules` array in the definition). For each detected split charge category, the collector queries category-level allocated costs using `GetCostAndUsage` with `GroupBy: [{"Type": "COST_CATEGORY", "Key": "{CategoryName}"}]` and metric `NetAmortizedCost` for all three periods. The `get_split_charge_categories()` function returns `tuple[list[str], list[dict]]` — the first element is the list of split charge cost center names, the second is the list of split charge rule objects. Each rule object contains: `Source` (string — the source cost center name), `Targets` (list of strings — destination cost center names, or the string `"ALL_OTHER"` to target all remaining cost centers), `Method` (string — `"PROPORTIONAL"`, `"EVEN"`, or `"FIXED"`), and `Parameters` (list of dicts — present only for `"FIXED"` method, each with `"Key"` and `"Value"` sub-fields where Key is the target cost center name and Value is the percentage allocation as a string). This mapping and split charge rule data are passed to the data processor (C-2.2) to allocate workload costs to cost centers, apply redistributions, and correctly handle split charge categories.
Refs: SRS-DP-420103, SRS-DP-420107

**[SDS-DP-020103] Support Parameterized Period Generation**
The Cost Collector supports generating target periods for an arbitrary month (specified by year and month) in addition to the default "current month" logic. This enables the backfill handler to request data for any historical month using the same collection logic.
Refs: SRS-DP-420106

**[SDS-DP-020210] Compute Prior Month's Equivalent Partial Period**
The Cost Collector computes the date range for the prior month's equivalent partial period using the following algorithm, implemented in a `_get_prior_partial_period(mtd_start, mtd_end_exclusive)` helper:

1. `prior_month_start` = first day of the month before `mtd_start` (e.g., if `mtd_start` is `2026-03-01`, `prior_month_start` = `2026-02-01`).
2. `mtd_days` = number of days in the MTD window = (`mtd_end_exclusive` − `mtd_start`).days (e.g., MTD covers March 1–7 → 7 days).
3. `prior_partial_end_exclusive` = `prior_month_start` + `timedelta(days=mtd_days)`. This represents the same number of days into the prior month as the MTD window covers in the current month.
4. **Clamping**: If `prior_partial_end_exclusive` would fall beyond the last day of the prior month (i.e., the prior month is shorter than the MTD window's day count), clamp it to the first day of the current month. This prevents invalid or cross-month date ranges when, for example, today is March 30 and the prior month is February (28 days).

The computed `(prior_month_start, prior_partial_end_exclusive)` pair is passed to `GetCostAndUsage` as `TimePeriod.Start` and `TimePeriod.End`. Both queries (workload/usage-type with `UnblendedCost`, and cost-center with `NetAmortizedCost`) use this same time range. The `_get_periods()` function includes the prior partial period alongside the other periods in its return value, clearly labeled (e.g., as `prev_month_partial`) so the processor can identify it for storage in the `mtd_comparison` summary.json field (SDS-DP-020211).
Refs: SRS-DP-420110

##### 3.2.2 C-2.2: Data Processor & Writer

**Purpose / Responsibility**: Processes raw Cost Explorer responses, categorizes usage types, computes aggregates (totals, storage metrics, comparisons), and writes structured JSON files to S3.

**Interfaces**:
- **Inbound**: Raw Cost Explorer response data from C-2.1
- **Outbound**: Summary JSON and parquet files written to S3 via `PutObject`

**[SDS-DP-020201] Categorize Usage Types**
The Data Processor categorizes each AWS usage type into Storage, Compute, Other, or Support by matching the usage type string against known patterns.
Refs: SRS-DP-420105

**[SDS-DP-020202] Apply Cost Category Mapping and Handle Split Charges**
The Data Processor applies the Cost Category mapping from C-2.1 to assign each workload's cost to a cost center. Workloads not matched by any Cost Category rule are grouped under a default label. When split charge categories are detected (C-2.1), the processor calls `_apply_split_charge_redistribution()` (see below) to adjust the allocated costs for the `current` and `prev_month` periods only. The `yoy` period's allocated costs are used as-is from the AWS CE API response. This avoids applying current-period split charge rules (which may differ in method or percentages from those in force 12 months ago) to historical allocations — the CE API's `NetAmortizedCost` for the YoY period already reflects the historically-correct allocation for that year. Each period then independently gates on its own allocated costs dict: if the cost center name is present as a key in that period's allocated dict, the processor uses the allocated value; otherwise it falls back to summing that period's workload costs. This per-period gate is essential — when the YoY (or `prev_month`) period predates the Cost Category definition, the CE API returns sentinel keys like `"No cost category"` instead of real cost center names, and the fallback to workload sums produces correct totals rather than $0. The gate resolves both scenarios: a period with no matching cost center keys correctly uses workload sums, and a period with matching keys uses the CE-returned allocated value directly. For split charge categories, the processor sets `is_split_charge: true` in the cost center entry and zeroes out the displayed cost amounts (`current_cost_usd`, `prev_month_cost_usd`, `yoy_cost_usd`) to prevent double-counting, since their costs are already included in other categories' allocated totals. The Global Summary total explicitly excludes split charge categories to avoid inflating the overall spend figure.

**`_apply_split_charge_redistribution(allocated_costs, split_charge_rules)`**

This helper is called by the processor before cost center lookup for the `current` and `prev_month` periods. It applies each split charge rule to the `allocated_costs` dict for a single period, redistributing the source cost center's amount among target cost centers according to the rule method. The function snapshots the original input costs internally so that each rule reads pre-redistribution source amounts — this matches AWS Cost Categories semantics where rule weights are based on the original source, not post-redistribution values. Returns a new dict with redistributed values; the input is not mutated.

Supported methods:

- `PROPORTIONAL` — distributes the source cost to each target in proportion to the target's current value in `allocated_costs`. If all target values are zero, falls back to `EVEN` distribution to avoid division by zero.
- `EVEN` — distributes the source cost equally across all targets. If no targets exist, no redistribution is performed.
- `FIXED` — distributes the source cost to each named target according to the percentage specified in the rule's `Parameters` list (Key = target name, Value = percentage string). If `Parameters` is absent or malformed (empty list, missing keys), falls back to `EVEN` distribution.

The `"ALL_OTHER"` target sentinel is resolved before method dispatch: it expands to all cost center names in `allocated_costs` that are not the source and not explicitly named in the other targets of the same rule.
Refs: SRS-DP-420103, SRS-DP-420107

**[SDS-DP-020203] Compute Storage Volume and Hot Tier Metrics**
The Data Processor computes total storage volume from S3 `TimedStorage-*` usage quantities and calculates the hot tier percentage as: `(TimedStorage-ByteHrs + TimedStorage-INT-FA-ByteHrs) / total TimedStorage-*-ByteHrs`. Usage type matching uses substring checks (`in` for storage volume, `endswith` for hot tier) rather than exact match or prefix match, because AWS Cost Explorer returns usage types with region prefixes (e.g. `USE1-TimedStorage-ByteHrs`, `EUW1-TimedStorage-INT-FA-ByteHrs`). EFS/EBS types are checked first (via `EFS:` / `EBS:` substring) to prevent false matches when EFS types contain "TimedStorage" in their name (e.g. `EFS:TimedStorage-ByteHrs`). When configured, EFS and EBS storage usage types are included in the totals. **AWS Cost Explorer returns `UsageQuantity` for TimedStorage-* in GB-hours, not byte-hours.** The processor converts GB-hours to average bytes stored by multiplying by 1,000,000,000 (bytes per GB) and then dividing by the number of hours in the reporting month. The processor uses decimal terabytes (TB = 10^12 bytes) for all volume conversions, consistent with AWS Cost Explorer and billing practices. Note: Prior to v1.5.0, the constant `_BYTES_PER_TB` incorrectly used tebibytes (TiB = 2^40 = 1,099,511,627,776) instead of terabytes, causing a ~10% overstatement in cost per TB values. This was corrected to 1,000,000,000,000 (10^12). Prior to v1.6.0, the processor incorrectly treated GB-hours as byte-hours, producing storage volumes ~1 billion times too large and cost-per-TB values ~1 billion times too small.
Refs: SRS-DP-420104

**[SDS-DP-020204] Write Summary JSON with Storage Lens Data and MTD Comparison**
The Data Processor writes `{year}-{month}/summary.json` containing pre-computed aggregates for the 1-page report: cost center totals (current, prev month, YoY), workload breakdown per cost center (sorted by cost descending, with MoM/YoY), storage metrics (total cost, cost/TB, hot tier %), a `collected_at` ISO 8601 timestamp, and optionally a `storage_lens` object containing organization-wide storage data from C-2.3 when Storage Lens integration is configured. The `storage_lens` object includes: `total_bytes` and `storage_lens_date` (timestamp from CloudWatch metric). Cost centers with `is_split_charge: true` are included in the `cost_centers` array but excluded from global summary calculations. When `is_mtd` is `true`, the processor additionally writes an `mtd_comparison` object (SDS-DP-020211) containing cost center and workload totals for the prior month's equivalent partial period, plus the `prior_partial_start` and `prior_partial_end_exclusive` date strings that define the comparison range. The `mtd_comparison` field is omitted from completed-month summary.json files.
Refs: SRS-DP-430101, SRS-DP-510002, SRS-DP-420108, SRS-DP-420110

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
The Lambda handler detects backfill mode via the event payload `{"backfill": true, "months": N, "force": false}`. In backfill mode, the handler generates a list of N target months (ending at the current month), processes each sequentially by invoking `collect()` (C-2.1) with explicit `target_year`/`target_month` parameters and `write_to_s3()` (C-2.2) per month with index updates suppressed. Before processing each month, the handler checks whether data already exists in S3 (by probing for `{year}-{month}/summary.json`) and skips existing months unless `force` is true. The current in-progress month is always included in the backfill target list and is treated the same as any other target month — it will be written regardless of the `force` flag when no existing entry is found, or skipped if one exists and `force` is false. After all months are processed, the handler calls `update_index()` once to rebuild the period manifest. The response includes a multi-status report: `{"statusCode": 200|207, "succeeded": [...], "failed": [...], "skipped": [...]}`.
Refs: SRS-DP-420106

**[SDS-DP-020209] Overwrite MTD Period on Each Daily Run**
The normal daily Lambda handler (non-backfill invocation) always overwrites the current month's data files in S3, regardless of whether they already exist. The existence check (`HeadObject summary.json`) that applies to backfill mode does not apply to normal daily runs — daily runs unconditionally call `collect()` for the current in-progress month and write the result to `{current_year}-{current_month}/summary.json`, `cost-by-workload.parquet`, and `cost-by-usage-type.parquet`. The `write_to_s3()` call for the MTD period sets `is_mtd=True` in the summary.json payload (see SDS-DP-040002). After writing the MTD period data, the handler writes the most recently completed month's data (as a non-MTD entry), then calls `update_index()` to ensure the MTD period is listed first in `index.json`. Both the MTD period and the most recently completed month are written on every normal daily run; a single daily invocation therefore produces two writes to S3 (plus the index update).
Refs: SRS-DP-420102, SRS-DP-420109

**[SDS-DP-020211] Compute and Write MTD Comparison Aggregates**
The Data Processor computes cost center and workload totals for the prior month's equivalent partial period (SDS-DP-020210) using the same categorization, Cost Category mapping, and split charge redistribution logic applied to the normal comparison periods. The resulting aggregates are stored in a top-level `mtd_comparison` object in the MTD period's `summary.json` (see SDS-DP-040002 for schema). The `mtd_comparison` object records the exact date range that was queried (`prior_partial_start` and `prior_partial_end_exclusive` as ISO 8601 date strings) so the SPA can display a human-readable comparison label (e.g., "vs. Feb 1–7"). The `mtd_comparison` field is only written when `is_mtd` is `true`; completed-month summary.json files do not contain this field. When the clamping logic of SDS-DP-020210 applies (prior month is shorter), the stored date range reflects the clamped end date, and the SPA renders the label accordingly.
Refs: SRS-DP-420110, SRS-DP-310220

##### 3.2.3 C-2.3: Storage Lens Reader

**Purpose / Responsibility**: Queries S3 Storage Lens CloudWatch metrics to obtain actual total storage volume (in bytes) for the organization.

**Interfaces**:
- **Inbound**: Invoked by the Lambda handler when `STORAGE_LENS_CONFIG_ID` environment variable is set (optional — auto-discovers if empty)
- **Outbound**: S3 Control API (`ListStorageLensConfigurations`, `GetStorageLensConfiguration`) for discovery; CloudWatch API (`GetMetricData`) to query `AWS/S3/Storage-Lens` namespace

**Variability**: Storage Lens configuration ID is optional at deploy time via Terraform variable. When not configured, the component auto-discovers the first available organization-level configuration. When no Storage Lens configs exist, this component is skipped.

**[SDS-DP-020301] Discover Storage Lens Configuration**
The Storage Lens Reader queries `ListStorageLensConfigurations` to find available configurations. When `STORAGE_LENS_CONFIG_ID` is provided, the reader validates it exists by calling `GetStorageLensConfiguration`. When no ID is provided, the reader selects the first organization-level configuration (scope type `Organization`) from the list. If no organization-level configs exist, the reader logs a warning and returns no data (storage metrics fall back to Cost Explorer).
Refs: SRS-DP-420108

**[SDS-DP-020302] Query CloudWatch Storage Metrics**
For the discovered or configured Storage Lens config, the reader queries the CloudWatch `AWS/S3/Storage-Lens` namespace for the `StorageBytes` metric using dimensions: `{configuration_id: <config_id>, storage_class: AllStorageClasses}`. The query uses a 14-day time window ending at the first day of the month after the target period (e.g. for period 2025-12, queries 2025-12-18 to 2026-01-01), using `Average` statistic and 1-day period granularity. The 14-day window accounts for Storage Lens data publication lag while anchoring to the correct reporting period. Both normal mode and backfill mode pass the target period's year/month to ensure period-appropriate storage volumes. The metric returns the total storage volume in bytes across all S3 storage classes for the organization.
Refs: SRS-DP-420108

**[SDS-DP-020303] Return Organization-Wide Storage Volume**
The Storage Lens Reader returns a single aggregate value: `{"total_bytes": int, "storage_lens_date": "YYYY-MM-DDTHH:MM:SSZ"}`. The timestamp is derived from the CloudWatch datapoint timestamp. No per-bucket breakdown is provided (CloudWatch-only integration provides organization-wide totals only).
Refs: SRS-DP-420108

### 3.3 SS-3: Terraform Module

**Purpose / Responsibility**: Provides a single Terraform module that provisions all AWS resources needed for a complete Dapanoskop deployment.

**Interfaces**:
- **Inbound**: Terraform input variables from the deployer
- **Outbound**: Provisions AWS resources (S3 buckets, CloudFront distribution, Cognito User Pool or app client on existing pool, optional SAML/OIDC federation, Lambda function, EventBridge rule, IAM roles)

**Variability**: Configurable via Terraform variables (domain name, Cost Category name (optional, defaults to first), existing Cognito User Pool ID (optional — managed pool created if omitted), federation settings (SAML/OIDC), MFA configuration, schedule, storage services to include, S3 Inventory integration (optional inventory bucket and prefix), resource tags (applied to all resources via provider default_tags), IAM permissions boundary (optional ARN), release version, etc.). When `var.tags` is set (non-empty map), the AWS provider applies those tags automatically to all taggable resources created by the module and its sub-modules via the `default_tags` block.

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

**[SDS-DP-030202] Create Managed Cognito User Pool with Managed Login v2**
When `cognito_user_pool_id` is empty, the module creates a Cognito User Pool (`count`-conditional) with: email as username, admin-only user creation, 14-character password policy, configurable MFA with software TOTP, deletion protection, verified email recovery, and optional advanced security (ENFORCED mode). A Cognito domain is created using the configured domain prefix with `managed_login_version = 2`, enabling the new Hosted UI (Managed Login v2). A `aws_cognito_managed_login_branding` resource is created with default branding settings tied to the app client. All existing user sessions are invalidated when upgrading from v1 to v2.
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

**[SDS-DP-030207] Provision IAM Role for Authenticated Users with Optional Permissions Boundary**
The module creates an IAM role with an `AssumeRoleWithWebIdentity` trust policy restricted to the Identity Pool (`cognito-identity.amazonaws.com:aud` = pool ID, `amr` = `authenticated`). An inline policy grants only `s3:GetObject` on the data bucket. The role is attached to the Identity Pool as the default authenticated role. If `var.permissions_boundary` is set, the specified permissions boundary ARN is attached to the role via the `permissions_boundary` attribute.
Refs: SRS-DP-450101, SRS-DP-520003, SRS-DP-530004

##### 3.3.3 C-3.3: Pipeline Infrastructure

**Purpose / Responsibility**: Provisions the Lambda function for cost data collection, its IAM role (with Cost Explorer and S3 permissions), and the EventBridge scheduled rule.

**[SDS-DP-030301] Provision Lambda, IAM Role, and Schedule with Storage Lens Support**
The module creates a Lambda function (Python runtime) from a packaged deployment artifact, an IAM role with permissions for `ce:GetCostAndUsage`, `ce:GetCostCategories`, `ce:ListCostCategoryDefinitions`, `ce:DescribeCostCategoryDefinition` (for split charge detection), `s3:PutObject` (to the data bucket), `s3:ListBucket` (on the data bucket for index.json generation), `s3control:ListStorageLensConfigurations`, `s3control:GetStorageLensConfiguration` (for Storage Lens discovery), `cloudwatch:GetMetricData` (for querying Storage Lens metrics), and an EventBridge rule to trigger the Lambda on a daily schedule.
When S3 artifact references are provided (from C-3.5), the Lambda function is deployed using `s3_bucket`, `s3_key`, and `s3_object_version` — an `s3_object_version` change triggers a Lambda code update. Otherwise, the Lambda is packaged from the local source directory via Terraform's `archive_file` data source and deployed using `filename` and `source_code_hash`. The Lambda IAM role optionally includes a permissions boundary (via `var.permissions_boundary`) if configured. Environment variables include `DATA_BUCKET`, `COST_CATEGORY_NAME`, `INCLUDE_EFS`, `INCLUDE_EBS`, and `STORAGE_LENS_CONFIG_ID` (the latter optional — auto-discovers if empty). Memory: 256 MB. Timeout: 5 minutes. EventBridge schedule: `cron(0 6 * * ? *)` (daily at 06:00 UTC).
Refs: SRS-DP-510002, SRS-DP-520002, SRS-DP-530001, SRS-DP-430103, SRS-DP-420107, SRS-DP-420108, SRS-DP-530004

##### 3.3.4 C-3.4: Data Store Infrastructure

**Purpose / Responsibility**: Provisions a dedicated S3 data bucket for cost data storage, separate from the app bucket.

**[SDS-DP-030401] Provision Data Bucket**
The module creates a dedicated S3 bucket for cost data with versioning enabled and server-side encryption (SSE-S3 or SSE-KMS). The bucket has no bucket policy granting CloudFront access — authenticated browser users access data directly using temporary IAM credentials from the Identity Pool (C-3.2).
Refs: SRS-DP-430101, SRS-DP-430102

**[SDS-DP-030403] Data Bucket Lifecycle Policy**
The data bucket has a lifecycle configuration that aborts incomplete multipart uploads after 1 day, expires obsolete delete markers, and transitions objects to S3 Intelligent-Tiering after 5 days. Intelligent-Tiering automatically moves infrequently accessed historical data to lower-cost tiers without retrieval fees or latency penalties. Archive tiers are not configured (omitting `aws_s3_intelligent_tiering_configuration`), so objects remain instantly accessible. No `NoncurrentVersionExpiration` is applied — all versioned data is retained indefinitely to preserve rollback capability.
Refs: SRS-DP-510003

**[SDS-DP-030402] Configure S3 CORS for Browser Access**
The module configures CORS on the data bucket allowing `GET` and `HEAD` methods from the CloudFront distribution origin. Allowed headers include `Authorization`, `Range`, `x-amz-*`, `amz-sdk-*`, and `x-host-override`. The `amz-sdk-*` pattern is required because AWS SDK v3 sends `amz-sdk-invocation-id` and `amz-sdk-request` headers that do not match the `x-amz-*` prefix. The `x-host-override` header is required by DuckDB-wasm's HTTP adapter, which renames the forbidden browser `Host` header to `X-Host-Override` for SigV4 request signing (S3 ignores this header, but CORS preflight must allow it). Without these headers, S3 returns 403 without CORS headers, which browsers report as CORS errors. Exposed headers include `Content-Length`, `Content-Range`, and `ETag`. Max age: 300 seconds.
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
                                 # The current in-progress month is always the first entry.
{year}-{month}/
  summary.json                   # Pre-computed aggregates for instant 1-page render
                                 # Contains is_mtd: true when the period is in progress.
  cost-by-workload.parquet       # Detailed workload cost data for all 3+ periods
  cost-by-usage-type.parquet     # Detailed usage type cost data for all 3+ periods
```

The current in-progress calendar month is always present as the first entry in `index.json` and is overwritten on every daily pipeline run. Its `summary.json` contains `"is_mtd": true`. Completed-month entries have `"is_mtd": false` (or the field absent, which is treated as `false`).

Refs: SRS-DP-430101, SRS-DP-430102, SRS-DP-430103, SRS-DP-420109

**[SDS-DP-040002] summary.json Schema**

The `is_mtd` field indicates whether the reporting period is the current in-progress calendar month. When `true`, the SPA displays an MTD indicator and labels the period "MTD" in the period selector. When `false` (or absent), the period is a completed month and is labeled with its abbreviated month name.

The `mtd_comparison` field is present only when `is_mtd` is `true`. It contains pre-computed cost center and workload totals for the prior month's equivalent partial period (same number of days into the prior month as the MTD window covers in the current month), enabling the SPA to render like-for-like change annotations without additional API calls. The `prior_partial_start` and `prior_partial_end_exclusive` fields (ISO 8601 date strings) record the exact date range queried so the SPA can construct human-readable comparison labels.

```json
{
  "collected_at": "2026-02-08T03:00:00Z",
  "period": "2026-02",
  "is_mtd": true,
  "periods": {
    "current": "2026-02",
    "prev_month": "2026-01",
    "yoy": "2025-02"
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
    },
    {
      "name": "SharedServices",
      "current_cost_usd": 0.00,
      "prev_month_cost_usd": 0.00,
      "yoy_cost_usd": 0.00,
      "is_split_charge": true,
      "workloads": []
    }
  ],
  "tagging_coverage": {
    "tagged_cost_usd": 14000.00,
    "untagged_cost_usd": 1000.00,
    "tagged_percentage": 93.3
  },
  "storage_lens": {
    "total_bytes": 5500000000000,
    "storage_lens_date": "2026-01-31T23:00:00Z"
  },
  "mtd_comparison": {
    "prior_partial_start": "2026-01-01",
    "prior_partial_end_exclusive": "2026-01-08",
    "cost_centers": [
      {
        "name": "Engineering",
        "prior_partial_cost_usd": 3200.00,
        "workloads": [
          {
            "name": "data-pipeline",
            "prior_partial_cost_usd": 1100.00
          }
        ]
      },
      {
        "name": "SharedServices",
        "prior_partial_cost_usd": 0.00,
        "is_split_charge": true,
        "workloads": []
      }
    ]
  }
}
```

Refs: SRS-DP-430101, SRS-DP-430102, SRS-DP-420110

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
    │                         │ [collect MTD period]       │                  │
    │                         │── GetCostAndUsage ────────>│                  │
    │                         │   (current month MTD,      │                  │
    │                         │    GroupBy: App + USAGE_TYPE)                 │
    │                         │<── response ───────────────│                  │
    │                         │                            │                  │
    │                         │ [collect prior partial     │                  │
    │                         │  period for like-for-like  │                  │
    │                         │  MTD comparison]           │                  │
    │                         │── GetCostAndUsage ────────>│                  │
    │                         │   (prior month same date   │                  │
    │                         │    range as MTD window,    │                  │
    │                         │    GroupBy: App + USAGE_TYPE)                 │
    │                         │<── response ───────────────│                  │
    │                         │── GetCostAndUsage ────────>│                  │
    │                         │   (prior month same range, │                  │
    │                         │    GroupBy: COST_CATEGORY, │                  │
    │                         │    metric: NetAmortizedCost)                  │
    │                         │<── response ───────────────│                  │
    │                         │                            │                  │
    │                         │── GetCostAndUsage ────────>│                  │
    │                         │   (prev month complete,    │                  │
    │                         │    same GroupBy)           │                  │
    │                         │<── response ───────────────│                  │
    │                         │── GetCostAndUsage ────────>│                  │
    │                         │   (YoY month, same)        │                  │
    │                         │<── response ───────────────│                  │
    │                         │                            │                  │
    │                         │ [apply CC mapping,         │                  │
    │                         │  categorize, aggregate,    │                  │
    │                         │  compute storage metrics,  │                  │
    │                         │  compute mtd_comparison,   │                  │
    │                         │  set is_mtd=true]          │                  │
    │                         │                            │                  │
    │                         │── PutObject ──────────────────────────────────>│
    │                         │   {y}-{cur_m}/summary.json (is_mtd: true,     │
    │                         │     mtd_comparison: {...}) │                  │
    │                         │   {y}-{cur_m}/cost-by-workload.parquet        │
    │                         │   {y}-{cur_m}/cost-by-usage-type.parquet      │
    │                         │                                               │
    │                         │ [collect most recently completed month]       │
    │                         │── GetCostAndUsage ────────>│                  │
    │                         │   (prev complete month,    │                  │
    │                         │    GroupBy: App + USAGE_TYPE)                 │
    │                         │<── response ───────────────│                  │
    │                         │── GetCostAndUsage ────────>│                  │
    │                         │   (month before that)      │                  │
    │                         │<── response ───────────────│                  │
    │                         │── GetCostAndUsage ────────>│                  │
    │                         │   (YoY month, same)        │                  │
    │                         │<── response ───────────────│                  │
    │                         │                            │                  │
    │                         │ [apply CC mapping,         │                  │
    │                         │  categorize, aggregate,    │                  │
    │                         │  compute storage metrics,  │                  │
    │                         │  set is_mtd=false]         │                  │
    │                         │                            │                  │
    │                         │── PutObject ──────────────────────────────────>│
    │                         │   {y}-{prev_m}/summary.json (is_mtd: false)   │
    │                         │   {y}-{prev_m}/cost-by-workload.parquet       │
    │                         │   {y}-{prev_m}/cost-by-usage-type.parquet     │
    │                         │                                               │
    │                         │── ListObjectsV2 (delimiter="/") ─────────────>│
    │                         │<── CommonPrefixes (YYYY-MM/) ────────────────│
    │                         │── PutObject index.json ──────────────────────>│
    │                         │   (current month first, then prev months)     │
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
      │                         │── collect() ──────────────>│                  │
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
- **S3 Standard** (usage types ending with `TimedStorage-ByteHrs`)
- **S3 Intelligent-Tiering Frequent Access** (usage types ending with `TimedStorage-INT-FA-ByteHrs`)
- **EFS Standard** (when configured to include EFS)
- **EBS gp2/gp3/io1/io2** (when configured to include EBS)

**Region prefix handling**: AWS Cost Explorer returns usage types with region prefixes (e.g. `USE1-TimedStorage-ByteHrs`, `EUW1-TimedStorage-INT-FA-ByteHrs`). The hot tier check uses `endswith()` matching and storage volume detection uses substring matching (`"TimedStorage" in usage_type`) to handle these prefixes correctly.

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

**Storage Lens recalculation**: When S3 Storage Lens data is available (C-2.3), the handler recalculates `cost_per_tb_usd` using `storage_lens_total_bytes` as the volume denominator instead of the CE-derived GB-Months value. This is more accurate because Storage Lens reflects actual storage volume, whereas the CE-derived volume may undercount due to region-prefixed usage types or other billing artifacts.

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

### 7.10 S3 Storage Lens Integration: CloudWatch-Only vs. Inventory vs. Hybrid

#### 7.10.1 Issue
How should Dapanoskop obtain actual storage volume data (in bytes) to supplement cost-derived storage metrics? The goal is to validate that storage cost metrics reflect real usage and help identify storage optimization opportunities.

#### 7.10.2 Boundary Conditions
- AWS provides two mechanisms for storage visibility: S3 Inventory (object-level manifest files) and S3 Storage Lens (aggregate CloudWatch metrics)
- S3 Inventory delivers detailed per-bucket, per-object data but requires setup (destination bucket, prefix configuration) and has delivery latency (up to 48 hours)
- S3 Storage Lens provides organization-wide aggregate metrics via CloudWatch with minimal setup (auto-discoverable) but no per-bucket breakdown in the free tier
- The Lambda must query data during daily execution (not user request time)
- Per-bucket breakdown was a nice-to-have feature, not a core requirement

#### 7.10.3 Assumptions
- Organization-wide storage totals are sufficient for validating cost-per-TB calculations
- Per-bucket investigation can be performed via the AWS Console or CLI when needed
- Minimizing deployment complexity and user configuration is valuable

#### 7.10.4 Considered Alternatives

| Option | Pros | Cons |
|--------|------|------|
| **A: S3 Storage Lens CloudWatch-only** | Auto-discoverable (no user config required); native AWS integration; no additional S3 storage cost; simple IAM permissions (s3control:*, cloudwatch:GetMetricData) | Organization-wide totals only (no per-bucket breakdown); requires Organization-level Storage Lens config |
| B: S3 Inventory only | Per-bucket and per-object detail; no CloudWatch dependency | Requires user to configure Inventory (bucket + prefix); delivery latency (up to 48h); additional S3 storage cost; more complex IAM (s3:GetObject on inventory bucket, s3:ListBucket for manifest discovery); CSV parsing complexity |
| C: Hybrid (Storage Lens + Inventory) | Best of both: org-wide totals + per-bucket detail | Most complex setup; requires both Storage Lens and Inventory configuration; highest IAM permission footprint; two data sources to reconcile |

#### 7.10.5 Decision
**Option A: S3 Storage Lens CloudWatch-only**. Auto-discovery eliminates user configuration burden (deployment friction), CloudWatch metrics are native AWS integration (no CSV parsing or S3 storage costs), and organization-wide totals are sufficient for the primary use case (validating cost-per-TB calculations). Per-bucket investigation (URS-DP-10313) is deferred — users can access per-bucket data via the AWS Console S3 Storage Lens dashboard or CLI when needed. Options B and C were rejected because Inventory requires additional user configuration (bucket/prefix setup, lifecycle policies) and adds complexity (manifest discovery, CSV parsing, S3 storage costs) for a feature that is not core to the cost monitoring workflow. The storage deep dive page (`/storage`) with per-bucket table is removed from the UI.

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
| 0.12    | 2026-02-16 | —      | Add S3 Inventory Reader component (C-2.3, SDS-DP-020301-020303); storage inventory in summary.json schema (SDS-DP-040002 update); split charge detection (SDS-DP-020102 update); allocated costs handling (SDS-DP-020202 update); storage inventory in summary writer (SDS-DP-020204 update); storage deep dive route (SDS-DP-010217); split charge badge rendering (SDS-DP-010218); Cognito Managed Login v2 (SDS-DP-030202 update); IAM permissions boundary on roles (SDS-DP-030207, 030301 updates); inventory IAM permissions (SDS-DP-030301 update); resource tags via provider default_tags (§3.3 variability update); x-host-override CORS header (SDS-DP-030402 update) |
| 0.13    | 2026-02-16 | —      | Replace S3 Inventory with S3 Storage Lens CloudWatch integration: rename C-2.3 to "Storage Lens Reader" (§3.2.3 title update); rewrite SDS-DP-020301-020303 for Storage Lens discovery and CloudWatch query; update summary.json schema (SDS-DP-040002: storage_lens replaces storage_inventory); update summary writer (SDS-DP-020204); update IAM permissions (SDS-DP-030301: add s3control:*, cloudwatch:GetMetricData, remove s3:GetObject/ListBucket on inventory bucket); remove storage deep dive route (SDS-DP-010217 marked removed); add design decision §7.10 explaining Storage Lens option selection |
| 0.14    | 2026-02-17 | —      | Bug fix batch: region-prefixed usage type matching for hot tier and storage volume (SDS-DP-020203, §6.5); period-aware Storage Lens time windowing (SDS-DP-020302); cost_per_tb recalculation using Storage Lens volume (§6.6); allocated costs fallback to workload sums when cost center name not in allocated dict (SDS-DP-020202) |
| 0.15    | 2026-02-17 | —      | Phase 2 Storage Cost Breakdown: Add storage cost detail route (SDS-DP-010219); update StorageOverview to render Storage Cost card as clickable link with period param (SDS-DP-010204 update) |
| 0.16    | 2026-02-17 | —      | Phase 3 Storage Tier Breakdown: Add storage tier breakdown route (SDS-DP-010220); update StorageOverview to render Total Stored card as clickable link with period param (SDS-DP-010204 update) |
| 0.17    | 2026-02-19 | —      | Document dual-metric architecture and split charge redistribution logic: update SDS-DP-020102 to document `split_charge_rules` list structure, updated `get_split_charge_categories()` return type `tuple[list[str], list[dict]]`, and "Untagged" mapping for empty App tags; update SDS-DP-020202 to document `_apply_split_charge_redistribution()` function including PROPORTIONAL/EVEN/FIXED methods, ALL_OTHER sentinel resolution, zero-target and malformed-parameter fallback behaviors, and that rules are evaluated against original source costs (not post-redistribution values) |
| 0.18    | 2026-02-27 | —      | Clarify completed-months-only scope constraint: update SDS-DP-020101 to document that normal daily pipeline runs always resolve the primary period to the previous complete calendar month (never the current in-progress month), explain the backfill exception (backfill includes current month as starting point and may write an incomplete MTD entry), and note the downstream effect on the period selector (SRS-DP-310501) |
| 0.19    | 2026-02-27 | —      | Add MTD as a supported feature: rewrite SDS-DP-020101 to describe `_get_periods()` returning the current in-progress month as primary period plus three comparison periods; add SDS-DP-020209 (daily MTD overwrite logic); add `is_mtd` field to SDS-DP-040002 summary.json schema; update SDS-DP-040001 data layout to note MTD is always the first index.json entry; update SDS-DP-010201 to document MTD default-selection logic and `is_mtd` prop propagation to layout components; update SDS-DP-020208 backfill to note current month handled consistently; update §4.1 sequence diagram to show MTD + completed-month writes on each daily run |
| 0.20    | 2026-02-27 | —      | Add like-for-like MTD comparison: update SDS-DP-020101 to include 5th query (prior month partial period); add SDS-DP-020210 (prior partial period date computation algorithm); add SDS-DP-020211 (processor writes mtd_comparison aggregates); update SDS-DP-020204 (summary writer includes mtd_comparison when is_mtd); update SDS-DP-040002 (summary.json schema adds mtd_comparison with prior_partial_start, prior_partial_end_exclusive, cost_centers); add SDS-DP-010221 (SPA renders like-for-like annotations, suppresses YoY for MTD, falls back gracefully); update §4.1 sequence diagram to show prior partial period queries |
| 0.21    | 2026-02-28 | —      | Correct function name references: rename `collect_for_month()` to `collect()` in SDS-DP-020208, SDS-DP-020209, and §4.1 backfill sequence diagram to match the actual implementation in `collector.py` |
| 0.22    | 2026-02-28 | —      | Bug fix documentation: update SDS-DP-020202 to specify that (1) `_apply_split_charge_redistribution()` is called for `current` and `prev_month` periods only — the `yoy` period's AWS CE allocated costs are used as-is because they already reflect that year's allocation and re-applying current-period rules would double-redistribute; (2) each period independently gates on its own allocated costs dict so that a `yoy` or `prev_month` period predating the Cost Category definition correctly falls back to workload sums rather than returning $0; (3) corrected `_apply_split_charge_redistribution` signature to 2-argument form `(allocated_costs, split_charge_rules)` — the stale `source_costs` third parameter is removed, internal snapshotting replaces it |
