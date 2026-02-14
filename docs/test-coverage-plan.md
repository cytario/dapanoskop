# Dapanoskop Test Coverage Analysis and Improvement Plan

**Date:** 2026-02-14
**Author:** QA Engineering
**Status:** Draft — Revised with specialist reviewer feedback
**Reviewers:** Python Engineer, Frontend Engineer, Cloud Engineer, Security Engineer

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Current State: SS-1 Frontend (app/)](#ss-1-frontend-app)
3. [Current State: SS-2 Lambda Pipeline (lambda/)](#ss-2-lambda-pipeline-lambda)
4. [Current State: SS-3/SS-4 Terraform IaC (terraform/)](#ss-3ss-4-terraform-iac-terraform)
5. [Current State: CI Pipeline](#ci-pipeline)
6. [Prioritized Improvement Plan](#prioritized-improvement-plan)
7. [Implementation Roadmap](#implementation-roadmap)

---

## Executive Summary

### Coverage at a Glance

| Subsystem   | Test Files | Test Cases | Estimated Coverage | Test Types Present       |
|-------------|-----------|------------|-------------------|--------------------------|
| app/        | 0         | 0          | 0%                | None                     |
| lambda/     | 4         | 36         | ~60-70% (est.)    | Unit, Integration        |
| terraform/  | 0         | 0          | 0%                | None (CI has fmt/validate/tflint) |

### Key Findings

1. **app/ has zero tests.** No test framework is installed. No test runner is configured. This is the most critical gap -- the entire user-facing application has no automated verification beyond TypeScript type-checking and the build passing.

2. **lambda/ has solid foundational tests** with good patterns (moto mocking, parametrized tests, fixture isolation), but is missing `pytest-cov` for coverage measurement, has no tests for `collector.py`'s AWS API integration paths (`get_cost_and_usage`, `get_cost_categories`, `collect`), and leaves `write_to_s3` and `update_index` tested only indirectly through the handler integration test.

3. **terraform/ relies entirely on static analysis** (fmt, validate, tflint in CI) but has no variable validation tests, no checkov in CI, and no `tofu plan` smoke tests.

4. **CI does not run any test coverage reporting.** There is no quality gate on coverage.

### Bugs Found During Review

The specialist reviewers identified two real bugs in the codebase (not just test gaps):

- **`CostCenterCard.tsx` crash on empty workloads:** The `reduce` call on `costCenter.workloads` initializes with `workloads[0]`, which is `undefined` when the array is empty. This would throw a runtime error. Fix: add a guard before the `reduce`.
- **`WorkloadTable.tsx` anomaly threshold ignores new workloads:** When `prev_month_cost_usd` is 0, `momPct` is set to 0, so new workloads with significant cost are never flagged as anomalies. The "new workload" case is arguably the most important anomaly to flag.

---

## SS-1 Frontend (app/)

### Current State

**Test framework:** None installed. No Vitest, no Jest, no testing-library, no Playwright.

**What exists:** The CI pipeline runs `prettier`, `eslint`, `tsc --noEmit`, and `npm run build`. These catch formatting, lint, type, and build errors but verify zero runtime behavior.

### Source Inventory

| File | Category | Complexity | Testability |
|------|----------|-----------|-------------|
| `app/lib/format.ts` | Pure utility | Low | Excellent -- pure functions, no dependencies |
| `app/lib/config.ts` | Config loader | Medium | Good -- requires `fetch` mock |
| `app/lib/auth.ts` | Auth module | High | Moderate -- `window`, `sessionStorage`, `crypto` |
| `app/lib/credentials.ts` | AWS credentials | High | Moderate -- AWS SDK, caching/dedup logic |
| `app/lib/data.ts` | Data fetching | Medium | Moderate -- `fetch`/S3 mocking needed |
| `app/types/cost-data.ts` | Type definitions | N/A | N/A (types only, no runtime) |
| `app/components/CostChange.tsx` | Presentational | Low | Good |
| `app/components/GlobalSummary.tsx` | Presentational | Low | Good |
| `app/components/PeriodSelector.tsx` | Presentational | Low | Good |
| `app/components/TaggingCoverage.tsx` | Presentational | Low | Good |
| `app/components/StorageOverview.tsx` | Presentational | Low | Good |
| `app/components/WorkloadTable.tsx` | Presentational + logic | Medium | Good |
| `app/components/CostCenterCard.tsx` | Presentational + logic | Medium | Good |
| `app/components/UsageTypeTable.tsx` | Data aggregation + display | Medium | Good |
| `app/routes/home.tsx` | Route with auth + data | High | Difficult -- multiple side effects |
| `app/routes/workload-detail.tsx` | Route with DuckDB | Very High | Difficult -- DuckDB-wasm, S3 creds |
| `app/root.tsx` | Shell/ErrorBoundary | Low | Good |

### What Is NOT Tested

Everything. Zero test coverage.

### Risk Assessment

- **`format.ts`** -- Used on every displayed number. A regression here would corrupt every cost display across the app. Pure functions make this trivially testable. **Highest ROI.**
- **`auth.ts`** -- Authentication gate and single security boundary for the entire app. A bug here could lock users out or (worse) bypass auth checks. The `isAuthenticated()` token expiry logic currently works safely by accident (missing `exp` falls to catch block), not by design. **[Security: Promoted to P0.]**
- **`UsageTypeTable.tsx`** -- Contains client-side data aggregation logic (Map-based grouping across periods). A logic bug would silently show wrong numbers to users -- users cannot cross-check aggregated values. The aggregation logic should be extracted and unit tested. **[Frontend: Promoted to P0.]**
- **`config.ts`** -- Every other module depends on it (`auth.ts`, `data.ts`, `credentials.ts`). A bug in config loading breaks the entire app. **[Frontend: Missing from original plan, added at P1.]**
- **`WorkloadTable.tsx`** -- Contains anomaly detection logic (`ANOMALY_THRESHOLD = 0.1`). New workloads (prev=0) yield momPct=0 and are never flagged. **[Frontend: Logic bug identified.]**
- **`CostCenterCard.tsx`** -- "Top mover" calculation crashes on empty workloads array. **[Frontend: Bug identified, fix before testing.]**
- **`credentials.ts`** -- Promise deduplication and refresh buffer logic. A bug could cause stale credentials or duplicate Identity Pool requests. **[Frontend: Missing from original plan.]**

---

## SS-2 Lambda Pipeline (lambda/)

### Current State

**Test framework:** pytest 9.0.2, moto (ce, s3), no pytest-cov.

**Test files and what they cover:**

| Test File | Tests | What It Covers |
|-----------|-------|---------------|
| `tests/conftest.py` | 0 (fixtures) | Auto-use fixture sets fake AWS credentials |
| `tests/test_handler.py` | 4 | Handler integration (normal + backfill), skip-existing, force-reprocess |
| `tests/test_collector.py` | 7 | `_month_range` (2 cases), `_get_periods` (5 cases, including target month) |
| `tests/test_processor.py` | 4 | `process()`: basic, untagged, storage metrics, multiple cost centers |
| `tests/test_categories.py` | 21 | `categorize()`: parametrized across all category patterns |

**Total: 36 passing tests in 0.94s.**

### What IS Tested (and quality assessment)

**test_handler.py (Integration):** Good quality. Tests the full handler path with mocked `collect()`, verifying S3 output structure (summary.json, parquets, index.json). Backfill tests cover: multi-month processing, skip-existing, and force-reprocess. These are the highest-value tests in the project. **[Python: 40+ lines of setup duplication across 4 tests -- extract to conftest.py fixture.]**

**test_collector.py (Unit):** Tests `_month_range` and `_get_periods` helper functions thoroughly -- including edge cases (December rollover, January, first-of-month). Missing tests for `get_cost_and_usage`, `get_cost_categories`, and `collect` main function.

**test_processor.py (Unit):** Tests `process()` at the function level with realistic data structures. Covers cost center grouping, sorting, tagging coverage, and storage metric calculations. Good use of helper functions (`_make_group`, `_make_collected`). Missing: edge cases (empty data, single item, very large numbers, zero costs).

**test_categories.py (Unit):** Excellent. Parametrized test covers 21 usage type patterns. Clean and maintainable. **[Python: Missing pattern-priority test -- first-match-wins ordering is not verified.]**

### What Is NOT Tested

| Module/Function | Risk | Why It Matters |
|-----------------|------|----------------|
| `collector.get_cost_and_usage()` | Medium | Pagination logic. If CE API returns paginated results and the loop breaks early, data is silently lost. |
| `collector.get_cost_categories()` | Medium | Category discovery + mapping extraction. Handles empty category name fallback. |
| `collector.collect()` | Medium | Orchestrator. Mocked entirely in handler tests. No verification of boto3 CE client integration. **[Python: Upgraded from Low.]** |
| `processor.write_to_s3()` | Medium | Parquet serialization + S3 writes. Tested indirectly via handler, but no direct test verifies parquet schema correctness or the `update_index_file=False` path independently. |
| `processor.update_index()` | Medium | S3 paginator + period parsing condition. A bug here corrupts index.json for all users. Single point of failure for the UI period selector. **[Python: Promoted to P0.]** |
| `processor._parse_groups()` | Medium | Tested indirectly via `process()`. Edge cases (malformed groups, missing keys, empty keys) not covered. **[Python: New gap identified.]** |
| `handler._month_exists_in_s3()` | Low | Simple S3 check. Tested indirectly via backfill skip test. |
| `handler._generate_backfill_months()` | Low | Tested indirectly via backfill handler test. Uses `datetime.now()` directly (non-deterministic). |
| Handler error paths | Medium | What happens when `collect()` raises? When `write_to_s3()` fails mid-backfill? `_handle_backfill` catches exceptions per-month, but this path is untested. |
| Handler error leakage | Medium | `str(e)` in backfill error responses may leak AWS ARNs and account IDs from boto3 exceptions. **[Security: New gap identified.]** |
| Storage metrics zero-division | Medium | No test for zero byte-hours (division by zero in hot_tier_percentage / cost_per_tb calculation). **[Python: New gap identified.]** |

### Infrastructure Gaps

- **No pytest-cov installed.** Cannot measure or enforce coverage thresholds.
- **No coverage reporting in CI.** Tests run but coverage is invisible. **[Python: Add HTML report format for CI artifact upload.]**
- **No mypy/pyright.** Type checking relies only on type annotations (ruff catches some issues but not type errors).

---

## SS-3/SS-4 Terraform IaC (terraform/)

### Current State

**Static analysis in CI:** `tofu fmt -check -recursive`, `tofu init -backend=false`, `tofu validate`, `tflint`.

**What is NOT in CI:** checkov security scanning (mentioned in project docs as a tool, but absent from CI). The codebase has 27 inline `#checkov:skip` annotations with documented justifications, confirming checkov is used locally.

### Module Inventory

| Module | Resources | Variable Validations | Preconditions | Complexity |
|--------|-----------|---------------------|---------------|-----------|
| `modules/artifacts` | S3 bucket + lifecycle + upload provisioners | 0 | 0 | Low |
| `modules/data-store` | S3 bucket + CORS + lifecycle + intelligent tiering | 0 | 0 | Low |
| `modules/hosting` | CloudFront + S3 + OAC + security headers + CSP + deploy | 0 | 0 | High |
| `modules/auth` | Cognito User Pool + IdP (SAML/OIDC) + Identity Pool + IAM | 3 (MFA, SAML URL, OIDC issuer) | 4 (domain prefix, SAML provider, OIDC provider, OIDC creds) | Very High |
| `modules/pipeline` | Lambda + IAM + EventBridge + CloudWatch | 0 | 0 | Medium |

**[Cloud: Auth module has 4 `lifecycle.precondition` blocks in addition to 3 variable validations. Original plan undercounted.]**

### What IS Tested (Static Analysis)

- **Format consistency** via `tofu fmt`
- **Syntax validity** via `tofu validate` (catches HCL errors, missing required variables, provider issues)
- **Best practice linting** via `tflint` (catches deprecated syntax, invalid resource arguments)

### What Is NOT Tested

| Gap | Risk | Impact |
|-----|------|--------|
| Variable validation rules | Medium | Auth module has 3 validations + 4 preconditions. These enforce security constraints (HTTPS-only URLs, valid MFA values, required-together variables). Untested. |
| Checkov security scanning in CI | High | 5 modules with S3 buckets, IAM policies, CloudFront. Checkov runs locally but is absent from CI, meaning security regressions can merge undetected. |
| CSP header construction | High | `hosting/main.tf` builds Content-Security-Policy dynamically from variables using string interpolation. A missing space or semicolon could break the CSP or create security holes. No test verifies the generated CSP string. **[Security+Cloud: Promoted to P1. Add output to hosting module, test with `.tftest.hcl`.]** |
| IAM policy least-privilege | Medium | Pipeline IAM allows `ce:GetCostAndUsage`, `ce:GetCostCategories` on `*`, S3 actions scoped to bucket ARN. Auth IAM allows `s3:GetObject` on data bucket. No test validates these stay scoped correctly. **[Security: Checkov catches resource scope but not action scope widening. Add policy-as-code assertion.]** |
| Cross-module integration | Medium | Root `main.tf` wires 5 modules together with cross-references (bucket ARNs, domain names, Cognito IDs). `tofu validate` catches reference errors but not logical wiring mistakes. |
| `tofu plan` smoke test | Low | Would catch provider-specific issues that validate misses. **[Cloud: Replace with tflint deep rules for better ROI without credential requirements.]** |
| `terraform_data` provisioners | Low | `local-exec` provisioners (aws s3 sync, curl, tar) are outside Terraform's testing surface. **[Cloud: Acknowledged as untestable.]** |

---

## CI Pipeline

### Current State (`.github/workflows/ci.yml`)

| Job | Steps | Tests Run |
|-----|-------|-----------|
| Frontend | npm ci, audit, prettier, eslint, tsc, build | No tests |
| Python | uv sync, install, audit, ruff check, ruff format, pytest | 36 tests, no coverage |
| Terraform | fmt, init, validate, tflint | Static analysis only |

### Missing from CI

1. **Frontend tests** -- add `npm test` step after build **[Frontend: Emphasize this gates merges.]**
2. **Python coverage reporting** -- add pytest-cov with term-missing + HTML report, set threshold
3. **Checkov** -- security scanning for Terraform (no `--skip-check` flags; rely on inline annotations)
4. **Coverage artifacts/badges** -- visibility into project health

---

## Prioritized Improvement Plan

### P0 -- Critical (Must Have)

These address the most significant risks with the highest ROI.

#### P0-1: Install Vitest and test `format.ts` pure utility functions

**Rationale:** `format.ts` is used in every cost display across the entire app. Every component imports `formatUsd`, `formatChange`, `formatPeriodLabel`, or `formatBytes`. A regression here would corrupt all displayed numbers. These are pure functions with zero dependencies -- the easiest possible tests to write.

**Concrete test cases:**
```
format.test.ts:
- formatUsd: positive value, zero, large value, small decimal
- formatChange: increase (red), decrease (green), flat (<0.01), new (prev=0), negative delta
- formatChange: both current and previous are 0 (flat case)
- formatPeriodLabel: "2026-01" -> "Jan '26", "2025-12" -> "Dec '25"
- formatBytes: TB range, GB range, exact boundary (1 TB), 0 bytes
```

**Setup:** Install only `vitest` and `vite-tsconfig-paths` in Phase 1. Use `node` environment (not jsdom) for pure function tests. Create a separate `vitest.config.ts` — do NOT add test config to the main `vite.config.ts` that includes the `reactRouter()` plugin.

```ts
// vitest.config.ts
import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    include: ["app/**/*.test.{ts,tsx}"],
  },
});
```

**[Frontend: Install deps incrementally — `@testing-library/*` and `jsdom` only when component tests begin in P2.]**

**Effort:** ~2 hours (including Vitest setup)

#### P0-2: Add pytest-cov to lambda and establish coverage baseline

**Rationale:** Cannot improve what you cannot measure. The lambda pipeline is the data backbone -- if it produces wrong data, every downstream display is wrong.

**Action items:**
1. Add `pytest-cov` to `[dependency-groups] dev` in `pyproject.toml`
2. Add `--cov=dapanoskop --cov-report=term-missing --cov-report=html` to pytest config
3. Set `--cov-fail-under=70` initially, bump to 80% after P0/P1 tests land
4. Update CI to upload HTML report as artifact

**Effort:** ~30 minutes

#### P0-3: Test `collector.get_cost_and_usage()` pagination and categories

**Rationale:** The pagination loop in `get_cost_and_usage()` is the only code path that handles AWS API pagination. If it breaks, data is silently truncated.

**[Python: Moto does not support CE pagination simulation (no `NextPageToken` handling). Use `unittest.mock` for pagination logic, moto for basic CE integration.]**

**Concrete test cases:**
```
test_collector.py (additions):
- test_get_cost_and_usage_pagination_logic: mock CE client with NextPageToken,
  verify loop follows token and aggregates all pages (use unittest.mock.MagicMock)
- test_get_cost_and_usage_single_page: basic moto integration, returns groups
- test_get_cost_and_usage_empty_response: returns empty list
- test_get_cost_categories_discovers_first_category: when category_name=""
- test_get_cost_categories_empty: when no categories exist, returns {}
```

**Effort:** ~3 hours

#### P0-4: Add checkov to CI

**Rationale:** Checkov is documented as a project tool but absent from CI. Five modules manage S3 buckets, IAM roles, CloudFront distributions, and Cognito pools. Without checkov in CI, security regressions can merge unnoticed.

**[Cloud+Security: Do NOT use `--skip-check` flags. The codebase already has 27 inline `#checkov:skip` annotations with documented justifications on specific resources. Global `--skip-check` would suppress checks on future resources without requiring per-resource justification. Do NOT use `--soft-fail` — inline skips already make it pass clean.]**

**Action items:**
1. Add a checkov step to the Terraform CI job
2. Use `--framework terraform` to avoid scanning non-Terraform files (e.g., GitHub Actions YAML)
3. Zero `--skip-check` flags — rely exclusively on inline annotations

```yaml
- name: Install checkov
  run: pip install checkov

- name: Checkov
  run: checkov -d . --compact --quiet --framework terraform
```

**Effort:** ~1 hour

#### P0-5: Test `auth.ts` token validation and bypass logic [Promoted from P1-2]

**[Security: Auth is the single security gate for the entire application. Token expiry logic is accidentally safe (missing `exp` falls to catch block), not intentionally safe. Must be P0.]**

**Rationale:** `isAuthenticated()` parses JWT, checks expiry, and has a bypass path. A bug here either locks users out or lets unauthorized access through.

**Testing approach:** Use `vi.mock("~/lib/config", ...)` to mock `getConfig()`, then call `initAuth()` in test setup. Use `vi.resetModules()` between tests to reset module-level state. jsdom provides a working `sessionStorage` — no mock needed, just call `sessionStorage.setItem()` directly.

**Concrete test cases:**
```
auth.test.ts:
- isAuthenticated returns true when authBypass is true
- isAuthenticated returns false with no token in sessionStorage
- isAuthenticated returns true for valid unexpired token
- isAuthenticated returns false for expired token
- isAuthenticated returns false for malformed token (not valid base64)
- isAuthenticated returns false for token with no exp claim (pins accidental safety)
- isAuthenticated returns false for token with exp=0
- isAuthenticated returns false for token with non-numeric exp (NaN case)
- getAccessToken returns "bypass-token" in bypass mode
- generateCodeVerifier output is >= 43 chars (RFC 7636 minimum entropy)
- handleCallback cleans up pkce_verifier from sessionStorage after use
- handleCallback returns false when pkce_verifier is missing
- logout clears id_token, access_token, and refresh_token from sessionStorage
```

**[Security: Expanded test cases for PKCE, logout cleanup, and malformed token edge cases.]**

**Effort:** ~3 hours (including jsdom environment setup)

#### P0-6: Test `processor.update_index()` period parsing [Promoted from P1-3]

**[Python: Single point of failure for the entire UI period selector. Trivial to write (~30 min, not 1.5h). Promoted to P0.]**

**Rationale:** `update_index()` uses a condition (`len(p) == 7 and p[4] == "-"`) to parse S3 prefixes into period labels. If this breaks, the app's period selector shows corrupt data or no periods at all.

**Concrete test cases:**
```
test_processor.py (additions):
- test_update_index_creates_sorted_index: multiple periods in S3 -> reverse-sorted index.json
- test_update_index_ignores_non_period_prefixes: "logs/", "backup/" are excluded
- test_update_index_empty_bucket: empty bucket -> {"periods": []}
```

**Effort:** ~30 minutes

#### P0-7: Extract and test `UsageTypeTable` aggregation logic [Promoted from P1-1]

**[Frontend: This is the only client-side data computation users cannot cross-check. Wrong format is visually obvious ("$1,00.00"), but wrong aggregation produces plausible-looking wrong numbers. Promoted to P0.]**

**Rationale:** `UsageTypeTable.tsx` contains a `Map`-based aggregation that groups `UsageTypeCostRow[]` by `usage_type` and sums costs across three periods. Extract to `app/lib/aggregate.ts` and test as pure functions.

**Concrete test cases:**
```
aggregate.test.ts:
- groups rows by usage_type correctly
- sums current/prev/yoy periods independently
- handles rows with only current period (prev=0, yoy=0)
- sorts by current cost descending
- handles empty input
- handles same usage_type with different category across periods (documents first-wins behavior)
```

**Effort:** ~2 hours

### P1 -- Important (Should Have)

These add meaningful safety nets for business-critical logic.

#### P1-1: Test `config.ts` [New]

**[Frontend: Every other module depends on `getConfig()` — auth, data, credentials. A bug here breaks the entire app. Missing from original plan.]**

**Rationale:** `getConfig()` has caching logic, a fetch-with-fallback pattern, and the `authBypass` determination. It is the dependency root for the entire frontend.

**Concrete test cases:**
```
config.test.ts:
- returns config from /config.json when fetch succeeds
- falls back to VITE_* env vars when fetch fails
- caches result after first call (second call returns same object without fetch)
- authBypass is true only when VITE_AUTH_BYPASS === "true"
```

**Effort:** ~1.5 hours (mock `fetch` with `vi.stubGlobal`, mock env with `vi.stubEnv`)

#### P1-2: Test `processor.write_to_s3()` independently

**Rationale:** Currently only tested through the handler integration test. A direct test would verify: parquet schema correctness, `update_index_file=False` behavior, and handling of empty workload/usage_type rows.

**Concrete test cases:**
```
test_processor.py (additions):
- test_write_to_s3_creates_all_files: summary.json + 2 parquets + index.json
- test_write_to_s3_skip_index_update: update_index_file=False does not create index.json
- test_write_to_s3_empty_rows: no parquet files created when rows are empty
- test_write_to_s3_parquet_schema: verify column names and types in written parquets
```

**Effort:** ~2 hours

#### P1-3: Test `_parse_groups()` edge cases [New]

**[Python: CE API can return malformed groups. Current code tested only indirectly.]**

**Concrete test cases:**
```
test_processor.py (additions):
- test_parse_groups_empty_keys: {"Keys": [], ...} -> filtered out
- test_parse_groups_single_key: {"Keys": ["App$web"], ...} -> filtered out (expects 2 keys)
- test_parse_groups_missing_keys_field: {"Metrics": {...}} -> filtered out
```

**Effort:** ~1 hour

#### P1-4: Test storage metrics zero-division safety [New]

**[Python: No test for zero byte-hours path. Division by zero would crash.]**

**Concrete test cases:**
```
test_processor.py (additions):
- test_storage_metrics_zero_volume: no storage usage types -> total_volume_bytes=0,
  hot_tier_percentage=0.0, cost_per_tb_usd=0.0 (no crash)
```

**Effort:** ~30 minutes

#### P1-5: Test category pattern priority [New]

**[Python: `categories.py` uses first-match-wins. Reordering patterns silently breaks categorization.]**

**Concrete test cases:**
```
test_categories.py (additions):
- test_categorize_pattern_priority: EBS:VolumeUsage -> "Storage" (not "Other")
- test_categorize_pattern_priority: TimedStorage-ByteHrs -> "Storage" (not "Support")
```

**Effort:** ~30 minutes

#### P1-6: Test CSP header construction [New]

**[Security+Cloud: CSP is built dynamically via string interpolation with conditional variables. A malformed value could break the CSP or inject directives. Add an output to the hosting module exposing the computed CSP string, then test with `.tftest.hcl`.]**

**Approach:** Add `output "content_security_policy"` to `modules/hosting/outputs.tf`, then write a `tofu test` that asserts expected substrings. Requires `mock_provider "aws" {}` (OpenTofu >= 1.7).

**Concrete test cases:**
```
hosting_csp.tftest.hcl:
- All three connect-src variables populated -> valid CSP with all three origins
- All three connect-src variables empty -> connect-src is 'self' only
- frame-ancestors 'none' is always present (clickjacking protection)
- No double-spaces or missing semicolons
```

**Effort:** ~2 hours

#### P1-7: Test Terraform variable validations

**Rationale:** The auth module has 3 variable validation rules (`cognito_mfa_configuration`, `saml_metadata_url`, `oidc_issuer`). These enforce security constraints (HTTPS-only URLs, valid MFA values).

**[Cloud: Use `mock_provider "aws" {}` (OpenTofu >= 1.7) since even `command = plan` requires provider initialization. Place test at `terraform/modules/auth/auth_validations.tftest.hcl`.]**

**Concrete test cases:**
```hcl
mock_provider "aws" {}

run "mfa_invalid_value" {
  command = plan
  variables {
    cognito_mfa_configuration = "INVALID"
    callback_urls             = ["https://example.com"]
    data_bucket_arn           = "arn:aws:s3:::test-bucket"
  }
  expect_failures = [var.cognito_mfa_configuration]
}

run "saml_url_not_https" {
  command = plan
  variables {
    saml_metadata_url = "http://insecure.example.com/metadata"
    callback_urls     = ["https://example.com"]
    data_bucket_arn   = "arn:aws:s3:::test-bucket"
  }
  expect_failures = [var.saml_metadata_url]
}

run "oidc_issuer_not_https" {
  command = plan
  variables {
    oidc_issuer     = "http://insecure.example.com"
    callback_urls   = ["https://example.com"]
    data_bucket_arn = "arn:aws:s3:::test-bucket"
  }
  expect_failures = [var.oidc_issuer]
}
```

**Note:** The auth module also has 4 `lifecycle.precondition` blocks enforcing required-together variable semantics. These are evaluated at plan/apply time on specific resources and require the mock provider. Test these as a follow-up if the mock provider works for validation tests.

**Effort:** ~2 hours

#### P1-8: Extract and test DuckDB S3 config SQL generation [New]

**[Security: The single-quote escaping in `workload-detail.tsx` is the sole defense against SQL injection in DuckDB SET commands. Extract to a testable helper.]**

**Concrete test cases:**
```
duckdb-config.test.ts:
- escapes single quotes in region, accessKeyId, secretAccessKey, sessionToken
- produces valid SET statements
- handles empty string values
```

**Effort:** ~1 hour

### P2 -- Nice to Have (Valuable but Lower Priority)

#### P2-1: Component rendering tests with testing-library

**Rationale:** Verify that components render correct structure and respond to props. Lower priority than pure logic tests because Tailwind styling issues are visual, not functional.

**[Frontend: When adding component tests, include Tailwind plugin in vitest config or use `css: false` to stub CSS imports. Consider `@vitejs/plugin-react` if esbuild JSX handling is insufficient.]**

**Candidates:**
- `CostChange` renders correct arrow direction and color class
- `TaggingCoverage` renders correct percentage bar width
- `PeriodSelector` calls `onSelect` with correct period
- `CostCenterCard` toggles expansion on click; does not crash on empty workloads
- `WorkloadTable` applies anomaly highlight at threshold; flags new workloads
- `StorageOverview` renders all three metric cards

**Effort:** ~4 hours (including @testing-library/react + jsdom setup)

#### P2-2: Test `collector.collect()` end-to-end with moto

**[Python: Upgraded from Low to Medium risk. collect() orchestrates three critical API calls and constructs period_labels. Handler tests mock it entirely.]**

**Rationale:** Full integration test of the collector with mocked Cost Explorer API. Verifies `collect()` integrates correctly with the boto3 CE client.

**Effort:** ~3 hours (moto's CE support may have limitations)

#### P2-3: Test handler error resilience

**Rationale:** What happens when `process()` raises during backfill? When `write_to_s3()` fails mid-batch? The handler catches per-month exceptions and continues.

**Concrete test cases:**
```
test_handler.py (additions):
- test_handler_backfill_partial_failure: one month fails, others succeed -> 207 status
- test_handler_backfill_s3_write_failure: write_to_s3 fails on second call, other months succeed
- test_handler_missing_data_bucket_env: raises ValueError
- test_handler_normal_mode_exception: propagates to caller
- test_handler_error_response_no_arn_leak: verify error messages do not contain AWS account IDs
```

**[Security: Add error sanitization test. Consider sanitizing `str(e)` to a fixed string.]**
**[Python: Add S3 write failure test — realistic scenario (throttling, permission changes).]**

**Effort:** ~2 hours

#### P2-4: Add `data.ts` fetch/S3 path tests

**Rationale:** `data.ts` has two code paths: local bypass (fetch from `/data/`) and production (S3 SDK). Testing both paths ensures data loading works regardless of environment.

**[Security: Add path traversal test — `period` parameter from URL search params has no validation inside `fetchSummary`. A value like `../../etc/passwd` would work against the local sirv server in dev mode. Add period format validation inside `fetchSummary` itself.]**

**Concrete test cases:**
```
data.test.ts:
- fetchSummary fetches correct URL in bypass mode
- fetchSummary uses S3 client in production mode
- fetchSummary rejects malicious period values (path traversal)
- discoverPeriods returns sorted period list
```

**Effort:** ~2 hours

#### P2-5: IAM policy regression tests [New]

**[Security: Checkov checks resource scope but not action scope. If someone adds `s3:*` or `iam:*` to the Lambda role, checkov won't catch it.]**

**Approach:** Write a `tofu test` that plans the pipeline module and asserts the IAM policy JSON contains exactly the expected action set.

**Effort:** ~2 hours

#### P2-6: Terraform tflint deep rules [Replaced P2-5 tofu plan smoke test]

**[Cloud: Replace `tofu plan` smoke test with tflint deep inspection rules. Better ROI without credential requirements. The `archive_file` data source creates cross-subsystem CI dependencies.]**

**Approach:** Enable specific AWS-provider rules in `.tflint.hcl` beyond the `recommended` preset.

**Effort:** ~1 hour

---

## Implementation Roadmap

### Phase 1: Foundation (Week 1)

| ID | Task | Effort | Subsystem |
|----|------|--------|-----------|
| P0-1 | Install Vitest, test `format.ts` | 2h | app/ |
| P0-2 | Add pytest-cov, establish baseline | 0.5h | lambda/ |
| P0-4 | Add checkov to CI (no `--skip-check` flags) | 1h | terraform/ |
| P0-6 | Test `update_index()` period parsing | 0.5h | lambda/ |

**Outcome:** Test infrastructure in place for app/, coverage visibility for lambda/, security scanning for terraform/.

### Phase 2: Security + Critical Logic (Week 2)

| ID | Task | Effort | Subsystem |
|----|------|--------|-----------|
| P0-3 | Test collector pagination + categories (mock + moto) | 3h | lambda/ |
| P0-5 | Test auth.ts token validation (expanded security cases) | 3h | app/ |
| P0-7 | Extract and test UsageTypeTable aggregation | 2h | app/ |

**Outcome:** The three highest-risk logic areas (data collection, auth, client-side aggregation) have dedicated tests.

### Phase 3: Depth (Week 3)

| ID | Task | Effort | Subsystem |
|----|------|--------|-----------|
| P1-1 | Test `config.ts` | 1.5h | app/ |
| P1-2 | Test `write_to_s3()` independently | 2h | lambda/ |
| P1-3 | Test `_parse_groups()` edge cases | 1h | lambda/ |
| P1-4 | Test storage metrics zero-division | 0.5h | lambda/ |
| P1-5 | Test category pattern priority | 0.5h | lambda/ |

**Outcome:** Lambda coverage reaches ~85%+. Config dependency root is tested.

### Phase 4: Terraform + Security Hardening (Week 4)

| ID | Task | Effort | Subsystem |
|----|------|--------|-----------|
| P1-6 | Test CSP header construction | 2h | terraform/ |
| P1-7 | Test Terraform variable validations | 2h | terraform/ |
| P1-8 | Extract and test DuckDB S3 config SQL escaping | 1h | app/ |

**Outcome:** Terraform security constraints are verified. SQL injection defense is pinned.

### Phase 5: Polish (Week 5+)

| ID | Task | Effort | Subsystem |
|----|------|--------|-----------|
| P2-1 | Component rendering tests | 4h | app/ |
| P2-2 | Collector e2e with moto | 3h | lambda/ |
| P2-3 | Handler error resilience + sanitization | 2h | lambda/ |
| P2-4 | data.ts fetch/S3 paths + path traversal | 2h | app/ |
| P2-5 | IAM policy regression tests | 2h | terraform/ |
| P2-6 | tflint deep rules | 1h | terraform/ |

**Outcome:** Comprehensive coverage across all subsystems.

### Tech Debt (Anytime)

| Task | Subsystem |
|------|-----------|
| Extract handler test S3 setup to conftest.py fixture (DRY) | lambda/ |
| Fix `CostCenterCard.tsx` empty-workloads crash | app/ |
| Fix `WorkloadTable.tsx` anomaly threshold for new workloads (prev=0) | app/ |
| Add period format validation inside `fetchSummary()` | app/ |
| Consider sanitizing `str(e)` in backfill error responses | lambda/ |

---

## Appendix: Test Framework Setup Recommendations

### app/ -- Vitest Setup

**Phase 1 (pure function tests):**
```bash
npm install -D vitest vite-tsconfig-paths
```

**Phase 2+ (component tests):**
```bash
npm install -D @testing-library/react @testing-library/jest-dom jsdom
```

Create `vitest.config.ts` (NOT in `vite.config.ts` — the `reactRouter()` plugin interferes with test execution):
```ts
import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    include: ["app/**/*.test.{ts,tsx}"],
    // For component tests, add:
    // environment: "jsdom",
    // css: false,
  },
});
```

Add to `package.json`:
```json
"scripts": {
  "test": "vitest run",
  "test:watch": "vitest"
}
```

**Add `npm test` to `.github/workflows/ci.yml` frontend job to gate merges.**

### lambda/ -- pytest-cov Setup

Add to `[dependency-groups] dev` in `pyproject.toml`:
```toml
dev = [
    "pytest",
    "pytest-cov",
    # ... existing deps
]
```

Add to `[tool.pytest.ini_options]`:
```toml
[tool.pytest.ini_options]
testpaths = ["tests"]
addopts = "--cov=dapanoskop --cov-report=term-missing --cov-report=html --cov-fail-under=70"
```

### terraform/ -- Checkov CI Step

Add to `.github/workflows/ci.yml` terraform job:
```yaml
- name: Install checkov
  run: pip install checkov

- name: Checkov
  run: checkov -d . --compact --quiet --framework terraform
```

**No `--skip-check` flags. No `--soft-fail`. Inline `#checkov:skip` annotations handle all known exemptions.**

---

## Appendix: What We Deliberately Do NOT Recommend Testing

1. **React Router framework boilerplate** (`root.tsx` Layout/App components) -- these are thin wrappers around framework primitives with zero custom logic.

2. **TypeScript type definitions** (`types/cost-data.ts`) -- these have no runtime behavior. TypeScript compilation already validates type correctness.

3. **Terraform resource configuration details** -- testing that an S3 bucket has `block_public_acls = true` is redundant with checkov (which checks the same thing with maintained rulesets). We rely on checkov for security posture validation.

4. **CSS/styling** -- Tailwind class names are not testable in a meaningful way through unit tests. Visual regression testing (e.g., Chromatic, Percy) would be the appropriate tool if needed.

5. **`workload-detail.tsx` DuckDB integration** -- This route lazy-loads DuckDB-wasm, configures S3 credentials or HTTP fetch, runs SQL queries, and parses Arrow results. Testing this end-to-end in Vitest would require a DuckDB-wasm mock that mirrors the real API surface. The effort-to-value ratio is poor for unit tests. This is a candidate for a future browser-based e2e test (e.g., Playwright) rather than a Vitest unit test. **However, the SQL generation for S3 credential configuration should be extracted and tested independently (see P1-8).**

6. **`terraform_data` provisioner resources** -- `local-exec` provisioners (`aws s3 sync`, `curl`, `tar`) are outside Terraform's testing surface area. A broken CLI command or changed URL structure would not be caught. **[Cloud: Acknowledged as an accepted limitation.]**
