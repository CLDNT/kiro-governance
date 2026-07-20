# DeliverPro — Future Features R&D Report
> Generated: 2026-07-15 | Source: CST-675 Jira ticket + Nayab/Faraz sync VTT + Phase 2 backlog analysis

## Overview
This report captures the feature and data gaps between DeliverPro and the way CST-675 — a live HIPAA health project — is currently managed manually in Jira. The two sources reveal (1) that Jira holds project metadata, decision workflows, and status cadences DeliverPro does not yet model, and (2) that several external systems (Avoma, Clockify, Oscar, Teams/SharePoint, GitHub, FusionAuth) are referenced in the real workflow but not integrated. Most gaps are legitimate metadata extensions with near-zero incremental cost, while the governance-as-layer and HIPAA/PHI risks require a "store reference, not content" approach for anything Avoma- or Oscar-derived.

---

## Section 1: Data / Field Gaps

| Field/Data | Currently In DeliverPro? | Gap Description | How-To | Complexity | Priority |
|---|---|---|---|---|---|
| `health_status` (RAG) | No | PM-set red/amber/green health, distinct from computed burn-rate color | Nullable column + CHECK enum; batch migration | Low | P1 |
| `actual_kickoff_date` | No | Real internal-kickoff date vs. planned | Column + idempotent auto-stamp on checklist complete | Medium | P1 |
| `actual_customer_kickoff_date` | No | Real customer-kickoff date | Column + separate checkpoint stamp | Medium | P1 |
| `implementation_lead` | No | Delivery lead role not tracked | TEXT column, consistent with existing PM/SA/AE columns | Low | P1 |
| `reporter` | No | Who raised/owns the ticket origin | TEXT column | Low | P1 |
| `assignee` | No | Current owner (rotates over lifecycle) | Single TEXT column now; history table only if hand-off audit needed | Low | P1 |
| `priority` / `resolution` / `request_type` enums | No | Standard Jira triage fields absent | Nullable columns with CHECK enum constraints | Low | P1 |
| `completed_this_week` | No | Weekly "done" narrative not captured | TEXT column on `weekly_status_logs` | Low | P1 |
| `planned_next_week` | No | Weekly "next" narrative not captured | TEXT column on `weekly_status_logs` | Low | P1 |
| Decision rationale/metadata | No | Approval decisions not modeled — currently raised as Jira tickets | New `project_decisions` table; short rationale + URL to authoritative doc | Medium | P1 |
| Avoma report content | No | Meeting report/scores not stored | ⚠️ HIPAA — store meeting_id + report_url + AI summary/scores only; content to encrypted S3, not RDS | Medium | P1 |

---

## Section 2: Workflow Feature Gaps

| Feature | Current Jira Workflow | DeliverPro Gap | How-To | Complexity | Priority |
|---|---|---|---|---|---|
| RAG health end-to-end | PM sets health, leadership reviews on board | No health field / not on dashboard | Add column + surface in leadership dashboard alongside burn-rate | Low–Medium | P1 |
| Decision ticket workflow | Raise → approver (Chris) approves/rejects → Nayab documents | No decision object or approval gate | New table + create/PATCH API with approver-only role check + Slack notify + decisions tab | Medium | P1 |
| Actual-date auto-capture | Dates recorded manually, often missed | No auto-stamp on kickoff events | Event-driven Lambda stamps dates on checklist completion (idempotent) | Medium | P1 |
| Friday status reminder | Manual chase by Nayab every Friday | No automated reminder | EventBridge Fri cron → Lambda finds missing logs → Slack reminder | Medium | P1 |
| Resource-assignment notify | Manual signal when resources assigned | No trigger on resource_assignment_date | On `resource_assignment_date` set → Slack notify + optional Phase 0 checklist start | Medium | P1 |
| Non-5×5 templates + IPR checkpoint | POC/migration/integration differ; IPR is a hard gate | Gate structure not fully config-driven; no IPR type | Make casdm_config fully config-driven; model IPR as a named checkpoint type | Medium | P2 |
| Board/kanban multi-filter view | Jira board with type/phase/PM/SA filters | No equivalent view | Frontend-only multi-filter board; no backend change | Low | P3 |
| Full project-intake/origination | Full request → triage → create flow | Only pieces exist; request_type column can ship now but workflow is incomplete | request_type column ships in Phase 3; full workflow deferred | High | P4 (defer) |

---

## Section 3: Integration Gaps

