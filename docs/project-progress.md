# Project Progress

## Phase 0: Discovery & Compliance

- [x] 0.1 Project type determined — **Greenfield (App Dev)** (confirmed by human 2026-06-10)
- [x] 0.2 Compliance check — **None required** (internal developer tooling POC; no HIPAA/SOC2/PCI-DSS/CCPA/GDPR data) (confirmed by human 2026-06-10)

### Open Questions (Phase 0)

- ✅ **RESOLVED — GitHub Agent mechanism:** Architect decision — **GitHub Actions workflow** (`.github/workflows/governance-trigger.yml`). Triggers on commit/merge when `project-progress.md` changes; processes macro-gate entries only. Micro events logged directly by sub-agents via MCP server. Resolved in SRS v1.1, confirmed in architect review round 2.

## Phase 1: SRS

- [x] 1.1 SRS created by product analyst — SRS v1.0 (2026-06-10)
- [x] 1.2 Architect review round 1 — 8 findings (2 Critical, 1 High, 3 Medium, 2 Low) (2026-06-10)
- [x] 1.3 Product analyst fixes — SRS v1.1 (2026-06-10)
- [x] 1.2 Architect review round 2 — 1 new High finding FINDING-09 (2026-06-10)
- [x] 1.3 Product analyst fixes — SRS v1.2 (2026-06-10)
- [x] 1.4 SRS approved — architect approved SRS v1.4, zero Critical/High issues (2026-06-10) - OQ-01: One Slack webhook per project channel ✅ - OQ-02: project_id = GitHub repository name (e.g. `rainn`, `icvics`) — customer decision Tariq Khan 2026-06-11 ✅ - OQ-03: Dashboard = Amazon QuickSight via Athena federated query ✅ - OQ-04: Secrets = SSM Parameter Store ✅ - Cost revised to ~$25–30/mo (QuickSight ~$12 + Athena ~$5 added)

## Phase 2: Architecture

- [x] 2.1 Domain decomposition — 5 domains, 9/9 FRs mapped, approved by plan reviewer + product analyst (2026-06-11)
- [x] 2.2 Feature list — 5 features (F-01 to F-05), approved by plan reviewer + product analyst (2026-06-11)
- [x] 2.3 Per-feature architecture docs — 5 docs (F-01 to F-05), all approved by plan reviewer (2026-06-11) - F-04: data-persistence-architecture.md v1.3 - F-01: mcp-server-core-architecture.md v1.2 - F-02: agent-integration-architecture.md v1.2 - F-03: github-trigger-architecture.md v1.3 - F-05: reporting-architecture.md v1.0 - H2 hallucination audit: PASSED (2026-06-11)
- [x] 2.4 Security Gate 1 — APPROVED after 3 rounds; TLS self-signed cert (Option B) wired in; all High/Medium resolved (2026-06-11)
- [x] 2.5 Unified data model — approved by plan reviewer + security reviewer (2026-06-11) - Single-table DynamoDB (kiro-governance-tracker), 2 GSIs, IAM append-only enforced - SSM paths consolidated, S3 buckets documented
- [x] 2.5a Security Gate 1.5 — data model — APPROVED after 3 rounds (2026-06-11)
- [x] 2.6 Technical architecture diagram — approved by plan reviewer after 2 rounds (2026-06-11) - kiro-governance-architecture.drawio — 5 domains, 12 flows, Lambda connector, SG boundary
- [x] 2.7 Security Gate 2 — Well-Architected review APPROVED; 0 Critical/High; 3 Medium (non-blocking); SEC-1 CDK fix applied (2026-06-11)
- [x] 2.8 Cost estimate — ~$20.49/mo (EC2 $8.47 + QuickSight $12.00 + S3 ~$0.02); AWS Budgets alarm at $35/mo recommended (2026-06-11)

## Phase 3: Sprint Planning

- [x] 3.1 Team size confirmed — 1 full-stack developer (Faraz), 100% availability assumed (2026-06-11)
- [x] 3.2 Implementation strategy + JIRA backlog — 14 stories, 48 pts, 3 sprints (2026-06-11)
      ⚠️ CR 2026-06-11: Athena + QuickSight dropped per customer decision. Revised: 11 stories, 41 pts, ~$8.47/mo
- [x] 3.3 Architect review of backlog — APPROVED (2026-06-11)
- [x] 3.4 Plan reviewer validation — APPROVED (2026-06-11)
- [x] 3.5 Backlog clarifications resolved — Athena/QuickSight CR executed, all docs updated (2026-06-11)
- [x] 3.6 Backlog approved — ready for implementation (2026-06-11)

### Final Sprint Plan (post-CR)

| Sprint   | Stories        | Pts | Focus                                       |
| -------- | -------------- | --- | ------------------------------------------- |
| Sprint 1 | KG-01 to KG-05 | 18  | CDK infra + EC2 + MCP Server                |
| Sprint 2 | KG-06 to KG-09 | 16  | Agent integration + GitHub Actions workflow |
| Sprint 3 | KG-13, KG-14   | 7   | Kiro CLI integration test + runbooks        |

## Phase 4: Implementation

### Sprint 1

