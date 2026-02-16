# Change Proposal: Replace S3 Inventory with S3 Storage Lens

**Date**: 2026-02-16
**Status**: Proposal
**Author**: Requirements Engineering Agent

## Executive Summary

The recently implemented "S3 Inventory" feature was based on a misunderstanding of the user's intent. The actual requirement is to integrate **S3 Storage Lens** data, not S3 Inventory. This document catalogs the current S3 Inventory implementation and proposes the changes needed to migrate to S3 Storage Lens.

---

## Current State: S3 Inventory Implementation

### What S3 Inventory Does

The current implementation reads S3 Inventory data (CSV or Parquet format) delivered to a specified S3 bucket and prefix. It:

1. **Discovers inventory configurations** under the specified prefix (up to 2 levels deep, e.g., `inventory/{source-bucket}/{config-name}/`)
2. **Finds the latest manifest** by sorting date-stamped folders (`YYYY-MM-DDT00-00Z/`)
3. **Reads manifest.json** to identify the list of CSV data files
4. **Parses CSV data files** (gzip-compressed) to sum the `Size` column and count objects
5. **Aggregates per source bucket** to produce a breakdown of total bytes and object count per bucket
6. **Enriches summary.json** with `storage_inventory` object containing per-bucket breakdowns
7. **Displays in UI**:
   - "Total Stored" metric card on main report (when inventory data is available)
   - Clickable link to `/storage` deep dive page
   - Storage deep dive table showing bucket name, size, object count, % of total

### Data Flow

```
S3 Inventory Bucket
  └─ {prefix}/{source-bucket}/{config}/YYYY-MM-DDT00-00Z/
       ├─ manifest.json
       └─ data/part-0.csv.gz

      ↓ (Lambda reads via boto3 S3 API)

Lambda (inventory.py)
  - get_inventory_total_bytes() → int | None
  - get_inventory_bucket_summary() → list[dict] | None

      ↓ (enriches processed summary)

summary.json
  storage_metrics:
    inventory_total_bytes: 123456789
  storage_inventory:
    buckets:
      - source_bucket: "my-bucket"
        total_bytes: 123456789
        object_count: 987

      ↓ (SPA fetches via S3 SDK)

UI (StorageOverview.tsx, storage.tsx)
  - Shows "Total Stored" metric with inventory_total_bytes
  - Shows per-bucket breakdown table on /storage page
```

### Configuration

**Terraform Variables** (root and pipeline module):
- `inventory_bucket` (string, default `""`) — S3 bucket containing S3 Inventory delivery
- `inventory_prefix` (string, default `""`) — S3 prefix to the inventory config (e.g., `inventory/source-bucket/AllObjects`)

**Lambda Environment Variables**:
- `INVENTORY_BUCKET` — set from Terraform variable
- `INVENTORY_PREFIX` — set from Terraform variable

**IAM Permissions** (Lambda role):
- `s3:GetObject` on `arn:aws:s3:::{inventory_bucket}/{inventory_prefix}/*`
- `s3:ListBucket` on `arn:aws:s3:::{inventory_bucket}`

### Implementation Files

**Python (Lambda):**
- `lambda/src/dapanoskop/inventory.py` — 278 lines
  - `_list_prefixes()` — list immediate sub-prefixes
  - `_is_date_folder()` — check if prefix is a date folder
  - `_find_latest_manifest()` — find most recent inventory manifest
  - `_discover_configs()` — discover inventory config paths (up to 2 levels)
  - `_read_manifest()` — download and parse manifest.json
  - `_resolve_dest_bucket()` — extract destination bucket from manifest
  - `_aggregate_csv()` — sum Size column from CSV data files
  - `_aggregate_parquet()` — sum Size column from Parquet data files
  - `_read_config_inventory()` — read inventory for a single config
  - `get_inventory_total_bytes()` — public API: return total bytes across all configs
  - `get_inventory_bucket_summary()` — public API: return per-bucket breakdown
- `lambda/src/dapanoskop/handler.py` — lines 21-42
  - `_enrich_with_inventory()` — calls inventory functions and enriches processed summary

**Python (Tests):**
- `lambda/tests/test_inventory.py` — 266 lines, 11 test cases covering:
  - Reading inventory and summing object sizes
  - Selecting latest manifest from multiple date folders
  - Graceful handling when no inventory exists
  - Disabled inventory (empty bucket/prefix)
  - Missing Size column in schema
  - Single-config bucket summary
  - Multi-bucket discovery and aggregation
  - Total bytes summing across multiple configs

