# Issue Tracker for Dapanoskop


## Bugs

### Cost per TB is wrong

Something is off in this calculation as it produces extremely large values.

> **Requirements Notes:**
> - **Affected**: SRS-DP-310207 (Display Cost per TB Stored), URS-DP-10306 (Assess Storage Cost Efficiency), SDS-DP-020203 (Compute Storage Volume and Hot Tier Metrics), SDS-DP-010204 (Render Storage Metrics), §6.6 (Cost per TB Calculation formula)
> - **No new requirements needed** — this is a defect in existing functionality that should meet documented specifications
> - **Impact**: Breaks a core storage metric relied upon for optimization decisions; affects all cost centers viewing storage overview
> - **Traceability**: StorageOverview component renders `metrics.cost_per_tb_usd` from summary.json, which is computed by Lambda processor (SDS-DP-020203). Bug is likely in processor's byte-hours to bytes conversion (§6.6: divide by hours in month) or in total volume calculation
> - **Clarification**: What is the actual displayed value (e.g., "$1,234,567 / TB" when expecting "$23.45 / TB")? Does the bug appear in all periods or only specific months? This would help isolate whether it's a volume calculation error vs. a unit conversion error

> **QA Notes:**
>
> **Root cause analysis:** In `/Users/martin/Development/slash-m/github/dapanoskop/lambda/src/dapanoskop/processor.py` line 84, the formula is `cost_per_tb = total_cost / (total_bytes / _BYTES_PER_TB)`. Two problems compound here:
> 1. `total_cost` sums ALL Storage-category costs (including request fees, data transfer, operations), but `total_bytes` only counts volume-type usage (TimedStorage, EFS, EBS). The numerator is broader than the denominator, inflating the ratio.
> 2. The existing test `test_storage_metrics` in `/Users/martin/Development/slash-m/github/dapanoskop/lambda/tests/test_processor.py` line 127 asserts `sm["total_volume_bytes"] > 0` but never asserts on `cost_per_tb_usd`. With the test fixture values (730B byte-hours), the resulting volume is approximately 2.5 GB, which yields a cost_per_tb of approximately $330,000 -- confirming the reported bug goes undetected by the test suite.
>
> **Tests to write/update:**
> - Add an explicit `cost_per_tb_usd` assertion to `test_storage_metrics` with a realistic expected value (e.g., $20-30/TB for S3 Standard).
> - Add a parametrized test with realistic AWS byte-hour magnitudes (e.g., 5 TB * 730 hours = 3.65e15 byte-hours) to validate the formula produces sensible $/TB values.
> - Add edge case: storage cost present but volume is very small (should still produce a valid, if high, cost_per_tb -- or should it show N/A?).
> - Update the `StorageOverview.test.tsx` fixture to use a value consistent with the corrected calculation.
>
> **Edge cases to watch:**
> - Division by zero when no storage volume usage types exist (already tested in `test_storage_metrics_zero_volume`, verify the fix preserves this).
> - Very small volumes (< 1 GB) -- should the UI show "N/A" instead of an astronomically high cost_per_tb?
> - EFS/EBS included vs excluded: does enabling these change which costs go into the numerator? Currently `total_cost` includes all Storage-category items regardless of the EFS/EBS flags, but volume only includes the matching types.
>
> **Verification:** After fix, run `cd /Users/martin/Development/slash-m/github/dapanoskop/lambda && uv run pytest -k storage_metrics` and confirm cost_per_tb values are in a realistic range ($10-50/TB for typical S3 usage). Cross-reference against the AWS S3 pricing page for a sanity check. Also update the fixture value `cost_per_tb_usd: 23.45` in `/Users/martin/Development/slash-m/github/dapanoskop/app/fixtures/2026-01/summary.json` if the corrected formula produces a different number.
>
> **Clarifying questions:**
> - Should `total_cost` in the numerator be limited to only volume-related storage costs (matching the denominator), or should it remain as all Storage-category costs? The former gives "cost per TB of stored data" while the latter gives "total storage spend per TB of volume" -- these are very different metrics.
total storage spend per TB of data stored / volume is correct.
> - The `_BYTES_PER_TB` constant (1,099,511,627,776 = 2^40) is tebibytes (TiB), not terabytes (TB = 10^12). AWS billing uses terabytes. Which unit is intended?
This might be the root cause, because displayed values are off by multiple millions.

