# User Requirements Specification (URS) — Dapanoskop

| Field               | Value                                      |
|---------------------|--------------------------------------------|
| Document ID         | URS-DP                                     |
| Product             | Dapanoskop (DP)                            |
| System Type         | Non-regulated Software                     |
| Version             | 0.9 (Draft)                                |
| Date                | 2026-02-15                                 |

---

## 1. Introduction

### 1.1 Purpose

This document defines the user requirements for Dapanoskop, a cloud cost monitoring tool for AWS. Requirements are expressed as user activities — what users need to accomplish — not as system features.

### 1.2 Scope

Dapanoskop provides opinionated AWS cloud cost visibility by leveraging resource tagging (App tag), AWS Cost Categories, and automated reporting. It serves both technical (DevOps) and non-technical (Budget Owner) audiences.

### 1.3 Referenced Documents

| Document | Description |
|----------|-------------|
| README.md | Dapanoskop project description |

### 1.4 Definitions and Abbreviations

| Term | Definition |
|------|------------|
| App tag | An AWS resource tag with key `App` (or `user:App`) whose value identifies the workload a resource belongs to |
| Workload | A logical grouping of AWS resources belonging to one application, identified by a shared App tag value |
| Cost Category | A single AWS Cost Category whose values represent cost centers. Dapanoskop expects one Cost Category to be configured in the AWS account (e.g., "Cost Centers") with values corresponding to individual cost centers. |
| Cost Center | A value within the configured Cost Category, representing an organizational budget unit to which AWS costs are allocated |
| MoM | Month-over-Month comparison |
| YoY | Year-over-Year comparison |
| Hot tier | Storage classes with immediate access: S3 Standard, S3 Intelligent-Tiering Frequent Access, EFS Standard |
| DevOps | Engineers who deploy and manage AWS infrastructure |
| Budget Owner | Individuals responsible for cost budgets who may not be familiar with AWS |

---

## 2. System Overview

### 2.1 General Description

Dapanoskop is an opinionated AWS cloud cost monitoring tool. It makes AWS spending transparent to both technical teams who deploy infrastructure and business stakeholders who own budgets. Its core opinion is that cloud cost management requires:

- Consistent resource tagging by workload (App tag)
- Mapping workloads to business cost centers via AWS Cost Categories
- A simple, periodic report that budget owners can read without AWS expertise

The name comes from Greek δαπάνη (dapáni, "cost") + σκοπέω (skopéo, "to observe").

### 2.2 Overall Process Description

#### 2.2.1 Macro-Step 1: Deploy Dapanoskop

**Description**: A DevOps engineer deploys Dapanoskop into an AWS account. This involves provisioning the web application infrastructure, the cost data collection pipeline, authentication, and configuring which Cost Categories and cost centers to report on. The deployment uses pre-built release artifacts so no local build tools are required.

**Input Data**: AWS account credentials, optionally an existing Cognito User Pool reference, optionally the name of the Cost Category to use, optionally SSO federation metadata.

**Output Data**: A running Dapanoskop instance accessible via a URL.

**User Requests**:
- "I want to deploy this with a single Terraform module"
- "I need to tell it which Cost Category to use, or just let it pick the first one"
- "I need to point it at my existing Cognito User Pool"
- "I don't have a Cognito User Pool; the module should create one for me"
- "I want to deploy without needing Node.js or Python installed"
- "I want my users to log in with their corporate identity (Azure Entra ID / SSO)"
- "I want to populate historical cost data when I first deploy, not wait months to accumulate it"

#### 2.2.2 Macro-Step 2: Tag Resources for Cost Visibility

**Description**: DevOps engineers ensure that AWS resources are tagged with the App tag so costs can be attributed to workloads. They review tagging coverage to identify untagged resources that create blind spots in cost reporting.

**Input Data**: AWS resources, tagging policies.

**Output Data**: Tagged resources, tagging coverage information.

**User Requests**:
- "I need to see which resources are not tagged"
- "I want to know how much cost is unattributed"

#### 2.2.3 Macro-Step 3: Review Cost Report

**Description**: Budget owners access a 1-page cost report that shows them how much AWS is costing their cost center(s), which workloads are driving that cost, and how costs are trending over time. They do this periodically (e.g., monthly) to monitor their budget line item for cloud spend.

**Input Data**: Authentication credentials.

**Output Data**: Cost report showing allocated costs by cost center, workload breakdown, MoM/YoY trends.

**User Requests**:
- "I want a single page that shows me my cloud costs"
- "I need to see which workloads cost the most"
- "I want to compare this month to last month and to the same month last year"
- "I want to see how costs have trended over the past year at a glance"
- "I need to see both absolute dollar amounts and percentage changes"
- "Show me storage costs separately because that is our biggest cost driver"
- "I want to see cost per TB stored"
- "I want to know what percentage of our data is in hot storage tiers"

#### 2.2.4 Macro-Step 4: Investigate Cost Anomalies