**Terraform:**
- `terraform/modules/pipeline/main.tf` — lines 92-105
  - Conditional IAM policy statement for S3 Inventory bucket read access
- `terraform/modules/pipeline/variables.tf` — lines 35-45
  - `inventory_bucket` variable definition
  - `inventory_prefix` variable definition
- `terraform/variables.tf` — lines 139-149
  - Root-level variable definitions for inventory_bucket/inventory_prefix
- `terraform/main.tf` — lines 73-74
  - Pass-through of inventory variables to pipeline module

**Frontend (TypeScript/React):**
- `app/app/types/cost-data.ts` — lines 15-28
  - `StorageInventory` interface
  - `BucketSummary` interface
  - `StorageMetrics.inventory_total_bytes` optional field
- `app/app/components/StorageOverview.tsx` — lines 27-28, 47-85
  - Conditional rendering of "Total Stored" metric card when `inventory_total_bytes` is present
  - Conditional link to `/storage` page when inventory data is available
- `app/app/routes/storage.tsx` — 286 lines
  - Full storage deep dive page
  - Fetches summary.json and displays per-bucket breakdown table
  - Shows "Total Stored", "Storage Cost", "Cost / TB" metric cards
  - Renders bucket table with source_bucket, total_bytes, object_count, % of total

**Documentation:**
- `docs/URS.md` — 3 requirements
  - URS-DP-10106: Configure S3 Inventory Integration
  - URS-DP-10312: View Actual Storage Volume
  - URS-DP-10313: Investigate Storage Per Bucket
- `docs/SRS.md` — 3 requirements
  - SRS-DP-310213: Display Actual Storage Volume Metric (Total Stored card)
  - SRS-DP-310214: Navigate to Storage Deep Dive
  - SRS-DP-420108: Query S3 Inventory for Actual Storage Volume
  - Section 3.3.3: Storage Deep Dive Screen specification (table 12-13)
- `docs/SDS.md` — 4 requirements + design section
  - SDS-DP-020204: Write Summary JSON with Inventory Data
  - SDS-DP-020301: Discover Inventory Configurations
  - SDS-DP-020302: Read Latest Manifest
  - SDS-DP-020303: Aggregate Size and Object Count
  - SDS-DP-030301: Provision Lambda with Inventory Support (IAM permissions)
  - Section 3.2.3: C-2.3 Inventory Reader component description
  - Section 4.4.3: `storage_inventory` schema in summary.json

---

## Proposed Change: Migrate to S3 Storage Lens

### What S3 Storage Lens Provides

Based on the reference implementation (`/Users/martin/Development/vizgen/devops-scripts/vz_aws/s3/storage_lens.py`), S3 Storage Lens is a more comprehensive storage analytics service that:

1. **Operates at organization level** (not bucket-by-bucket)
2. **Provides two data export mechanisms**:
   - **S3 CSV Export**: Daily CSV reports delivered to an S3 bucket (similar to Inventory in structure)
   - **CloudWatch Metrics Export**: Real-time metrics published to CloudWatch