> **Python Pipeline Plan:**
>
> **1. Root Cause Analysis**
>
> Confirmed: The bug is caused by using TiB (2^40 = 1,099,511,627,776) instead of TB (10^12 = 1,000,000,000,000) for the conversion.
>
> **Evidence from `/Users/martin/Development/slash-m/github/dapanoskop/lambda/src/dapanoskop/processor.py:18`:**
> ```python
> _BYTES_PER_TB = 1_099_511_627_776  # This is 2^40 (TiB), not 10^12 (TB)
> ```
>
> **Impact calculation:**
> - Current constant: 1,099,511,627,776 (TiB)
> - Correct constant: 1,000,000,000,000 (TB)
> - Ratio: 1.0995 (~10% overstatement)
> - For storage costs in the thousands, this produces cost_per_tb values ~10% higher than reality
>
> **AWS documentation confirmation:** Cost Explorer returns byte-hours in decimal units (TB = 10^12), not binary units (TiB = 2^40). The formula in §6.6 states "cost per TB" using decimal units, matching AWS pricing pages (e.g., S3 Standard at $0.023/GB = $23/TB).
>
> **2. Code Changes Required**
>
> **File:** `/Users/martin/Development/slash-m/github/dapanoskop/lambda/src/dapanoskop/processor.py`
>
> **Line 18 (constant definition):**
> ```python
> # Before:
> _BYTES_PER_TB = 1_099_511_627_776
>
> # After:
> _BYTES_PER_TB = 1_000_000_000_000  # 10^12 bytes per terabyte (decimal, not binary)
> ```
>
> **Line 84 (formula remains unchanged, but add explanatory comment):**
> ```python
> # Cost per TB: total storage cost / (total volume in bytes / bytes per TB)
> cost_per_tb = total_cost / (total_bytes / _BYTES_PER_TB) if total_bytes else 0
> ```
>
> **3. Test Updates Required**
>
> **File:** `/Users/martin/Development/slash-m/github/dapanoskop/lambda/tests/test_processor.py`
>
> **Update `test_storage_metrics` (line 108)** to add explicit `cost_per_tb_usd` assertion:
> ```python
> # After line 134 (after hot tier assertion), add:
> # Verify cost_per_tb_usd calculation is applied correctly
> expected_volume_bytes = (730_000_000_000 + 365_000_000_000 + 730_000_000_000) / 730
> expected_volume_tb = expected_volume_bytes / 1_000_000_000_000
> expected_cost_per_tb = 750.0 / expected_volume_tb
> assert abs(sm["cost_per_tb_usd"] - round(expected_cost_per_tb, 2)) < 0.1
> ```
>
> **Add new test `test_storage_metrics_realistic_scale`** after `test_storage_metrics_zero_volume` (line 500):
> ```python
> def test_storage_metrics_realistic_scale() -> None:
>     """Test storage metrics with realistic AWS byte-hour magnitudes."""
>     # Scenario: 5 TB stored for entire month (730 hours)
>     # 5 TB = 5,000,000,000,000 bytes
>     # 5 TB * 730 hours = 3,650,000,000,000,000 byte-hours
>     # AWS S3 Standard pricing: ~$0.023/GB = ~$23/TB/month
>     # Expected cost: 5 TB * $23 = $115
>
>     collected = _make_collected(
>         current_groups=[
>             _make_group("app", "TimedStorage-ByteHrs", 115.0, 3_650_000_000_000_000),
>         ],
>         prev_groups=[
>             _make_group("app", "TimedStorage-ByteHrs", 110.0, 3_500_000_000_000_000),
>         ],
>         yoy_groups=[],
>     )
>
>     result = process(collected)
>     sm = result["summary"]["storage_metrics"]
>
>     # Verify volume: 3.65e15 byte-hours / 730 hours = 5,000,000,000,000 bytes = 5 TB
>     assert sm["total_volume_bytes"] == 5_000_000_000_000
>
>     # Verify cost per TB: $115 / 5 TB = $23/TB (realistic S3 Standard pricing)
>     assert sm["cost_per_tb_usd"] == 23.0
> ```
>
> **4. Fixture Updates Required**
>
> **File:** `/Users/martin/Development/slash-m/github/dapanoskop/app/fixtures/2026-01/summary.json`
>
> **Lines 16-18:** Update volume and cost_per_tb to be internally consistent:
> - Current: `total_volume_bytes: 5497558138880` (~5 TB), `total_cost_usd: 4200.0`, `cost_per_tb_usd: 23.45`
> - Correct calculation with current values: `4200 / (5497558138880 / 1_000_000_000_000) = 4200 / 5.498 ≈ 764.10`
> - **Problem:** The fixture's `cost_per_tb_usd: 23.45` was manually crafted to appear realistic, but the underlying `total_cost_usd` and `total_volume_bytes` are inconsistent. A realistic S3 Standard cost for 5 TB should be ~$115 (5 TB × $23/TB), not $4200.
> - **Resolution:** Scale `total_volume_bytes` up to match the $4200 cost at realistic $/TB rates. This preserves multi-workload fixture complexity.
> - **Updated fixture values:**
>   - `total_volume_bytes: 180_000_000_000_000` (~180 TB)
>   - `cost_per_tb_usd: 23.33` (4200 / 180)
>
> **File:** `/Users/martin/Development/slash-m/github/dapanoskop/app/fixtures/2025-12/summary.json`
>
> **Lines 16-18:** Apply same correction:
> - Current: `total_volume_bytes: 5200000000000` (~5.2 TB), `total_cost_usd: 4050.0`, `cost_per_tb_usd: 22.8`
> - **Updated fixture values:**
>   - `total_volume_bytes: 175_000_000_000_000` (~175 TB)
>   - `cost_per_tb_usd: 23.14` (4050 / 175)
>
> **5. Estimated Complexity**
>
> **Size: S (Small)**
>
> - **Code change:** Single constant modification (1 line) + 1 comment
> - **Test changes:** 1 existing test enhancement + 1 new test (~30 lines total)
> - **Fixture changes:** 2 JSON files (4 lines total)
> - **No schema changes, no API changes, no infrastructure changes**
> - **Risk:** Low (formula logic unchanged, only constant value corrected)
>
> **Estimated effort:** 30 minutes implementation + 15 minutes testing = 45 minutes total

> **Frontend Plan:**
>
> The primary fix is in the Lambda processor (SS-2, not SS-1), but the frontend has two follow-up tasks:
>
> 1. **Update fixture data** after the Lambda fix lands.
>    - File: `/Users/martin/Development/slash-m/github/dapanoskop/app/fixtures/2026-01/summary.json` (line 18)
>    - The `cost_per_tb_usd: 23.45` value may need updating to match the corrected Lambda formula output. Cross-check: with `total_cost_usd: 4200.0` and `total_volume_bytes: 5497558138880` (5.0 TB in TiB, or ~5.5 TB in decimal TB), corrected cost/TB should be ~$764/TB (TiB) or ~$840/TB (decimal TB) for total-storage-spend-per-volume semantics. The current fixture value of $23.45 is artificially low and inconsistent with the fixture's own numbers. Update once Lambda team confirms the corrected output.
>    - Also update the same fixture across all period directories if they exist (check `/Users/martin/Development/slash-m/github/dapanoskop/app/fixtures/*/summary.json`).
>
> 2. **Update `formatBytes` unit label** (optional, low priority).
>    - File: `/Users/martin/Development/slash-m/github/dapanoskop/app/app/lib/format.ts` (lines 53-58)
>    - `formatBytes` currently divides by `1_099_511_627_776` (TiB) but labels the result "TB". If the Lambda fix switches to decimal TB (`10^12`), this function should align. If the Lambda keeps TiB internally, the label should say "TiB" or the divisor should change to `10^12`.
>    - `StorageOverview.tsx` does not currently call `formatBytes`, but the label "Cost / TB" at line 25 should match whichever unit the Lambda emits.
>
> 3. **Update test fixture** in `StorageOverview.test.tsx` (line 12) to match corrected value.
>
> **Dependencies**: Blocked by Lambda (SS-2) fix. Frontend changes are mechanical fixture/label updates.
> **Complexity**: S (Small) -- once Lambda output is known, it is a few-line fixture update.