- [x] KG-01 CDK Stack — DynamoDB table, GSIs, IAM role, SSM params — code reviewed + approved (2026-06-11)
- [x] KG-02 EC2 Instance provisioning + self-signed TLS cert setup — code reviewed + approved (2026-06-11)
- [x] KG-03 MCP Server project scaffold — code reviewed + approved (2026-06-11)
- [x] KG-04 `record_progress` tool (classification + dedup + DynamoDB write) — code reviewed + approved (2026-06-11)
- [x] KG-05 `notify_slack` tool (SSM webhook lookup + Slack POST) — code reviewed + approved (2026-06-11)

### Sprint 2

- [x] KG-06 Human-approval gate (orchestrator-standards.md + .kiro/mcp.json) — code reviewed + approved (2026-06-11)
- [x] KG-07 Orchestrator hook — macro sign-off (verified complete from KG-06) — approved (2026-06-11)
- [x] KG-08 Micro update logging (4 steering files instrumented, 11 events) — approved (2026-06-11)
- [x] KG-09 GitHub Actions governance workflow — code reviewed + approved (2026-06-11)

### Sprint 3

- [x] KG-13 End-to-end integration test runbook via Kiro CLI — approved (2026-06-11)
- [x] KG-14 Runbooks (cert-rotation, ec2-deploy, auto-recovery alarm) — approved (2026-06-11)

- [x] Implementation plan approved by Faraz
- [x] Design docs approved by Faraz
- [x] CR 2026-06-23: DynamoDB → RDS PostgreSQL change request approved by Tariq Khan. Architecture docs updated (F-04 v2.0, unified-data-model v1.4). Sprint 4 backlog added (KG-15–KG-18, 13 pts).

### Sprint 4

- [x] KG-15 CDK: RDS PostgreSQL db.t3.micro, IAM auth, SG, SSM params, DynamoDB removed — code reviewed + approved (2026-06-24)
- [x] KG-16 DB migration: V001__governance_events.sql, 12 columns, uq_idempotency constraint, 3 indexes — code reviewed + approved (2026-06-24)
- [x] KG-17 MCP Server: postgres.service.ts (RDSSigner + pg pool), record-progress.ts migrated, DynamoDB SDK removed — code reviewed + approved (2026-06-24)
- [x] KG-18 Shared types: GovernanceEventRecord pk/sk removed, id + phase_name added — code reviewed + approved (2026-06-24)

## Phase 2: Interactive Project Tracker (new scope — 2026-06-25)

- [x] Phase 2 KB indexed: Phase2Transcript.txt + Phase2KeyPoints.txt (2026-06-25)
- [x] Phase 2 next-steps doc created: docs/phase2/next-steps.md (2026-06-25)
- [x] V002 migration created: projects + project_gates + gate_evidence tables (2026-06-25)
- [x] Sandbox stack deprovisioned — all resources deleted from account 504649076991 (2026-06-25)
- [x] Phase 2 SRS v1.3 — architect-approved, zero remaining gaps, 31 FRs (2026-06-29)
- [x] Phase 2 domain decomposition v1.0 — 8 domains, 28 FRs mapped (2026-06-29)
- [x] Phase 2 feature list v1.0 — 19 features, F-P2-01 to F-P2-19 (2026-06-29)
- [x] 2.3 Per-feature architecture docs — all 8 domains approved (2026-06-29)
      - auth-architecture.md ✅
      - projects-architecture.md ✅ (1 Critical fixed: phase computation consistency)
      - gates-architecture.md ✅
      - meetings-architecture.md ✅
      - files-architecture.md ✅
      - config-architecture.md ✅
      - analysis-architecture.md ✅ (Iteration 3 deferred)
      - reporting-architecture.md ✅
- [x] 2.4 Security Gate 1 — PASSED, all Critical/High resolved (2026-06-30)
- [x] 2.5 Unified data model — approved (V003 migration written) (2026-06-30)
- [x] 2.5a H2 hallucination audit — PASSED (2026-06-30)
- [x] 2.6 Architecture diagram — deliverpro-architecture.drawio, approved (2026-06-30)
- [x] 2.7 Security Gate 2 — PASSED, 0 Critical/High, 7 Medium accepted (2026-06-30)
- [x] 2.8 Cost estimate — ~$25.71/mo total (Phase 1 + Phase 2), written (2026-06-30)

## Phase 3: Sprint Planning

- [x] 3.1 Team size confirmed — Muhammad Faraz, 1 developer, 4 hrs/day, 20 hrs/week (2026-06-30)
- [x] 3.2 Implementation strategy + JIRA backlog — 41 stories, 160 pts, 8 sprints (2026-06-30)
- [x] 3.3 Architect review of backlog — APPROVED, 3 minor spec strategy refs noted (2026-06-30)
- [x] 3.4 Plan reviewer validation — APPROVED, all sprints 20 pts, all 31 FRs covered (2026-06-30)
- [x] 3.5 H3 hallucination audit — PASSED (2026-06-30)
- [x] 3.6 Backlog approved — ready for implementation (2026-06-30)
## Phase 4: Implementation

### Sprint 1 — Foundation (2026-06-30)
- [x] DP-01 CDK Stack Scaffold (DeliverProStack: Cognito, API GW, CloudFront, S3, Lambda role) ✅
- [x] DP-02 V003 Migration (all new tables, columns, indexes, QuickSight views, AppDev seed data) ✅
- [x] DP-03 Shared Middleware (JWT auth, RBAC, error handler, logger, RDS pool) ✅
- [x] DP-04 Cognito User Pool + 5 Groups + App Client ✅

