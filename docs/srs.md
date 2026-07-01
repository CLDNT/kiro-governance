# Software Requirement Specification — `kiro_governance`

## Changelog

| Version | Date | Author | Change |
|---------|------|--------|--------|
| v1.7 | 2026-06-23 | Orchestrator | CASDM phase alignment: renamed macro gate "Spec file approved" → "Spec strategy approved" (Tariq Khan). Added GATE_PHASES (Phase 0–4) and GATE_PHASE_NAMES (Internal Preparation / Discover & Align / Design & Review / Build & Implement / Launch & Enable). Corrected Discovery/Preliminary SRS gates from Phase 1 → Phase 0. Added backward-compat alias 'spec file approved' → 'Spec strategy approved'. |
| v1.7b | 2026-06-23 | Orchestrator | CR 2026-06-23: DynamoDB → RDS PostgreSQL approved by Tariq Khan. F-04 architecture doc rewritten (v2.0). Unified data model updated (v1.4): removed pk/sk DynamoDB fields, added phase_name, updated SSM params. Sprint 4 backlog added (KG-15–KG-18, 13 pts). |
| v1.6 | 2026-06-11 | Product Analyst | Dropped Athena connector, QuickSight dashboard, S3 Athena buckets per customer decision (Faraz, 2026-06-11). FR-08 scope narrowed to DynamoDB delivery boundary only. Cost revised to ~$8.47/mo. |
| v1.5 | 2026-06-11 | Product Analyst | Resolved OQ-02: project_id = GitHub repository name (customer decision, Tariq Khan 2026-06-11). Removed JIRA blocker. FR-01/FR-02/FR-05 unblocked. |
| v1.4 | 2026-06-10 | Product Analyst | Architect delta review fixes: added Athena intermediary for QuickSight (FINDING-HIGH), updated cost estimate to ~$25-30/mo, refined OQ-02 blocker scope, added SSM parameter naming convention, clarified Athena connector terminology. |
| v1.3 | 2026-06-10 | Product Analyst | Resolved OQ-01 (Slack: one webhook per project channel), OQ-02 (project_id: JIRA ID pending R&D with Waleed — BLOCKED), OQ-03 (Dashboard: Amazon QuickSight), OQ-04 (Secrets: SSM Parameter Store). Source: Customer answers 2026-06-10. |
| v1.2 | 2026-06-10 | Product Analyst | Fixed FR-04/§11/OQ-05 contradiction on GitHub Actions scope (macro-only). FINDING-09 from round 2 review. |
| v1.1 | 2026-06-10 | Product Analyst | Fixes from architect review round 1: resolved GitHub trigger mechanism (FINDING-02), added deduplication key strategy (FINDING-03), added missing macro gate "Preliminary SRS validated" (FINDING-01), added 10th macro gate "Project documentation approved" (FINDING-04), clarified flag_override semantics (FINDING-07), resolved OQ-05 (FINDING-05), added p95 < 5s target (FINDING-06), labeled FR-08 filter capabilities (FINDING-08). |
| v1.0 | 2026-06-10 | Product Analyst | Initial SRS created from project brief |

---

## 1. Executive Summary

### 1.1 Business Objective

Build a lightweight **governance gate and notification layer** around Kiro's agentic output, so AI-accelerated delivery remains auditable and under human control.

> Source: Project Brief §1 — "puts a lightweight governance gate and notification layer around Kiro's output, so AI-accelerated delivery stays auditable and under human control."

### 1.2 Target Users

- Delivery leads and project managers using Kiro-based agentic delivery
- Human reviewers who approve agent-generated artifacts (SRS, architecture docs, code)
- Engineering team members monitoring project progress via Slack and dashboard

### 1.3 What This POC Proves

The end-to-end governance loop on **Pathway 1 (agent-generated artifacts)**: an agent produces an artifact → human approves → progress is logged to DynamoDB → Slack notification fires → dashboard shows status.

> Source: Project Brief §2 — "The POC proves the end-to-end loop on one pathway before we generalise."