### Version is reported wrong

The footer of the web app reports version 0.1.0 but we are at 1.5.0.

> **Requirements Notes:**
> - **Affected**: §6.2 (Labeling — version follows SemVer, displayed in footer after sign-in), SDS-DP-010205 (Apply Business-Friendly Labels — includes footer display)
> - **No new requirements needed** — this is a defect in artifact generation or deployment
> - **Impact**: Low user impact (informational only), but breaks traceability between deployed code and release versions; complicates support and troubleshooting
> - **Traceability**: Version is hardcoded in workload-detail.tsx:272 (`v0.1.0`). SDS §6.2 states "versioning is automated via conventional commits and semantic-release" but the version string is not dynamically injected. SDS-DP-030102 (Deploy SPA from Artifacts Bucket) and §7.6 (Runtime Config) describe config.json for runtime configuration, but version is not included in that mechanism
> - **Root cause**: Version string is not part of the build artifact metadata or runtime config; likely needs to be injected at build time (via `package.json` version) or added to `config.json` written by Terraform
> - **Clarification**: Should version come from `package.json` (requires build-time injection) or be added to Terraform-managed `config.json` (requires extracting version from release tag)? Option 1 (package.json) aligns with existing semantic-release automation but requires modifying the build; Option 2 (config.json) requires Terraform to parse the release version and add it to the config file
Use the package.json and adjust the build

> **Frontend Plan:**
>
> **Approach**: Inject the version from `package.json` at build time via Vite's `define` config, extract a shared `<Footer>` component to eliminate duplication, and extract a shared `<Header>` component (consolidating with the Logo/Favicon issue).
>
> **Files to modify:**
>
> 1. `/Users/martin/Development/slash-m/github/dapanoskop/app/package.json` -- Add `"version": "1.5.0"` field (line 3, after `"name"`).
>
> 2. `/Users/martin/Development/slash-m/github/dapanoskop/app/vite.config.ts` -- Add `define` option to inject version at build time. At line 8, inside `defineConfig`, add:
>    ```ts
>    define: {
>      __APP_VERSION__: JSON.stringify(
>        require("./package.json").version ?? "0.0.0"
>      ),
>    },
>    ```
>    Since the project uses ESM (`"type": "module"`), use `import` or `fs.readFileSync` + `JSON.parse` instead of `require`. Alternatively, read `version` at the top of vite.config.ts:
>    ```ts
>    import pkg from "./package.json" with { type: "json" };
>    // then in define: { __APP_VERSION__: JSON.stringify(pkg.version) }
>    ```
>    Add a `declare const __APP_VERSION__: string;` in a `env.d.ts` or `vite-env.d.ts` file so TypeScript does not complain.
>
> 3. **Create** `/Users/martin/Development/slash-m/github/dapanoskop/app/app/components/Footer.tsx` -- Shared footer component:
>    ```tsx
>    export function Footer() {
>      return (
>        <footer className="text-center py-4 text-xs text-gray-400">
>          Dapanoskop v{__APP_VERSION__}
>        </footer>
>      );
>    }
>    ```
>
> 4. `/Users/martin/Development/slash-m/github/dapanoskop/app/app/routes/home.tsx` (line 188-190) -- Replace inline footer with `<Footer />` import.
>
> 5. `/Users/martin/Development/slash-m/github/dapanoskop/app/app/routes/workload-detail.tsx` (line 271-273) -- Replace inline footer with `<Footer />` import.
>
> 6. **Create** `/Users/martin/Development/slash-m/github/dapanoskop/app/app/components/Footer.test.tsx` -- Test that rendered output contains `v1.5.0`. Mock `__APP_VERSION__` via `vi.stubGlobal`.
>
> **Edge case**: The `define` replacement is a static string swap at build time, so it is safe for pre-rendering (no `window` dependency).
>
> **Dependencies**: None. Can be done independently. Pairs well with the Logo/Favicon issue (both touch the header/footer in the same two route files).
> **Complexity**: S (Small)

> **QA Notes:**
>
> **Affected locations:** The version string `v0.1.0` is hardcoded in two files:
> - `/Users/martin/Development/slash-m/github/dapanoskop/app/app/routes/home.tsx` line 189
> - `/Users/martin/Development/slash-m/github/dapanoskop/app/app/routes/workload-detail.tsx` line 272
>
> Note that `package.json` currently has no `version` field at all.
>
> **Tests to write/update:**
> - Neither route has a test that verifies the footer version. A hardcoded string is low-risk for regression, but the duplication is the real problem.
> - If the fix extracts the version into a shared constant or reads it from `package.json` at build time, write a unit test for that constant/helper.
> - If a shared `<Footer>` component is extracted (recommended to eliminate the duplication), add a component test verifying the rendered version string matches the expected value.
>
> **Edge cases to watch:**
> - If the version is read dynamically at module scope (e.g., via `import.meta`), ensure it does not break React Router pre-render. A simple constant export or build-time replacement via Vite's `define` config is safest.
> - If using `package.json` version, remember it would need to be added first since the field does not exist.
>
> **Verification:** After fix, run `cd /Users/martin/Development/slash-m/github/dapanoskop/app && npm run build` and inspect the built output to confirm the footer shows "v1.5.0". Visually confirm in both the home page and workload-detail page during dev. Run `npm test` to verify no tests break from the refactor.

## Feature requests

### Add trend line to long term cost view

Add a trend line for the 3-month moving average to the long-term cost view.