### Sprint 2 — Projects Backend (2026-06-30)
- [x] DP-05 Project CRUD Handlers (list, get, create, update) ✅
- [x] DP-06 Jira One-Time Import Lambda ✅
- [x] DP-07 CASDM Template Seeding on Project Create ✅
- [x] DP-08 Onboarding Checklist CRUD ✅
- [x] DP-09 Resource Budget Update Handler ✅

### Sprint 3 — Gates + Files + Meetings Backend (2026-06-30)
- [x] DP-10 Gate Status View Lambda ✅
- [x] DP-11 Checkpoint Completion Lambda (4 types) ✅
- [x] DP-12 Evidence Attachment Lambda ✅
- [x] DP-13 Files Domain Presigned URL Lambdas ✅
- [x] DP-14 Weekly Status Call Log Handlers ✅

### Sprint 4 — Frontend Iteration 1 (2026-06-30)
- [x] DP-15 React + Vite + Tailwind Scaffold + Cognito Auth Flow ✅
- [x] DP-16 Project List Page + Search/Filter ✅
- [x] DP-17 Project Detail Page (Gate Status View) ✅
- [x] DP-18 Evidence Attachment UI + File Upload ✅
- [x] DP-19 Onboarding Checklist UI ✅
- [x] DP-20 Weekly Status Log UI + Resource Budget Display ✅

### Sprint 5 — Iteration 2 Backend (2026-06-30)
- [x] DP-21 Escalation Board Handlers ✅
- [x] DP-22 Discovery Sessions Handlers ✅
- [x] DP-23 Checkpoint Notes Lambda ✅
- [x] DP-24 Executive Check-in & Planning Checkpoint Seeds ✅
- [x] DP-25 Project Closure Workflow Lambda ✅

### Sprint 6 — Iteration 2 Frontend + Reporting (2026-06-30)
- [x] DP-26 Escalation Board UI ✅
- [x] DP-27 Discovery Sessions UI ✅
- [x] DP-28 Checkpoint Notes UI + Project Closure UI ✅
- [x] DP-29 Reporting Domain Handlers (summary + timeline) ✅
- [x] DP-30 Leadership Dashboard UI ✅
- [x] DP-31 Micro Artifact Status UI + Phase Progression Visual ✅

### Sprint 7 — Iteration 3 Infrastructure + Config (2026-06-30)
- [x] DP-32 CASDM Config CRUD Handlers ✅
- [x] DP-33 Analysis Prompts CRUD Handlers ✅
- [x] DP-34 Project Type Template Management ✅
- [x] DP-35 AgentCore Agent Setup (Bedrock, claude-sonnet-4-5 US cross-region) ✅
- [x] DP-36 CloudWatch Alarms + Budget Alerts ✅

### Sprint 8 — Iteration 3 Analysis + Polish (2026-06-30)
- [x] DP-37 Avoma Transcript Fetch Lambda ✅
- [x] DP-38 AgentCore Transcript Analysis Lambda ✅
- [x] DP-39 Evidence Link Metadata Extraction ✅
- [x] DP-40 E2E Integration Test Suite (10 tests, all passing) ✅

**All 40 stories complete. 0 Critical/High findings across all code reviews.**

## Deployment (2026-06-30)
- [x] CDK DeliverProStack deployed to ceanalytics (2026-06-30)
- [x] V003 migration applied to RDS (2026-06-30)
- [x] Frontend built and deployed to S3 + CloudFront (2026-06-30)
- [x] App live at: https://d2s8z1ws7s6cmc.cloudfront.net
- [x] MCP server deployed and running on EC2 44.219.249.6:443 (2026-07-01)
- [x] Governance e2e test PASSED — micro + macro events written to RDS (2026-07-01)
- [x] SSM params set: mcp-api-key, mcp-cert-fingerprint, db-endpoint, region (2026-07-01)

## Phase 1 Governance Layer — FULLY OPERATIONAL

| Component | Status |
|-----------|--------|
| MCP Server (EC2 44.219.249.6:443) | ✅ Running |
| RDS PostgreSQL (governance_events) | ✅ Connected |
| record_progress tool | ✅ Tested — micro + macro events written |
| notify_slack tool | ✅ Deployed |
| GitHub Actions trigger | ✅ Configured |
| DeliverPro frontend | ✅ Live at d2s8z1ws7s6cmc.cloudfront.net |
| DeliverPro API (40 Lambda routes) | ✅ 200 responses confirmed |

### Sprint Plan Summary

| Sprint | Stories | Pts | Focus |
|--------|---------|-----|-------|
| Sprint 1 | DP-01 to DP-04 | 20 | CDK infra, V003 migration, shared middleware, Cognito |
| Sprint 2 | DP-05 to DP-09 | 20 | Projects backend (CRUD, Jira import, seeding, checklist) |
| Sprint 3 | DP-10 to DP-15 | 20 | Gates + Files backend |
| Sprint 4 | DP-16 to DP-21 | 20 | Frontend Iteration 1 (auth, project list, gate view, evidence UI) |
| Sprint 5 | DP-22 to DP-27 | 20 | Iteration 2 backend (meetings, closure, checkpoints) |
| Sprint 6 | DP-28 to DP-33 | 20 | Iteration 2 frontend + Reporting |
| Sprint 7 | DP-34 to DP-38 | 20 | Iteration 3 infra + Config (AgentCore, prompts, project types) |
| Sprint 8 | DP-39 to DP-41 + runbooks | 20 | Iteration 3 analysis + polish + CloudWatch alarms |
- [x] V002 migration finalized: 6 tables (projects, micro_artifacts, macro_checkpoints, gate_evidence, casdm_config, checkpoint_notes) (2026-06-25)
- [ ] CDK stack deployed to ceanalytics profile
- [ ] V001 + V002 migrations run on ceanalytics RDS instance
- [ ] Phase 2 SRS drafted

