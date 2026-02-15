# Issue Tracker for Dapanoskop


## Bugs

### Cost per TB is still wrong

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


## Feature requests

### Give trendline a contrast color

the current trendline in the Cost Trend is gray and hard to see, use an appropriate contrast color