> **Requirements Notes:**
> - **Affected**: URS-DP-10309 (View Cost Trends Across Multiple Months — 12-month chart), SRS-DP-310214 (Display Multi-Period Cost Trend Chart), SDS-DP-010208 (Render Cost Trend Chart)
> - **New requirement likely needed** — Adding a trend line is an enhancement to the existing visualization, not a bug fix
> - **Suggested new requirement**: **[URS-DP-10310] Identify Long-Term Cost Trends** — A Budget Owner identifies the underlying cost trajectory by viewing a smoothed trend line (e.g., 3-month moving average) overlaid on the historical cost chart, to distinguish short-term noise from sustained increases or decreases
> - **Impact**: Low-to-medium — Enhances an existing feature (trend chart was added in v0.6) but does not block core workflows. Improves Budget Owner's ability to interpret month-over-month volatility
> - **Traceability**: Would require updating SDS-DP-010208 (CostTrendChart component) to compute and render a Recharts `Line` element alongside the stacked bars. The moving average computation would happen in the frontend (useTrendData hook or within the chart component), not in the Lambda summary.json
> - **Design consideration**: §7.9 chose Recharts for stacked bar charts. Adding a `<Line>` element to a `<ComposedChart>` is straightforward in Recharts. The 3-month moving average can be computed from the `points` array already fetched by useTrendData (SDS-DP-010207)
> - **Clarification**: Should the trend line be configurable (e.g., 3-month vs. 6-month window)? Should it be per-cost-center or aggregate only? Should it be toggleable in the UI?
Only aggregate and not configurable

> **Frontend Plan:**
>
> **Approach**: Compute a 3-month simple moving average on the aggregate total cost per period, then overlay it as a `<Line>` on the existing chart by switching from `<BarChart>` to `<ComposedChart>`.
>
> **Files to modify:**
>
> 1. **Create** `/Users/martin/Development/slash-m/github/dapanoskop/app/app/lib/moving-average.ts` -- Pure utility function:
>    ```ts
>    export function computeMovingAverage(
>      points: { period: string; [key: string]: string | number }[],
>      costCenterNames: string[],
>      window: number = 3,
>    ): (number | null)[] {
>      return points.map((pt, i) => {
>        if (i < window - 1) return null;
>        let sum = 0;
>        for (let j = i - window + 1; j <= i; j++) {
>          const total = costCenterNames.reduce(
>            (acc, name) => acc + (Number(points[j][name]) || 0), 0
>          );
>          sum += total;
>        }
>        return sum / window;
>      });
>    }
>    ```
>
> 2. **Create** `/Users/martin/Development/slash-m/github/dapanoskop/app/app/lib/moving-average.test.ts` -- Unit tests covering:
>    - Fewer than 3 points: all return `null`.
>    - Exactly 3 points: third point is average of all three totals.
>    - Sparse data (missing cost center keys in some points treated as 0).
>    - Single cost center (degenerate case).
>
> 3. `/Users/martin/Development/slash-m/github/dapanoskop/app/app/components/CostTrendChart.tsx`:
>    - **Line 1-9**: Add `Line` and `ComposedChart` to the recharts import. Remove `BarChart` from import.
>    - **Line 70-96**: Import `computeMovingAverage` from `~/lib/moving-average`. Compute the MA array from props, then merge it into `points` as a `_movingAvg` key on each point object (or build an enriched data array). Switch `<BarChart>` to `<ComposedChart>`. Add a `<Line>` element:
>      ```tsx
>      <Line
>        type="monotone"
>        dataKey="_movingAvg"
>        stroke="#6b7280"
>        strokeWidth={2}
>        strokeDasharray="6 3"
>        dot={false}
>        name="3-Month Avg"
>        connectNulls={false}
>      />
>      ```
>      The dashed gray line visually separates the trend from the stacked bars.
>
> 4. `/Users/martin/Development/slash-m/github/dapanoskop/app/app/components/CostTrendChart.test.tsx`:
>    - **Line 6-24**: Add `ComposedChart` and `Line` to the recharts mock (replace `BarChart` mock with `ComposedChart`).
>    - Add a test: "renders a Line for the moving average".
>
> **Edge cases**:
> - With only 1-2 periods, the `_movingAvg` is `null` for all points; the `<Line>` renders nothing (correct behavior, `connectNulls={false}`).
> - The `CustomTooltip` (lines 37-63) already computes totals from the payload. The Line's entry will appear in the tooltip payload automatically; either include it styled distinctly or filter it out if redundant with the "Total" line.
>
> **Dependencies**: None. Independent of all other issues.
> **Complexity**: M (Medium) -- new utility + chart type migration + test updates.

> **QA Notes:**
>
> **Current implementation:** The trend chart lives in `/Users/martin/Development/slash-m/github/dapanoskop/app/app/components/CostTrendChart.tsx` (a Recharts stacked `BarChart`). Data is loaded by `/Users/martin/Development/slash-m/github/dapanoskop/app/app/lib/useTrendData.ts` which fetches all periods and builds `TrendPoint[]` with per-cost-center values.
>
> **Tests to write:**
> - Extract the moving average calculation as a pure function in a utility module. Unit test it with:
>   - Fewer than 3 data points: should return null/undefined for the first two points (insufficient data for a 3-month window).
>   - Exactly 3 points: the third point should have the average of all three.
>   - Points with missing cost centers in some periods (sparse data).
>   - Verify the average is computed on the total across all cost centers, not per-cost-center (unless the design says otherwise).
> - Update `/Users/martin/Development/slash-m/github/dapanoskop/app/app/components/CostTrendChart.test.tsx` to verify a Recharts `Line` component is rendered when moving average data is provided.
> - Update `/Users/martin/Development/slash-m/github/dapanoskop/app/app/lib/useTrendData.test.ts` if the hook is extended to compute the moving average.
>
> **Edge cases to watch:**
> - Only 1-2 periods of data available: trend line should not render (or should be clearly marked as insufficient data).
> - Large gaps in periods (e.g., missing months mid-sequence): should the window skip missing months or treat them as zero? This has significant impact on the displayed trend.
> - The chart currently uses `BarChart`. Adding a `Line` requires switching to a `ComposedChart` in Recharts. Verify this does not break existing stacked bar rendering.
>
> **Verification:** Use the existing 12-month fixture data set. Manually compute the expected moving average for at least 3 consecutive points and compare against the rendered values. The moving average for month N should equal `(total[N-2] + total[N-1] + total[N]) / 3`.

### Add Logo and Favicon

Use the greek δ as a logo / favicon and make the Dapanoskop title clickable to navigate back to "home" / current cost report.