## Governance Test — 2026-07-01

- [x] Design docs approved by Tariq Khan — Phase 2 DeliverPro architecture (2026-07-01)

## Change Request — GitHub/Slack Project Linkage Audit (2026-07-02)

- [x] Audit completed — 4 items validated (unique key, MCP-log visibility, GitHub linkage, Slack webhook linkage)
- [x] Impact analysis produced + reviewed (aws-architect + plan-reviewer + aws-security-reviewer + technical-pm): `docs/phase2/change-requests/2026-07-02-github-slack-linkage-impact.md`
      - Findings: 0 Critical, 3 High (all resolved in design), 6 Medium (resolved/folded), Low/Info applied
      - Core defect confirmed: `governance_events.project_id` (= GitHub repo name) never matches `projects.jira_key` → MCP logs invisible per project; no `github_repo`/Slack link on `projects`
      - Recommendation: Option A (1:1) — add `github_repo`, `github_url`, `slack_webhook_ssm_path`, `slack_channel_id` + audit cols; repoint governance join to `projects.github_repo` (collision-safe transition); Phase 1 untouched
      - Proposed FRs (NOT yet applied to SRS): FR-P2-033 (key uniqueness/immutability), FR-P2-034 (GitHub link), FR-P2-035 (Slack link), FR-P2-036 (GitHub-event reconciliation), FR-P2-037 (MCP logs visible per project); + change to FR-P2-019
      - Phasing (technical-pm): core fix ~19 pts (CR-01/02/03/06), ~1 sprint, ~$0/mo incremental
- [ ] **AWAITING HUMAN DECISION** — see §9 of impact doc (D1 approve direction; D2 cardinality; D3 nullable-at-creation; D4 onboarding capture; D5 authoritative repo↔project mapping for backfill)
- [ ] SRS FR additions (product-analyst) — blocked on human approval
- [ ] V004 data-model delta (aws-architect) — blocked on human approval
- [ ] Backlog stories CR-01..CR-07 (technical-pm) — blocked on human approval

### CR v2 — Customer decisions folded in (2026-07-02)

- [x] Customer decisions confirmed: optional linkage as feature switch; macro = app-owned, micro = Kiro signal; no-orphan storage rule; app-managed Slack destination; per-project notify_slack routing
- [x] Impact analysis revised to v2.1 — reviewed round 2 (aws-architect + plan-reviewer + aws-security-reviewer + technical-pm): 0 Critical, 2 High (both resolved in design), 6 Medium (folded)
      - Slack = workspace bot token + `chat.postMessage`; `slack_channel_id` in PG, token in SSM SecureString/Secrets Manager (never plaintext in PG)
      - No-orphan = HARD REJECT of unmatched governance events + rejection metric
      - `notify_slack` (Phase 1) changes to resolve destination per-project from PG
      - MCP DB role hardened: REVOKE ALL then re-grant INSERT/SELECT only (append-only at DB layer) — needs D14
      - FR TODO: FR-P2-033..041; V004 delta (linkage cols + partial unique index + project_link_audit + audit trigger + timeline rewrite); backlog P0 + CR-01..CR-11 (~43 pts core, ~$0/mo)
- [ ] **AWAITING HUMAN DECISION (v2)** — D13 (GitHub OIDC per-repo identity vs POC risk-accept); D14 (approve kiro_mcp REVOKE/re-grant); D15 (backfill→gates cutover ordering); D16 (macro checkpoints display-only from governance_events); D17 (secret store + KMS key choice); OQ-CR-06 (authoritative repo↔project mapping — data-blocked)
- [ ] SRS FR additions (product-analyst) — blocked on human approval
- [ ] V004 data-model delta (aws-architect) — blocked on human approval
- [ ] Backlog CR-01..CR-11 (technical-pm) — blocked on human approval

### CR v3 — Final Design of Record (2026-07-02)

- [x] All customer decisions consolidated; dual-channel notification requirement added (CI=micro, app=macro, both coexist, same MCP)
- [x] Impact analysis finalized to v3.1 — round-3 review (aws-architect + plan-reviewer + aws-security-reviewer + technical-pm): 5 High all resolved/gated, Med/Low resolved or parked
      - Final design: optional per-project linkage feature switch; workspace Slack bot token in SSM + non-secret micro/macro channel ids in PG; dual channels routed via same notify_slack by event_type; CI=MICRO / app=MACRO; hard no-orphan resolve-or-reject in record_progress; macro app-owned; micro Level 1 (timeline) + Level 2 (artifact auto-complete, event_code key, OIDC-gated); append-only via table-ownership reassignment; dead DynamoDB code removed
      - Key review catches: SEC-H1 (REVOKE cosmetic because kiro_mcp owns tables → reassign ownership to kiro_migrator); PLAN-H1 (classifyEvent would mis-store CI micro as macro → explicit type authoritative); PLAN-H2 (backward-compat CLI-macro path); SEC-H2/H3 (shared API key mis-attribution + Level-2 spoof → GitHub OIDC promoted to HARD prerequisite for Level 2)
      - FR TODO: FR-P2-033..042; V004 delta; MCP change spec; CI + app notification paths; backlog P0+CR-01..CR-14 (Core Level-1 ≈56 pts/~3 wks; Level-2 +13 pts gated; ~$0/mo)
