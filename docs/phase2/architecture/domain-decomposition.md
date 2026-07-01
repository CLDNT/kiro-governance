# Domain Decomposition — Phase 2: DeliverPro

## Changelog

| Date | Version | Author | Change |
|------|---------|--------|--------|
| 2026-06-29 | v1.0 | AWS Architect | Initial domain decomposition from SRS v1.2a (28 FRs) |

---

## 1. Architecture Overview

**Architecture:** TypeScript monorepo. API Gateway (REST) + Lambda (TypeScript). RDS PostgreSQL (shared Phase 1 instance). React + Vite + Tailwind CSS frontend deployed to CloudFront + S3.

```
deliverpro/
├── infra/                          # AWS CDK stack
│   ├── bin/app.ts
│   ├── stacks/
│   │   ├── stateful-stack.ts       # RDS (existing), S3, Cognito
│   │   └── stateless-stack.ts      # API Gateway, Lambdas, CloudFront
│   └── constructs/
├── packages/
│   ├── shared/                     # Types, middleware, DB helpers
│   ├── projects/                   # Domain
│   ├── gates/                      # Domain
│   ├── meetings/                   # Domain
│   ├── auth/                       # Domain
│   ├── files/                      # Domain
│   ├── analysis/                   # Domain (deferred)
│   ├── config/                     # Domain
│   └── reporting/                  # Domain
├── frontend/                       # React + Vite + Tailwind
├── migrations/
└── package.json
```

---

## 2. Domain List

### 2.1 `shared`

**Purpose:** Cross-cutting types, middleware, and database utilities. Not a domain — no handlers.

| Owns | Details |
|------|---------|
| Types | `GovernanceEventRecord`, `Project`, `MacroCheckpoint`, `MicroArtifact`, all shared interfaces |
| Middleware | JWT validation (Cognito), role-based access control, error handler, request logger |
| DB helpers | PostgreSQL connection pool (pg), query builder helpers |
| Constants | CASDM phase names, checkpoint types, evidence types, role enums |

---

### 2.2 `projects`

**Purpose:** Project lifecycle — CRUD, Jira import, onboarding checklist, resource budget, closure, search/filter.

| Owns | Details |
|------|---------|
| Tables | `projects`, `onboarding_checklist_items` |
| Handlers | `list-projects.ts`, `get-project.ts`, `create-project.ts`, `update-project.ts`, `import-jira.ts`, `search-projects.ts`, `update-hours.ts`, `close-project.ts`, `list-checklist.ts`, `update-checklist-item.ts` |
| S3 paths | None |
| SRS FRs | FR-P2-001, FR-P2-009, FR-P2-014, FR-P2-015, FR-P2-019, FR-P2-022, FR-P2-023, FR-P2-028 |

**Key responsibilities:**
- Project list with computed `current_phase` (query-time join on `macro_checkpoints`)
- One-time Jira CST import (idempotent — runs once)
- Direct in-app project creation with CASDM template seeding
- Onboarding checklist CRUD (Phase 0 items)
- Resource budget tracking (SOW hours vs consumed)
- Project closure workflow (status transition)
- Search and filter by title, jira_key, status, phase, PM, SA, type

---

### 2.3 `gates`

**Purpose:** CASDM macro checkpoints, micro artifacts, evidence attachment, checkpoint notes.

| Owns | Details |
|------|---------|
| Tables | `macro_checkpoints`, `micro_artifacts`, `gate_evidence`, `checkpoint_notes` |
| Handlers | `list-checkpoints.ts`, `complete-checkpoint.ts`, `list-artifacts.ts`, `update-artifact.ts`, `attach-evidence.ts`, `list-evidence.ts`, `add-note.ts`, `list-notes.ts` |
| S3 paths | None (file storage delegated to `files` domain) |
| SRS FRs | FR-P2-002, FR-P2-003, FR-P2-007, FR-P2-008, FR-P2-011, FR-P2-017, FR-P2-024, FR-P2-026, FR-P2-027 |

**Key responsibilities:**
- Display gate status per project (all phases, micro + macro)
- Mark macro checkpoints complete (human_review, meeting, checklist types)
- Attach evidence to checkpoints (delegates file upload to `files` domain via S3 key)
- Micro artifact status tracking (pending → in_progress → complete)
- Phase 1 governance_events integration (read from `governance_events` table for timeline)
- Checkpoint notes (append-only)
- Executive check-in calls (Phase 3 + Phase 4 checkpoints)
- Kickoff prep meeting + account planning session (seeded checkpoints)