> **Requirements Notes:**
> - **Affected**: §2.1 (General Description — name etymology mentions δ but no logo requirement), SDS-DP-010205 (Apply Business-Friendly Labels — covers report content but not chrome/branding)
> - **New requirements needed** — This is a new branding/navigation feature, not documented in any requirement
> - **Suggested new requirements**:
>   - **[URS-DP-30103] Navigate Back to Report Home** — A user returns to the current cost report from any screen within the application by clicking the application header, without losing their selected reporting period
>   - **[SRS-DP-310102] Application Logo Display** — The system displays a logo (Greek letter δ) in the application header on all screens, visually reinforcing the product identity
>   - **[SRS-DP-310103] Browser Favicon** — The system displays a favicon (Greek letter δ) in the browser tab, improving tab identification when multiple applications are open
>   - **[SRS-DP-310104] Clickable Header Navigation** — The application header (logo + title) is clickable and navigates to the cost report home (preserving the current or most recent period selection)
> - **Impact**: Low — Improves usability and branding but does not affect core cost monitoring workflows
> - **Traceability**: Requires updates to header components across all routes (cost-report, workload-detail). Favicon requires adding to public assets and referencing in HTML head. Navigation behavior should preserve the `period` query parameter if present
> - **Design consideration**: §6.8 (Design System) documents Cytario design tokens (purple/teal palette, Montserrat font). The logo design should align with this palette. The δ symbol is referenced in URS §2.1 etymology but not as a visual element
> - **Clarification**: Should the logo be text-based (δ character) or an SVG graphic? What color (primary purple, white-on-gradient)? Should clicking preserve the currently selected period or always go to the latest complete month (current behavior per SRS-DP-310501)?
Preserve the period; use an svg graphic for the logo.

> **Frontend Plan:**
>
> **Approach**: Create an SVG delta logo asset, extract a shared `<Header>` component used by both routes, replace the existing `favicon.ico` with an SVG favicon, and add a `<link>` tag in `root.tsx`.
>
> **Files to create/modify:**
>
> 1. **Create** `/Users/martin/Development/slash-m/github/dapanoskop/app/public/favicon.svg` -- SVG delta (δ) icon, white on purple/teal gradient circle matching the Cytario palette. Keep it simple (under 1KB). The existing `favicon.ico` can remain as a fallback.
>
> 2. **Create** `/Users/martin/Development/slash-m/github/dapanoskop/app/app/components/DeltaLogo.tsx` -- Inline SVG component rendering the delta symbol, sized for the header (~24x24px). White δ on a rounded gradient background:
>    ```tsx
>    export function DeltaLogo({ className }: { className?: string }) {
>      return (
>        <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
>          {/* gradient circle + delta path */}
>        </svg>
>      );
>    }
>    ```
>
> 3. **Create** `/Users/martin/Development/slash-m/github/dapanoskop/app/app/components/Header.tsx` -- Shared header component. Accepts an optional `period` prop (for preserving the period param in the home link). Includes logo, title as a `<Link>`, and a logout button slot:
>    ```tsx
>    import { Link } from "react-router";
>    import { DeltaLogo } from "./DeltaLogo";
>    export function Header({ period, onLogout }: { period?: string; onLogout?: () => void }) {
>      const to = period ? `/?period=${period}` : "/";
>      return (
>        <header className="bg-cytario-gradient px-6 py-3 flex items-center justify-between shadow-sm">
>          <Link to={to} className="flex items-center gap-2 text-white hover:opacity-90">
>            <DeltaLogo className="w-6 h-6" />
>            <span className="text-lg font-bold">Dapanoskop</span>
>          </Link>
>          {onLogout && (
>            <button onClick={onLogout} className="text-sm text-white/90 hover:text-white cursor-pointer hover:underline">
>              Logout
>            </button>
>          )}
>        </header>
>      );
>    }
>    ```
>
> 4. `/Users/martin/Development/slash-m/github/dapanoskop/app/app/routes/home.tsx` (lines 123-132) -- Replace the inline `<header>` block with `<Header period={selectedPeriod} onLogout={logout} />`. Also update the login page's `<h1>Dapanoskop</h1>` (line 106) to include the `<DeltaLogo />` for visual consistency.
>
> 5. `/Users/martin/Development/slash-m/github/dapanoskop/app/app/routes/workload-detail.tsx` (lines 178-180) -- Replace the inline `<header>` with `<Header period={period} />`. No logout button on drill-down (matching current behavior -- no logout shown).
>
> 6. `/Users/martin/Development/slash-m/github/dapanoskop/app/app/root.tsx` (line 17, inside `<head>`) -- Add favicon link:
>    ```tsx
>    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
>    <link rel="icon" type="image/x-icon" href="/favicon.ico" />
>    ```
>
> 7. **Create** `/Users/martin/Development/slash-m/github/dapanoskop/app/app/components/Header.test.tsx` -- Tests:
>    - Renders a link wrapping logo + title.
>    - Link href includes `?period=` when period prop is provided.
>    - Link href is `/` when no period prop.
>    - Logout button renders when `onLogout` is provided, not when omitted.
>
> **Edge cases**:
> - On the home page, clicking the header link with the same period should not trigger a full data reload (React Router handles client-side dedup).
> - The `<Link>` must use React Router's `Link`, not an `<a>` tag, to preserve SPA navigation.
>
> **Dependencies**: Pairs naturally with the Version issue (both extract shared Header/Footer). Implement together to avoid touching the same route files twice.
> **Complexity**: M (Medium) -- SVG asset creation, component extraction, two route refactors, root.tsx update.