3. **Delivers richer metrics** beyond just storage bytes:
   - `StorageBytes` — total storage volume (equivalent to Inventory's Size sum)
   - `ObjectCount` — total object count
   - `CurrentVersionObjectCount` — objects excluding delete markers
   - `EncryptedBytes`, `ReplicatedBytes`, etc.
   - Storage class breakdowns (STANDARD, STANDARD_IA, GLACIER, etc.)
   - Prefix-level metrics (for deduplication analysis)
4. **Requires organization-wide configuration** via S3 Control API
5. **Aggregates across multiple storage classes** automatically
6. **Historical data** is available via CloudWatch metric queries

### Key Differences from S3 Inventory

| Aspect | S3 Inventory | S3 Storage Lens |
|--------|--------------|-----------------|
| **Scope** | Per-bucket, configured individually | Org-wide, single configuration |
| **Configuration API** | S3 Bucket Inventory API | S3 Control API (`s3control:GetStorageLensConfiguration`) |
| **Data Source** | CSV/Parquet files with per-object rows | Aggregated CSV reports or CloudWatch metrics |
| **Granularity** | Object-level (one row per object) | Bucket-level, prefix-level, storage-class-level aggregates |
| **Metrics** | Object metadata (size, storage class, encryption, etc.) | Aggregated storage metrics (total bytes, object count, per storage class) |
| **Delivery Frequency** | Daily or weekly | Daily (CSV) or near-real-time (CloudWatch) |
| **Discovery** | Manual prefix walking to find bucket/config paths | API-driven: list configurations, check org-wide flag |
| **Cost** | Storage for CSV/Parquet files (~$0.023/GB-month for S3 Standard) | Storage for CSV exports + CloudWatch Metrics charges (if enabled) |
| **Use Case** | Compliance, lifecycle policy validation, per-object analysis | Cost analytics, storage optimization, org-wide visibility |

### Recommended Data Source: CloudWatch Metrics

The reference implementation demonstrates two approaches:

1. **S3 CSV Export** (`find_and_download_org_storage_lens_report()`): Downloads CSV reports from S3, parses them locally
2. **CloudWatch Metrics** (`get_storage_lens_metrics()`): Queries CloudWatch API for `StorageBytes`, `ObjectCount`, etc.

**Recommendation**: Use **CloudWatch Metrics** approach for Dapanoskop because:
- No need to download/parse CSV files (simpler Lambda code)
- Real-time data availability (CSV reports lag by up to 48 hours)
- Built-in aggregation across storage classes and regions
- CloudWatch API provides time-series data (can query historical storage volume)
- Lower Lambda execution time (CloudWatch query vs. S3 download + CSV parsing)

**Trade-offs**:
- CloudWatch Metrics must be explicitly enabled in Storage Lens configuration
- CloudWatch charges apply (but minimal: $0.01 per 1,000 metric requests; Dapanoskop would make ~1-3 requests/day)
- Bucket-level breakdown requires parsing CSV export **or** multiple CloudWatch queries with dimension filters

### Migration Approach

**Option A: CloudWatch Metrics Only** (Recommended)
- Query `StorageBytes` and `ObjectCount` metrics for org-wide totals
- Display org-wide storage volume on main report
- Remove per-bucket breakdown (or add a note: "Enable CSV export for bucket-level breakdown")

**Option B: Hybrid (CloudWatch + CSV)**
- Query CloudWatch for org-wide `StorageBytes` (fast, real-time)
- Download/parse CSV export for per-bucket breakdown (if user wants `/storage` page)
- More complex, but preserves current UX

**Option C: CSV Only**
- Download/parse CSV reports (similar to current S3 Inventory approach)
- Simpler migration (fewer code changes)
- Slower, requires CSV export enabled

**Proposed: Option A** for initial migration (simplest, fastest, most cost-effective), with Option B as a follow-up enhancement if per-bucket breakdown is critical.

---

## Affected Files

### Python (Lambda)

**Files to Modify:**

1. **`lambda/src/dapanoskop/inventory.py` → `lambda/src/dapanoskop/storage_lens.py`**
   - Rename module to reflect new data source
   - **New functions**:
     - `_get_org_config_with_export()` — find org-wide Storage Lens configuration with CloudWatch metrics enabled (port from reference)
     - `_list_storage_lens_metrics()` — list all metric combinations for a given metric name (port from reference)
     - `_build_metric_stat_queries()` — build CloudWatch metric data queries (port from reference)
     - `_convert_metric_data_to_datapoints()` — convert CloudWatch results to datapoint format (port from reference)
     - `get_storage_lens_metrics()` — query CloudWatch for `StorageBytes` and `ObjectCount` (port from reference)
   - **Remove functions** (specific to S3 Inventory):
     - `_list_prefixes()`
     - `_is_date_folder()`
     - `_find_latest_manifest()`
     - `_discover_configs()`
     - `_read_manifest()`
     - `_resolve_dest_bucket()`
     - `_aggregate_csv()`
     - `_aggregate_parquet()`
     - `_read_config_inventory()`
   - **Update functions**:
     - `get_inventory_total_bytes()` → `get_storage_lens_total_bytes()`
       - Call `get_storage_lens_metrics()` with `metric_names=["StorageBytes"]`
       - Extract latest datapoint value
       - Return `int | None`
     - `get_inventory_bucket_summary()` → remove (not supported in CloudWatch-only approach) or stub with "Not available"

2. **`lambda/src/dapanoskop/handler.py`**
   - Update imports: `from dapanoskop.storage_lens import get_storage_lens_total_bytes`
   - Rename function: `_enrich_with_inventory()` → `_enrich_with_storage_lens()`
   - Update logic:
     - Remove call to `get_inventory_bucket_summary()` (or stub it)
     - Call `get_storage_lens_total_bytes()` instead of `get_inventory_total_bytes()`
     - Update log messages to reference "Storage Lens" instead of "Inventory"
   - Update environment variable references:
     - `STORAGE_LENS_CONFIG_ID` (new) — optional: specific Storage Lens config ID to use
     - Remove: `INVENTORY_BUCKET`, `INVENTORY_PREFIX`

**Files to Rewrite:**

3. **`lambda/tests/test_inventory.py` → `lambda/tests/test_storage_lens.py`**
   - Rewrite all tests to mock CloudWatch API (`boto3.client("cloudwatch")`) instead of S3 API
   - Mock `list_storage_lens_configurations()` and `get_storage_lens_configuration()` from S3 Control API
   - Mock `list_metrics()` and `get_metric_data()` from CloudWatch API
   - Test cases:
     - Discover org-wide Storage Lens config with CloudWatch metrics enabled
     - Query `StorageBytes` and `ObjectCount` metrics
     - Handle missing Storage Lens configuration
     - Handle CloudWatch metrics disabled
     - Handle CloudWatch API errors

### Terraform

**Files to Modify:**

4. **`terraform/modules/pipeline/main.tf`**
   - **Update IAM policy** (lines 92-105):
     - **Add permissions**:
       ```hcl
       # S3 Control API for Storage Lens configuration discovery
       {
         Effect = "Allow"
         Action = [
           "s3:ListStorageLensConfigurations",
           "s3:GetStorageLensConfiguration",
         ]
         Resource = "*"  # S3 Control actions do not support resource-level permissions
       },
       # CloudWatch API for Storage Lens metrics
       {
         Effect = "Allow"
         Action = [
           "cloudwatch:ListMetrics",
           "cloudwatch:GetMetricData",
         ]
         Resource = "*"  # CloudWatch actions do not support resource-level permissions
       }
       ```
     - **Remove**:
       - Conditional S3 Inventory bucket read permissions (lines 93-105)
   - **Update Lambda environment variables** (lines 136-149):
     - **Remove**: `INVENTORY_BUCKET`, `INVENTORY_PREFIX`
     - **Add** (optional): `STORAGE_LENS_CONFIG_ID` (if user wants to specify a config; otherwise, Lambda auto-discovers)

5. **`terraform/modules/pipeline/variables.tf`**
   - **Remove variables** (lines 35-45):
     - `inventory_bucket`
     - `inventory_prefix`
   - **Add variable** (optional):
     ```hcl
     variable "storage_lens_config_id" {
       description = "Storage Lens configuration ID to use. Leave empty to auto-discover the first org-wide config with CloudWatch metrics enabled."
       type        = string
       default     = ""
     }
     ```

6. **`terraform/variables.tf`**
   - **Remove variables** (lines 139-149):
     - `inventory_bucket`
     - `inventory_prefix`
   - **Add variable** (optional):
     ```hcl
     variable "storage_lens_config_id" {
       description = "Storage Lens configuration ID to use. Leave empty to auto-discover."
       type        = string
       default     = ""
     }
     ```

7. **`terraform/main.tf`**
   - **Update pipeline module call** (lines 73-74):
     - **Remove**: `inventory_bucket`, `inventory_prefix`
     - **Add** (optional): `storage_lens_config_id = var.storage_lens_config_id`

### Frontend (TypeScript/React)

**Option A (CloudWatch-only): Remove per-bucket breakdown**

8. **`app/app/types/cost-data.ts`**
   - **Keep**: `StorageMetrics.inventory_total_bytes` (rename to `storage_lens_total_bytes` or keep for backward compat)
   - **Remove**: `StorageInventory` interface, `BucketSummary` interface
   - **Update**: `CostSummary.storage_inventory` → remove or change to `storage_lens?: { total_bytes: number; object_count: number; timestamp: string }`

9. **`app/app/components/StorageOverview.tsx`**
   - **Update**: "Total Stored" metric card tooltip — change "S3 Inventory" references to "S3 Storage Lens"
   - **Remove**: Link to `/storage` page (lines 76-85) — or change to a note: "Per-bucket breakdown requires Storage Lens CSV export"

10. **`app/app/routes/storage.tsx`**
    - **Option A**: Remove entire route (or stub it with "Not available in CloudWatch-only mode")
    - **Option B** (if CSV export is added): Update to parse CSV data instead of `storage_inventory.buckets`

**Option B (Hybrid): Keep per-bucket breakdown, add CSV parsing**

If CSV export is supported, the frontend changes are minimal:
- Update `storage_inventory` data structure to match Storage Lens CSV schema (bucket-level, not object-level)
- Update tooltips to reference "Storage Lens" instead of "Inventory"

### Documentation

**Files to Update:**

11. **`docs/URS.md`**
    - **Update requirements**:
      - **URS-DP-10106**: Change title to "Configure S3 Storage Lens Integration"
        - Update text: "A DevOps engineer optionally configures S3 Storage Lens integration by enabling CloudWatch metrics export (or specifying a Storage Lens configuration ID), so that Dapanoskop displays actual total storage volume (in bytes) from org-wide storage metrics."
      - **URS-DP-10312**: Update text: "...derived from S3 Storage Lens CloudWatch metrics when configured..."
      - **URS-DP-10313**: Update text: "A Budget Owner views per-bucket storage breakdown, derived from S3 Storage Lens CSV export when configured..." OR "...this feature requires S3 Storage Lens CSV export (CloudWatch metrics provide org-wide totals only)"
    - **Update change history** (end of document): Add entry for v0.11 documenting the migration from S3 Inventory to S3 Storage Lens

12. **`docs/SRS.md`**
    - **Update requirements**:
      - **SRS-DP-310213**: Update text: "When S3 Storage Lens integration is configured, the system displays... read from S3 Storage Lens CloudWatch metrics. If CloudWatch metrics are unavailable..."
      - **SRS-DP-310214**: Update text or mark as optional: "When S3 Storage Lens CSV export data is available, the 'Total Stored' metric card... (Note: CloudWatch metrics provide org-wide totals only; per-bucket breakdown requires CSV export)"
      - **SRS-DP-420108**: Rename to "Query S3 Storage Lens for Actual Storage Volume"
        - Update text: "The pipeline queries the S3 Control API to discover the org-wide Storage Lens configuration with CloudWatch metrics enabled. It then queries CloudWatch Metrics for `StorageBytes` and `ObjectCount` metrics (namespace `AWS/S3/Storage-Lens`, dimensions `organization_id`, `record_type=ORGANIZATION`). The latest datapoint value is used as the actual storage volume."
    - **Update table 12 (Storage Deep Dive Screen)**: Add note that per-bucket breakdown requires CSV export, or remove table entirely if CSV export is not supported
    - **Update change history**: Add entry for SRS v0.11

13. **`docs/SDS.md`**
    - **Update component description** (Section 3.2.3):
      - Rename "C-2.3: Inventory Reader" → "C-2.3: Storage Lens Reader"
      - Update purpose: "Queries S3 Control API to discover org-wide Storage Lens configurations, then queries CloudWatch Metrics for `StorageBytes` and `ObjectCount`."
      - Update interfaces:
        - **Inbound**: Invoked by Lambda handler when Storage Lens integration is desired (no env var check needed; auto-discovers)
        - **Outbound**: S3 Control API (`ListStorageLensConfigurations`, `GetStorageLensConfiguration`), CloudWatch API (`ListMetrics`, `GetMetricData`)
      - Update variability: "Storage Lens config ID can be specified via `STORAGE_LENS_CONFIG_ID` env var, or the Lambda auto-discovers the first org-wide config with CloudWatch metrics enabled."
    - **Update requirements**:
      - **SDS-DP-020301**: Rename to "Discover Storage Lens Configuration"
        - Update text: "The Storage Lens Reader calls `s3control.list_storage_lens_configurations()` to list all configurations in the account. It filters for org-wide configurations (those with an `AwsOrg` key) that have `DataExport.CloudWatchMetrics.IsEnabled=true`. It selects the first matching configuration, or uses the config ID from `STORAGE_LENS_CONFIG_ID` env var if specified."
      - **SDS-DP-020302**: Rename to "Query CloudWatch Metrics for Storage Volume"
        - Update text: "The Storage Lens Reader calls `cloudwatch.list_metrics(Namespace='AWS/S3/Storage-Lens', MetricName='StorageBytes', Dimensions=[organization_id, record_type=ORGANIZATION])` to discover metric combinations (storage classes, regions). It then calls `cloudwatch.get_metric_data()` with a time range of the last 7 days (or the target reporting month) and aggregates values across all dimension combinations to produce org-wide total bytes and object count."
      - **SDS-DP-020303**: Rename or remove (was CSV-specific aggregation)
      - **SDS-DP-020204**: Update text to reference Storage Lens metrics instead of Inventory
    - **Update Section 4.4.3** (summary.json schema):
      - Update `storage_inventory` field:
        - Option A (CloudWatch-only): Change to `"storage_lens": { "total_bytes": 123456789, "object_count": 987, "timestamp": "2026-02-15T12:00:00Z" }` (no per-bucket breakdown)
        - Option B (CSV): Keep structure but update comments to reference Storage Lens CSV export
    - **Update Section 7** (Design Decisions): Add §7.X explaining why Storage Lens was chosen over S3 Inventory (org-wide visibility, richer metrics, CloudWatch integration)
    - **Update change history**: Add entry for SDS v0.13

---

## Migration Notes

### Terraform Variable Changes

**Before (S3 Inventory):**
```hcl
module "dapanoskop" {
  source = "github.com/cytario/dapanoskop//terraform?ref=v1.9.0"

  inventory_bucket = "my-inventory-bucket"
  inventory_prefix = "inventory/"
}
```

**After (S3 Storage Lens):**
```hcl
module "dapanoskop" {
  source = "github.com/cytario/dapanoskop//terraform?ref=v2.0.0"

  # No configuration needed — Lambda auto-discovers org-wide Storage Lens config
  # Optional: specify a config ID if you have multiple
  # storage_lens_config_id = "my-org-storage-lens"
}
```

### IAM Permissions Changes

**Before (S3 Inventory):**
- `s3:GetObject` on `arn:aws:s3:::my-inventory-bucket/inventory/*`
- `s3:ListBucket` on `arn:aws:s3:::my-inventory-bucket`

**After (S3 Storage Lens):**
- `s3:ListStorageLensConfigurations` on `*` (S3 Control API)
- `s3:GetStorageLensConfiguration` on `*` (S3 Control API)
- `cloudwatch:ListMetrics` on `*` (CloudWatch API)
- `cloudwatch:GetMetricData` on `*` (CloudWatch API)

### Data Model Changes

**Before (S3 Inventory):**
```json
{
  "storage_metrics": {
    "inventory_total_bytes": 123456789,
    ...
  },
  "storage_inventory": {
    "buckets": [
      {
        "source_bucket": "my-bucket",
        "total_bytes": 123456789,
        "object_count": 987
      }
    ]
  }
}
```

**After (S3 Storage Lens — Option A: CloudWatch-only):**
```json
{
  "storage_metrics": {
    "storage_lens_total_bytes": 123456789,
    "storage_lens_object_count": 987,
    ...
  },
  "storage_lens": {
    "total_bytes": 123456789,
    "object_count": 987,
    "timestamp": "2026-02-15T12:00:00Z",
    "config_id": "my-org-storage-lens",
    "org_id": "o-abc123"
  }
}
```

**After (S3 Storage Lens — Option B: CSV + CloudWatch):**
```json
{
  "storage_metrics": {
    "storage_lens_total_bytes": 123456789,
    ...
  },
  "storage_lens": {
    "total_bytes": 123456789,
    "object_count": 987,
    "timestamp": "2026-02-15T12:00:00Z",
    "buckets": [
      {
        "bucket_name": "my-bucket",
        "account_id": "123456789012",
        "storage_bytes": 123456789,
        "object_count": 987,
        "storage_class": "STANDARD"  // or aggregated across classes
      }
    ]
  }
}
```

### User Prerequisites

**Before (S3 Inventory):**
- User must manually configure S3 Inventory on each bucket they want to monitor
- User must create an S3 destination bucket for inventory delivery
- User must provide the destination bucket and prefix to Terraform

**After (S3 Storage Lens):**
- User must have an **org-wide Storage Lens configuration** already set up in their AWS Organization
- The Storage Lens configuration must have **CloudWatch Metrics export enabled**
- (Optional for per-bucket breakdown) The configuration must have **S3 CSV export enabled**
- Dapanoskop auto-discovers the configuration — no Terraform variables required

**Migration Guidance for Users:**
1. Create an org-wide Storage Lens configuration via AWS Console or CLI:
   - Navigate to S3 → Storage Lens → Dashboards → Create Dashboard
   - Set scope to "Organization"
   - Enable "CloudWatch publishing" (required for Dapanoskop)
   - (Optional) Enable "Metrics export" to S3 (for per-bucket breakdown)
2. Remove `inventory_bucket` and `inventory_prefix` from Terraform configuration
3. (Optional) Add `storage_lens_config_id` if you have multiple configs
4. Re-deploy Dapanoskop (`terraform apply`)

---

## Requirements Impact

### URS (User Requirements) — Version 0.10 → 0.11

**Requirements to Update:**

- **URS-DP-10106**: Configure S3 Inventory Integration → Configure S3 Storage Lens Integration
  - Change from bucket/prefix configuration to auto-discovery of org-wide config
- **URS-DP-10312**: View Actual Storage Volume
  - Update to reference "S3 Storage Lens CloudWatch metrics" instead of "S3 Inventory data"
- **URS-DP-10313**: Investigate Storage Per Bucket
  - Mark as optional or update to note that CSV export is required (not available in CloudWatch-only mode)

**Traceability:**
- URS-DP-10106 → SRS-DP-420108 → SDS-DP-020301, SDS-DP-020302
- URS-DP-10312 → SRS-DP-310213 → SDS-DP-020204, SDS-DP-010207
- URS-DP-10313 → SRS-DP-310214, Section 3.3.3 → SDS-DP-010217

### SRS (Software Requirements) — Version 0.10 → 0.11

**Requirements to Update:**

- **SRS-DP-310213**: Display Actual Storage Volume Metric
  - Update to reference "S3 Storage Lens CloudWatch metrics" instead of "S3 Inventory manifests"
- **SRS-DP-310214**: Navigate to Storage Deep Dive
  - Mark as optional or update to note CSV export requirement
- **SRS-DP-420108**: Query S3 Inventory for Actual Storage Volume → Query S3 Storage Lens for Actual Storage Volume
  - Complete rewrite to describe S3 Control API discovery + CloudWatch Metrics query
- **Section 3.3.3**: Storage Deep Dive Screen (Tables 12-13)
  - Update or mark as optional depending on CSV export support

**Traceability:**
- SRS-DP-310213 → SDS-DP-010207
- SRS-DP-310214 → SDS-DP-010217
- SRS-DP-420108 → SDS-DP-020301, SDS-DP-020302

### SDS (Software Design Specification) — Version 0.12 → 0.13

**Components to Update:**

- **Section 3.2.3**: C-2.3 Inventory Reader → C-2.3 Storage Lens Reader
  - Complete rewrite to describe S3 Control API + CloudWatch API integration

**Requirements to Update:**

- **SDS-DP-020204**: Write Summary JSON with Inventory Data
  - Update to reference Storage Lens metrics instead of Inventory
- **SDS-DP-020301**: Discover Inventory Configurations → Discover Storage Lens Configuration
  - Complete rewrite to describe `list_storage_lens_configurations()` and filtering logic
- **SDS-DP-020302**: Read Latest Manifest → Query CloudWatch Metrics for Storage Volume
  - Complete rewrite to describe CloudWatch API query
- **SDS-DP-020303**: Aggregate Size and Object Count
  - Rename or remove (was CSV-specific; CloudWatch returns aggregated values)
- **SDS-DP-030301**: Provision Lambda with Inventory Support
  - Update to reference Storage Lens IAM permissions (S3 Control + CloudWatch)

**Data Model to Update:**

- **Section 4.4.3**: summary.json schema
  - Update `storage_inventory` field to `storage_lens` with new schema (see Data Model Changes above)

**Design Decisions to Add:**

- **Section 7.X**: Why Storage Lens Instead of S3 Inventory?
  - Org-wide visibility (no per-bucket configuration needed)
  - Richer metrics (storage class breakdowns, encryption metrics, etc.)
  - CloudWatch integration (real-time data, historical queries)
  - Aligns with AWS best practices for storage cost optimization

**Traceability:**
- All SDS requirements trace back to updated SRS requirements (see above)

---

## Risks and Considerations

### Breaking Change

This is a **breaking change** for existing Dapanoskop deployments:

1. **Terraform variables removed**: Users must update their Terraform configurations to remove `inventory_bucket` and `inventory_prefix`
2. **IAM permissions changed**: The Lambda IAM role policy will change (S3 Inventory permissions removed, S3 Control + CloudWatch permissions added)
3. **Data model changed**: The `storage_inventory.buckets` field in summary.json will be removed (Option A) or restructured (Option B)
4. **User prerequisites changed**: Users must have an org-wide Storage Lens configuration instead of bucket-specific S3 Inventory configs

**Recommendation**: Version this as a **major release** (e.g., v2.0.0) and provide clear migration guidance in the release notes.

### User Impact

- **Existing users** with S3 Inventory configured will need to:
  1. Set up an org-wide Storage Lens configuration with CloudWatch metrics enabled
  2. Update their Terraform configuration to remove inventory variables
  3. Re-deploy Dapanoskop
  4. Verify that storage metrics are still displayed correctly
- **New users** will have a simpler setup (auto-discovery of Storage Lens config, no bucket/prefix configuration needed)

### Feature Loss (Option A: CloudWatch-only)

- **Per-bucket storage breakdown** will not be available unless CSV export is also implemented (Option B)
- Users who want per-bucket visibility will need to wait for CSV export support or revert to S3 Inventory

### Cost Implications

- **S3 Inventory cost**: Saved (no longer storing CSV/Parquet files per bucket)
- **Storage Lens cost**: Minimal (free tier covers most usage; org-wide dashboards are free; CloudWatch metrics are $0.01 per 1,000 requests)
- **Net cost impact**: Likely neutral or slightly lower

### Effort Estimate

**Option A (CloudWatch-only):**
- Python code rewrite: ~4-6 hours (port reference implementation, update handler)
- Terraform updates: ~1 hour
- Frontend updates: ~1 hour (remove per-bucket breakdown, update tooltips)
- Test rewrite: ~3-4 hours
- Documentation updates: ~2-3 hours
- **Total**: ~11-15 hours

**Option B (Hybrid with CSV):**
- Add 4-6 hours for CSV download/parsing logic
- Add 2-3 hours for frontend per-bucket table updates
- **Total**: ~17-24 hours

---

## Recommended Next Steps

1. **Confirm user intent**: Verify that S3 Storage Lens is indeed the desired feature (not S3 Inventory)
2. **Decide on approach**: Option A (CloudWatch-only) vs. Option B (Hybrid with CSV)
3. **Create implementation plan**: Break down the work into tasks (Lambda rewrite, Terraform updates, frontend updates, tests, docs)
4. **Update requirements**: Modify URS, SRS, SDS to reflect Storage Lens instead of Inventory
5. **Implement and test**: Port reference code, write new tests, validate against a real Storage Lens configuration
6. **Update README**: Add setup instructions for enabling Storage Lens CloudWatch metrics
7. **Release as v2.0.0**: Document breaking changes and migration steps

---

## Appendix: Reference Implementation Summary

The reference implementation (`/Users/martin/Development/vizgen/devops-scripts/vz_aws/s3/storage_lens.py`) provides:

### Key Functions

- **`_get_org_config_with_export()`** (lines 37-122): Discovers org-wide Storage Lens config with data export enabled (S3 or CloudWatch)
- **`get_storage_lens_metrics()`** (lines 361-443): Queries CloudWatch for Storage Lens metrics, returns dict mapping metric names to datapoint lists
- **`find_and_download_org_storage_lens_report()`** (lines 162-256): Downloads CSV report from S3 for a specific date
- **`parse_storage_lens_report()`** (lines 501-661): Parses CSV files and generates XLSX summary with storage class pricing

### Storage Lens Report Structure (CSV Export)

- Path: `s3://{bucket}/StorageLens/{prefix}/{org-id}/{config-id}/V_1/reports/dt=YYYY-MM-DD/`
- Format: Multiple gzipped CSV files
- Schema: Columns include `record_type`, `bucket_name`, `aws_account_number`, `storage_class`, `metric_name`, `metric_value`
- Record types:
  - `ORGANIZATION`: Org-wide aggregates
  - `ACCOUNT`: Per-account aggregates
  - `BUCKET`: Per-bucket aggregates
  - `PREFIX`: Per-prefix aggregates (for deduplication analysis)
- Metric names:
  - `StorageBytes`: Total storage in bytes
  - `ObjectCount`: Total object count
  - `CurrentVersionStorageBytes`, `DeleteMarkerStorageBytes`, etc.

### CloudWatch Metrics

- Namespace: `AWS/S3/Storage-Lens`
- Dimensions:
  - `organization_id`: AWS Organization ID
  - `record_type`: `ORGANIZATION`, `ACCOUNT`, `BUCKET`, etc.
  - `storage_class`: `STANDARD`, `STANDARD_IA`, `GLACIER`, etc.
  - `aws_region`: AWS region
- Metrics:
  - `StorageBytes`: Total storage volume (bytes)
  - `ObjectCount`: Total object count
  - `CurrentVersionObjectCount`, `EncryptedBytes`, etc.
- Aggregation: Reference implementation sums `Average` values across all dimension combinations to get org-wide totals

---

**End of Change Proposal**
