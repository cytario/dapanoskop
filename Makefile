.PHONY: help install lint format test build clean \
       app-install app-lint app-format app-typecheck app-build app-dev \
       lambda-install lambda-lint lambda-format lambda-test \
       tf-init tf-validate tf-lint tf-fmt

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
	  awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-18s\033[0m %s\n", $$1, $$2}'

# ── Aggregate targets ────────────────────────────────────────────────

install: app-install lambda-install ## Install all dependencies

lint: app-lint lambda-lint tf-lint ## Lint all subsystems

format: app-format lambda-format tf-fmt ## Format all subsystems

test: lambda-test ## Run all tests

build: app-build ## Build all artifacts

clean: ## Remove build artifacts and caches
	rm -rf app/build app/.react-router app/node_modules/.cache
	rm -rf lambda/.pytest_cache lambda/.ruff_cache
	find lambda -type d -name __pycache__ -exec rm -rf {} + 2>/dev/null || true

# ── Frontend (app/) ─────────────────────────────────────────────────

app-install: ## Install frontend dependencies
	cd app && npm ci

app-lint: ## Run ESLint and Prettier check
	cd app && npx prettier --check .
	cd app && npx eslint .

app-format: ## Auto-format frontend code
	cd app && npx prettier --write .

app-typecheck: ## Run TypeScript type checking
	cd app && npx react-router typegen && npx tsc --noEmit

app-build: ## Build the frontend
	cd app && npm run build

app-dev: ## Start frontend dev server
	cd app && npm run dev

# ── Python Lambda (lambda/) ─────────────────────────────────────────

lambda-install: ## Install Python dependencies
	cd lambda && uv sync && uv pip install -e .

lambda-lint: ## Run ruff linter and format check
	cd lambda && uv run ruff check .
	cd lambda && uv run ruff format --check .

lambda-format: ## Auto-format Python code
	cd lambda && uv run ruff check --fix .
	cd lambda && uv run ruff format .

lambda-test: ## Run Python tests
	cd lambda && uv run pytest

# ── Terraform (terraform/) ──────────────────────────────────────────

tf-init: ## Initialize Terraform
	cd terraform && tofu init -backend=false

tf-validate: tf-init ## Validate Terraform configuration
	cd terraform && tofu validate

tf-lint: ## Run TFLint
	cd terraform && tflint --recursive

tf-fmt: ## Check Terraform formatting
	cd terraform && tofu fmt -check -recursive