### 1.4 Expected Impact

- Consistent, automated governance checks on every agent-generated artifact
- Auditable record of what was checked, when, and by whom
- Live visibility into where each deliverable sits in the pipeline

---

## 2. Problem Statement

> Source: Project Brief §1 — "As we move delivery work onto agentic tooling (Kiro sub-agents generating architecture docs, specs, and code), the output is being produced faster than it can be governed."

**Current pain points:**

1. No consistent, automated way to check that an agent-generated artifact meets standards before it moves forward
2. No mechanism for applying both an automated check AND a human sign-off
3. No record of what was checked, when, and with what result
4. No live visibility into where each deliverable sits in the pipeline

**Cost of not solving:** Agent-generated artifacts flow into production-grade deliverables without governance, breaking auditability and quality control in agentic delivery.

---

## 3. Stakeholders

| Stakeholder | Role |
|---|---|
| Delivery Leads | Primary consumers of governance visibility; approve macro gates |
| Kiro Agent Team | Builds and maintains the MCP server and agent hooks |
| Engineering Teams | Consume Slack notifications; use dashboard for status |
| Project Managers | Monitor cross-project status via dashboard |

---

## 4. Scope

### 4.1 In Scope (POC)

- ✅ Pathway 1 — Agent-generated artifact governance
- ✅ MCP server with two capabilities: Slack notification + DynamoDB write
- ✅ DynamoDB Project Tracker DB (single-table design)
- ✅ GitHub Actions workflow trigger for `project-progress.md` changes
- ✅ Macro/micro classification of governance events
- ✅ Slack notification to per-project channels on macro events
- ✅ Human-approval gate addition to agent workflow (branch + PR)
- ✅ Dashboard for cross-project status reporting

### 4.2 Out of Scope

- ❌ **Pathway 2** — Meeting-transcript governance via Bedrock (explicitly deferred)
- ❌ **Aurora DB** — rejected; DynamoDB chosen
- ❌ **npm distribution** — EC2 hosting chosen over npm private registry
- ❌ **Centralised secrets management** — POC uses environment-level secrets; revisit later
- ❌ **Compliance requirements** — none (internal developer tooling POC)
- ❌ **Athena DDB connector** — dropped per customer decision 2026-06-11
- ❌ **QuickSight dashboard** — dropped per customer decision 2026-06-11
- ❌ **S3 Athena results/spill buckets** — dropped per customer decision 2026-06-11

> Source: Project Brief §3, Pathway 2 — "DEFERRED — not required for now."

### 4.3 Assumptions

| ID | Assumption | Status |
|----|-----------|--------|
| A-01 | Slack channels are already configured per project | ✅ Confirmed (Brief §7: "Already configured per project — no action") |
| A-02 | Kiro has native MCP support including remote servers | ✅ Confirmed (Brief §5: "Kiro has native MCP support, including remote servers") |
| A-03 | GitHub Actions workflow can trigger on `project-progress.md` changes and call MCP server | ✅ Resolved — Architect decision: GitHub Actions workflow (see §11) |
| A-04 | EC2 instance available for MCP server hosting (~$8/mo) | ✅ Confirmed (Brief §6) |
| A-05 | Current Kiro app-dev agents do NOT have an explicit human-approval gate | ✅ Confirmed (Brief §5: "do not yet have an explicit human-approval gate") |

---

## 5. Proposed Solution Overview

### 5.1 High-Level Flow (Pathway 1)

```
Kiro sub-agent generates artifact
    → Human reviews & approves (macro gate)
    → Orchestrator hook calls MCP server
    → MCP server: (1) Slack notification, (2) DynamoDB write
    → Parallel: GitHub commit triggers GitHub Actions workflow
    → Workflow: parses project-progress.md diff
    → If macro-gate lingo detected → calls same MCP server tools
    → Dashboard reads DynamoDB for cross-project status
```

> Source: Project Brief §3, Pathway 1 — steps 1–7.

### 5.2 Macro vs Micro Governance

