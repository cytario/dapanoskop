# User Requirements Specification (URS) — Dapanoskop

| Field               | Value                                      |
|---------------------|--------------------------------------------|
| Document ID         | URS-DP                                     |
| Product             | Dapanoskop (DP)                            |
| System Type         | Non-regulated Software                     |
| Version             | 0.1 (Draft)                                |
| Date                | 2026-02-08                                 |

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
| vz_aws | Origin Python CLI tool with cost reporting capabilities |

### 1.4 Definitions and Abbreviations

| Term | Definition |
|------|------------|
| App tag | An AWS resource tag with key `App` (or `user:App`) whose value identifies the workload a resource belongs to |
| Workload | A logical grouping of AWS resources belonging to one application, identified by a shared App tag value |
| Cost Category | An AWS Cost Categories rule that maps workloads to cost centers |
| Cost Center | An organizational budget unit to which AWS costs are allocated |
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

**Description**: A DevOps engineer deploys Dapanoskop into an AWS account. This involves provisioning the web application infrastructure, the cost data collection pipeline, authentication, and configuring which Cost Categories and cost centers to report on.

**Input Data**: AWS account credentials, desired Cost Category configuration, existing Cognito User Pool reference.

**Output Data**: A running Dapanoskop instance accessible via a URL.

**User Requests**:
- "I want to deploy this with a single Terraform module"
- "I need to configure which cost centers to track"
- "I need to point it at my existing Cognito User Pool"

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

**Description**: A DevOps engineer manages who can access Dapanoskop via the existing Cognito User Pool console. All authenticated users can see all cost centers.

**Input Data**: User identity.

**Output Data**: User accounts with access to Dapanoskop.

**User Requests**:
- "I manage users in our existing Cognito User Pool"

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
A DevOps engineer deploys a complete Dapanoskop instance into an AWS account using a Terraform module, providing configuration values for the target environment.

**[URS-DP-10102] Configure Cost Centers**
A DevOps engineer specifies which AWS Cost Categories and cost center values Dapanoskop reports on, so that reports align with the organization's budget structure.

**[URS-DP-10103] Configure Authentication**
A DevOps engineer integrates Dapanoskop with an existing Cognito User Pool so that only authorized users can access cost reports.

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

#### 3.1.4 Investigate Cost Anomalies (Macro-Step 4)

**[URS-DP-10401] Drill Into Workload Cost**
A DevOps engineer or Budget Owner examines the usage types within a specific workload to understand what is driving its cost.

**[URS-DP-10402] Identify Cost Changes**
A Budget Owner identifies which workloads or cost components changed significantly compared to previous periods, to focus investigation on the largest movers.

#### 3.1.5 Manage Users and Access (Macro-Step 5)

**[URS-DP-10501] Control Report Access**
A DevOps engineer manages user access to Dapanoskop via the existing Cognito User Pool console. All authenticated users can view all cost centers.

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
A Budget Owner understands the cost report without separate documentation. The report is self-explanatory through clear labels, section headings, and contextual information.

---

## 4. Change History

| Version | Date       | Author | Description       |
|---------|------------|--------|-------------------|
| 0.1     | 2026-02-08 | —      | Initial draft     |
