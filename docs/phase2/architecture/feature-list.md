# Feature List — Phase 2: DeliverPro

## Changelog

| Date | Version | Author | Change |
|------|---------|--------|--------|
| 2026-06-29 | v1.0 | AWS Architect | Initial feature list from SRS v1.2a (28 FRs), domain decomposition v1.0 |

---

## 1. Overview

28 FRs mapped across 8 domains into 19 features. Every FR has exactly one feature. Every feature traces to at least one FR.

**Iteration key:**
- **Iteration 1** — Core project tracking + auth + hosting
- **Iteration 2** — Extended lifecycle management
- **Iteration 3** — AI analysis + admin configuration

---

## 2. Features by Domain

### 2.1 Domain: `projects`

| Feature ID | Feature | SRS FRs | Iteration | Description |
|------------|---------|---------|-----------|-------------|
| F-P2-01 | Project List & Search | FR-P2-001, FR-P2-015 | 1 | Display, search, and filter all delivery projects with computed phase and burn rate badge |
| F-P2-02 | Project Creation & Jira Import | FR-P2-009 | 1 | One-time Jira CST bootstrap import and direct in-app project creation with CASDM template seeding |
| F-P2-03 | Project Phase Progression | FR-P2-014 | 1 | Compute and display current CASDM phase based on mandatory checkpoint completions |
| F-P2-04 | Onboarding Checklist | FR-P2-019 | 1 | Phase 0 structured checklist (9 items) with per-item completion tracking |
| F-P2-05 | Resource Budget Tracking | FR-P2-022, FR-P2-028 | 1 | SOW hours vs consumed tracking with burn rate percentage and visual indicator on project card |
| F-P2-06 | Project Closure Workflow | FR-P2-023 | 2 | Phase 4 closure checklist (4 items) with status transition to Closed |

---

### 2.2 Domain: `gates`

| Feature ID | Feature | SRS FRs | Iteration | Description |
|------------|---------|---------|-----------|-------------|
| F-P2-07 | Gate Status View | FR-P2-002, FR-P2-011 | 1 | Per-project detail view showing all phases with micro artifacts, macro checkpoints, and Phase 1 governance events |
| F-P2-08 | Evidence Attachment | FR-P2-003, FR-P2-004 | 1 | Attach meeting links, file uploads, or URLs to macro checkpoints |
| F-P2-09 | Checkpoint Completion | FR-P2-008 | 1 | Mark macro checkpoints complete with rich result capture (meeting_date, result_detail, reviewed_by) |
| F-P2-10 | Micro Artifact Tracking | FR-P2-007 | 1 | Display and update status of AI-generated micro artifacts per phase |
| F-P2-11 | Checkpoint Notes | FR-P2-017 | 2 | Append-only free-text notes on any macro checkpoint |
| F-P2-12 | Executive & Planning Checkpoints | FR-P2-024, FR-P2-026, FR-P2-027 | 2 | Kickoff prep meeting (Phase 1), executive check-in calls (Phase 3+4), account planning session (Phase 4) |

---

### 2.3 Domain: `meetings`

| Feature ID | Feature | SRS FRs | Iteration | Description |
|------------|---------|---------|-----------|-------------|
| F-P2-13 | Weekly Status Call Log | FR-P2-020 | 1 | Log each weekly client status call with date, link, topics, demos, and blockers |
| F-P2-14 | Escalation Board | FR-P2-021 | 2 | Raise, resolve, and filter escalations by severity per project |
| F-P2-15 | Discovery Sessions Log | FR-P2-025 | 2 | Log multiple numbered discovery sessions per project in Phase 1 |

---

### 2.4 Domain: `auth`

| Feature ID | Feature | SRS FRs | Iteration | Description |
|------------|---------|---------|-----------|-------------|
| F-P2-16 | Authentication & Role-Based Access | FR-P2-010, FR-P2-018 | 1 | Cognito user pool, JWT authorizer, role-based view routing, and CloudFront SPA deployment |

---

### 2.5 Domain: `files`

| Feature ID | Feature | SRS FRs | Iteration | Description |
|------------|---------|---------|-----------|-------------|
| F-P2-17 | File Upload & Download | FR-P2-012 | 1 | S3 presigned URL generation for evidence file upload (max 25 MB) and download |

---