> Source: Project Brief §4 — "Micro = a sub-agent check (automated)… Macro = a human check / approval."

- **Micro events:** Logged to DB via MCP call. No Slack notification. Example: "domain decomposition done."
- **Macro events:** Logged to DB AND Slack-notified. Carry human sign-off. Example: "SRS approved by human."

---

## 6. System Components

| Component | Role | Hosting |
|-----------|------|---------|
| MCP Server | Agent-callable abstraction — two tools: (1) Slack API call, (2) DynamoDB-write webhook | EC2 (~$8/mo) |
| DynamoDB (Project Tracker DB) | Append-only record of micro/macro updates per project | AWS (serverless, ~free) |
| GitHub Actions Workflow | `.github/workflows/governance-trigger.yml` — triggers on commit/merge when `project-progress.md` changes; diffs file; calls MCP server for macro events only | GitHub-hosted runner (free tier) |
| Slack (per-project channels) | Team notification for macro events | Already configured |
| Kiro Agent Hooks | Human-approval gate + orchestrator hook calling MCP server | Branch + PR into app-dev agents |

> Source: Project Brief §6 — Architecture & hosting table. GitHub Actions mechanism: `Architect decision — not customer-specified` (brief §6 states "can still run as a GitHub Action").

---

## 7. Data Model Reference

The DynamoDB single-table design is specified in Project Brief §6 ("Suggested DynamoDB schema").

| Field | Example | Notes |
|---|---|---|
| `PK` | `PROJECT#rainn` | Partition by project |
| `SK` | `UPDATE#2026-06-10T19:55Z#<ulid>` | Sortable by time |
| `update_text` | "SRS approved by human" | From `project-progress.md` |
| `type` | `macro` \| `micro` | Auto-classified; overridable |
| `flag_override` | `true`/`null` | Manual classification override — indicates the `type` value was manually set by a human operator |
| `gate` | "SRS Approval", "Security Gate" | Maps to methodology gate |
| `phase` | "Phase 1" | Optional, for dashboard grouping |
| `source_ref` | commit SHA / `project-progress.md#L42` | Provenance |
| `actor` | `aws-architect` / human name | Who emitted/approved |
| `created_at` | ISO timestamp | |

**GSI:** On `type` (or `gate`) to support dashboard cross-project rollups.

> Source: Project Brief §6 — "Suggested DynamoDB schema (single table)"

---

## 8. Functional Requirements

### FR-01: MCP Server — Slack Notification Tool

**Priority:** Must Have
**Source:** Project Brief §5 — "Slack API abstraction — exposes a 'notify Slack' capability. The agent calls it; the server handles the Slack API / incoming-webhook call."

**Description:**
The MCP server shall expose a tool that accepts a notification payload and sends it to the specified project's Slack channel via incoming webhook.

**Acceptance Criteria:**

- Given a valid tool call with parameters `project_id`, `message`, and `event_type` (`macro`|`micro`)
- When `event_type` is `macro`
- Then the server shall POST to the Slack incoming webhook URL for that project's channel
- And return a success response with the Slack API response status
- `Implementation detail — not customer-specified:` HTTP 200 returned to caller on success; HTTP 502 on Slack API failure
- `Architect decision — not customer-specified:` The `project_id` → Slack webhook URL mapping is stored in AWS SSM Parameter Store (SecureString). SSM parameter naming pattern: `/kiro-governance/slack/webhooks/{project_id}`. Per OQ-01 + OQ-04 resolutions.

- Given `event_type` is `micro`
- Then no Slack notification is sent (micro events are DB-only)
- `Implementation detail — not customer-specified:` Return HTTP 200 with `{"notified": false, "reason": "micro_event"}`

---

### FR-02: MCP Server — DynamoDB Write Tool

**Priority:** Must Have
**Source:** Project Brief §5 — "DB call abstraction (webhook) — exposes a 'record progress' capability that writes to the internal project-progress DB via a webhook."

**Description:**
The MCP server shall expose a tool that accepts a progress update and writes it as a record to the DynamoDB Project Tracker table.

