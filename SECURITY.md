# Security Policy

## Supported Versions

| Version | Supported |
| ------- | --------- |
| latest  | Yes       |

Only the latest release on the `main` branch receives security updates.

## Reporting a Vulnerability

**Please do not open a public GitHub issue for security vulnerabilities.**

Instead, report vulnerabilities through one of these channels:

1. **GitHub Security Advisories** (preferred) -- use the "Report a vulnerability" button on the [Security tab](../../security/advisories/new) of this repository.
2. **Email** -- send details to [security@cytario.com](mailto:security@cytario.com).

### What to include

- Description of the vulnerability and its potential impact.
- Steps to reproduce or a proof-of-concept.
- Affected component (`app/`, `lambda/`, `terraform/`).
- Any suggested fix, if you have one.

### What to expect

- **Acknowledgement** within 3 business days.
- **Status update** within 10 business days with an assessment and remediation timeline.
- Credit in the release notes (unless you prefer to remain anonymous).

## Security Design Overview

Dapanoskop is an internal cost-monitoring tool deployed inside a single AWS account. Key security properties:

- **Authentication** -- Cognito-based OAuth 2.0; no anonymous access in production.
- **Data in transit** -- CloudFront with TLS; S3 access via VPC endpoints or HTTPS.
- **Data at rest** -- S3 server-side encryption (SSE-S3 or SSE-KMS via Terraform config).
- **Least privilege** -- Lambda IAM role scoped to Cost Explorer read and a single S3 bucket.
- **No secrets in code** -- all credentials are injected via environment variables or IAM roles.

## Dependency Management

- **npm** and **pip** dependencies are monitored by [Dependabot](.github/dependabot.yml) with weekly update schedules.
- **Terraform providers** are pinned to specific versions in `terraform/versions.tf`.