### 2.6 Domain: `analysis`

| Feature ID | Feature | SRS FRs | Iteration | Description |
|------------|---------|---------|-----------|-------------|
| F-P2-18 | Transcript Analysis | FR-P2-005, FR-P2-013 | 3 | Avoma API transcript fetch + Bedrock AI topic-coverage analysis with structured results |

---

### 2.7 Domain: `config`

| Feature ID | Feature | SRS FRs | Iteration | Description |
|------------|---------|---------|-----------|-------------|
| F-P2-19 | CASDM Configuration Admin | FR-P2-006, FR-P2-016 | 3 | Admin panel for adding, renaming, reordering, and deactivating phases/gates without code deploy |

---

### 2.8 Domain: `reporting`

No standalone feature. The `reporting` domain is a read-only aggregation layer that implements the timeline and cross-project summary aspects of F-P2-07 (gate status view — timeline assembly) and F-P2-16 (role-based access — Leadership cross-project summary). Its handlers (`project-timeline.ts`, `cross-project-summary.ts`) serve these features without owning dedicated FRs.

---

## 3. FR → Feature Traceability Matrix

| FR | Title | Feature ID | Domain |
|----|-------|-----------|--------|
| FR-P2-001 | Project List View | F-P2-01 | projects |
| FR-P2-002 | Project Detail — Gate Status View | F-P2-07 | gates |
| FR-P2-003 | Manual Evidence Attachment | F-P2-08 | gates |
| FR-P2-004 | Meeting Link Entry (Manual) | F-P2-08 | gates |
| FR-P2-005 | Transcript Analysis (AI Topic Coverage) | F-P2-18 | analysis |
| FR-P2-006 | Configurable Phases and Gates | F-P2-19 | config |
| FR-P2-007 | Micro Artifact Status Tracking | F-P2-10 | gates |
| FR-P2-008 | Macro Checkpoint Completion | F-P2-09 | gates |
| FR-P2-009 | Jira CST One-Time Import & Direct Project Creation | F-P2-02 | projects |
| FR-P2-010 | Role-Based Views | F-P2-16 | auth |
| FR-P2-011 | Phase 1 Governance Data Integration | F-P2-07 | gates |
| FR-P2-012 | File Upload to S3 | F-P2-17 | files |
| FR-P2-013 | Avoma API Integration | F-P2-18 | analysis |
| FR-P2-014 | Project Phase Progression | F-P2-03 | projects |
| FR-P2-015 | Search and Filter Projects | F-P2-01 | projects |
| FR-P2-016 | Admin — Manage Phase/Gate Configuration | F-P2-19 | config |
| FR-P2-017 | Checkpoint Notes | F-P2-11 | gates |
| FR-P2-018 | CloudFront Deployment | F-P2-16 | auth |
| FR-P2-019 | Project Onboarding Checklist | F-P2-04 | projects |
| FR-P2-020 | Weekly Status Call Log | F-P2-13 | meetings |
| FR-P2-021 | Escalation Board | F-P2-14 | meetings |
| FR-P2-022 | Resource Budget Tracking | F-P2-05 | projects |
| FR-P2-023 | Project Closure Workflow | F-P2-06 | projects |
| FR-P2-024 | Executive Check-in Calls | F-P2-12 | gates |
| FR-P2-025 | Discovery Sessions Log | F-P2-15 | meetings |
| FR-P2-026 | Kickoff Prep Meeting | F-P2-12 | gates |
| FR-P2-027 | Account Planning Session | F-P2-12 | gates |
| FR-P2-028 | Resource Budget Display on Project Card | F-P2-05 | projects |

**Coverage check:** 28/28 FRs mapped. ✅ No orphans.

---

## 4. Iteration Summary

| Iteration | Features | FR Count | Domains Active |
|-----------|----------|----------|----------------|
| Iteration 1 | F-P2-01 through F-P2-05, F-P2-07 through F-P2-10, F-P2-13, F-P2-16, F-P2-17 | 17 FRs | projects, gates, meetings, auth, files |
| Iteration 2 | F-P2-06, F-P2-11, F-P2-12, F-P2-14, F-P2-15 | 7 FRs | projects, gates, meetings |
| Iteration 3 | F-P2-18, F-P2-19 | 4 FRs | analysis, config |

---

*End of Feature List v1.0*