**Acceptance Criteria:**

- Given a valid tool call with parameters: `project_id`, `update_text`, `type` (`macro`|`micro`), `gate` (optional), `phase` (optional), `actor`, `source_ref`
- When the tool is invoked
- Then a record is written to DynamoDB with:
  - `PK` = `PROJECT#<project_id>` — `project_id` = GitHub repository name. `Source: Customer — 2026-06-11`
  - `SK` = `UPDATE#<ISO-timestamp>#<ulid>`
  - All provided fields stored as attributes
  - `created_at` set to current ISO timestamp
- And the tool returns the written record's `PK` and `SK`
- `Implementation detail — not customer-specified:` Return HTTP 200 with `{"pk": "...", "sk": "..."}` on success; HTTP 500 on DynamoDB write failure

---

### FR-03: Macro/Micro Auto-Classification

**Priority:** Must Have
**Source:** Project Brief §4 — "Classification should be driven off recognisable macro-gate lingo in the project-progress.md entry… plus a manual flag override."

**Description:**
The system shall auto-classify governance events as `macro` or `micro` based on matching the `update_text` against canonical macro-gate lingo from the methodology (§4a of brief). A manual `flag_override` shall allow correction of the auto-classification.

**Acceptance Criteria:**

- Given an update with `update_text` containing recognised macro-gate lingo (e.g., "SRS approved", "code approved", "design docs approved")
- Then `type` shall be set to `macro`

- Given an update with `update_text` that does NOT match any macro-gate lingo
- Then `type` shall be set to `micro`

- Given a tool call with `flag_override` = `true`
- Then the `type` value provided by the caller is stored as-is (no auto-classification is performed)
- The `flag_override` field serves as an audit marker indicating the `type` classification was manually set by a human operator, overriding what auto-classification would have produced

- The canonical macro gates to match are (10 gates):
  1. "Discovery outputs validated"
  2. "Preliminary SRS validated"
  3. "SRS approved"
  4. "Design docs approved" / "solution architecture approved"
  5. "Implementation plan approved" / "sprint plan approved"
  6. "Spec strategy approved"
  7. "Code approved"
  8. "UAT report approved"
  9. "Runbooks approved" / "documentation approved"
  10. "Project documentation approved"
  - `Architect decision — not customer-specified:` Exact matching algorithm (substring, regex, or NLP) to be determined by architect

> Source: Project Brief §4a — Canonical macro gates table

---

### FR-04: GitHub Actions Workflow — Parse `project-progress.md` on Commit

**Priority:** Must Have
**Source:** Project Brief §3 step 5 — "the artifact and the updated project-progress.md are committed to GitHub; a GitHub agent reads the commit, and if project-progress.md changed with macro-gate lingo, it verifies the gate was completed and runs the same two steps (Slack + DB)."

**Description:**
A GitHub Actions workflow (`.github/workflows/governance-trigger.yml`) shall trigger when `project-progress.md` is committed/merged to the main branch. It shall diff the file, extract new/changed entries, check for macro-gate lingo matches, and call the MCP server's two tools (Slack + DB) for macro events only. Non-matching entries are ignored by the workflow.

**Acceptance Criteria:**

- Given a commit/merge to main branch that modifies `project-progress.md`
- When the GitHub Actions workflow triggers
- Then the workflow shall:
  1. Extract the diff (new/changed lines)
  2. For each new entry, check if it matches macro-gate lingo (per FR-03 logic)
  3. For macro entries: call MCP server Slack tool (FR-01) AND DynamoDB tool (FR-02)
  4. For non-matching entries (micro): no action taken — the workflow ignores them. Micro events are logged directly by sub-agents via the MCP server (FR-07).
- `Architect decision — not customer-specified:` The GitHub Actions workflow is the chosen implementation mechanism for the "GitHub agent" referenced in the brief. The brief §6 explicitly supports this: "can still run as a GitHub Action."