| System | What It Provides | Integration Needed | How-To | Complexity | Priority |
|---|---|---|---|---|---|
| Avoma | Meeting reports, transcripts, AI scores | Fetch report + auto-match to project by naming convention | ⚠️ HIPAA — extend DP-37/38 Lambda to fetch report metadata; store reference/summary only; never store transcript content in RDS | Medium | P1 |
| Slack | Team channels | Auto-create micro + macro channel per project on init | Reuse existing bot token → `conversations.create`; store channel IDs; handle name collisions | Medium | P2 |
| Clockify | Time entries / actual hours logged | Replace manual `hours_consumed` updates | Scheduled Lambda pulls entries via Clockify API; new SSM creds; keyed on Clockify project ID | High | P4 (defer) |
| SharePoint/Teams | Folder provisioning, SOW document storage | Graph API to create project folder structure | App registration + admin consent + Graph SDK | High | P4 (defer) |
| Oscar | SOW/deal context, preliminary SRS generation | Read deal context; trigger preliminary SRS draft | ⚠️ HIPAA-adjacent — store deal ID + SOW link only; SRS generated to GitHub; separate AgentCore pipeline | High | P4 (defer) |
| FusionAuth | Identity / OIDC for agent and human auth | Migrate auth provider from Cognito | ⚠️ HIPAA — controlled cutover preserving MFA/TLS/audit; own workstream, do not bundle with features | High | P4 (defer) |
| GitHub | Repo creation + .kiro scaffolding | Auto-provision repo with correct .gitignore on project create | GitHub App; blocked on OIDC (FusionAuth) being in place first | Medium–High | P4 (defer) |

---

## Section 4: HIPAA / Compliance Considerations

- **PHI leakage into the governance DB is the #1 risk.** Avoma reports/transcripts for a health project (like MCI Health) can contain PHI; persisting content in RDS could pull the entire DB into HIPAA scope.
- **Guardrail — governance-as-layer only.** Keep DeliverPro storing IDs, URLs, AI summaries, and scores only. Never store human-readable meeting content in RDS.
- **S3 (SSE-KMS), not RDS**, for any retained human-readable content; store only the S3 key + metadata in Postgres.
- **BAA with Avoma required** if any Avoma-derived content is stored anywhere — even S3. Confirm before extending DP-37/38.
- **Bedrock AgentCore:** no PHI must be transmitted to the model. Apply AWS Bedrock Guardrails. Confirm Bedrock is in the AWS BAA scope.
- **FusionAuth migration must preserve** MFA enforcement, TLS 1.2+, and access audit logging. Treat as a controlled identity workstream, not a feature.
- **Baseline controls to confirm before any HIPAA project is onboarded:** RDS KMS encryption at rest, TLS in transit, S3 Block Public Access + SSE-KMS, Cognito MFA enforced, least-privilege Lambda roles, full audit trail via `governance_events`.

---

## Section 5: Recommended Phase 3 Scope

1. **Batched column migration (V005)** — Add all missing fields: `health_status`, `actual_kickoff_date`, `actual_customer_kickoff_date`, `implementation_lead`, `reporter`, `assignee`, `priority`, `resolution`, `request_type`. Plus `completed_this_week` / `planned_next_week` on `weekly_status_logs`. Foundational — downstream features depend on these fields existing.

2. **RAG health end-to-end** — Add health_status column + expose on project cards + leadership dashboard. Immediate visibility value, low effort.

3. **Weekly status fields** — Extend `weekly_status_logs` with `completed_this_week` + `planned_next_week`. Low-cost extension of an existing table.

4. **Actual-date auto-capture** — Event-driven Lambda stamps `actual_kickoff_date` and `actual_customer_kickoff_date` on specific checklist item completions. Uses existing write path.

5. **Decision ticket workflow** — New `project_decisions` table, create/PATCH API, approver-only role check, Slack notification, decisions tab on project detail. Highest-visibility governance capability.

6. **Friday reminder + resource-assignment notify** — EventBridge cron (Friday) + Lambda to find projects with missing weekly logs → Slack reminder. On `resource_assignment_date` set → Slack notify.

7. **Avoma report as reference (redesigned)** — Extend DP-37/38 to fetch report metadata (title, date, duration, summary) via Avoma API. Store reference + AI summary only in RDS; raw content to encrypted S3. ⚠️ HIPAA: confirm Avoma BAA before enabling for health projects.

8. **Slack channel auto-creation** — Reuse existing bot token; create micro + macro channels on project creation. Returns channel IDs stored in existing columns.

9. **Non-5×5 templates + IPR checkpoint** — Validate that casdm_config is fully config-driven. Add IPR as a named checkpoint type with proper gate logic.

10. **Board/kanban multi-filter view** *(stretch)* — Frontend-only; replicate Jira board filtering by type/phase/PM/SA.

---

## Section 6: Deferred to Phase 4+

- **Oscar integration + auto preliminary-SRS** ⚠️ HIPAA-adjacent — flagship-sized feature requiring Oscar API, AgentCore pipeline, presales governance. Own workstream.
- **FusionAuth OIDC migration** ⚠️ HIPAA — cross-cutting identity cutover; do not bundle with feature work.
- **GitHub repo auto-creation** — Blocked on FusionAuth OIDC being live first.
- **Clockify integration** — New external system; keep manual `hours_consumed` through Phase 3.
- **SharePoint/Teams folder provisioning** — New external system + Microsoft Graph admin consent. Significant setup overhead.
- **Full project-intake/origination workflow** — `request_type` column ships in Phase 3; full triage-to-create workflow waits for Phase 4.

---

> ⚠️ **Architect note on priority re-classification:** Oscar, FusionAuth, and GitHub auto-creation were flagged P1 in initial analysis. They are re-classified to Phase 4 — bundling three new external/identity systems into Phase 3 would blow scope and stack unacceptable risk, especially given HIPAA implications.