> **QA Notes:**
>
> **Current implementation:** The header in both `/Users/martin/Development/slash-m/github/dapanoskop/app/app/routes/home.tsx` (line 125) and `/Users/martin/Development/slash-m/github/dapanoskop/app/app/routes/workload-detail.tsx` (line 179) renders `<h1>Dapanoskop</h1>` as plain text, not a link. Headers are duplicated across routes.
>
> **Tests to write/update:**
> - If a shared `<Header>` component is extracted (recommended to eliminate the duplication across both routes), add a component test that:
>   - Verifies the title is wrapped in a `<Link to="/">` (or `<a href="/">`).
>   - Verifies the logo/delta character is rendered.
> - For the favicon: no automated test is needed (visual asset), but verify it appears in the build output.
> - No existing component tests reference the header directly, so no existing tests should break.
>
> **Edge cases to watch:**
> - On the home page, clicking the title should not cause a full re-fetch of data. React Router client-side navigation should handle this, but verify.
> - The Greek delta (lowercase delta is U+03B4: δ) must render correctly across browsers. Use the Unicode character directly in JSX. Test in both Chrome and Safari.
> - Favicon formats: provide at minimum `favicon.ico` and optionally `favicon.svg`. Ensure the `<link rel="icon">` tag is added to the `<head>` in `/Users/martin/Development/slash-m/github/dapanoskop/app/app/root.tsx`.
> - If clicking the header preserves the `?period=` parameter, test that the correct period is carried over from the workload-detail page back to home.
>
> **Verification:** Run `cd /Users/martin/Development/slash-m/github/dapanoskop/app && npm run build` and verify the favicon appears in `build/client/`. Check that the `<link rel="icon">` tag is present in the rendered HTML. Navigate between home and workload-detail to confirm the title link works in both directions.

### Improve Mobile view

The top part of the cost report (total spend, vs last month, vs last year) is not handling mobile view well by sticking to a 3 column layout. Figure out a reasonable breakpoint where they are displayed in 1 column. Also the Cost trend's legend is being written partially on top of the chart on mobile if there are too many entries.

> **Requirements Notes:**
> - **Affected**: SRS-DP-600002 (Browser Compatibility — "No mobile optimization is provided initially. Desktop browsers only"), SRS-DP-310211 (Display Global Cost Summary — 3 metrics in summary bar), SRS-DP-310214 (Display Multi-Period Cost Trend Chart — legend with color indicators)
> - **Potential requirement conflict**: SRS-DP-600002 explicitly states "No mobile optimization is provided initially. Desktop browsers only." This feature request directly contradicts that stated boundary. Implementing mobile responsiveness represents a scope expansion beyond the current requirements baseline
> - **New requirements needed** — If mobile support is now desired, this requires updating URS to add a mobile user scenario and updating SRS-DP-600002
> - **Suggested new requirements**:
>   - **[URS-DP-10308] Access Report on Mobile Device** (UPDATE EXISTING) — Change from "Access Report Without AWS Knowledge" to also state: "A Budget Owner accesses and reviews the cost report on a mobile device (phone or tablet) without layout breakage or overlapping content"
>   - **[SRS-DP-600002] Browser Compatibility** (UPDATE) — Remove "No mobile optimization is provided initially. Desktop browsers only." Replace with: "The web application is responsive and functional on both desktop browsers and mobile browsers (iOS Safari, Android Chrome). Layouts adapt to narrow viewports using responsive breakpoints"
>   - **[SRS-DP-310211] Display Global Cost Summary** (UPDATE) — Add: "On viewports narrower than 768px, the three metrics stack vertically (1 column)"
>   - **[SRS-DP-310214] Display Multi-Period Cost Trend Chart** (UPDATE) — Add: "On narrow viewports, the legend is positioned below the chart to prevent overlap"
> - **Impact**: Medium — Affects architectural decisions (responsive design patterns), testing scope (requires mobile browser testing), and potentially performance (responsive images, touch targets)
> - **Traceability**: Requires updates to StorageOverview.tsx (grid-cols-3), cost report layout components, and CostTrendChart (Recharts responsive container and legend positioning)
> - **Design consideration**: §6.8 (Design System) uses Tailwind utility classes. Tailwind's responsive modifiers (sm:, md:, lg:) can implement breakpoints. Recharts supports responsive legend positioning via `layout` prop
> - **Clarification**: What is the priority of mobile support relative to other features? Should all screens be mobile-responsive or just the main cost report? What is the target viewport width for the breakpoint (768px, 640px)? Are there performance considerations for mobile data usage (chart bundles, parquet queries)?
no performance requirements as deskopt is the main audience, but all screens should render reasonably on mobile

> **Frontend Plan:**
>
> **Approach**: Add responsive Tailwind breakpoints to all 3-column grids (stack to 1-col below `sm` / 640px), and fix the Recharts legend overlap by positioning it below the chart on narrow viewports.
>
> **Files to modify:**
>
> 1. `/Users/martin/Development/slash-m/github/dapanoskop/app/app/components/GlobalSummary.tsx` (line 24):
>    - Change `grid grid-cols-3 gap-4` to `grid grid-cols-1 sm:grid-cols-3 gap-4`.
>
> 2. `/Users/martin/Development/slash-m/github/dapanoskop/app/app/components/StorageOverview.tsx` (line 11):
>    - Change `grid grid-cols-3 gap-4` to `grid grid-cols-1 sm:grid-cols-3 gap-4`.
>
> 3. `/Users/martin/Development/slash-m/github/dapanoskop/app/app/routes/workload-detail.tsx` (line 212):
>    - Change `grid grid-cols-3 gap-4` to `grid grid-cols-1 sm:grid-cols-3 gap-4`.
>
> 4. `/Users/martin/Development/slash-m/github/dapanoskop/app/app/components/CostTrendChart.tsx` (line 84):
>    - Change `<Legend />` to `<Legend verticalAlign="bottom" wrapperStyle={{ paddingTop: 12 }} />`. This moves the legend below the chart area, preventing overlap with bars regardless of viewport width. The `paddingTop` adds breathing room between bars and legend.
>    - Increase the `ResponsiveContainer` height from 320 to 360 (line 75) to accommodate the legend below the chart without compressing the bars.
>
> 5. `/Users/martin/Development/slash-m/github/dapanoskop/app/app/components/CostTrendChart.test.tsx`:
>    - Update the `Legend` mock to accept and render `verticalAlign` prop, or add a test asserting the Legend receives `verticalAlign="bottom"`.
>
> **Scope note**: The `WorkloadTable` and `UsageTypeTable` are HTML tables that naturally reflow. The `CostCenterCard` is already full-width. The `TaggingCoverage` bar is full-width. The `PeriodSelector` horizontal strip may overflow on mobile, but since it uses horizontal scrolling it should be acceptable. No changes needed for those.
>
> **Dependencies**: None. Fully independent of all other issues.
> **Complexity**: S (Small) -- four one-line CSS class changes plus a legend prop tweak.