- [ ] **AWAITING HUMAN GO-AHEAD (v3)** — decisions D-v3-1..11 (HIGH: D-v3-8 OIDC as Level-2 prereq vs risk-accept; D-v3-10 CLI-macro backward-compat path); open questions OQ-CR-13..19 (OQ-CR-13 event-code vocab blocks Level 2; OQ-CR-14 repo↔project backfill mapping blocks cutover)
- [ ] On go-ahead: FR additions → product-analyst; V004 delta → aws-architect; backlog → technical-pm; implementation → dev agents (each through its review gate)

### CR v3 — GO-AHEAD received (2026-07-02); Level 2 dropped by customer

- [x] Scope locked: Level 1 (timeline surfacing) + infra; Level 2 (micro→artifact auto-completion, event_code, OIDC) DEFERRED/iceboxed (customer 2026-07-02)
- [x] Spec-ready foundation complete (8-stage pipeline, all gates passed):
      - [x] SRS updated to v1.5 — FR-P2-033..042 added (042 = deferred), architect-approved
      - [x] V004 migration spec + architecture docs updated (unified-data-model, projects, gates, reporting, config + Phase 1 cross-refs) — plan-reviewer + security-reviewer approved, architect final
      - [x] Backlog created + approved: CR-P0, CR-01, CR-01A, CR-02..CR-15 (Level-1 core ≈59 pts, 3 sprints); CR-ICEBOX (CR-12/CR-14/CR-OIDC) deferred → FR-P2-042
      - Standing gates: (1) CR-06 backfill must validate before CR-08/09/03 production cutover (OQ-CR-14 mapping still needed — orchestrator to escalate early); (2) CR-01A/CR-05/CR-08/CR-09 require mandatory security-reviewer pass at code stage
- [ ] Implementation in progress — dispatching stories in dependency order (CR-01 → CR-01A → CR-02/MCP → …)

#### CR v3 Implementation

- [x] CR-01 V004 additive schema migration (linkage columns, partial unique index, project_link_audit + per-field trigger, inert micro_artifact_mapping) — spec + code reviewed, APPROVED (2026-07-02); ownership SQL relocated to V005 for CR-01A; not yet deployed
      - follow-up: unified-data-model §4.4/§4.4.6 doc-staleness fix (architect); verify.sql to run in CI pre-deploy
- [x] CR-01A V005 append-only hardening (kiro_migrator owns tables; kiro_mcp INSERT/SELECT + 6-col SELECT on projects; preflight audit + verify) — spec + security + code reviewed, APPROVED (2026-07-02); 35/35 tests; not deployed
      - 6-col kiro_mcp projects grant (id,title added) ACCEPTED — read-only, needed for notify_slack project labels
      - DEPLOY GATES (later): GATE 1 pre-apply ownership audit; GATE 2 repoint MCP off RDS master (D-v3-3/D-v3-11)
- [x] unified-data-model doc-staleness fix (V004 additive / V005 append-only split) — done
- [x] CR-02 Projects API linkage retrofit (linkage fields on GET/POST/PATCH, admin/leadership-only 403 mutation, github_url validation, 409 uniqueness, per-field audit) — spec + security + code reviewed, APPROVED round 2 (2026-07-02); 43/43 tests; not deployed
      - follow-up (tracked): pre-existing tsc errors in close-project.ts / reopen-project.ts / import-jira.ts (out of CR-02 scope); dead imports in create-project.ts to clean later
- [ ] Next: CR-P0 (doc drift), CR-05 (Slack provisioning), CR-08 (record_progress no-orphan), CR-09 (notify_slack dual-channel), CR-06 (backfill — BLOCKED on OQ-CR-14), CR-15 (frontend linkage UI), CR-10/CR-03/CR-13
- [x] CR-11 dead DynamoDB code + table-name SSM leftover removal — implement + code reviewed, APPROVED (2026-07-02); 8/8 tests; not deployed
- [x] CR-P0 persistence doc-drift correction (mcp-server-core DynamoDB→RDS) + pk/sk residual removed — architect + plan reviewed, APPROVED (2026-07-03)
      - note: v3 Slack-webhook→bot-token doc drift in mcp-server-core §6.1-6.3/§7.3/§9.1 tracked separately (updated by CR-09)
- [x] CR-05 Slack bot-token provisioning + bot-token Slack client (chat.postMessage, SSM SecureString token, least-privilege IAM) — implement + security + code reviewed, APPROVED (2026-07-03); 12/12 tests; not deployed
- [x] CR-08 record_progress no-orphan resolve + resolveProject + classifyEvent explicit-type fix (PLAN-H1) — implement + security + code reviewed, APPROVED (2026-07-03); resolveProject/no-orphan 13/13 tests + classifyEvent 15 tests; not deployed
      - follow-up (LOW): bound project_id charset/length; CI matchGate should reuse shared matchGateFromText (alias ordering)