---

### 2.4 `meetings`

**Purpose:** Weekly status logs, escalations, discovery sessions.

| Owns | Details |
|------|---------|
| Tables | `weekly_status_logs`, `escalations`, `discovery_sessions` |
| Handlers | `log-status-call.ts`, `list-status-logs.ts`, `log-escalation.ts`, `resolve-escalation.ts`, `list-escalations.ts`, `log-discovery-session.ts`, `list-discovery-sessions.ts` |
| S3 paths | None |
| SRS FRs | FR-P2-020, FR-P2-021, FR-P2-025 |

**Key responsibilities:**
- Weekly status call logging (date, link, topics, demos, blockers)
- Escalation board (raise, resolve, filter by severity)
- Discovery session tracking (multiple per project, auto-numbered)

---

### 2.5 `auth`

**Purpose:** Cognito user pool configuration, JWT validation, role management.

| Owns | Details |
|------|---------|
| Tables | None (roles stored in Cognito groups; no app-level user table in v1) |
| Handlers | None (auth is middleware + Cognito Authorizer on API Gateway) |
| CDK resources | Cognito User Pool, User Pool Client, User Pool Groups (`pm`, `sa`, `engineer`, `leadership`, `admin`) |
| S3 paths | None |
| SRS FRs | FR-P2-010, FR-P2-018 (CloudFront deployment — auth integration) |

**Key responsibilities:**
- Cognito User Pool provisioning (CDK)
- API Gateway Cognito Authorizer
- JWT validation middleware in `shared/middleware/`
- Role-based view routing (PM, SA, Engineer, Leadership)
- CloudFront + Cognito integration for SPA access

**Note:** `auth` is primarily infrastructure (CDK constructs) + shared middleware. It has no Lambda handlers of its own — the JWT authorizer runs at the API Gateway layer and the role-check middleware lives in `shared/`.

---

### 2.6 `files`

**Purpose:** S3 file upload, download, presigned URL generation.

| Owns | Details |
|------|---------|
| Tables | None (metadata stored in `gate_evidence` by the `gates` domain) |
| Handlers | `upload-presigned-url.ts`, `download-presigned-url.ts` |
| S3 paths | `evidence/{project_id}/{phase}/{checkpoint_name}/{filename}`, `transcripts/{project_id}/{checkpoint_name}/{timestamp}.txt` |
| SRS FRs | FR-P2-012 |

**Key responsibilities:**
- Generate presigned PUT URLs for client-side upload (max 25 MB, allowed MIME types)
- Generate presigned GET URLs for file download
- S3 bucket configuration (Block Public Access, lifecycle)
- File type validation (PDF, DOCX, XLSX, PNG, JPG, TXT, MD)

---

### 2.7 `analysis`

**Purpose:** Avoma transcript fetch + Bedrock AI topic-coverage analysis.

| Owns | Details |
|------|---------|
| Tables | None (results stored in `macro_checkpoints.analysis_result` by `gates` domain) |
| Handlers | `fetch-transcript.ts`, `analyze-transcript.ts` |
| S3 paths | `transcripts/{project_id}/{checkpoint_name}/{timestamp}.txt` (writes via `files` domain presigned URL or direct S3 put) |
| SRS FRs | FR-P2-005, FR-P2-013 |

**Key responsibilities:**
- Call Avoma API to fetch transcript text given a meeting link
- Store transcript in S3
- Call Bedrock (Claude) with transcript + required topics
- Return structured analysis result (`topics_covered`, `topics_missing`, `passed`, `confidence`)
- Update `macro_checkpoints.analysis_result` and `analysis_run_at`
- Secrets Manager integration for Avoma API credentials

**Status:** Deferred to Iteration 3 per SRS §12. Architecture defined now; implementation later.

---

### 2.8 `config`

**Purpose:** CASDM phase/gate template administration.

| Owns | Details |
|------|---------|
| Tables | `casdm_config` |
| Handlers | `list-config.ts`, `add-phase.ts`, `add-item.ts`, `update-item.ts`, `reorder-items.ts`, `deactivate-item.ts` |
| S3 paths | None |
| SRS FRs | FR-P2-006, FR-P2-016 |

**Key responsibilities:**
- List current CASDM template (phases, gates, artifacts)
- Add new phase / gate / artifact
- Rename phase or gate
- Reorder phases or gates
- Deactivate gate/artifact (soft delete — `is_active = false`)
- Changes only affect newly-created projects
- Restricted to Leadership/Admin role

