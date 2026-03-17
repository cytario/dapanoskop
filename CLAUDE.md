# Dapanoskop

AWS cloud cost monitoring tool. Monorepo with three subsystems:
- `app/` — React Router v7 SPA, Tailwind v4, DuckDB-wasm
- `lambda/` — Python 3.12 Lambda pipeline, uv, ruff, pytest+moto
- `terraform/` — OpenTofu/Terraform IaC

## Agent Coordination

Always prefer an **agent team** over independent sub-agents. When a task spans
multiple subsystems (e.g. Lambda + frontend + tests), assemble a coordinated team
using `TeamCreate` so agents can communicate and share context, rather than
launching isolated `Agent` calls that duplicate work or produce conflicting changes.