- [x] CR-05 (PARTIAL) — bot-token Slack client getBotToken + postMessageToChannel + SSM SecureString path + least-privilege IAM; 12/12 tests. REMAINING: two-token split provisioning credential, conversations.list/create channel provisioning, provisioning UI
- [x] CR-09 notify_slack dual-channel rewrite (micro→micro channel, macro→macro channel; bot-token; project-labelled; graceful skips; webhook retired; doc drift closed) — APPROVED (2026-07-03); 44/44 tests; not deployed
- [x] CR-10 (PARTIAL) — CI micro adaptation in governance-trigger.js (type:micro, micro-channel notify) + CLI-macro backward-compat retained; code reviewed. REMAINING: app-backend→MCP macro notify path on in-app approval; CLI display-only macro path (type:macro, does not set reached_at); no-double-notify verification
- [ ] REMAINING (correctly scoped): CR-04 (onboarding soft-capture), CR-05 remainder (provisioning + two-token + UI), CR-10 remainder (app macro notify + CLI display-only), CR-03 (timeline join repoint), CR-15 (frontend linkage UI), CR-13 (integration tests), CR-06 (backfill — BLOCKED on OQ-CR-14)
- [x] CR-03 timeline join repoint (v_timeline + gates/reporting → github_repo, collision-safe interim branch; macro display-only, no auto-completion; unlinked shows native-only) — implement + code reviewed, APPROVED (2026-07-03); 18/18 tests; V006 migration; not deployed
- [x] CR-10 (COMPLETE) — CI micro adaptation + classifyEvent fix (done earlier) + app→MCP macro notify on approval (best-effort/non-blocking, skip when github_repo NULL) + CLI display-only macro path (no reached_at) — implement + security + code reviewed, APPROVED (2026-07-03); 25/25 tests; not deployed
      - follow-up (MEDIUM): packages/gates has no tsconfig.json → not type-checked (pre-existing, all 8 handlers); add tsconfig + repo type-check script
      - follow-up (LOW): mcp-client transport unit test; project-scoped RBAC on complete-checkpoint; code-enforce no-double-notify guard (CR-13); authenticated actor for human_review Slack label
- [x] CR-04 onboarding soft-capture of Slack channel ids (optional at 'Set up Slack/Teams channel' completion; not blocking; audited linkage path; secret-rejecting) — implement + code reviewed, APPROVED (2026-07-03); 56/56 tests; not deployed
      - follow-up (LOW): architect reconcile projects-architecture §2.7 contract with CR-04 fields
