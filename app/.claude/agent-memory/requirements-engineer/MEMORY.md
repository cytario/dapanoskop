# Requirements Engineer Memory — Dapanoskop

## Document Structure

### Requirement ID Schemes
- **URS**: `URS-DP-XXYYZ` — XX=macro-step, YY=sub-workflow, Z=sequence
  - Example: URS-DP-10311 = Macro-Step 1 (Deploy/Review), Sub-workflow 03 (Review Cost Report), item 11
- **SRS**: `SRS-DP-XXYYZZ` — XX=category, YY=screen/feature, ZZ=sequence
  - Example: SRS-DP-310302 = Category 3 (UI), Feature 10 (Report), Sub-feature 3 (Cost Center Detail), item 02
- **SDS**: `SDS-DP-CCSSZZ` — CC=component number, SS=subsystem, ZZ=sequence
  - Example: SDS-DP-010214 = Component 01 (Report Renderer), Sub-system 02, item 14

### Version Numbering
- **Minor version bump** (X.Y → X.Y+1): New features without breaking changes
- **Patch/revision** (within same version): Clarifications, corrections
- URS, SRS, SDS version independently but stay roughly aligned

### Document Locations
- `/Users/martin/Development/slash-m/github/dapanoskop/docs/URS.md`
- `/Users/martin/Development/slash-m/github/dapanoskop/docs/SRS.md`
- `/Users/martin/Development/slash-m/github/dapanoskop/docs/SDS.md`

## Traceability Patterns

Every requirement traces bidirectionally:
- SRS items reference URS IDs via `Refs: URS-DP-XXXXX`
- SDS items reference SRS IDs via `Refs: SRS-DP-XXXXXX`

When adding new features:
1. Check if existing URS workflows cover the user need
2. If not, add new URS requirement first
3. Add SRS behavioral requirements referencing URS
4. Add SDS implementation specs referencing SRS
5. Update all three change histories with same date

## Section Numbering in Specs

### URS Structure
- §2.2.X: Macro-steps (Deploy, Tag, Review, Investigate, Manage)
- §3.1.X: Workflow requirements (numbered by macro-step)
- §3.2.X: Regulatory requirements
- §3.3: Other requirements

### SRS Structure
- §3.1.X: UI screens (numbered sequentially as features are added)
- §4.X: System interfaces (SI-1, SI-2, etc.)
- §5.X: Data requirements

### SDS Structure
- §3.X: Sub-systems (SS-1: SPA, SS-2: Data Pipeline, SS-3/SS-4: IaC)
- §3.X.Y: Components within subsystems (C-1.1, C-1.2, etc.)
- Each component has multiple specs (SDS-DP-CCSSXX)

## Common Update Patterns

### Adding a New UI Screen
1. **URS**: Add workflow requirement (URS-DP-103XX)
2. **SRS**: Add new §3.1.X section with screen specs (SRS-DP-310X0Y)
3. **SRS**: Renumber subsequent sections if needed
4. **SDS**: Add route/component specs (SDS-DP-0102XX)

### Adding a Toggle/Enhancement to Existing Feature
1. **URS**: Update existing requirement with capability addition
2. **SRS**: Update corresponding requirement with behavioral change
3. **SDS**: Update implementation spec with component details

### Adding Clickable Navigation
- Update SRS requirement to specify clickability and target
- Update SDS spec to document Link component usage

## Architectural Constraints (from SDS)

- React Router v7 framework mode (file-based routing in `routes/`)
- No `window` references at module scope (pre-render compatibility)
- Auth via Cognito User Pool → Identity Pool → temporary S3 credentials
- Data flow: Lambda writes summary.json + parquet → SPA reads via S3 SDK
- DuckDB-wasm for parquet drill-down (lazy-loaded)

## Recent Updates

### Phase 3 (2026-02-15)
- Added cost trend time range toggle (1 Year / All Time)
- Added cost center detail page at `/cost-center/:name`
- Updated: URS 0.8→0.9, SRS 0.8→0.9, SDS 0.10→0.11
- See `phase3-analysis.md` for details