---

### 2.9 `reporting`

**Purpose:** Cross-project read views, governance timeline, QuickSight prep.

| Owns | Details |
|------|---------|
| Tables | None (reads from all other domains' tables) |
| Handlers | `project-timeline.ts`, `cross-project-summary.ts` |
| S3 paths | None |
| SRS FRs | FR-P2-004 (meeting link entry is a gate concern, but timeline display involves cross-domain reads) |

**Key responsibilities:**
- Project timeline view: join `governance_events` + `macro_checkpoints` + `gate_evidence` chronologically
- Cross-project summary for Leadership view (phase completion rates, stalled projects)
- Read-only domain — no writes to any table
- Future: export data for QuickSight (out of scope for this build)

**Note:** FR-P2-004 (Meeting Link Entry) is owned by the `gates` domain since it updates `macro_checkpoints`. The `reporting` domain only reads and assembles timeline data.

---

## 3. Domain Dependency Table

| Domain | Depends On | Reason |
|--------|-----------|--------|
| `shared` | — | Foundation layer — no dependencies |
| `projects` | `shared` | Types, middleware, DB helpers |
| `gates` | `shared` | Types, middleware, DB helpers |
| `meetings` | `shared` | Types, middleware, DB helpers |
| `auth` | `shared` | Types (role enums) |
| `files` | `shared` | Types, middleware |
| `analysis` | `shared` | Types, middleware, DB helpers |
| `config` | `shared` | Types, middleware, DB helpers |
| `reporting` | `shared` | Types, middleware, DB helpers |

```
         ┌──────────────┐
         │   shared     │
         └──────┬───────┘
                │ (all domains depend on shared)
    ┌───────────┼───────────────┬──────────────┐
    │           │               │              │
    ▼           ▼               ▼              ▼
projects    gates         meetings         config
    │           │               │              │
    │           ▼               │              │
    │        files              │              │
    │           │               │              │
    │           ▼               │              │
    │       analysis            │              │
    │                           │              │
    └───────────┬───────────────┘──────────────┘
                │
                ▼
           reporting (reads all tables)
```

**Circular dependency check:** ✅ None. All arrows flow downward from `shared`. No domain imports from another domain's service layer. `reporting` reads tables directly — it does not call other domains' handlers.

---

## 4. FR Coverage Table

Every FR maps to exactly one domain. No orphans.

| FR | Title | Domain | Rationale |
|----|-------|--------|-----------|
| FR-P2-001 | Project List View | `projects` | Project CRUD and listing |
| FR-P2-002 | Project Detail — Gate Status View | `gates` | Displays checkpoints and artifacts |
| FR-P2-003 | Manual Evidence Attachment | `gates` | Evidence links to checkpoints |
| FR-P2-004 | Meeting Link Entry (Manual) | `gates` | Updates `macro_checkpoints.meeting_link` |
| FR-P2-005 | Transcript Analysis (AI Topic Coverage) | `analysis` | Avoma + Bedrock integration |
| FR-P2-006 | Configurable Phases and Gates | `config` | Admin CRUD on `casdm_config` |
| FR-P2-007 | Micro Artifact Status Tracking | `gates` | Reads/writes `micro_artifacts` |
| FR-P2-008 | Macro Checkpoint Completion | `gates` | Core checkpoint state machine |
| FR-P2-009 | Jira CST One-Time Import & Direct Project Creation | `projects` | Project creation and import |
| FR-P2-010 | Role-Based Views | `auth` | Cognito groups → view routing |
| FR-P2-011 | Phase 1 Governance Data Integration | `gates` | Reads `governance_events` for timeline |
| FR-P2-012 | File Upload to S3 | `files` | Presigned URL generation |
| FR-P2-013 | Avoma API Integration | `analysis` | Avoma transcript fetch |
| FR-P2-014 | Project Phase Progression | `projects` | Computed `current_phase` on project query |
| FR-P2-015 | Search and Filter Projects | `projects` | Project list filtering |
| FR-P2-016 | Admin — Manage Phase/Gate Configuration | `config` | Admin panel CRUD |
| FR-P2-017 | Checkpoint Notes | `gates` | Append-only notes on checkpoints |
| FR-P2-018 | CloudFront Deployment | `auth` | SPA hosting + auth integration |
| FR-P2-019 | Project Onboarding Checklist | `projects` | Checklist items per project |
| FR-P2-020 | Weekly Status Call Log | `meetings` | Status log CRUD |
| FR-P2-021 | Escalation Board | `meetings` | Escalation raise/resolve |
| FR-P2-022 | Resource Budget Tracking | `projects` | SOW hours vs consumed |
| FR-P2-023 | Project Closure Workflow | `projects` | Status transition to Closed |
| FR-P2-024 | Executive Check-in Calls | `gates` | Macro checkpoints in Phase 3+4 |
| FR-P2-025 | Discovery Sessions Log | `meetings` | Discovery session CRUD |
| FR-P2-026 | Kickoff Prep Meeting | `gates` | Macro checkpoint in Phase 1 |
| FR-P2-027 | Account Planning Session | `gates` | Macro checkpoint in Phase 4 |
| FR-P2-028 | Resource Budget Display on Project Card | `projects` | Burn rate badge on list view |

**Coverage check:** 28 FRs → 28 assignments. ✅ No orphans.

---

## 5. Boundary Rules

### 5.1 No Cross-Domain Service Imports

Domains import **only** from `packages/shared/`. No domain imports another domain's service layer, handler, or internal types.

```typescript
// ✅ CORRECT
import { Project } from '@deliverpro/shared/types/project';
import { withAuth } from '@deliverpro/shared/middleware/auth';

// ❌ WRONG — cross-domain import
import { completeCheckpoint } from '@deliverpro/gates/services/checkpoint.service';
```

### 5.2 Cross-Domain Data Access via Database

When one domain needs data owned by another domain's table, it queries the database directly:

- `projects` domain computes `current_phase` by joining `macro_checkpoints` (owned by `gates`)
- `reporting` domain reads from `governance_events`, `macro_checkpoints`, `gate_evidence` for timeline assembly
- `gates` domain reads `onboarding_checklist_items` (owned by `projects`) to determine if a `checklist`-type checkpoint is complete

These are **read-only cross-domain queries** — not service-layer imports.

### 5.3 S3 Path Ownership

- `files` domain owns all S3 operations (presigned URL generation)
- Other domains that need file references (e.g., `gates` storing evidence) call the `files` domain's API endpoint to get a presigned URL, then store the resulting S3 key in their own table

### 5.4 Shared Types as Contract

Cross-domain data shapes are defined in `packages/shared/types/`. Both the producing domain and consuming domain reference the same interface — no duplication.

### 5.5 Event-Driven Coupling (Future)

If real-time cross-domain notifications are needed (e.g., "all onboarding items complete → update checklist checkpoint"), this will use an EventBridge rule or SNS topic. For MVP, the `gates` domain computes checklist-checkpoint completion at query time by joining `onboarding_checklist_items`.

---

## 6. Table Ownership Summary

| Table | Owner Domain | Written By | Read By |
|-------|-------------|-----------|---------|
| `projects` | `projects` | `projects` | `projects`, `reporting` |
| `onboarding_checklist_items` | `projects` | `projects` | `projects`, `gates` (completion check) |
| `macro_checkpoints` | `gates` | `gates`, `analysis` (analysis_result) | `gates`, `projects` (phase computation), `reporting` |
| `micro_artifacts` | `gates` | `gates` | `gates`, `reporting` |
| `gate_evidence` | `gates` | `gates` | `gates`, `reporting` |
| `checkpoint_notes` | `gates` | `gates` | `gates` |
| `weekly_status_logs` | `meetings` | `meetings` | `meetings`, `reporting` |
| `escalations` | `meetings` | `meetings` | `meetings`, `reporting` |
| `discovery_sessions` | `meetings` | `meetings` | `meetings`, `reporting` |
| `casdm_config` | `config` | `config` | `config`, `projects` (seeding), `gates` (template lookup) |
| `governance_events` | Phase 1 (MCP server) | Phase 1 MCP server | `gates` (timeline), `reporting` |

---

## 7. Lambda Function Count Estimate

| Domain | Handlers | Notes |
|--------|----------|-------|
| `projects` | 10 | CRUD + import + checklist + hours + closure + search |
| `gates` | 8 | Checkpoints + artifacts + evidence + notes |
| `meetings` | 7 | Status logs + escalations + discovery sessions |
| `files` | 2 | Upload + download presigned URLs |
| `analysis` | 2 | Fetch transcript + analyze (deferred) |
| `config` | 6 | Admin CRUD on casdm_config |
| `reporting` | 2 | Timeline + cross-project summary |
| **Total** | **37** | |

---

*End of Domain Decomposition v1.0*
