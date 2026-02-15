# Contributing to Dapanoskop

Thank you for your interest in contributing to Dapanoskop! This guide covers the development setup, code style expectations, and PR process.

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) >= 22
- [uv](https://docs.astral.sh/uv/) (Python package manager)
- Python >= 3.12
- [OpenTofu](https://opentofu.org/) >= 1.5 (or Terraform >= 1.5)

### Setup

```bash
git clone https://github.com/cytario/dapanoskop.git
cd dapanoskop

# Frontend
cd app && npm install && cd ..

# Python Lambda
cd lambda && uv sync && uv pip install -e . && cd ..

# Generate fixture data for local development
uv run python scripts/generate-fixtures.py
```

### Environment Variables

Copy the template and adjust as needed:

```bash
cp app/.env.template app/.env
```

See `app/.env.template` for all available variables with descriptions.

### Running Locally

There are two modes for local development:

#### Option A: Fixture Data (default)

Uses generated fixture data. No AWS access required.

```bash
cd app
npm run dev
```

The dev server serves fixture data from `fixtures/` at `/data/` automatically. Make sure `VITE_AUTH_BYPASS=true` is set in your `.env` file (it is by default in the template).

#### Option B: Real S3 Data

Uses actual cost data from your deployed S3 bucket. Requires AWS credentials with `s3:GetObject` permission on the data bucket.

1. **Configure AWS credentials** using any method supported by the [AWS SDK credential provider chain](https://docs.aws.amazon.com/sdkref/latest/guide/standardized-credentials.html):

   ```bash
   # Option 1: AWS SSO (recommended)
   aws sso login --profile your-profile
   export AWS_PROFILE=your-profile

   # Option 2: Environment variables
   export AWS_ACCESS_KEY_ID=...
   export AWS_SECRET_ACCESS_KEY=...
   export AWS_SESSION_TOKEN=...
   ```

2. **Set the bucket name** in your `.env` file:

   ```bash
   VITE_AUTH_BYPASS=true
   VITE_DATA_S3_BUCKET=dapanoskop-data-abc123
   VITE_DATA_S3_REGION=eu-north-1
   ```

3. **Start the dev server**:

   ```bash
   cd app
   npm run dev
   ```

The Vite dev server proxies `/data/*` requests to S3 server-side, so there are no CORS issues. The S3 bucket's CORS configuration is not involved. Authentication is handled entirely by the dev server using your local AWS credentials.

Open [http://localhost:5173](http://localhost:5173).

## Code Style

### Frontend (`app/`)

- Formatting: [Prettier](https://prettier.io/)
- Linting: [ESLint](https://eslint.org/)
- Type checking: TypeScript (strict)

```bash
cd app
npx prettier --check .
npx eslint .
npx react-router typegen && npx tsc --noEmit
npm run build
```

### Python (`lambda/`)

- Formatting and linting: [Ruff](https://docs.astral.sh/ruff/)
- Testing: [pytest](https://docs.pytest.org/) with [moto](https://docs.getmoto.org/) for AWS mocking

```bash
cd lambda
uv run ruff check .
uv run ruff format --check .
uv run pytest
```

### Terraform (`terraform/`)

- Formatting: `tofu fmt`
- Linting: [TFLint](https://github.com/terraform-linters/tflint)

```bash
cd terraform
tofu fmt -check -recursive
tofu init -backend=false && tofu validate
tflint --recursive
```

## Making Changes

### Branching

Create a feature branch from `main`:

```bash
git checkout -b feat/my-feature
```

### Commit Messages

This project uses [Conventional Commits](https://www.conventionalcommits.org/) and [semantic-release](https://semantic-release.gitbook.io/) for automated versioning.

| Prefix | Purpose | Version bump |
|--------|---------|--------------|
| `feat:` | New feature | Minor |
| `fix:` | Bug fix | Patch |
| `docs:` | Documentation only | None |
| `chore:` | Maintenance | None |
| `refactor:` | Code refactor (no behavior change) | None |
| `test:` | Adding or updating tests | None |
| `feat!:` or `BREAKING CHANGE:` | Breaking change | Major |

Scope is optional but encouraged for clarity (e.g., `feat(lambda): add EFS support`).

### Pull Request Process

1. Ensure all quality gates pass locally before pushing (see [Code Style](#code-style) above).
2. Open a pull request against `main`.
3. Fill in the PR template describing your changes and how to test them.
4. CI must pass before merging.
5. A maintainer will review your PR. Address any feedback with new commits (do not force-push).
6. Once approved, a maintainer will merge using squash-and-merge.

### What Makes a Good PR

- Focused on a single concern (one feature, one fix, one refactor).
- Includes tests where applicable.
- Updates documentation if behavior changes.
- Has a clear description of *what* and *why*.

## Reporting Issues

Use [GitHub Issues](https://github.com/cytario/dapanoskop/issues) to report bugs or request features. Please use the provided issue templates.

## License

By contributing, you agree that your contributions will be licensed under the [GPL-3.0 License](LICENSE).