- `Architect decision — not customer-specified:` The GitHub Actions workflow processes **macro events only**. Non-matching (micro) entries in `project-progress.md` are ignored by the workflow entirely — micro updates are logged to DB directly by sub-agents calling the MCP server DynamoDB tool (FR-07). This aligns with brief §3 step 5: "if project-progress.md changed with macro-gate lingo."

- `Architect decision — not customer-specified:` The workflow triggers on pushes to main branch with path filter `docs/project-progress.md`. It uses `fetch-depth: 2` for diff comparison. The EC2 MCP server must be reachable from GitHub Actions runners (security group allowlist).

---

### FR-05: Orchestrator Hook — Macro Sign-Off Capture

**Priority:** Must Have
**Source:** Project Brief §5 — "Orchestrator hook path: an explicit human-approval gate in the agent fires an orchestrator hook → the hook calls the MCP server tool → which performs (a) the Slack notification webhook and (b) the DynamoDB update webhook."

**Description:**
When a human approves a macro gate within the Kiro agent workflow, the orchestrator hook shall call the MCP server to perform both Slack notification and DynamoDB write.

**Acceptance Criteria:**

- Given a human has approved a macro gate artifact within the agent workflow
- When the orchestrator hook fires
- Then it shall call the MCP server with:
  - `project_id`: current project identifier — `project_id` = GitHub repository name, available from agent runtime context. `Source: Customer — 2026-06-11`
  - `update_text`: description of what was approved (e.g., "SRS approved by human")
  - `type`: `macro`
  - `gate`: the specific gate name from §4a
  - `actor`: the human approver's identifier
  - `source_ref`: reference to the approved artifact
- And the MCP server shall execute both FR-01 (Slack) and FR-02 (DB write)

---

### FR-06: Human-Approval Gate in Kiro Agents

**Priority:** Must Have
**Source:** Project Brief §5 — "The current Kiro app-dev agents do not yet have an explicit human-approval gate. We need to add one; the hook that drives the macro capture above triggers off that gate."

**Description:**
An explicit human-approval gate shall be added to the Kiro app-dev agent workflow. This gate pauses the agent workflow, requests human review/approval of a macro artifact, and on approval triggers the orchestrator hook (FR-05).

**Acceptance Criteria:**

- Given a sub-agent has completed a macro-gate artifact (e.g., SRS, architecture doc)
- When the workflow reaches the human-approval gate
- Then the agent shall pause and await human input
- And on human approval, the orchestrator hook (FR-05) shall fire

- Delivery: as a **branch + PR** into the main app-dev agents repository
- `Implementation detail — not customer-specified:` Must pull latest Kiro agents before making changes

> Source: Project Brief §7 decisions table — "Not present today — must be added. Deliver as a branch + PR into the main app-dev agents; pull latest Kiro agents first."

---

### FR-07: Micro Update Logging (No Human Gate)

**Priority:** Must Have
**Source:** Project Brief §3 step 6 — "Micro updates (small progress, e.g., 'domain decomposition done') are logged to the DB the same way without the human gate."

**Description:**
Micro governance events (sub-agent progress updates) shall be logged to DynamoDB via the MCP server without requiring human approval and without triggering Slack notifications.

**Acceptance Criteria:**

- Given a sub-agent completes a micro-level task
- When it calls the MCP server DynamoDB tool with `type` = `micro`
- Then a record is written to DynamoDB
- And NO Slack notification is sent

---

### FR-08: Dashboard — Cross-Project Status Reporting

**Priority:** Should Have
**Source:** Project Brief §3 step 7 — "Quick dashboard & reporting reads the DB for cross-project status."

**Description:**
Data available in DynamoDB, directly queryable by external consumers. No dashboard, Athena connector, or QuickSight in scope.

**Acceptance Criteria:**

- The DynamoDB table shall store governance events queryable by:
  - Per-project: list of governance events (macro and micro) sorted by time
  - Cross-project: rollup of macro gate completions by phase
  - Filter by: project, gate, phase, type (macro/micro)