**Description**: When a budget owner notices unexpected cost changes in their report, they or a DevOps engineer drill into the data to understand what changed. This might involve looking at cost breakdowns at a more granular level.

**Input Data**: The cost report, a specific workload or cost spike.

**Output Data**: Granular cost data explaining the anomaly.

**User Requests**:
- "I want to click on a workload and see what usage types make up its cost"

#### 2.2.5 Macro-Step 5: Manage Users and Access

**Description**: A DevOps engineer manages who can access Dapanoskop. When using an existing Cognito User Pool, users are managed via the pool's console. When using a managed pool, users are created by an admin via the AWS Console or CLI, or users authenticate automatically through a federated identity provider (SAML/OIDC). All authenticated users can see all cost centers.

**Input Data**: User identity, optionally identity provider federation configuration.

**Output Data**: User accounts with access to Dapanoskop.

**User Requests**:
- "I manage users in our existing Cognito User Pool"
- "I want to create users via the AWS Console when using the managed pool"
- "When SSO is configured, I don't want to manage users at all — anyone in the IdP group gets access"

### 2.3 User Groups

| User Group | Description | Technical Expertise | Primary Activities |
|------------|-------------|--------------------|--------------------|
| DevOps | Engineers who deploy and manage AWS infrastructure. They tag resources, configure cost categories, deploy Dapanoskop, and investigate cost anomalies at a technical level. | High (AWS, IaC, CLI) | Deploy, configure, tag, investigate |
| Budget Owner | Individuals responsible for cost budgets. AWS cost is one line item in their budget. Without Dapanoskop this line item is a black box. They are not necessarily familiar with AWS or cloud in general. | Low to none (cloud) | Review reports, identify trends, flag anomalies |

---

## 3. User Requirements

### 3.1 Workflow Requirements

#### 3.1.1 Deploy Dapanoskop (Macro-Step 1)

**[URS-DP-10101] Provision Dapanoskop Instance**
A DevOps engineer deploys a complete Dapanoskop instance into an AWS account using a Terraform module, providing configuration values for the target environment. The deployment uses pre-built release artifacts and does not require local build tools (Node.js, Python).

**[URS-DP-10102] Configure Cost Category**
A DevOps engineer specifies which AWS Cost Category Dapanoskop uses to derive cost centers. By default, the first Cost Category returned by the Cost Explorer API is used. All values within the selected Cost Category are treated as cost centers and reported on.

**[URS-DP-10103] Configure Authentication**
A DevOps engineer configures authentication for Dapanoskop so that only authorized users can access cost reports. The engineer either provides an existing Cognito User Pool or lets the module create and manage one with security-hardened defaults.

**[URS-DP-10104] Configure SSO Federation**
A DevOps engineer configures single sign-on so that users authenticate through their organization's identity provider (e.g., Azure Entra ID via SAML or an OIDC provider) instead of managing separate Cognito credentials.

**[URS-DP-10105] Backfill Historical Cost Data**
A DevOps engineer triggers collection of historical cost data for all months available in Cost Explorer, so that Dapanoskop is populated with past cost trends immediately after initial deployment rather than accumulating data month by month.

#### 3.1.2 Tag Resources for Cost Visibility (Macro-Step 2)

**[URS-DP-10201] Review Tagging Coverage**
A DevOps engineer reviews how much of the AWS cost is attributed to tagged workloads versus untagged resources, to identify gaps in cost visibility.

**[URS-DP-10202] Identify Untagged Cost**
A DevOps engineer identifies the proportion of total cost that is not attributed to any workload (missing App tag), so they can prioritize tagging efforts.

#### 3.1.3 Review Cost Report (Macro-Step 3)

**[URS-DP-10301] View Cost Center Summary**
A Budget Owner views the total AWS cost allocated to their cost center(s) for a given period.

**[URS-DP-10302] Compare Costs Over Time**
A Budget Owner compares current cost center costs against the previous month (MoM) and the same month of the previous year (YoY), in both absolute dollar amounts and percentage change.

**[URS-DP-10303] Identify Top Workloads by Cost**
A Budget Owner identifies which workloads contribute the most to their cost center's AWS spend, with workloads sorted by cost amount.

**[URS-DP-10304] Compare Workload Costs Over Time**
A Budget Owner compares individual workload costs against the previous month and the same month last year, in both absolute and relative terms.

**[URS-DP-10305] Review Storage Cost Summary**
A Budget Owner reviews total storage cost across all storage services (S3, EFS, EBS, etc.) allocated to their cost center.

**[URS-DP-10306] Assess Storage Cost Efficiency**
A Budget Owner reviews the cost per terabyte stored to understand storage cost efficiency.

**[URS-DP-10307] Assess Storage Tier Distribution**
A Budget Owner reviews what percentage of data is stored in hot storage tiers (S3 Standard, Intelligent-Tiering Frequent Access, and optionally EFS/EBS) to understand potential for storage cost optimization. Which storage services are included is configurable at deployment time.

**[URS-DP-10308] Access Report Without AWS Knowledge**
A Budget Owner accesses and understands the cost report without requiring any knowledge of AWS services, infrastructure, or cloud terminology.