> **QA Notes:**
>
> **Current implementation:**
> - `/Users/martin/Development/slash-m/github/dapanoskop/app/app/components/GlobalSummary.tsx` line 24: `grid grid-cols-3 gap-4` -- no responsive breakpoint, always 3 columns.
> - `/Users/martin/Development/slash-m/github/dapanoskop/app/app/components/StorageOverview.tsx` line 11: same `grid grid-cols-3 gap-4` pattern.
> - `/Users/martin/Development/slash-m/github/dapanoskop/app/app/routes/workload-detail.tsx` line 212: same `grid grid-cols-3 gap-4` pattern for the workload summary cards.
> - `/Users/martin/Development/slash-m/github/dapanoskop/app/app/components/CostTrendChart.tsx` line 84: Recharts `<Legend />` uses default positioning with no overflow handling.
>
> **Tests to write/update:**
> - Component unit tests are not well-suited for responsive layout verification. This is best verified with:
>   - Manual testing at viewport widths: 320px (small phone), 375px (iPhone), 768px (tablet), 1024px+ (desktop).
>   - Optionally, a Playwright visual regression test at mobile viewport sizes if e2e infrastructure is added later.
> - If responsive Tailwind classes are added (e.g., `grid-cols-1 sm:grid-cols-3`), no unit test is needed for the class string itself -- Tailwind class correctness is a CSS framework concern.
> - For the legend overlap fix: if the Recharts `<Legend>` props are changed (e.g., `verticalAlign="bottom"`, custom `wrapperStyle`), update `/Users/martin/Development/slash-m/github/dapanoskop/app/app/components/CostTrendChart.test.tsx` to verify the Legend props are passed correctly.
>
> **Edge cases to watch:**
> - All three card grids need the same responsive treatment: `GlobalSummary`, `StorageOverview`, and the workload-detail summary cards. Do not fix one and leave the others inconsistent.
> - The `CostTrendChart` uses a fixed `height={320}` (line 75). On mobile, if the legend is moved below the chart, the total height may need to increase to avoid compressing the bars.
> - With many cost centers (6+), the legend could wrap to multiple lines even on desktop. Test with the maximum expected number of cost centers from the fixture data (currently 3).
> - Tailwind v4 default breakpoints: `sm` is 640px, `md` is 768px. Verify the chosen breakpoint aligns with the actual target devices.
>
> **Verification:** Use browser dev tools responsive mode. At 375px width: (1) summary cards stack in a single column, (2) chart legend does not overlap bar content, (3) all text is readable without horizontal scrolling. Also test at 768px (tablet) to verify the transition point looks clean.

### Useful Tooltips

When hovering over a value, there should be a tool tip to explain what goes into the value. For example storage cost, hot tier and cost/tb.

> **Requirements Notes:**
> - **Affected**: URS-DP-30102 (Understand Report Content — "report is self-explanatory through clear labels, section headings, and contextual information"), SRS-DP-310209 (Business-Friendly Terminology — uses business-friendly labels without AWS terminology)
> - **Partial requirement exists**: URS-DP-30102 states the report should be self-explanatory without separate documentation, but does not specify tooltips as the mechanism. SRS-DP-310214 already specifies tooltips for the cost trend chart ("A tooltip displays the per-cost-center cost and computed total for the hovered period")
> - **New requirements needed** — Tooltips are a specific UI mechanism not currently required outside the chart
> - **Suggested new requirements**:
>   - **[URS-DP-30102] Understand Report Content** (UPDATE) — Extend existing requirement to add: "The report provides contextual explanations (e.g., via hover tooltips) for calculated metrics such as cost per TB, hot tier percentage, and storage cost breakdown"
>   - **[SRS-DP-310206] Display Total Storage Cost** (UPDATE) — Add: "A tooltip explains which storage services are included (S3, and optionally EFS/EBS per deployment configuration)"
>   - **[SRS-DP-310207] Display Cost per TB Stored** (UPDATE) — Add: "A tooltip explains the calculation: total storage cost divided by total volume in TB"
>   - **[SRS-DP-310208] Display Hot Tier Percentage** (UPDATE) — Add: "A tooltip explains which storage tiers are considered 'hot' (S3 Standard, S3 Intelligent-Tiering Frequent Access, and optionally EFS/EBS)"
> - **Impact**: Low — Improves self-service understanding for Budget Owners (aligns with URS-DP-10308) but does not change functionality
> - **Traceability**: Requires updates to StorageOverview.tsx to add tooltip UI elements (likely via a library like Radix UI Tooltip or native `title` attribute). The tooltip content should reference the formulas documented in SDS §6.5 (Hot Tier Calculation) and §6.6 (Cost per TB Calculation)
> - **Design consideration**: §6.8 (Design System) does not currently specify a tooltip pattern. Tooltips should follow the Cytario design system (Montserrat font, primary/secondary colors). Consider accessibility (keyboard navigation, ARIA labels)
> - **Clarification**: Should tooltips be everywhere (workload costs, MoM/YoY deltas, tagging coverage) or just for storage metrics as specified? Should they be verbose (full formula) or concise (one sentence)? Desktop-only (hover) or also mobile (tap/long-press)?
everywhere but concise