- DynamoDB table with GSIs provides the queryable data layer for any future reporting tool. Dashboard implementation is out of scope per customer decision 2026-06-11.

---

### FR-09: Dual Trigger Path — Consistency

**Priority:** Must Have
**Source:** Project Brief §5 — "A macro event (e.g., 'SRS approved by human') reaches the DB + Slack through either path — they run the same two MCP tools."

**Description:**
Both trigger paths (orchestrator hook and GitHub Actions workflow) shall produce identical DynamoDB records and Slack notifications for the same event. The system shall not create duplicate records when both paths fire for the same event.

**Acceptance Criteria:**

- Given a macro event is captured by both the orchestrator hook AND the GitHub Actions workflow
- Then the system shall produce only ONE DynamoDB record and ONE Slack notification for that event

- `Architect decision — not customer-specified:` Deduplication uses an **idempotency key** composed of: `PK` (PROJECT#<project_id>) + `gate` name + day-granularity date (YYYY-MM-DD). If a DynamoDB record with the same idempotency key already exists within that calendar day, the write is skipped and no duplicate Slack notification is sent.

---

## 9. Non-Functional Requirements

### NFR-01: Performance

- `Architect decision — not customer-specified:` MCP server tool invocations shall complete with p95 latency < 5 seconds end-to-end (EC2-to-DynamoDB + Slack webhook). This is a POC-appropriate target that can be tightened later.
- DynamoDB writes shall use on-demand capacity (no provisioned throughput needed for POC scale)

> Source: Cloudelligent recommended best practice — pending client confirmation

### NFR-02: Reliability

- The MCP server shall be available during working hours for the POC
- `Architect decision — not customer-specified:` No uptime SLA specified; this is an internal POC. Architect to determine if EC2 auto-recovery is warranted.
- Failed Slack notifications shall not block DynamoDB writes (the two jobs are independent)

> Source: Project Brief §5 — the two jobs are described as independent capabilities

### NFR-03: Security (Internal Tooling Level)

- Slack webhook URLs and AWS credentials shall be stored in the agent/Action environment
- `Implementation detail — not customer-specified:` No public-facing endpoints beyond what MCP protocol requires
- No authentication beyond the inherent trust boundary of the Kiro agent ↔ MCP server connection (internal tooling)
- `Architect decision — not customer-specified:` The EC2 MCP server should validate an API key/shared secret in requests from GitHub Actions to prevent unauthorized calls. Secret stored in GitHub Actions secrets and passed as a header.

> Source: Project Brief §7 — "Slack webhook URL + AWS creds for DynamoDB live in the agent/Action environment for the POC."

### NFR-04: Observability

- ⚠️ `UNVERIFIED (no customer source):` No logging/monitoring requirements stated in brief. Recommend basic CloudWatch logging for the EC2-hosted MCP server.

> Source: Cloudelligent recommended best practice — pending client confirmation

### NFR-05: Cost

- EC2 hosting: ~$8.47/mo base config
- DynamoDB: ~$0/mo (free tier, on-demand, low volume)
- GitHub Actions: free tier (2,000 min/mo for private repos)
- Total POC infrastructure: ~$8.47/mo
- Note: QuickSight and Athena dropped per customer decision 2026-06-11.

> Source: Project Brief §6 — cost estimates provided.

---

## 10. Edge Cases & Failure Scenarios

| Scenario | Expected Behaviour | Source |
|----------|-------------------|--------|
| Slack API is unreachable | DynamoDB write still succeeds; Slack failure is logged | `Implementation detail — not customer-specified` |
| DynamoDB write fails | Error returned to caller; Slack notification may still have fired | `Implementation detail — not customer-specified` |
| `project-progress.md` entry is ambiguous (neither clear macro nor micro) | Classify as `micro` by default; `flag_override` allows manual correction | Project Brief §4 — "plus a manual flag override that can set or correct the classification" |
| Both trigger paths fire for same event | Deduplication via idempotency key prevents duplicate records (FR-09) | `Architect decision — not customer-specified` |
| Human rejects artifact at macro gate | No MCP call fires; artifact returns to sub-agent for rework | `Implementation detail — not customer-specified` |
| `project-progress.md` has bulk edits (many lines changed) | Each new entry processed individually | `Implementation detail — not customer-specified` |

---

## 11. Resolved Architectural Decisions

### ✅ RESOLVED — GitHub Trigger Mechanism

**Context:** The project brief states a "GitHub agent reads the commit" and "if `project-progress.md` changed with macro-gate lingo, it verifies the gate was completed and runs the same two steps." The brief §6 also states: "The GitHub-side parse step (reading `project-progress.md` on commit) can still run as a GitHub Action or as a process alongside the MCP server on the EC2 box."

**Decision:** Use a **GitHub Actions workflow** (`.github/workflows/governance-trigger.yml`).

**Rationale:**
1. The brief explicitly supports this option (§6: "can still run as a GitHub Action")
2. Zero additional infrastructure — no public endpoint on EC2 for webhooks, no webhook secret management beyond API key
3. Natively triggers on file changes — `paths: ['docs/project-progress.md']` filter is built-in
4. Reliable — fires on all pushes/merges to main, not just local commits
5. Testable — workflow runs visible in GitHub Actions UI with full logs
6. Cost — free within GitHub's included minutes for private repos

**Scope:** The GitHub Actions workflow processes **macro events only**. It parses `project-progress.md` diffs for macro-gate lingo and calls the MCP server (Slack + DB) only for matching entries. Non-matching (micro) entries are ignored by the workflow entirely — micro updates are logged to DB directly by sub-agents via the MCP server DynamoDB tool (FR-07). This aligns with brief §3 step 5: "if project-progress.md changed with macro-gate lingo."

> Source: Project Brief §3 step 5 and §6. `Architect decision — not customer-specified:` The specific mechanism (GitHub Actions) is the architect's resolution of the brief's "GitHub agent" reference.

---

## 12. Open Questions

| ID | Question | Impact | Status |
|----|----------|--------|--------|
| OQ-01 | What is the exact Slack incoming webhook URL provisioning model? (One per project channel?) | FR-01 implementation | ✅ Resolved |
| OQ-02 | How does the Kiro agent identify `project_id` at runtime? (Workspace config? Repo name?) | All FRs — `project_id` parameter | ✅ Resolved |
| OQ-03 | What is the dashboard technology? (Static site? Internal tool? Existing platform?) | FR-08 scope | ✅ Resolved |
| OQ-04 | Auth/secrets model — environment variables sufficient for POC? Revisit when? | NFR-03 | ✅ Resolved |

### Resolved Questions

| ID | Question | Resolution |
|----|----------|-----------|
| OQ-01 | What is the exact Slack incoming webhook URL provisioning model? | **Resolved:** Each project has exactly one dedicated Slack channel and one corresponding incoming webhook URL. The MCP server routes notifications using a `project_id` → webhook URL mapping. `Source: Customer — 2026-06-10` |
| OQ-02 | How does the Kiro agent identify `project_id` at runtime? | **Resolved:** `project_id` = **GitHub repository name** (e.g., `rainn`, `icvics`). This is the unique identifier for each project across the governance system. Rationale: repo name is inherently unique, always available in the GitHub Actions runtime context (`github.repository` / `github.event.repository.name`), and maps directly to the project being governed. The `project_id` → Slack webhook URL mapping is stored as key-value pairs in AWS SSM Parameter Store at `/kiro-governance/slack/webhooks/{project_id}` (per FR-01). No JIRA dependency. `Source: Customer (Tariq Khan) — 2026-06-11` ✅ RESOLVED — No longer a blocker. FR-01, FR-02, FR-05 may proceed. |
| OQ-03 | What is the dashboard technology? | **Resolved:** Out of scope — customer decision 2026-06-11. DynamoDB table is the delivery boundary. External consumers build their own dashboard. |
| OQ-04 | Auth/secrets model — environment variables sufficient for POC? | **Resolved:** `Architect decision — not customer-specified:` For the POC, use **AWS SSM Parameter Store (SecureString)** for Slack webhook URLs and DynamoDB credentials. Rationale: (1) AWS-native, consistent with EC2 hosting choice; (2) no plaintext secrets in environment variables or code; (3) free tier sufficient for POC; (4) trivially upgradable to Secrets Manager if rotation is needed later. GitHub Actions will use GitHub Encrypted Secrets for the MCP server API key. `Source: Architect decision — customer deferred` |
| OQ-05 | Should the GitHub trigger also process micro events, or only macro? | **Resolved:** GitHub Actions workflow processes macro events only. Brief §3 step 5 states: "if project-progress.md changed with macro-gate lingo, it verifies the gate was completed and runs the same two steps (Slack + DB)." Micro events are logged directly by sub-agents via the MCP server DynamoDB tool (FR-07), not via the GitHub path. |

---

## 13. Dependencies

| Dependency | Type | Status |
|-----------|------|--------|
| Kiro MCP native support (remote servers) | Technical | ✅ Confirmed |
| Slack channels per project | Infrastructure | ✅ Already configured |
| EC2 instance for MCP server | Infrastructure | To be provisioned |
| DynamoDB table | Infrastructure | To be provisioned |
| Latest Kiro app-dev agents codebase | Code | Required before FR-06 work |
| GitHub repository access | Infrastructure | Assumed available |
| GitHub Actions enabled on repository | Infrastructure | Required for FR-04 |

---

## 14. Success Metrics

| Metric | Target | Source |
|--------|--------|--------|
| End-to-end loop proven | A macro event flows from agent → human approval → DB + Slack | Project Brief §2 — "proves the end-to-end loop" |
| All 10 canonical macro gates representable | Schema supports all gates from §4a (including "Preliminary SRS validated" and "Project documentation approved") | Project Brief §4a |
| Cross-project visibility | Dashboard shows status of multiple projects | Project Brief §3 step 7 |
| ⚠️ `UNVERIFIED (no customer source):` Quantitative adoption/usage targets | Not specified | — |

---

## 15. Risks & Mitigation

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| Human-approval gate changes conflict with Kiro agent updates | Medium | Medium — merge conflicts | Pull latest agents immediately before work; minimal-touch PR |
| Macro-gate lingo matching produces false positives/negatives | Medium | Low — correctable via `flag_override` | Manual override capability built in (FR-03) |
| EC2 instance unavailability | Low | Medium — blocks all governance | `Architect decision — not customer-specified:` Basic health monitoring recommended |
| GitHub Actions runner cannot reach EC2 MCP server | Low | Medium — blocks GitHub trigger path | `Architect decision — not customer-specified:` EC2 security group must allow inbound from GitHub Actions IP ranges |

---

## 16. Canonical Macro Gates Reference (from Methodology)

| Phase | Macro Gate | Validating Sub-Agent |
|-------|-----------|---------------------|
| 1 — Discover & Align | Preliminary SRS validated | `product-analyst` |
| 0 — Internal Preparation | Discovery outputs validated | `product-analyst` |
| 0 — Internal Preparation | Preliminary SRS validated | `product-analyst` |
| 1 — Discover & Align | SRS approved | `product-analyst` |
| 2 — Design & Review | Design docs / solution architecture approved | `aws-architect` |
| 2 — Design & Review | Implementation / sprint plan approved | `plan-reviewer` |
| 3 — Build & Implement | Spec strategy approved | `executioner` |
| 3 — Build & Implement | Code approved | `code-reviewer` |
| 3 — Build & Implement | UAT report approved | `qa-agent` |
| 4 — Launch & Enable | Runbooks / documentation approved | `aws-architect` |
| 4 — Launch & Enable | Project documentation approved | `aws-architect` |

Additionally, Phase 2 includes automated (non-human) gates: **Security Gate** and **Compliance Gate** (run by `security-reviewer`).

> Source: Project Brief §4a — "Canonical macro gates (from the methodology diagram)"

---

*End of SRS v1.6*