**[URS-DP-10309] View Cost Trends Across Multiple Months**
A Budget Owner views a visual summary of cost trends across all available reporting months, broken down by cost center, to identify spending patterns, seasonal variations, and anomalies over time. When more than 12 months of data are available, the user can toggle between viewing the most recent 12 months or all available periods.

**[URS-DP-10310] Identify Long-Term Cost Trajectory**
A Budget Owner identifies the underlying cost trajectory by viewing a smoothed trend line (3-month moving average) overlaid on the historical cost chart, to distinguish short-term volatility from sustained increases or decreases.

**[URS-DP-10311] View Cost Center Detail Page**
A Budget Owner views a dedicated page for a single cost center showing its historical cost trend, period-over-period comparisons (MoM, YoY), and workload breakdown, enabling focused analysis of a specific cost center without the context of other cost centers.

#### 3.1.4 Investigate Cost Anomalies (Macro-Step 4)

**[URS-DP-10401] Drill Into Workload Cost**
A DevOps engineer or Budget Owner examines the usage types within a specific workload to understand what is driving its cost.

**[URS-DP-10402] Identify Cost Changes**
A Budget Owner identifies which workloads or cost components changed significantly compared to previous periods, to focus investigation on the largest movers.

#### 3.1.5 Manage Users and Access (Macro-Step 5)

**[URS-DP-10501] Control Report Access**
A DevOps engineer manages user access to Dapanoskop. When using an existing pool, users are managed via its console. When using a managed pool without federation, the engineer creates users via the AWS Console or CLI (admin-only signup). When SSO federation is active, users authenticate through the external identity provider and no manual Cognito user management is required. All authenticated users can view all cost centers.

### 3.2 Regulatory Requirements

#### 3.2.1 Applicable Standards and Regulations

Dapanoskop is non-regulated software. No regulatory standards apply.

#### 3.2.2 Accountability Requirements

Not applicable — non-regulated software.

#### 3.2.3 Security Requirements

**[URS-DP-20301] Authenticate Before Access**
A user authenticates their identity before accessing any cost data. All authenticated users can view all cost centers.

#### 3.2.4 Integrity Requirements

**[URS-DP-20401] Trust Cost Data Accuracy**
A Budget Owner trusts that the cost figures shown in Dapanoskop match the actual AWS billing data, without manual reconciliation.

#### 3.2.5 Traceability Requirements

Not applicable — non-regulated software.

#### 3.2.6 Quality System Requirements

Not applicable — non-regulated software.

#### 3.2.7 Not Applicable Regulatory Requirements

| Regulation | Justification |
|------------|---------------|
| 21 CFR Part 11 | Non-regulated software; no electronic records/signatures requirements |
| EU cGMP Annex 11 | Non-regulated software; not a GxP system |
| MDR 2017/745 | Not a medical device |
| IEC 62304 | Not medical device software |

### 3.3 Other Requirements

**[URS-DP-30101] Access Documentation**
A DevOps engineer accesses deployment and configuration documentation to set up and maintain Dapanoskop.

**[URS-DP-30102] Understand Report Content**
A Budget Owner understands the cost report without separate documentation. The report is self-explanatory through clear labels, section headings, and contextual information such as tooltips explaining calculated metrics.

**[URS-DP-30103] Navigate Back to Report Home**
A user returns to the current cost report from any screen within the application by clicking the application header, without losing their selected reporting period.

**[URS-DP-30104] Access Report on Mobile Device**
A Budget Owner accesses and reviews the cost report on a mobile device (phone or tablet) without layout breakage or overlapping content, though the primary design target remains desktop browsers.

---

## 4. Change History

| Version | Date       | Author | Description       |
|---------|------------|--------|-------------------|
| 0.1     | 2026-02-08 | —      | Initial draft     |
| 0.2     | 2026-02-12 | —      | Add managed Cognito pool, SSO federation, release artifacts |
| 0.3     | 2026-02-13 | —      | Review for Cognito Identity Pool data access; no user-facing task changes (authentication remains transparent to users) |
| 0.4     | 2026-02-13 | —      | Review for artifacts S3 bucket deployment mechanism; no user-facing task changes (deployment workflow remains identical) |
| 0.5     | 2026-02-14 | —      | Add backfill historical cost data requirement (URS-DP-10105) |
| 0.6     | 2026-02-15 | —      | Add multi-month cost trend visualization requirement (URS-DP-10309) |
| 0.7     | 2026-02-15 | —      | Add cost trajectory trend line (URS-DP-10310), contextual tooltips (URS-DP-30102 update), header navigation (URS-DP-30103), and mobile device access (URS-DP-30104) |
| 0.8     | 2026-02-15 | —      | Consolidate v0.7 changes (trend line, tooltips, navigation, mobile) into single version entry |
| 0.9     | 2026-02-15 | —      | Add cost trend time range toggle (URS-DP-10309 update) and cost center detail page navigation (URS-DP-10311) |