- [x] CR-05 (COMPLETE) — two-token split (separate provisioning credential channels:read+manage, distinct SSM from runtime chat:write token) + admin/leadership-only resolve-or-create channel provisioning endpoint (idempotent; ids persisted via audited linkage path) — implement + security + code reviewed, APPROVED (2026-07-03); 40/40 tests; not deployed
      - follow-up: architect decide channel visibility (public default) + anti-squatting (finding #4); construct-developer pre-deploy IAM least-privilege gate; MEDIUM tech-debt — pre-existing tsc errors in projects close-project.ts/reopen-project.ts/import-jira.ts block package CI-green
- [x] CR-15 frontend linkage UI + Slack provisioning trigger (github/Slack fields admin/leadership-only, client validation mirroring server, safe github_url link, provision action, re-point warning, no secret rendered) — implement + code reviewed, APPROVED (2026-07-03); not deployed
      - note: repo has no CASL — role gating via canManageLinkage helper (backend re-enforces); follow-up (LOW): client-side URL re-validation in card, component tests
- [x] CR-13 Level-1 integration tests (feature switch, no-orphan, dual-channel routing, no-double-notify coexistence, macro app-owned) — implement + code reviewed, APPROVED (2026-07-03); 23 integration tests; full suite 202/202 green
- [ ] CR-06 backfill — BLOCKED on OQ-CR-14 (authoritative repo↔project mapping)

### CR v3 — Scope change (2026-07-03): fresh start + link-time gate detection

- Customer decision: remove old imported projects (fresh start); create new projects going forward
- **OQ-CR-14 MOOT / CR-06 backfill CANCELLED** — no backfill needed
- **NEW CR-16** — on git-link, auto-detect resolved gates by reading the repo's docs/project-progress.md and setting matching macro_checkpoints.reached_at (deliberate shift: tracker may auto-resolve gates on link)
- [x] CR-17 fresh-start cleanup — V007 migration removes old non-template imported projects (destructive, gated, NOT auto-run, rollback noted) — reviewed, APPROVED (2026-07-03); not run
- [x] CR-16 link-time gate detection — GitHub read token (SSM SecureString, contents:read), fetch+parse docs/project-progress.md, POST /api/projects/{id}/sync-gates (admin/leadership-only, own-repo-only), idempotent macro_checkpoints.reached_at set with reviewed_by='system:repo-sync' + audit — implement + security + code reviewed, APPROVED (2026-07-03); not deployed
      - follow-up (LOW): anchor gate parse to '[x] N.N <Gate>' form (alias 'documentation approved'→'Runbooks approved' bleed); wire migrations tests into jest; wrap resolve+audit in one transaction
- [x] Finalization — tech-debt cleanup + consolidated deploy runbook — **COMPLETE (2026-07-03)**
      - Tech-debt cleared (repo CI-green: projects+gates tsc clean, 304/304 tests): projects tsc errors (close/reopen/import-jira), gates tsconfig, migrations V004–V007 tests wired into jest, gate-parse anchored to `[x] N.N <Gate>` + shared `matchGateFromText` reuse (canonical-first bleed fix across shared + CI script + `.kiro` template), dead imports removed (list-projects, seed.service)
      - Consolidated deploy/cutover runbook: `docs/phase2/runbooks/cr-github-slack-linkage-deploy.md` (GATE1→migrations V004→V007→GATE2→secrets→IAM→timeline cutover→post-deploy verification, with human sign-off points)
      - Doc drifts reconciled: projects-architecture §2.7 (CR-04 fields) + §12.4 (channel-visibility ADR: public default + anti-squatting), mcp-server-core §3.2 (two-reason-code model), unified-data-model V004→V006 refs (v_timeline repoint = V006; CR-06 cancelled → V007 fresh-start)

All buildable Level-1 stories implemented, reviewed, and approved (code + tests only — NOT deployed):
CR-P0, CR-01, CR-01A, CR-02, CR-03, CR-04, CR-05, CR-08, CR-09, CR-10, CR-11, CR-15, CR-13.

**Blocked (needs human input):**
- None — CR-06 backfill CANCELLED (fresh start; replaced by CR-17 cleanup + CR-16 link-time gate detection). OQ-CR-14 moot.

**Deferred (customer decision):** ~~Level 2~~ — **UN-DEFERRED 2026-07-07: build now WITHOUT GitHub OIDC** (customer accepts trust model). CR-OIDC dropped. Level 2 = event_code vocabulary (CR-14) + micro→artifact auto-completion (CR-12) + UI integration. V007 fresh-start cleanup = APPROVED (customer said yes). DB access path check delegated to aws-architect (read-only CLI, profile ceanalytics).
- [ ] DB access path discovery (aws-architect, read-only CLI ceanalytics) — in progress
- [x] Level 2 build (event_code + auto-completion + UI, no OIDC) — COMPLETE & verified (2026-07-07): event_code vocabulary (micro-artifact-events.ts), V008 migration (event_code column + micro_artifact_mapping seed + kiro_phase2 SELECT/UPDATE grants, kiro_mcp_app stays append-only), app-side reconcile service + sync-artifacts handler (idempotent/audited/reversible/own-repo-scoped), record_progress event_code, UI kiro-vs-manual badge + override; SRS FR-P2-042 activated (v1.7); H1/M1/M2 fixed; 380 backend + 62 frontend tests pass; not deployed
      - follow-up (non-blocking, pre-existing): packages/reporting missing tsconfig.json breaks root `npm run build`; stray build artifacts in packages/gates/services; projects→gates tsconfig ordering nit

**Deploy / cutover gates (NOT done — require human sign-off + ops):**
1. Apply migrations V004 (additive) → V005 (append-only, GATE 1 ownership audit first) → V006 (timeline repoint)
2. GATE 2: repoint MCP runtime → **kiro_mcp_app** (distinct NOSUPERUSER runtime role; master `kiro_mcp` = admin/migrations only); repoint Phase-2 Lambda DB_USER → kiro_phase2 (D-v3-3/D-v3-11). Append-only truly enforced only after this + live pg_stat_activity usename=kiro_mcp_app check.
3. Create Slack app; store bot token (chat:write) + provisioning credential (channels:read/manage) in SSM SecureString; construct-developer applies least-privilege IAM
4. Timeline-join cutover (drop interim jira_key branch) — via review-gated V008 (fresh start: may be dropped immediately, no backfill dependency)

**Tracked follow-ups (tech-debt / doc reconciliation):**
- [x] Pre-existing tsc errors in projects close-project.ts/reopen-project.ts/import-jira.ts — FIXED (2026-07-03)
- [x] packages/gates tsconfig.json — present; gates type-checks clean (2026-07-03)
- [x] Architect: channel visibility (public default) + anti-squatting (projects-arch §12.4 ADR); reconciled projects-arch §2.7 (CR-04), mcp-server-core §3.2 two-reason-code, V004→V006 doc refs (2026-07-03)
- [x] CI matchGate reuses shared matchGateFromText (canonical-first, alias-bleed fixed); gate-parse anchored to `[x] N.N <Gate>`; migrations V004–V007 tests wired into jest (2026-07-03)
- LOW (remaining, non-blocking): bound project_id charset in record_progress; mcp-client transport test; client-side URL re-validation in linkage card; Level-2 real-Postgres CTE smoke test

### Deploy-readiness hardening (2026-07-03)

- [x] Least-privilege IAM (CDK) — three single-ARN SSM SecureString grants (bot-token→mcpServerRole; github/read-token→projectsLinkageRole; provisioning-token→provisioningRole), role↔secret isolation, kms:ViaService=ssm; MCP/Lambda repoint wiring — construct + security + code reviewed, APPROVED (2026-07-03); 14/14 tests; not deployed
- [x] **Append-only enforcement blocker FIXED** — RDS master username `kiro_mcp` collided with the V005 locked-down role (superuser bypass). Introduced distinct NOSUPERUSER runtime role **kiro_mcp_app**; moved INSERT/SELECT-only + column grants onto it; MCP DB_USER + IAM rds-db:connect repointed to kiro_mcp_app; V005 verify/preflight assert non-superuser; data-model §4.4.4 + runbook GATE 2 updated — backend + construct + security + code reviewed, APPROVED (2026-07-03); not deployed
- [x] CDK Nag wired (AwsSolutionsChecks Aspect in infra/bin/app.ts) with documented suppressions
      - follow-up (LOW): reconcile postgres.service.ts ProjectRow JSDoc (4→6 col grant); convert stack-wide Nag suppressions to per-resource before prod; re-run cdk synth in deploy account (VPC lookup) to confirm 0 Nag findings

## Deploy directives (2026-07-07)
- Customer: fix root-build caveat; deploy everything; API keys added to Secrets Manager later (by customer); RDS public-exposure security fix DEFERRED (customer: "for later")
- 🔴 CRITICAL (deferred per customer): governance RDS PubliclyAccessible=true + SG 0.0.0.0/0 on 5432 + StorageEncrypted=false — lock down later
- DB access confirmed: profile ceanalytics (acct 713554442614), RDS PG16, MasterUsername=kiro_mcp, IAM auth on; migrate via SSM send-command on MCP EC2 i-0f01f38b05385521c (in-VPC) or SSM port-forward
- [x] Caveat fix — config/files/meetings/analysis type errors fixed (type-only: withRoles/query/userId/log-levels/itemIdentifier), stray .js/.d.ts artifacts removed + gitignored → root `npm run build -ws` GREEN (10/10 workspaces), 380 tests pass (2026-07-07)
- [ ] Deploy (staged, live governance DB via SSM on MCP EC2; API keys added later by customer):
      - [x] GATE 1 preflight ownership audit (read-only) — PASS (2026-07-07); connectivity = SSM port-forward via MCP EC2 + RDS IAM token
      - [x] V004 additive (canary) — APPLIED SUCCESS (2026-07-07); V004 verify false-positive on ownership-implied grant (clears after V005), migration correct/not modified
      - [x] V005 append-only — FIXED (SET ROLE kiro_migrator wrap) + APPLIED SUCCESS + V005 verify PASS (2026-07-07); ownership→kiro_migrator, kiro_mcp_app append-only. (V004 verify = benign false-negative on live master; verify scripts are ephemeral-CI-only per runbook)
      - follow-up (LOW): add RDS-safe verify variant (pg_catalog FK check, skip superuser-bypass assertion); fix stale RDS endpoint in deploy-outputs.md
      - [x] V006 timeline repoint + V008 level-2 — APPLIED SUCCESS + verify PASS (2026-07-07); v_timeline→github_repo (collision-safe branch), Level-2 event_code+mapping(16 rows)+grants live, kiro_mcp_app append-only intact
      - follow-up (LOW): reconcile V008 header/runbook "do not deploy/deferred" text with the 2026-07-07 go-live
      - [x] cdk deploy FULL working tree — SUCCESS (2026-07-07): KiroGovernanceStack + DeliverProStack UPDATE_COMPLETE; ~33 Lambdas repointed DB_USER→kiro_phase2; new routes (timeline, sync-gates, sync-artifacts, slack/provision) live; RDS SG/public untouched. Smoke: GET /api/projects 200 (kiro_phase2 IAM auth), timeline 200. API https://ug1vg2f8ac.execute-api.us-east-1.amazonaws.com/prod/
      - follow-up: COMMIT the uncommitted fix (2 IAM role descriptions em-dash→hyphen in stateless-stack.ts) so main matches deployed; provision 3 SSM tokens (customer)
      - [x] GATE 2 — MCP runtime repointed to kiro_mcp_app + restarted; /health 200; pg_stat_activity confirms MCP session=kiro_mcp_app; append-only ENFORCED (INSERT ok, UPDATE/DELETE denied, proven). Also fixed latent issue: old kiro_mcp lacked rds_iam (2026-07-07)
      - 🔺 GAP FOUND: EC2 MCP runs a STALE dist — CR-08 no-orphan reject + CR-09 dual-channel notify + event_code NOT live on the MCP yet (accepted an orphan test row). Needs MCP code rebuild/redeploy to EC2.
      - [x] MCP server code rebuild + redeploy to EC2 — SUCCESS (2026-07-07): CR-08 no-orphan LIVE (verified: unlinked repo → written:false, no row), CR-09 dual-channel + CR-11 (no DynamoDB) + event_code present in running dist; DB_USER=kiro_mcp_app held; /health 200
      - [x] V007 = NO-OP / N/A (2026-07-07): read-only preflight shows ZERO CST-* projects (environment already fresh-start); 0 rows to delete, 0 cascaded children; governance_events untouched. No destructive action needed. Preserved: DP-002, DP-003 (RAINN), kiro-governance, __template__.

### DEPLOY STATUS (2026-07-07): LIVE except V007
- Migrations V004 (additive), V005 (append-only), V006 (timeline repoint), V008 (Level 2) — APPLIED + verified on live RDS
- IAM least-privilege + full working tree — cdk deployed (KiroGovernanceStack + DeliverProStack UPDATE_COMPLETE); ~33 Lambdas on kiro_phase2; new routes live; smoke 200
- GATE 2 — MCP repointed to kiro_mcp_app; append-only ENFORCED (proven); MCP code redeployed → CR-08/CR-09/CR-11/event_code LIVE
- RDS SG/public-exposure fix — DEFERRED per customer (🔴 still open)
- PENDING customer: (1) final V007 go + it runs with snapshot-first; (2) add 3 SSM SecureString tokens (bot/provisioning/github) to activate Slack+GitHub features; (3) commit the uncommitted IAM role-description fix (em-dash→hyphen in stateless-stack.ts)