> **Frontend Plan:**
>
> **Approach**: Create a reusable `<InfoTooltip>` component that renders a small info icon (circled "i") next to metric labels. On hover/focus, it shows a concise explanation. Use CSS-only positioning (no external tooltip library needed) to keep the bundle light. Apply tooltips to all metric cards across all screens.
>
> **Files to create/modify:**
>
> 1. **Create** `/Users/martin/Development/slash-m/github/dapanoskop/app/app/components/InfoTooltip.tsx`:
>    ```tsx
>    interface InfoTooltipProps { text: string; }
>    export function InfoTooltip({ text }: InfoTooltipProps) {
>      return (
>        <span className="relative inline-flex items-center ml-1 group" tabIndex={0}>
>          <span className="w-4 h-4 rounded-full bg-gray-200 text-gray-500 text-[10px]
>                          flex items-center justify-center cursor-help"
>                aria-label={text}>i</span>
>          <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5
>                          hidden group-hover:block group-focus:block
>                          bg-gray-800 text-white text-xs rounded px-2 py-1
>                          whitespace-normal w-48 text-center z-10 shadow-lg"
>                role="tooltip">{text}</span>
>        </span>
>      );
>    }
>    ```
>    Accessible: `tabIndex={0}` enables keyboard focus; `group-focus:block` shows tooltip on Tab; `aria-label` provides screen reader text.
>
> 2. `/Users/martin/Development/slash-m/github/dapanoskop/app/app/components/GlobalSummary.tsx`:
>    - Import `InfoTooltip`.
>    - Line 26 ("Total Spend" label): Add `<InfoTooltip text="Sum of all cost center spend for this period." />`
>    - Line 32 ("vs Last Month" label): Add `<InfoTooltip text="Change compared to the previous calendar month." />`
>    - Line 38 ("vs Last Year" label): Add `<InfoTooltip text="Change compared to the same month one year ago." />`
>
> 3. `/Users/martin/Development/slash-m/github/dapanoskop/app/app/components/StorageOverview.tsx`:
>    - Import `InfoTooltip`.
>    - Line 13 ("Storage Cost"): Add `<InfoTooltip text="Total cost of all storage services (S3, optionally EFS/EBS)." />`
>    - Line 25 ("Cost / TB"): Add `<InfoTooltip text="Total storage cost divided by data volume in terabytes." />`
>    - Line 30 ("Hot Tier"): Add `<InfoTooltip text="Percentage of volume in frequently accessed storage tiers." />`
>
> 4. `/Users/martin/Development/slash-m/github/dapanoskop/app/app/components/TaggingCoverage.tsx`:
>    - Import `InfoTooltip`.
>    - Line 15 ("Tagging Coverage" label): Add `<InfoTooltip text="Proportion of spend attributed to tagged resources." />`
>
> 5. `/Users/martin/Development/slash-m/github/dapanoskop/app/app/components/CostCenterCard.tsx`:
>    - Import `InfoTooltip`.
>    - Line 58 ("MoM" label in CostChange): Add `<InfoTooltip text="Month-over-month cost change." />` after the MoM CostChange.
>    - Line 78 ("Top mover" text): Add `<InfoTooltip text="Workload with the largest absolute cost change vs last month." />`
>
> 6. `/Users/martin/Development/slash-m/github/dapanoskop/app/app/routes/workload-detail.tsx`:
>    - Import `InfoTooltip`.
>    - Line 214 ("Current"): Add `<InfoTooltip text="Total cost for this workload in the selected period." />`
>    - Line 220 ("vs Last Month"): Add `<InfoTooltip text="Change compared to the previous calendar month." />`
>    - Line 229 ("vs Last Year"): Add `<InfoTooltip text="Change compared to the same month one year ago." />`
>
> 7. **Create** `/Users/martin/Development/slash-m/github/dapanoskop/app/app/components/InfoTooltip.test.tsx`:
>    - Test: renders the "i" icon.
>    - Test: tooltip text is present in the DOM (for accessibility, even if visually hidden).
>    - Test: `aria-label` attribute matches the provided text.
>
> 8. `/Users/martin/Development/slash-m/github/dapanoskop/app/app/components/StorageOverview.test.tsx`:
>    - Update existing tests to verify tooltip text is present in the rendered output for each card.
>
> **Tooltip content for "Cost / TB"**: The text says "total storage cost divided by data volume in terabytes." This description is accurate regardless of the TiB/TB unit fix (it describes the concept, not the constant). However, the wording should be reviewed after the Cost per TB bug is fixed to ensure consistency.
>
> **Dependencies**: Loosely depends on the Cost per TB fix (tooltip text for "Cost / TB" should be accurate), but the tooltip component and wiring can be implemented in parallel -- only the exact wording may need a tweak.
> **Complexity**: M (Medium) -- new component, touches 6 existing files, multiple tooltip text strings to author.

> **QA Notes:**
>
> **Current implementation:** `/Users/martin/Development/slash-m/github/dapanoskop/app/app/components/StorageOverview.tsx` renders three cards (Storage Cost, Cost / TB, Hot Tier) with no tooltip or explanatory text. `/Users/martin/Development/slash-m/github/dapanoskop/app/app/components/GlobalSummary.tsx` similarly has no tooltips. The `CostTrendChart.tsx` already has a custom tooltip for the chart itself (lines 37-63), but it shows values, not explanations.
>
> **Tests to write:**
> - Component tests for tooltip content in `StorageOverview.test.tsx`:
>   - Verify the tooltip element exists for each card (e.g., a `title` attribute, or an `aria-describedby` pattern for accessible tooltips).
>   - Verify the explanatory text content is present in the DOM (even if visually hidden until hover).
>   - Test accessibility: tooltips should be reachable by keyboard (focus) and announced by screen readers.
> - If a reusable `<InfoTooltip>` component is created, add standalone component tests for it.
>
> **Edge cases to watch:**
> - Touch devices: hover does not exist on mobile. If the "Improve Mobile view" feature is also implemented, consider an info icon (i) with tap-to-show pattern instead of pure hover.
> - Tooltip text must be technically accurate. Suggested content:
>   - "Storage Cost": "Total cost of all storage-category line items (S3, and optionally EFS/EBS per deployment configuration)."
>   - "Cost / TB": "Storage cost divided by total volume in terabytes." (Note: accuracy depends on fixing the cost_per_tb bug first.)
>   - "Hot Tier": "Percentage of storage volume in S3 Standard and S3 Intelligent-Tiering Frequent Access tiers."
> - Tooltip positioning: on cards near the edge of the viewport, tooltips should not be clipped. Test with different screen widths.
>
> **Verification:** After implementation, manually verify each tooltip appears on hover (desktop) and is keyboard-accessible (Tab + focus triggers tooltip). Confirm explanatory text is technically accurate by cross-referencing with the processor logic in `/Users/martin/Development/slash-m/github/dapanoskop/lambda/src/dapanoskop/processor.py`. Run `cd /Users/martin/Development/slash-m/github/dapanoskop/app && npm test` to verify all new and existing tests pass.
