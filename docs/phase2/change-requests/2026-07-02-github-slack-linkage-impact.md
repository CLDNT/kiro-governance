# Change Request Impact Analysis — Project ↔ GitHub Repo ↔ Slack Webhook Linkage & Identifier Reconciliation

**Date:** 2026-07-02
**Type:** Audit + Planning (no implementation)
**Author:** AWS Architect
**Status:** **v3.1 — Final Design of Record (2026-07-02), round-3 reviews consolidated.** Proposed, awaiting human go-ahead. Planning/audit only — **no SRS, data model, migration, or code changes are applied by this document.** All round-3 High findings (security H1/H2/H3, plan H1/H2) are resolved in the design or surfaced as explicit blocking human decisions; Mediums/Lows resolved or parked. See "v3.1 — Round-3 Review Findings Disposition" immediately below the confirmed-decisions table.
**Scope:** Phase 2 "DeliverPro" project-delivery tracker (top-level presentation/management layer over the shared RDS — it maps governance data to the correct project or does not store it) + Phase 1 MCP governance server integration boundary — including **Phase 1 `record_progress` (no-orphan resolve-or-reject), `notify_slack` (dual-channel bot-token rewrite), `slack.service` rewrite, MCP DB-role hardening, and dead-code removal.**

### Revision History

| Version | Date | Author | Change |
|---------|------|--------|--------|
| v1 | 2026-07-02 | AWS Architect | Initial audit of the four linkage/identifier items; review-consolidated round 1 (all §0 findings resolved/parked). Preserved below from §0 onward. |
| **v2** | **2026-07-02** | **AWS Architect** | **Revised per confirmed customer decisions (2026-07-02): (1) optional linkage as feature switch; (2) MACRO app-owned / MICRO external Kiro signal; (3) hard no-orphan rule enforced in the MCP `record_progress` write path via RDS resolve-or-reject; (4) app-managed Slack (single workspace bot token + per-project `slack_channel_id` in PG); (5) `notify_slack` resolves the destination per project from PG. See the "v2 Customer Decisions & Design Delta" section immediately below — it SUPERSEDES the noted v1 sections (TODO FR list §4, data-model delta §5, affected docs §6.1, open questions §8). All v1 content is retained below for audit.** |
| **v2.1** | **2026-07-02** | **AWS Architect** | **Round-2 review consolidation of the v2 design (security S-11..S-18, plan-review F1..F12, capacity v2). Two High findings (S-11 DB privilege / audit integrity, S-12 cross-project isolation) resolved in design; six Medium and remaining Low/Info resolved or parked. See the "V2-R2 — Round-2 Review Consolidation" section immediately below — it is AUTHORITATIVE and SUPERSEDES the specific v2 artifacts it cites (V2-4.1 metric, V2-4.3/V2-7 GRANT block, V2-5 Slack scopes, FR-P2-038/041 ACs, V2-9 backlog/phasing, V2-10 open questions). Verified against source: V001 line 30 grants `GRANT ALL PRIVILEGES` to `kiro_mcp`; `record_progress.ts` already writes via `postgres.service` (DynamoDB→RDS migration already in code — F7/P0/S-9 = doc-drift only).** |
| **v3** | **2026-07-02** | **AWS Architect** | **DEFINITIVE Final Design of Record. Consolidates the confirmed customer decisions of 2026-07-02 (linkage optional feature switch; workspace Slack bot token + `chat.postMessage`; DUAL per-project channels — micro + macro — routed through the SAME MCP `notify_slack` by `event_type`; CI/Kiro path = MICRO, DeliverPro app = MACRO, both coexist with no double-notification; hard no-orphan in `record_progress`; macro app-owned/human-approved, micro external Kiro signal; micro in-app integration at two levels — timeline surfacing + `micro_artifacts` auto-completion via a deterministic mapping; MCP DB role hardened to append-only + `SELECT` on `projects`; remove dead DynamoDB code). The new "v3 — Final Design of Record" section at the TOP is self-contained and implementable without reading v1/v2. Re-verified every claim against source: MCP server code (`record-progress.ts`, `notify-slack.ts`, `slack.service.ts`, `postgres.service.ts`, `dynamodb.service.ts`, `index.ts`), `scripts/governance-trigger.js`, migrations V001/V002×2/V003/V003a, and current `gates-architecture.md`. Material correction vs v1/v2: the CURRENT `gates-architecture.md` has NO §5 governance→`macro_checkpoints` auto-completion write path — completion is already app-owned via the §4 state machine — so Decision H is largely already satisfied; there is no auto-completion to remove, only the display-only `v_timeline` join to repoint.** |
| **v3.1** | **2026-07-02** | **AWS Architect** | **Round-3 review consolidation (security S-v3-H1..L4, plan-review H1..L4/I1, capacity v3). Resolves the 3 security High + 2 plan High findings in the design and surfaces the residual trust/backward-compat risks as explicit blocking human decisions. Material corrections to v3, all verified against source: (sec-H1) `REVOKE ALL` on `kiro_mcp` is INEFFECTIVE because `kiro_mcp` OWNS the tables (V001 grants only DATABASE-level `ALL`, not table DML; `kiro_mcp` can INSERT today only as table owner). Real append-only requires reassigning table OWNERSHIP to a separate migrator/admin role, then granting `kiro_mcp` only `INSERT,SELECT` + `ALTER DEFAULT PRIVILEGES` — the V004 §F block is rewritten accordingly. (sec-L4) `CREATE USER IF NOT EXISTS kiro_mcp` in V001 is invalid PostgreSQL — replace with a `DO`-block guard; clarifies the migrator role. (plan-H1) `classifyEvent()` ignores an explicit `type` unless `flag_override` is ALSO true — the CI `type:'micro'` call is therefore stored as `macro`; fixed by making explicit `type` authoritative in `classifyEvent` AND having CI pass `flag_override:true` + a non-gate `update_text` (belt-and-suspenders); FR-P2-040/041 gain a `type='micro'` persistence AC. (plan-H2) CLI-only (pure-Kiro-CLI) repos have no in-app macro approver and lose the webhook path — added an explicit CLI-macro path + a webhook→bot-token transition fallback, and a blocking Decision (D-v3-10). (sec-H2/H3) cross-project mis-attribution and Level-2 spoofing share one root cause (untrusted caller-asserted identity) — GitHub OIDC (CR-OIDC) is promoted from optional fast-follow to a hard PREREQUISITE of Level-2 (CR-12). (plan-M1) `event_code` exists in no table/schema/type — Level-2 determinism needs a Phase-1 addition (new story CR-14); CR-12 stays blocked on OQ-CR-13. (plan-M3) V004 audit trigger rewritten to emit PER-FIELD rows to match FR-P2-034/035 ACs. (plan-M2) F10 migration-ordering action item restored. (plan-L2) `micro_artifact_mapping` grant removed under app-side Level-2. (plan-L3) app skips `notify_slack` when `github_repo IS NULL` (avoids `z.string().min(1)` failure). (sec-M3) `github_url` validation AC added. (plan-L1) SUPERSEDED pointers added to retained V2-R2 headers. See "v3.1 — Round-3 Review Findings Disposition" for the full table.** |

> **How to read this document:** The **"v3 — Final Design of Record"** section (immediately below) is the **current, authoritative design of record** and is self-contained — a reader can implement from it without reading v1/v2 archaeology. It SUPERSEDES everything below it wherever they conflict. Below it, the **"V2-R2 — Round-2 Review Consolidation"** and **"v2 Customer Decisions & Design Delta"** sections and the original v1 body are retained **for audit/history only**. This remains a proposal — it does not modify `docs/phase2/srs.md`, `docs/phase2/architecture/unified-data-model.md`, `docs/phase1/*`, or any migration/code. Those changes happen only after explicit human go-ahead.

---

# v3 — Final Design of Record (2026-07-02) — AUTHORITATIVE & SELF-CONTAINED

> This section is the definitive design. It consolidates every confirmed customer decision of 2026-07-02 into one implementable specification. It is **planning/audit only** — it PROPOSES changes; it does not modify the SRS, migrations, or code. Everything below this section is retained for history and is superseded by this section wherever they conflict.

## v3-0. Confirmed Customer Decisions (2026-07-02)

| # | Decision (CONFIRMED) |
|---|----------------------|
| A | **Linkage is OPTIONAL per project = the feature switch.** `github_repo` + Slack channels are optional. `github_repo` attached → micro integration ON; not attached → current app-only behaviour unchanged. `github_repo` is nullable, **1:1 per project**. |
| B | **Project unique key.** `projects.jira_key` is already `UNIQUE`; add an explicit FR for uniqueness **+ immutability** (FR-P2-033). |
| C | **Data model (V004, spec only).** Add to `projects`: `github_repo`, `github_url`, `slack_micro_channel_id`, `slack_macro_channel_id` (all nullable) + `updated_by`/`updated_at`; add `project_link_audit` table + `BEFORE UPDATE` audit trigger; partial `UNIQUE` index on `github_repo`. The single `slack_channel_id` proposed in v2 is **REPLACED** by the two channel columns. The Slack **bot token is a SECRET** — SSM SecureString / Secrets Manager only (single workspace token), **never a PG column**. PG holds only non-secret channel ids. |
| D | **Slack mechanism.** One workspace-level Slack app + **bot token** + `chat.postMessage` (NOT incoming webhooks). Webhook-OAuth is the documented rejected alternative. |
| E | **Notification routing — SAME MCP, DIFFERENT CHANNELS.** Rewrite `notify_slack` to: (1) STOP skipping micro events; (2) route by `event_type` — micro → `slack_micro_channel_id`, macro → `slack_macro_channel_id`; (3) resolve project by `github_repo`, read channel from PG, post via the bot token; (4) if the relevant channel is unconfigured, **skip gracefully** (no error surfaced, no secret/path leak); (5) message is **PROJECT-labelled** (`jira_key`/title), not repo-labelled. |
| F | **Event sources coexist.** CI script path (GitHub/Kiro) triggers **MICRO** events + micro-channel notification; the DeliverPro **APP** triggers **MACRO** events + macro-channel notification when a human approves a macro gate in-app. **No double-notification** — micro owned by CI/Kiro, macro owned by app. Both call the SAME centralized MCP `notify_slack` (the app does not build its own Slack client). |
| G | **No-orphan hard reject.** In `record_progress`, resolve `projects.github_repo = incoming repo`; if no project matches → **HARD REJECT** (do not write) + emit a **dimensionless** rejection metric. MCP gains RDS `SELECT` on `projects` (new `resolveProject` query in `postgres.service.ts`). |
| H | **Macro = app-owned.** `macro_checkpoints` completion is set **only** by in-app triggers; Kiro macro governance events are **display-only** (do NOT auto-set `reached_at`). |
| I | **Micro in-app integration (when github connected) — TWO LEVELS, both in scope:** Level 1 (surface) micro events resolve to the project and appear on the project timeline (source `kiro_mcp`); Level 2 (drive checklist) a micro event auto-completes the matching `micro_artifacts` row (FR-P2-042) via a **deterministic config/lookup mapping** (event-code → artifact), NOT fuzzy text matching. Mapping key mechanism is an OPEN QUESTION with a recommendation. |
| J | **Cleanup.** Remove dead `packages/mcp-server/src/services/dynamodb.service.ts` (+ its test) and the DynamoDB-named `table-name` SSM config leftover. |

## v3.1 — Round-3 Review Findings Disposition (AUTHORITATIVE)

> This subsection disposes **every** round-3 finding (security-review-v3, plan-review-v3, capacity-review-v3). The approval threshold is **zero Critical/High**. All 3 security High + 2 plan High are resolved in the design below or surfaced as explicit **blocking human decisions**; Mediums/Lows are resolved or parked with justification. Where a finding changed a v3 artifact, the affected v3 sub-section (v3-3..v3-10) has been **corrected in place** and this table is the audit trail.

**Round-3 totals:** security = 0 Critical / 3 High / 4 Medium / 4 Low; plan = 0 Critical / 2 High / 3 Medium / 4 Low + 1 Info; capacity = phasing accepted.

### High findings — RESOLVED / gated

| ID | Source | Finding (verified) | Resolution | Where fixed |
|----|--------|--------------------|------------|-------------|
| **SEC-H1** | security | Real append-only FAILS as specified. V001 grants only `ALL PRIVILEGES ON DATABASE` (database-level: CONNECT/CREATE/TEMP — **not** table DML). `kiro_mcp` can `INSERT` today **only because it OWNS the tables** (it is the connecting/migration role). A table **owner keeps all rights regardless of `REVOKE`** and can re-grant — so the v3 `REVOKE ALL` + re-grant is cosmetic; append-only is not enforced. | **RESOLVED — reassign ownership.** V004 §F rewritten: (1) create a dedicated `kiro_migrator` role that OWNS all tables; (2) `ALTER TABLE ... OWNER TO kiro_migrator` for `governance_events`, `projects`, and the new tables; (3) grant `kiro_mcp` ONLY `INSERT, SELECT ON governance_events` + column-scoped `SELECT ON projects`; (4) `ALTER DEFAULT PRIVILEGES FOR ROLE kiro_migrator` so future tables are not implicitly owned by `kiro_mcp`. **Pre-implementation MUST verify current table ownership** (`\dt`/`pg_tables.tableowner`) and the migration-runner identity. | v3-4 §F; v3-5.4; new action item in v3-8; D-v3-3 reworded; D-v3-11 added |
| **SEC-H2** | security | Cross-project isolation: shared MCP API key + caller-asserted `project_id` (CI can even set `PROJECT_ID` independent of `GITHUB_REPOSITORY`) lets any key holder post into another **linked** project's micro/macro channel and mis-attribute events. No-orphan does not close this (a valid *other-project* repo still resolves). | **GATED — OIDC promoted to prerequisite for Level-2** and offered as the structural fix for routing/attribution. Default remains risk-accept for the first-party POC with compensating controls (no-orphan + append-only bound tampering to insert-with-wrong-attribution, never edit/delete). Escalated to blocking human decision D-v3-8. | v3-8 (CR-OIDC now precedes CR-12); D-v3-8 reworded |
| **SEC-H3** | security | Level-2 integrity: `micro_artifacts` auto-completion is driven by a shared-key, caller-asserted micro event; a forged/replayed event with a mapped `event_code` can falsely mark deliverables complete (`completed_by` spoofable). Same root cause as SEC-H2. | **RESOLVED by gating.** Level-2 (CR-12) is **blocked on CR-OIDC** (trusted event identity) AND on OQ-CR-13 (mapping key). Additional controls baked into FR-P2-042: restrict auto-completing `event_code`s to an allow-list, record machine provenance (`completed_by='kiro_mcp:<event_code>'`), keep the action **reversible + audited**, idempotent. | v3-3 FR-P2-042; v3-5.5; v3-8 (CR-12 dep on CR-OIDC) |
| **PLAN-H1** | plan | `classifyEvent()` ignores an explicit `type` unless `flag_override` is ALSO true (verified: `if (input.flag_override && input.type) return input.type; else substring-match update_text`). v3-6.1 sets CI `type:'micro'` but keeps the gate name in `update_text` and does NOT pass `flag_override:true` → CI events persist as `type='macro'` (macro idempotency key), contradicting the CI=MICRO split and breaking the no-double-notify foundation + Level-2. | **RESOLVED — two-layer fix.** (a) **Change `classifyEvent` so an explicit `type` ALWAYS wins** (drop the `flag_override &&` conjunction — Phase-1 change, folded into CR-08/CR-10 as a `classifyEvent` correction). (b) **CI belt-and-suspenders:** pass `type:'micro'` + `flag_override:true` AND build a non-gate `update_text` label so no accidental substring match occurs. Added FR-P2-040/041 AC asserting CI-sourced events persist with `type='micro'`. | v3-5.1 note; v3-6.1 rewrite; FR-P2-040/041 ACs; v3-8 CR-10 scope |
| **PLAN-H2** | plan | No backward-compat for pure-Kiro-CLI repos. (a) A CLI-only linked repo has no in-app macro approver; v3 makes macro strictly app-owned + removes the CI macro path → macro gates committed via `progress-MD` for CLI-only repos are never recorded/notified (regression vs the demoed "progress-MD → gate → Slack"). (b) v3-5.3 deletes the per-repo webhook path with NO transition fallback → repos currently notified via `/kiro-governance/slack/webhooks/{repo}` silently stop at cutover. | **RESOLVED — CLI-macro path + transition window, gated by explicit sign-off.** (a) Define a **CLI-macro path**: for repos with no in-app approver, the CI script MAY emit a macro governance event (`type:'macro'`, `flag_override:true`) that is **display-only** (surfaces on timeline, still does NOT auto-complete `macro_checkpoints`) and triggers the macro-channel notification — preserving the demoed behaviour without violating app-owned completion. (b) Keep the **legacy webhook fallback** in `slack.service` during a transition window; retire only after CR-06 backfill + bot-token cutover validate. Because this changes the confirmed "CI=micro / app=macro" split for CLI-only repos, it is a **blocking human decision (D-v3-10)** — approve the CLI-macro path OR accept the CLI-only macro regression as a documented breaking change. | v3-5.3 (fallback); v3-6.1/v3-6.2 (CLI path); D-v3-10 added |

### Medium / Low / Info findings

| ID | Source | Finding | Disposition |
|----|--------|---------|-------------|
| **SEC-M1** | security | Runtime `notify_slack` token carries provisioning scopes (the R2-4/S-13 two-token split was dropped in v3). | **RESOLVED — restore two-token split.** Runtime `notify_slack` uses a `chat:write`-only bot token; provisioning (`conversations.create`/`list` → `channels:read`/`channels:manage`) uses a **separate** credential held only by the app link/onboarding path. Restated in v3-5.3 + FR-P2-039. |
| **SEC-M2** | security | Single shared API key for CI + app, no per-tool/per-caller scoping. | **PARKED to human (D-v3-8/OQ-CR-19).** Same root cause as SEC-H2; OIDC (CR-OIDC) is the structural fix. POC compensating controls documented. |
| **SEC-M3** | security | `github_url` unvalidated → stored XSS / open-redirect via the clickable link. | **RESOLVED — validation AC.** FR-P2-034 gains: `github_url` must match `^https://github\.com/[A-Za-z0-9._/-]+$`, `https`-only, host allow-listed to `github.com`; invalid → 400. UI renders with `rel="noopener noreferrer"`. |
| **SEC-M4** | security | No-orphan enforced only in app code, not a DB invariant. | **PARKED (accepted for POC).** A `BEFORE INSERT` trigger coupling `governance_events` to `projects` was considered and rejected in v2 (couples the append-only table). Write-path check + the SEC-H1 ownership hardening bound the risk. Documented; revisit if multi-tenant beyond first-party. |
| **SEC-L1** | security | Slack message mention injection (`@here`/`<!channel>` in `message`). | **RESOLVED — sanitize.** `notify_slack` strips/escapes `<!…>` mention tokens and posts with a fixed `[jira_key]` prefix; message body is plain text. Added to v3-5.2. |
| **SEC-L2** | security | No rate limiting on `notify_slack`. | **PARKED (Low).** Slack API self-throttles (429 → `slack_error`); MCP already single-tenant POC. Track as future hardening. |
| **SEC-L3** | security | Audit trigger `actor_sub` spoofable / `db_direct` fallback. | **ACCEPTED (documented).** After SEC-H1, only `kiro_migrator`/admin can write `projects`; `db_direct` marks out-of-band changes intentionally. Belt-and-suspenders only. |
| **SEC-L4** | security | `CREATE USER IF NOT EXISTS kiro_mcp` (V001) is invalid PostgreSQL syntax; ties to SEC-H1 migration-role clarity. | **RESOLVED.** V004 §F uses a `DO $$ … CREATE ROLE … $$` guard for `kiro_mcp` and `kiro_migrator`; a follow-up notes V001 should be corrected (or superseded) — flagged as a Phase-1 doc/migration fix. |
| **PLAN-M1** | plan | `event_code` exists in no table (`governance_events`), no `RecordProgressInputSchema` field, no `GovernanceEventRecord` field. Level-2 is not deterministic-testable until specified. | **RESOLVED — new Phase-1 story CR-14.** Adding `event_code` requires: a new optional field on `record_progress` input + `GovernanceEventRecord` + an `event_code TEXT` column on `governance_events` (Phase-1 migration, append-only-compatible: additive nullable column). CR-12 (Level-2) stays **blocked on OQ-CR-13 + CR-14**. Added to affected-docs + v3-4. |
| **PLAN-M2** | plan | Two `V002__*.sql` coexist (both `CREATE...IF NOT EXISTS projects`); F10 ordering action item dropped. | **RESOLVED — F10 restored.** Pre-implementation action item added to v3-8/v3-11: verify the migration runner sorts by full filename and that `V004__github_slack_linkage.sql` is lexically last; confirm the two `V002` files converge on a single `projects` definition (they do — identical columns; the `casdm_tracking` variant is canonical, `jira_sync` adds `project_gates`). |
| **PLAN-M3** | plan | V004 audit trigger writes ONE row `field='linkage_change'` with pipe-concatenated values; FR-P2-034/035 ACs promise per-field old→new. | **RESOLVED — per-field trigger.** V004 §D rewritten to emit one `project_link_audit` row **per changed field** (`github_repo`, `github_url`, `slack_micro_channel_id`, `slack_macro_channel_id`) with that field's own old→new. ACs now match implementation. |
| **PLAN-L1** | plan | Retained V2-R2 sections still say "remove/de-wire gates §5.3 macro auto-completion," which v3 verified does not exist. | **RESOLVED.** SUPERSEDED pointers added at the V2-R2 headers that carry the stale instruction. |
| **PLAN-L2** | plan | V004 grants `kiro_mcp SELECT ON micro_artifact_mapping` "if Level-2 in MCP," but recommended design is app-side → unnecessary surface. | **RESOLVED — grant removed.** Under the recommended app-side Level-2 (D-v3-9 default), `kiro_mcp` gets NO grant on `micro_artifact_mapping`; the app's own DB role reads it. V004 §F updated. |
| **PLAN-L3** | plan | For `github_repo IS NULL`, v3-6.2 says the app calls `notify_slack` and gets `channel_not_configured` — but `project_id` is `z.string().min(1)`; a null repo fails validation instead. | **RESOLVED.** v3-6.2 updated: the app **skips** the `notify_slack` call entirely when `github_repo IS NULL` (never calls with null). |
| **PLAN-L4** | plan | FR-P2-042 AC allows matching on `source_ref` as an alt key, but `micro_artifact_mapping` keys only `event_code` (UNIQUE `event_code,project_type,phase`). | **RESOLVED — align to `event_code`.** FR-P2-042 keys on `event_code` only (pending OQ-CR-13/CR-14); the `source_ref` alternative is removed from the AC. |
| **PLAN-I1** | plan | Micro Slack posts originate only from the adapted CI script; direct sub-agent `record_progress type:micro` calls do NOT trigger `notify_slack`. | **RESOLVED — stated explicitly** in v3-6.1: only CI-sourced micro events reach the micro channel; direct sub-agent micro `record_progress` calls persist + surface on the timeline but do not auto-notify Slack (relates to OQ-CR-16 — a curated notify subset). |

### Capacity (Technical PM) — accepted

3 sprints (~3 weeks) for core; ~$0/mo incremental. Critical path CR-01→CR-02→CR-05→CR-09→CR-10→CR-13 = 32 pts. **Round-3 adjustment:** CR-OIDC is no longer optional-trailing — it becomes a **hard predecessor of CR-12 (Level-2)**; and **CR-14 (`event_code` Phase-1 field)** is added as a predecessor of CR-12. CR-12 therefore moves to Sprint 3/4 behind CR-OIDC + CR-14 + OQ-CR-13. Core-without-Level-2 (54 pts) is unaffected and remains the recommended first delivery.

---

## v3-1. Source Verification Log (re-verified for v3)

Every v3 claim was checked against the actual source. ✔ = confirmed on disk.

| Claim | Source (verified) | ✔ |
|-------|-------------------|---|
| `record_progress` persists to **RDS Postgres** (not DynamoDB) via `writeGovernanceEvent`; dedup by `ON CONFLICT (idempotency_key)`; **no project resolution** today | `packages/mcp-server/src/tools/record-progress.ts`, `services/postgres.service.ts` | ✔ |
| `notify_slack` **skips micro** (`event_type==='micro'` → `{notified:false,reason:'micro_event'}`); resolves webhook from SSM; message is **repo-labelled**: `🏁 *[${project_id}]* ${message}` | `packages/mcp-server/src/tools/notify-slack.ts` | ✔ |
| Slack integration today = **incoming webhook** (`GetParameter /kiro-governance/slack/webhooks/${projectId}` → `https.request` POST `{text}`) | `packages/mcp-server/src/services/slack.service.ts` | ✔ |
| `postgres.service.ts` has RDS IAM auth + `writeGovernanceEvent` only — **no `resolveProject`** | `packages/mcp-server/src/services/postgres.service.ts` | ✔ |
| `dynamodb.service.ts` is a **dead stub** (all exports throw `deprecated`); a test file exists for it | `services/dynamodb.service.ts`, `services/__tests__/dynamodb.service.test.ts` | ✔ |
| **`table-name` SSM leftover**: `index.ts` `loadServerConfig()` reads `/kiro-governance/config/table-name` into `ServerConfig.tableName` (DynamoDB era; unused by RDS path) | `packages/mcp-server/src/index.ts` | ✔ |
| CI script parses `docs/project-progress.md` diff, matches **MACRO** gates, calls `record_progress` `type:'macro'` then `notify_slack` `event_type:'macro'` with message `${gate} — committed by ${ACTOR}` | `scripts/governance-trigger.js` | ✔ |
| `kiro_mcp` holds `GRANT ALL PRIVILEGES ON DATABASE kiro_governance` (can UPDATE/DELETE events, write `projects`) — append-only is NOT a DB guarantee today | `migrations/V001__governance_events.sql` | ✔ |
| `governance_events.project_id TEXT NOT NULL`, **no FK** → orphans storable today | `migrations/V001__governance_events.sql` | ✔ |
| Canonical projects schema = `V002__projects_and_casdm_tracking.sql` (`projects`, `micro_artifacts` [uq `(project_id,phase,artifact_name)`, status `pending/in_progress/complete`], `macro_checkpoints`). A **second, stale** `V002__projects_and_jira_sync.sql` (defines `project_gates`) also coexists (both `CREATE ... IF NOT EXISTS`) | `migrations/V002__*.sql` | ✔ |
| `macro_checkpoints.reached_at` exists (added by V003 ALTER); `v_timeline` inner-joins `governance_events ge JOIN projects p ON p.jira_key = ge.project_id` and surfaces **ALL** event types (no macro filter) | `migrations/V003__phase2_additions.sql` | ✔ |
| **CURRENT `gates-architecture.md` has NO §5 governance-reconciliation section**; checkpoint completion is app-owned via the §4 state machine (`human_review`/`meeting`/`transcript_analysis`/`checklist`), `reached_at` set only by in-app triggers. **There is no macro auto-completion write path to remove** (the v1/v2 "gates §5.3" references describe a superseded doc version) | `docs/phase2/gates-architecture.md` §2.8/§3/§4 | ✔ |
| Highest existing FR = **FR-P2-032** (SRS v1.4) → new FRs start at FR-P2-033 | `docs/phase2/srs.md` | ✔ |

> **Consequence of the gates correction (H):** Decision H ("macro app-owned; Kiro macro events display-only") is **already the deployed behaviour** — nothing auto-completes `macro_checkpoints` from `governance_events` today. v3 therefore does **not** remove any code; it (a) documents/locks this invariant in an FR, and (b) ensures the display-only `v_timeline` surfacing (which shows all governance events, macro included) never drives completion. The only real timeline change is the join-key repoint (`jira_key` → `github_repo`) for Level 1.

## v3-2. Target End-State Flow

```
Project (optional github_repo + optional micro/macro Slack channels)
  │
  ├─ UNLINKED (github_repo IS NULL): behaves exactly as today — app-only. No Kiro
  │    events resolve to it; no external Slack routing. (Feature switch OFF.)
  │
  └─ LINKED (github_repo set): Feature switch ON
       │
       ├─ MICRO signal (owned by CI/Kiro):
       │    Kiro sub-agents + scripts/governance-trigger.js → record_progress type:micro
       │       → MCP resolves projects.github_repo == repo (NO MATCH ⇒ hard reject, dimensionless metric)
       │          → writes governance_event
       │       → notify_slack event_type:micro → slack_micro_channel_id  (project-labelled)
       │    Level 1: micro event surfaces on the project timeline (source kiro_mcp)
       │    Level 2: micro event auto-completes the mapped micro_artifacts row (deterministic)
       │
       └─ MACRO signal (owned by DeliverPro app):
            human approves a macro gate in-app → macro_checkpoints.reached_at set (app-owned)
               → app calls the SAME MCP notify_slack event_type:macro → slack_macro_channel_id
            Kiro macro governance events (if any) = DISPLAY-ONLY on timeline; never set reached_at
```

## v3-3. Final TODO FR List — FR-P2-033 .. FR-P2-042

> PROPOSALS for `docs/phase2/srs.md` (not applied). IDs continue from FR-P2-032. Every AC is machine-testable. Items not traceable to a customer statement are labelled **Architect decision**.

### FR-P2-033 — Project Unique Key: Uniqueness & Immutability (Must)

**Source:** Customer 2026-07-02 (Decision B): "every project must have a unique identifier (a key)." Existing DB behaviour verified in `migrations/V002__projects_and_casdm_tracking.sql` (`jira_key TEXT NOT NULL UNIQUE`). Immutability = **Architect decision** (all child FKs reference `jira_key` with `ON DELETE CASCADE` and no `ON UPDATE CASCADE`).

**Acceptance Criteria:**

- Given two projects, then their `jira_key` values are distinct (enforced by the `UNIQUE` constraint).

- Given a create request whose `jira_key` already exists, then the API returns HTTP 409 `{ "code": "DUPLICATE_JIRA_KEY" }`.

- Given `PATCH /api/projects/{projectId}` with any attempt to change `jira_key`, then the API returns HTTP 422 `{ "code": "IMMUTABLE_FIELD", "field": "jira_key" }` and the stored value is unchanged.

- Given a directly-created project, then `jira_key` matches `^DP-\d{3,}$` and is the next sequential value.

### FR-P2-034 — Project ↔ GitHub Repository Link (Must)

**Source:** Customer 2026-07-02 (Decision A) + Phase 2 transcript ("attach it to a repository"; "It works with your Github… write it down on our database"). Storing the link **on the project entity** and the admin/leadership authz = **Architect + security decision**.

**Acceptance Criteria:**

- Given a project, then it exposes `github_repo` (repository name, e.g. `deliverpro`) and `github_url` (full HTTPS URL); both nullable.

- Given `POST /api/projects` omitting `github_repo`, then the project is created with `github_repo = NULL` (feature switch OFF; linkable later).

- Given two projects both with non-NULL `github_repo`, then their values are distinct; a duplicate returns HTTP 409 `{ "code": "DUPLICATE_GITHUB_REPO" }` (enforced by the partial unique index — 1:1).

- Given a `github_repo` value, then it matches `^[A-Za-z0-9._-]{1,100}$`; invalid → HTTP 400 `{ "code": "VALIDATION_ERROR", "field": "github_repo" }`.

- **(SEC-M3)** Given a `github_url` value, then it MUST match `^https://github\.com/[A-Za-z0-9._/-]{1,200}$` (scheme `https` only; host allow-listed to `github.com`); any other scheme/host or embedded control chars → HTTP 400 `{ "code": "VALIDATION_ERROR", "field": "github_url" }`. When rendered as a clickable link, the anchor uses `rel="noopener noreferrer"` (prevents stored-XSS / open-redirect via a hostile URL).

- Given an `admin` or `leadership` user (verified on Cognito `sub`/group claim, NOT the free-text `project_manager` field) PATCHes a new `github_repo`, then the link updates; given any other role, then HTTP 403 `{ "code": "FORBIDDEN" }`.

- Given any create/change of `github_repo`/`github_url`, then **one `project_link_audit` row per changed field** is written (`field` = the exact column name, `old_value`, `new_value`, actor Cognito `sub`, timestamp) plus `updated_by`/`updated_at` on `projects`. **(PLAN-M3: per-field rows, not a single concatenated `linkage_change` row.)**

### FR-P2-035 — Project ↔ Dual Slack Destinations (App-Managed) (Must)

**Source:** Customer 2026-07-02 (Decisions C, D, E) — dual channels per project (micro + macro); workspace bot token; token is a secret.

**Acceptance Criteria:**

- Given a project, then it exposes `slack_micro_channel_id` and `slack_macro_channel_id` (both nullable, non-secret Slack channel ids e.g. `C0123ABCD`); no bot token or webhook URL is ever present in any API response, PG column, or log.

- Given the workspace Slack **bot token**, then it is stored **only** in SSM SecureString (or Secrets Manager) as a **single workspace-level** parameter; it is never a PG column.

- Given a change to either channel id, then it is authorized to `admin`/`leadership` (Cognito-sub) and writes **one `project_link_audit` row per changed field** (`field` = `slack_micro_channel_id` or `slack_macro_channel_id`, own old→new, actor, timestamp). **(PLAN-M3.)**

- Given the rejected webhook-in-PG alternative, if chosen by the customer, then any URL column MUST be `pgcrypto`/KMS-encrypted and pass a dedicated security review (default design forbids storing it in PG).

### FR-P2-036 — Reconciliation: MICRO surfacing (Level 1); MACRO display-only (Must)

**Source:** Customer 2026-07-02 (Decisions H, I-Level 1). Reconciliation via `github_repo` = **Architect decision** (fixes the identifier-space mismatch).

**Acceptance Criteria:**

- Given a `governance_events` row with `project_id = R` and a project with `github_repo = R`, then that event appears on that project's timeline with `source: 'kiro_mcp'`, ordered chronologically.

- Given a `governance_events` row with `type = 'macro'`, then it is displayed on the timeline but **does not** set `macro_checkpoints.reached_at` (macro completion is app-owned — FR-P2-041).

- Given a `governance_events` row whose `project_id` matches no project's `github_repo`, then it does not appear on any project timeline and no error is raised (it was hard-rejected at write time per FR-P2-038).

- Given a project with `github_repo = NULL`, then its timeline shows only DeliverPro-native events (identical to current behaviour).

### FR-P2-037 — MCP Governance Logs Visible Per Project (Must)

**Source:** Customer — SRS FR-P2-011 ("you're collecting stuff in your database for Kiro. Where would I see that if I'm a project manager?").

**Acceptance Criteria:**

- Given a project with `github_repo = R` and ≥1 `governance_events` row with `project_id = R`, then `GET /api/projects/{projectId}/timeline`, `GET /api/reporting/timeline/{projectId}`, and the `v_timeline` view all return those events (joined via `github_repo`).

- Given a project whose `github_repo` was just backfilled, then its historical governance events appear immediately (read-side join; no reprocessing).

### FR-P2-038 — No-Orphan Governance Event Storage (Must)

**Source:** Customer 2026-07-02 (Decision G): "stored only if it maps to an existing project; if none, do not store."

**Acceptance Criteria:**

- Given `record_progress` with `project_id = R`, when no project has `github_repo = R`, then the event is **not written** and the tool returns `{ "written": false, "reason": "no_matching_project" }`.

- Given the same rejection, then a **dimensionless** `GovernanceEventRejected` CloudWatch counter is incremented (NO repo dimension) and the repo name is written to the **structured log only**; no orphan row is stored.

- Given `record_progress` with a matching project, then behaviour (classification, dedup via `ON CONFLICT`, RDS write) is unchanged.

- Given resolution, then it uses `SELECT jira_key FROM projects WHERE github_repo = $1 LIMIT 1` for **both** macro and micro events.

- Given the MCP DB user `kiro_mcp`, then its privileges are exactly `INSERT, SELECT ON governance_events` (+ sequence) and `SELECT (jira_key, github_repo, slack_micro_channel_id, slack_macro_channel_id) ON projects` — no `UPDATE`/`DELETE` anywhere.

### FR-P2-039 — App-Managed Slack Provisioning & Dual-Channel Routing (Must)

**Source:** Customer 2026-07-02 (Decisions D, E, F).

**Acceptance Criteria:**

- Given a single workspace Slack app + bot token, then DeliverPro authenticates once (admin OAuth consent); no per-project OAuth.

- Given a project being linked, then DeliverPro resolves/creates the micro and/or macro channels (`conversations.list`/`conversations.create`) and stores their ids in `slack_micro_channel_id`/`slack_macro_channel_id`.

- Given `notify_slack` with `event_type = 'micro'`, then it posts to `slack_micro_channel_id`; given `event_type = 'macro'`, then it posts to `slack_macro_channel_id` — both via `chat.postMessage` using the SSM bot token, resolving the project by `github_repo`.

- Given the resolved channel id is NULL or the project does not resolve, then `notify_slack` returns `{ "notified": false, "reason": "channel_not_configured" }` — no error surfaced, no secret/SSM path/repo leaked in the response.

- Given a posted message, then it is **project-labelled** using `jira_key` (and title when available), e.g. `[DP-001] …`, not the repo name.

- Given the bot token, then it is read with least-privilege `ssm:GetParameter`+`kms:Decrypt` scoped to the **single token parameter ARN** only; `ssm:PutParameter` is admin/out-of-band.

- **(SEC-M1) Two-token split:** the **runtime** token used by `notify_slack` carries **`chat:write` only** (cannot create/rename channels); the **provisioning** scopes (`channels:read` + `channels:manage` for `conversations.list`/`conversations.create`) live on a **separate** credential held only by the app's link/onboarding path. No `admin.*` scope on either. The Phase-1 `notify_slack` role can read only the runtime token ARN.

### FR-P2-040 — Optional Linkage Feature Switch (Must)

**Source:** Customer 2026-07-02 (Decision A).

**Acceptance Criteria:**

- Given `github_repo = NULL`, then no Kiro governance events are recorded against the project and its timeline shows only DeliverPro-native events (identical to today); no external Slack routing occurs.

- Given `github_repo` set, then micro recording + micro-channel Slack routing turn ON for that repo.

- **(PLAN-H1)** Given a CI/Kiro-path `record_progress` call for a linked repo, then the persisted `governance_events` row has `type='micro'` (verified: `classifyEvent` honors the explicit `type` — see v3-5.1), regardless of any gate-name substring present in `update_text`. A stored `type='macro'` from the CI path is a defect.

- Given `github_repo` is later cleared or re-pointed, then previously-stored events keyed to the old repo stop surfacing on the timeline (join is on current `github_repo`), the change is written to `project_link_audit`, and the UI warns the operator of the historical-event visibility impact. Re-pointing back restores visibility.

### FR-P2-041 — MACRO Gate Ownership (Must)

**Source:** Customer 2026-07-02 (Decisions F, H).

**Acceptance Criteria:**

- Given any macro checkpoint, then `reached_at` is set **only** by an in-app trigger (`human_review`/`meeting`/`transcript_analysis`/`checklist` per `gates-architecture.md` §4); Kiro macro governance events **never** set it.

- Given an in-app macro-gate approval on a linked project, then the DeliverPro app calls the SAME MCP `notify_slack` with `event_type = 'macro'` (macro channel); the app does not build its own Slack client.

- Given the split of ownership, then micro notifications originate **only** from the CI/Kiro path and macro notifications **only** from the app — no event produces both a micro and a macro notification (no double-notify).

- **(PLAN-H2 — pure-Kiro-CLI repos, gated on D-v3-10)** Given a linked repo that has NO in-app macro approver (CLI-only), if the CLI-macro path is approved (D-v3-10), then the CI script MAY emit a macro governance event (`type='macro'`, `flag_override:true`) that is **display-only** (surfaces on the timeline, does NOT set `macro_checkpoints.reached_at`) and triggers the **macro-channel** notification — preserving the demoed "progress-MD → gate → Slack" behaviour without violating app-owned completion. If D-v3-10 rejects the CLI-macro path, then CLI-only repos record no macro gate/notification (documented breaking change).

- Given the current codebase, then no `governance_events → macro_checkpoints` auto-completion path exists or is (re)introduced (verified: current `gates-architecture.md` has no such write path).

### FR-P2-042 — Micro-Event → Micro-Artifact Auto-Completion (Deterministic) (Must)

**Source:** Customer 2026-07-02 (Decision I, Level 2). Mapping-key mechanism = OPEN (OQ-CR-13) with architect recommendation (stable event code).

**Acceptance Criteria:**

- Given a linked project and a `governance_events` row of `type = 'micro'`, when a deterministic mapping row resolves `(event_code, phase, project_type) → artifact_name`, then the matching `micro_artifacts` row for that project/phase is set `status = 'complete'`, `completed_at = event.created_at`, `completed_by = 'kiro_mcp:' || event.event_code` (machine provenance — **SEC-H3**, not the spoofable free-text actor).

- **(PLAN-L4)** The mapping key is `event_code` ONLY (`micro_artifact_mapping.UNIQUE(event_code, project_type, phase)`); `source_ref` is NOT an alternative key. `event_code` requires the Phase-1 addition in CR-14 (see PLAN-M1) — until then Level-2 is not implementable.

- **(SEC-H3) Trusted-identity gate:** Level-2 auto-completion is enabled ONLY when the emitting path has verified identity (GitHub OIDC — CR-OIDC). Auto-completing `event_code`s are restricted to a configurable **allow-list**; a mapped event outside the allow-list surfaces on the timeline but does not mutate artifact state.

- **(SEC-H3) Reversible + audited:** every auto-completion writes an audit row (`event_code`, resolved `artifact_name`, project, timestamp, provenance); an admin can reverse an erroneous auto-completion, and reversal is audited.

- Given a micro event with **no** mapping row, then no artifact is changed and the event still surfaces on the timeline (Level 1 is unaffected by Level 2 misses).

- Given the mapping, then it is a **config/lookup table** (deterministic), NOT fuzzy text matching; an unmapped or ambiguous event never mutates artifact state.

- Given an already-`complete` artifact, then re-processing the same/duplicate micro event is idempotent (no error, no state change).

## v3-4. Final V004 Data-Model Delta (spec only — PROPOSED `migrations/V004__github_slack_linkage.sql`)

```sql
-- V004__github_slack_linkage.sql (PROPOSED, v3) — NOT APPLIED.

-- (A) Optional GitHub linkage + DUAL app-managed Slack channels (Decision C).
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS github_repo            TEXT,        -- repo name; matches governance_events.project_id; FEATURE SWITCH (A)
  ADD COLUMN IF NOT EXISTS github_url             TEXT,        -- full HTTPS repo URL (display)
  ADD COLUMN IF NOT EXISTS slack_micro_channel_id TEXT,        -- non-secret Slack channel id for MICRO notifications (E)
  ADD COLUMN IF NOT EXISTS slack_macro_channel_id TEXT,        -- non-secret Slack channel id for MACRO notifications (E)
  ADD COLUMN IF NOT EXISTS updated_by             TEXT,        -- Cognito sub of last mutator (audit)
  ADD COLUMN IF NOT EXISTS updated_at             TIMESTAMPTZ; -- last mutation timestamp (audit)
-- NOTE: the single slack_channel_id proposed in v2 is REPLACED by the two columns above.
--       The v2 column never shipped (no prior migration added it) — nothing to drop.
-- NOTE: the Slack BOT TOKEN is a SECRET — SSM SecureString / Secrets Manager only, NEVER a PG column.

-- (B) 1:1 repo <-> project; partial unique tolerates multiple NULLs (unlinked projects).
--     Also serves the record_progress / notify_slack resolve lookup.
CREATE UNIQUE INDEX IF NOT EXISTS uq_projects_github_repo
  ON projects (github_repo) WHERE github_repo IS NOT NULL;

-- (C) Linkage-change audit table (Decision C).
CREATE TABLE IF NOT EXISTS project_link_audit (
  id          BIGSERIAL   PRIMARY KEY,
  project_id  TEXT        NOT NULL REFERENCES projects(jira_key) ON DELETE CASCADE,
  field       TEXT        NOT NULL,   -- 'github_repo'|'github_url'|'slack_micro_channel_id'|'slack_macro_channel_id'
  old_value   TEXT,
  new_value   TEXT,
  actor_sub   TEXT        NOT NULL,   -- Cognito sub, or 'db_direct' for out-of-band changes
  changed_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_project_link_audit_project ON project_link_audit (project_id);

-- (D) BEFORE UPDATE trigger — audits ANY linkage mutation, ONE ROW PER CHANGED FIELD (PLAN-M3).
--     Matches FR-P2-034/035 ACs (per-field old→new). Belt-and-suspenders beyond app authz.
CREATE OR REPLACE FUNCTION trg_audit_project_linkage() RETURNS trigger AS $$
DECLARE
  actor TEXT := COALESCE(NEW.updated_by, 'db_direct');
BEGIN
  IF NEW.github_repo IS DISTINCT FROM OLD.github_repo THEN
    INSERT INTO project_link_audit (project_id, field, old_value, new_value, actor_sub)
    VALUES (NEW.jira_key, 'github_repo', OLD.github_repo, NEW.github_repo, actor);
  END IF;
  IF NEW.github_url IS DISTINCT FROM OLD.github_url THEN
    INSERT INTO project_link_audit (project_id, field, old_value, new_value, actor_sub)
    VALUES (NEW.jira_key, 'github_url', OLD.github_url, NEW.github_url, actor);
  END IF;
  IF NEW.slack_micro_channel_id IS DISTINCT FROM OLD.slack_micro_channel_id THEN
    INSERT INTO project_link_audit (project_id, field, old_value, new_value, actor_sub)
    VALUES (NEW.jira_key, 'slack_micro_channel_id', OLD.slack_micro_channel_id, NEW.slack_micro_channel_id, actor);
  END IF;
  IF NEW.slack_macro_channel_id IS DISTINCT FROM OLD.slack_macro_channel_id THEN
    INSERT INTO project_link_audit (project_id, field, old_value, new_value, actor_sub)
    VALUES (NEW.jira_key, 'slack_macro_channel_id', OLD.slack_macro_channel_id, NEW.slack_macro_channel_id, actor);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_project_linkage
  BEFORE UPDATE ON projects FOR EACH ROW EXECUTE FUNCTION trg_audit_project_linkage();

-- (E) Level-2 deterministic mapping (Decision I / FR-P2-042). Config/lookup, NOT fuzzy match.
--     PENDING OQ-CR-13 mapping-key mechanism — recommended stable event_code key shown.
CREATE TABLE IF NOT EXISTS micro_artifact_mapping (
  id            BIGSERIAL PRIMARY KEY,
  event_code    TEXT NOT NULL,          -- stable code emitted by Kiro (recommended key); OR match on source_ref pattern
  project_type  TEXT NOT NULL DEFAULT 'default',
  phase         TEXT NOT NULL,
  artifact_name TEXT NOT NULL,          -- must match micro_artifacts.artifact_name for (project, phase)
  is_active     BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_micro_artifact_mapping UNIQUE (event_code, project_type, phase)
);

-- (F) SEC-H1/SEC-L4 — REAL append-only via OWNERSHIP REASSIGNMENT (Decision G).
--     BLOCKING prerequisite for no-orphan + routing.
--
--     ROOT CAUSE (verified): V001 grants only `ALL PRIVILEGES ON DATABASE` (database-level:
--     CONNECT/CREATE/TEMP), NOT table DML. kiro_mcp can INSERT today ONLY because it OWNS the
--     tables (it is the connecting/migration role). A table OWNER keeps every right regardless
--     of REVOKE and can re-grant — so a plain `REVOKE ALL` (as earlier v3 drafts specified) is
--     COSMETIC and does NOT make governance_events append-only.
--
--     ⚠️ PRE-IMPLEMENTATION VERIFICATION (mandatory, in CR-01): confirm current table ownership
--        (SELECT tablename, tableowner FROM pg_tables WHERE schemaname='public';) and the
--        migration-runner identity. If kiro_mcp is NOT the owner, adjust the ALTER ... OWNER TO
--        statements to the real owner. Do NOT apply blindly.

-- F.1 — Roles. (SEC-L4: `CREATE USER IF NOT EXISTS` is INVALID PostgreSQL — use DO-block guards.)
--       kiro_migrator OWNS the schema objects and runs migrations; kiro_mcp is the runtime app role.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kiro_migrator') THEN
    CREATE ROLE kiro_migrator NOLOGIN;   -- owner/DDL role; assumed by the migration runner
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kiro_mcp') THEN
    CREATE ROLE kiro_mcp LOGIN;          -- runtime MCP role (RDS IAM auth)
  END IF;
END
$$;
GRANT rds_iam TO kiro_mcp;

-- F.2 — Reassign OWNERSHIP of all objects to the non-runtime migrator role.
--       This is what actually removes kiro_mcp's implicit owner rights (UPDATE/DELETE/DROP/GRANT).
ALTER TABLE governance_events        OWNER TO kiro_migrator;
ALTER TABLE projects                 OWNER TO kiro_migrator;
ALTER TABLE micro_artifacts          OWNER TO kiro_migrator;
ALTER TABLE macro_checkpoints        OWNER TO kiro_migrator;
ALTER TABLE project_link_audit       OWNER TO kiro_migrator;
ALTER TABLE micro_artifact_mapping   OWNER TO kiro_migrator;
ALTER SEQUENCE governance_events_id_seq OWNER TO kiro_migrator;
-- (Enumerate ALL existing tables/sequences here after the ownership audit above.)

-- F.3 — Strip any residual privileges, then grant kiro_mcp EXACTLY least privilege.
REVOKE ALL ON ALL TABLES    IN SCHEMA public FROM kiro_mcp;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM kiro_mcp;
REVOKE ALL PRIVILEGES ON DATABASE kiro_governance FROM kiro_mcp;
GRANT CONNECT ON DATABASE kiro_governance TO kiro_mcp;
GRANT USAGE  ON SCHEMA public             TO kiro_mcp;

-- Real append-only: INSERT + SELECT only (no UPDATE/DELETE — kiro_mcp is no longer owner).
GRANT INSERT, SELECT ON governance_events                TO kiro_mcp;
GRANT USAGE, SELECT  ON SEQUENCE governance_events_id_seq TO kiro_mcp;

-- Resolve-or-reject + dual-channel routing: read-only, column-scoped, NO write on projects.
GRANT SELECT (jira_key, github_repo, slack_micro_channel_id, slack_macro_channel_id) ON projects TO kiro_mcp;

-- (PLAN-L2) NO grant on micro_artifact_mapping — Level-2 runs APP-SIDE (D-v3-9 default), read by
--           the app's own DB role, not kiro_mcp. Do NOT widen the MCP surface.

-- F.4 — Future-proofing: ensure objects the migrator creates later are NOT implicitly owned/granted
--        to kiro_mcp, and default new-table privileges stay closed for the runtime role.
ALTER DEFAULT PRIVILEGES FOR ROLE kiro_migrator IN SCHEMA public
  REVOKE ALL ON TABLES FROM kiro_mcp;
ALTER DEFAULT PRIVILEGES FOR ROLE kiro_migrator IN SCHEMA public
  REVOKE ALL ON SEQUENCES FROM kiro_mcp;

-- NOTE (SEC-L4 follow-up): V001's `CREATE USER IF NOT EXISTS kiro_mcp` is invalid syntax and must be
--   corrected (or superseded by this DO-block) as a Phase-1 migration/doc fix — tracked in v3-8 CR-01.
-- NOTE (PLAN-M1): Level-2 `event_code` is NOT added here — it is a Phase-1 change (new nullable column
--   on governance_events + input/type field) delivered by CR-14. See v3-5.5.
```

**Column summary (added to `projects`):**

| Column | Type | Nullable | Secret? | Purpose |
|--------|------|----------|---------|---------|
| `github_repo` | `TEXT` | yes (partial UNIQUE) | no | Reconciliation key + feature switch; resolve lookup |
| `github_url` | `TEXT` | yes | no | Clickable repo link |
| `slack_micro_channel_id` | `TEXT` | yes | no | MICRO notification destination (CI/Kiro-owned) |
| `slack_macro_channel_id` | `TEXT` | yes | no | MACRO notification destination (app-owned) |
| `updated_by` / `updated_at` | `TEXT` / `TIMESTAMPTZ` | yes | no | Linkage-change audit |

**Timeline join repoint (Level 1):** V003 `v_timeline` source-1 currently joins `governance_events ge JOIN projects p ON p.jira_key = ge.project_id`. Repoint to `ON p.github_repo = ge.project_id`; when `github_repo IS NULL` the branch yields zero governance rows (correct — unlinked shows none). The `packages/gates/handlers/project-timeline.ts` and `reporting` timeline SQL must be repointed identically. During backfill (CR-06), an interim collision-safe predicate may be used: `ON p.github_repo = ge.project_id OR (p.github_repo IS NULL AND p.jira_key = ge.project_id)`, guarded by a collision check that no `github_repo` equals any `jira_key`; drop the `jira_key` branch once backfill validates.

## v3-5. Final MCP Server Change Spec

### v3-5.1 `record_progress` — add resolve-or-reject (Decision G)

Insert a resolve step **before** the existing write in `handleRecordProgress` (`tools/record-progress.ts`), after classification:

```
classify → RESOLVE (SELECT jira_key FROM projects WHERE github_repo = $1 LIMIT 1)
   ├─ 0 rows → return { written:false, reason:'no_matching_project' };
   │            metrics.addMetric('GovernanceEventRejected', Count, 1)  // NO dimension
   │            log.warn({ repo: input.project_id })                     // repo in log only
   └─ 1 row  → existing dedup + writeGovernanceEvent (unchanged)
```

- Add `export async function resolveProject(repo: string): Promise<{ jira_key: string } | null>` to `postgres.service.ts` running the parameterized `SELECT`. Reuses the existing IAM-auth pool.
- Applies to BOTH macro and micro events.
- No change to the tool input contract (`project_id` remains the repo name).

**(PLAN-H1) `classifyEvent` correction (also in `classifyEvent` at `packages/shared/constants/macro-gates.ts`):** the current guard `if (input.flag_override && input.type) return input.type` only honors an explicit `type` when `flag_override` is *also* true — otherwise it re-derives `type` from an `update_text` gate-name substring match. This silently converts the CI `type:'micro'` call into a stored `type='macro'`. **Fix: make an explicit `type` authoritative** — change the guard to `if (input.type) return { resolvedType: input.type, matchedGate: input.type === 'macro' ? <match gate> : undefined }` so a caller-supplied `type` always wins (substring matching applies only when `type` is absent). This is a Phase-1 change folded into CR-08/CR-10. Add a unit test asserting `classifyEvent({update_text:'SRS approved', type:'micro'}).resolvedType === 'micro'`.

### v3-5.2 `notify_slack` — dual-channel bot-token rewrite (Decisions D, E)

Rewrite `handleNotifySlack` (`tools/notify-slack.ts`):

```
notify_slack(project_id, message, event_type)
  ├─ (STOP skipping micro — remove the `if event_type==='micro' return micro_event` guard)
  ├─ RESOLVE: SELECT jira_key, slack_micro_channel_id, slack_macro_channel_id
  │           FROM projects WHERE github_repo = $1
  │     0 rows → { notified:false, reason:'channel_not_configured' }
  ├─ channelId = event_type==='macro' ? slack_macro_channel_id : slack_micro_channel_id
  │     channelId IS NULL → { notified:false, reason:'channel_not_configured' }   // graceful skip
  ├─ token = getBotToken()  (SSM SecureString, single workspace param, cached)
  └─ POST https://slack.com/api/chat.postMessage { channel: channelId, text: `[${jira_key}] ${message}` }
        Slack {ok:false,error} → { notified:false, reason:`slack_error:${error}` }
```

- Message is **project-labelled** (`[jira_key] …`) — replaces the current repo-labelled `🏁 *[${project_id}]* …`.
- No SSM path, secret, or repo name is leaked in any response reason.
- **(SEC-L1)** Sanitize the `message` before posting: strip/escape Slack broadcast tokens (`<!here>`, `<!channel>`, `<!everyone>`) and `<@…>`/`<#…>` link syntax so a crafted `update_text` cannot trigger mass mentions; post as plain text with the fixed `[jira_key]` prefix.

### v3-5.3 `slack.service.ts` — rewrite to bot token + `chat.postMessage` (Decision D)

- **(PLAN-H2b) Do NOT delete `getWebhookUrl` at cutover — deprecate with a transition fallback.** Keep the legacy webhook path (`/kiro-governance/slack/webhooks/${projectId}`) available during a transition window: if a project has no `slack_micro_channel_id`/`slack_macro_channel_id` configured yet BUT a legacy webhook param exists for its repo, fall back to the webhook `postToSlack` and log a deprecation warning. This prevents repos currently notified via the webhook from **silently going dark** at cutover. Retire `getWebhookUrl` + the per-repo webhook params only after CR-06 backfill + bot-token channel configuration validate for every currently-notifying repo (tie to the CR-06 gate).
- Add `getBotToken(ssmClient)` — reads the single workspace bot-token SSM SecureString param (e.g. `/kiro-governance/slack/bot-token`), 5-min in-memory cache. **(SEC-M1)** the runtime token is `chat:write`-only; the provisioning credential is separate.
- Add `postMessage(token, channelId, text)` — `POST https://slack.com/api/chat.postMessage` with `Authorization: Bearer <token>`, JSON `{ channel, text }`; treat HTTP-200 with `{ ok:false }` as an error (Slack returns 200 even on logical failure).
- Keep the 3s timeout + generic error codes (no secret leakage).

### v3-5.4 DB privilege change (Decision G / SEC-H1)

Delivered by the V004 §F block (rewritten for SEC-H1): reassign **table ownership** of all objects to a non-runtime `kiro_migrator` role, then grant `kiro_mcp` exactly `INSERT, SELECT ON governance_events` (+ sequence) and column-scoped `SELECT` on `projects`, plus `ALTER DEFAULT PRIVILEGES` to keep future tables closed. A plain `REVOKE ALL` is insufficient because `kiro_mcp` currently **owns** the tables (owner rights survive REVOKE). **No** grant on `micro_artifact_mapping` (Level-2 is app-side — PLAN-L2). This makes append-only a real DB guarantee. **Pre-implementation MUST audit current ownership + migration-runner identity** (CR-01). AWS IAM is unchanged (the EC2 role already holds `rds-db:connect`).

### v3-5.5 Level-2 auto-completion placement (Decision I / FR-P2-042)

Auto-completing `micro_artifacts` requires an `UPDATE` on a Phase-2-owned table — which `kiro_mcp` must NOT hold under the hardened append-only role. **Recommendation: implement Level 2 in the DeliverPro app, not in MCP.** Two options (OQ-CR-17):

- **Recommended — app-side consumer:** the DeliverPro backend reads new micro `governance_events` (it already has read access to the shared RDS) and applies the `micro_artifact_mapping` → `micro_artifacts` update under the app's own DB role. Keeps MCP strictly append-only.
- Alternative — MCP-side: would require granting `kiro_mcp` `UPDATE (status, completed_at, completed_by) ON micro_artifacts`, weakening the append-only posture. Not recommended.

**(SEC-H3) Trusted-identity prerequisite — Level-2 is GATED on CR-OIDC.** Because Level-2 mutates deliverable state from a caller-asserted micro event, it must NOT be enabled until event identity is verified (GitHub OIDC — CR-OIDC). Under the shared-key model a forged/replayed event with a mapped `event_code` could falsely mark deliverables complete. Therefore **CR-OIDC is a hard predecessor of CR-12** (not an optional fast-follow). Additional controls (allow-listed `event_code`s, machine provenance `completed_by='kiro_mcp:<event_code>'`, reversible + audited) are in FR-P2-042.

**(PLAN-M1) `event_code` is a Phase-1 dependency — CR-14.** The deterministic key `event_code` does not exist today (no column on `governance_events`, no field on `RecordProgressInputSchema`/`GovernanceEventRecord`). Level-2 requires CR-14 to add: (a) an optional `event_code` field on the `record_progress` input schema + `GovernanceEventRecord`, and (b) a nullable `event_code TEXT` column on `governance_events` (additive, append-only-compatible). **CR-12 stays blocked on OQ-CR-13 (vocabulary) + CR-14 (schema) + CR-OIDC (identity).**

### v3-5.6 Dead-code & config cleanup (Decision J)

- Delete `packages/mcp-server/src/services/dynamodb.service.ts` and `services/__tests__/dynamodb.service.test.ts`.
- Remove the `table-name` SSM leftover: drop `/kiro-governance/config/table-name` from `loadServerConfig()` in `index.ts` and remove `tableName` from the `ServerConfig` interface (unused by the RDS path). Retire the SSM parameter out-of-band.

## v3-6. CI Script + App-Backend Notification Path (Decision F)

**Ownership split (no double-notify):** MICRO = CI/Kiro path only; MACRO = DeliverPro app only.

### v3-6.1 CI/Kiro path → MICRO (`scripts/governance-trigger.js`)

Today the script matches MACRO gates from `docs/project-progress.md` and sends `type:'macro'` + `notify_slack event_type:'macro'`. Adapt to the MICRO role:

- Change the `record_progress` call from `type:'macro'` to **`type:'micro'`**, and the `notify_slack` call from `event_type:'macro'` to **`event_type:'micro'`**.
- **(PLAN-H1 — critical) Ensure the event actually persists as `type='micro'`.** Two safeguards, both required: (a) the `classifyEvent` fix in v3-5.1 makes an explicit `type` authoritative; (b) the CI call ALSO passes **`flag_override: true`** and builds `update_text` from a **non-gate label** (e.g. `"Progress update: <file> changed"`, NOT the canonical gate name) so no accidental substring match can re-classify it. Without (a), keeping a gate name in `update_text` without `flag_override:true` stores the row as `type='macro'` — breaking the CI=MICRO split, the no-double-notify contract, and Level-2.
- The gate-name match (if retained) is used ONLY to build a human-readable message label — it no longer implies `type:macro` and never drives macro completion.
- No-orphan (G): if `PROJECT_ID` (the repo name) does not resolve to a project, `record_progress` returns `no_matching_project`; the script logs and continues (non-blocking) — consistent with the feature switch (unlinked repos produce nothing).
- Kiro sub-agents that already call `record_progress type:micro` directly via MCP (per the steering "Micro Logging" sections) are unchanged — they are the other MICRO source and flow through the same no-orphan resolve + persistence.
- **(PLAN-I1 — micro Slack notification source, explicit) Only the adapted CI script triggers a micro Slack post.** Direct sub-agent `record_progress type:micro` calls persist the event and surface it on the timeline (Level 1) but do NOT themselves call `notify_slack`, so they do NOT post to the micro channel. If micro Slack coverage for direct sub-agent events is desired, that is a separate change (relates to OQ-CR-16 — a curated notify subset). Set expectations accordingly.

### v3-6.2 DeliverPro app → MACRO (app backend)

- When a human approves a macro gate in-app (the `gates-architecture.md` §4 state machine sets `macro_checkpoints.reached_at`), the app backend calls the SAME MCP `notify_slack` with `event_type:'macro'` and `project_id = <project.github_repo>` so MCP routes to `slack_macro_channel_id`.
- The app does **not** build its own Slack client — Slack is centralized in the MCP tool.
- **(PLAN-L3)** If the project is unlinked (`github_repo IS NULL`), the app **skips the `notify_slack` call entirely** — it does NOT call with a null/empty `project_id` (the tool's `project_id` is `z.string().min(1)`; a null would fail validation, not return a graceful reason). Macro completion is still recorded in `macro_checkpoints`. If `github_repo` is set but `slack_macro_channel_id IS NULL`, the app MAY call `notify_slack` and receive `channel_not_configured` (graceful), or skip proactively — either is acceptable.
- **(PLAN-H2a) CLI-only repos (no in-app approver), gated on D-v3-10:** if the CLI-macro path is approved, the CI script emits the macro event (display-only, `type='macro'` + `flag_override:true`, does NOT set `reached_at`) and triggers the macro-channel notification via `notify_slack event_type:'macro'` — so the demoed "progress-MD → gate → Slack macro" behaviour survives for repos with no DeliverPro approver. If rejected, CLI-only repos get no macro gate/notification (documented breaking change; human sign-off recorded at D-v3-10).
- Macro milestones already surface on the timeline via the `v_timeline` `macro_checkpoints` branch (reached_at) — the app does **not** need to write a `governance_event` for macro (avoids double-sourcing). Any Kiro-emitted macro `governance_events` remain display-only.

## v3-7. Affected Documents (to update after go-ahead)

| Document | Change |
|----------|--------|
| `docs/phase1/mcp-server-core-architecture.md` | `record_progress`: add resolve-or-reject + correct stale DynamoDB persistence wording to RDS + **`classifyEvent` explicit-`type`-wins fix (PLAN-H1)** + **optional `event_code` field (PLAN-M1 / CR-14)**. `notify_slack`: dual-channel PG resolve + bot-token `chat.postMessage` (replaces webhook, with transition fallback) + **mention sanitization (SEC-L1)** + **two-token split (SEC-M1)**. SSM inventory: add runtime + provisioning bot-token params, remove `table-name`, deprecate per-repo webhook params. Note the **ownership-reassignment append-only hardening (SEC-H1)** and correct V001's invalid `CREATE USER IF NOT EXISTS` (SEC-L4). |
| `docs/phase1/github-trigger-architecture.md` | CI script now emits `type:micro` + `flag_override:true` + non-gate `update_text` (PLAN-H1) + micro-channel notify; `project_id = repo name` retained; unlinked repos are hard-rejected (no-orphan). **CLI-macro path for repos with no in-app approver (PLAN-H2, gated on D-v3-10).** Optional GitHub OIDC identity (CR-OIDC, SEC-H2/H3). |
| `governance_events` (Phase-1 migration, CR-14) | **(PLAN-M1)** Add nullable `event_code TEXT` column (additive, append-only-compatible) to enable deterministic Level-2 mapping. New index optional. |
| `docs/phase1/agent-integration-architecture.md` | `record_progress` may return `no_matching_project`; callers log and continue. Micro sub-agent logging unchanged (now routed to micro channel). |
| `docs/phase2/projects-architecture.md` | Add `github_repo`/`github_url`/`slack_micro_channel_id`/`slack_macro_channel_id`/`updated_by`/`updated_at` to Project/Create/Update; admin/leadership linkage authz + audit; Slack provisioning at link time; 409 `DUPLICATE_GITHUB_REPO`, 422 `IMMUTABLE_FIELD`. |
| `docs/phase2/gates-architecture.md` | Repoint §2.8 timeline join (`jira_key`→`github_repo`). Add explicit statement that macro completion is app-owned and Kiro macro events are display-only (no auto-completion path exists or is introduced). Add Level-2 auto-completion of `micro_artifacts` from micro events. |
| `docs/phase2/reporting-architecture.md` | Repoint `v_timeline`/reporting-timeline join to `github_repo`. |
| `docs/phase2/config-architecture.md` | Admin management of `micro_artifact_mapping` (Level-2) + Slack channel ids; note `casdm_config` unaffected. |
| `docs/phase2/architecture/unified-data-model.md` | V004 columns, dual Slack channels, `project_link_audit` + trigger, `micro_artifact_mapping`, partial unique index, hardened `kiro_mcp` grants, no-orphan enforcement note, timeline join repoint. Reconcile the `Aurora PG15` (data-model) vs `PG16` (Phase-1 CR) engine note. |
| `docs/phase2/srs.md` | Add FR-P2-033..042; change FR-P2-019 (onboarding soft-captures channel ids); add OQ-CR-13..19; bump version + changelog. |
| Shared types + OpenAPI (`packages/shared/types/`, `specs/api/*`) | New project fields; `no_matching_project`/`channel_not_configured` reasons; `409`/`422`/`403`/`400` codes. |

## v3-8. Updated Backlog — Stories, Points, Ordering, Dependencies

Estimation: 1 pt ≈ 1 hr; ~20 pts/week; single developer.

| Story | Pts | Scope | Depends on |
|-------|-----|-------|-----------|
| **P0** | 3 | Doc-drift: correct `mcp-server-core-architecture.md` DynamoDB→RDS wording (code already RDS). No spike. | — |
| **CR-11** | 2 | Cleanup (J): delete `dynamodb.service.ts` + its test; remove `table-name` SSM leftover in `index.ts` + `ServerConfig.tableName`; retire the SSM param. | — |
| **CR-01** | 5 | V004 migration: dual Slack + github columns, partial unique index, `project_link_audit` + **per-field** BEFORE UPDATE trigger (PLAN-M3), `micro_artifact_mapping`, **SEC-H1 ownership reassignment** (`kiro_migrator` owns tables; `kiro_mcp` gets `INSERT,SELECT` on events + column `SELECT` on projects + `ALTER DEFAULT PRIVILEGES`; NO grant on mapping — PLAN-L2), **SEC-L4** `DO`-block role creation. **MUST first audit current table ownership + migration-runner identity.** (Was 3 pts; +2 for ownership audit/reassignment.) | Approval, D-v3-3, D-v3-11 |
| **CR-02** | 5 | `projects` API retrofit: fields + validation, 409 `DUPLICATE_GITHUB_REPO`, 422 `IMMUTABLE_FIELD`, 403 linkage authz (Cognito-sub), audit, TS types + OpenAPI, tests. | CR-01 |
| **CR-05** | 8 | App-managed Slack: workspace app, bot token → SSM/Secrets Manager, `chat:write`+`channels:read`/`channels:manage`, `conversations.list`/`create`, store micro+macro channel ids, single-ARN IAM scope, provisioning UI. | CR-01, CR-02 |
| **CR-09** | 8 | `notify_slack` dual-channel rewrite (route by `event_type`, resolve by `github_repo`, project-labelled, graceful skip) + **`slack.service.ts` rewrite to bot token `chat.postMessage`**. | CR-01, CR-05 |
| **CR-08** | 5 | `record_progress` resolve-or-reject + `resolveProject` in `postgres.service.ts` + dimensionless `GovernanceEventRejected` + **`classifyEvent` explicit-`type`-wins fix (PLAN-H1)**. Requires SEC-H1 ownership (CR-01). | P0, CR-01 |
| **CR-03** | 5 | Level 1: repoint `v_timeline` + `project-timeline.ts` + reporting timeline join `jira_key`→`github_repo`; lock macro app-owned (no auto-completion); E2E. | CR-01 |
| **CR-14** | 3 | *(NEW — PLAN-M1, Phase 1)* Add nullable `event_code` to `governance_events` (migration) + optional `event_code` on `record_progress` input schema + `GovernanceEventRecord`. Predecessor of Level-2. Blocked on OQ-CR-13 (vocabulary). | CR-01 |
| **CR-OIDC** | 5 | *(PREREQUISITE of CR-12 — SEC-H2/H3; also closes cross-project attribution)* GitHub OIDC per-repo identity — MCP verifies asserted `project_id`/repo == authenticated repository. Phase 1. | CR-08, CR-09 |
| **CR-12** | 5 | Level 2: `micro_artifact_mapping` seed + app-side consumer to auto-complete `micro_artifacts` (FR-P2-042) with allow-listed `event_code`s, machine provenance, reversible+audited. **Blocked on OQ-CR-13 + CR-14 (schema) + CR-OIDC (identity).** | CR-01, CR-03, CR-14, CR-OIDC |
| **CR-10** | 5 | Event-source split: adapt `governance-trigger.js` to MICRO (`type:micro` + `flag_override:true` + non-gate `update_text` — PLAN-H1); **CLI-macro path (PLAN-H2, D-v3-10)**; wire app-backend MACRO `notify_slack` on gate approval (skip when repo NULL — PLAN-L3); assert no double-notify. | CR-08, CR-09 |
| **CR-04** | 4 | Onboarding soft-captures `slack_micro_channel_id`/`slack_macro_channel_id`. | CR-02 |
| **CR-06** | 3 | Backfill `projects.github_repo` + validation report. **HARD PREDECESSOR of CR-08/CR-09/CR-03 cutover.** Blocked on OQ-CR-14 (mapping data). | CR-02 |
| **CR-13** | 3 | Integration tests: feature switch (linked/unlinked no-regression; unlinked neither stores nor notifies); coexistence (micro-only-from-CI, macro-only-from-app, no double-notify). | CR-03, CR-08, CR-09, CR-10 |
| **CR-07** | 3 | *(Defer, Could-Have)* Rejected-writes metric dashboard. | CR-08 |

**Ordering / cutover rule:** `Approval → {P0, CR-11, CR-01} → CR-02 → {CR-04, CR-05→CR-09}`, and `CR-01→CR-03`. **CR-06 backfill MUST complete + validate BEFORE CR-08/CR-09/CR-03 cutover go-live** (otherwise un-backfilled linked repos silently stop storing/notifying; the webhook transition fallback in v3-5.3 covers the gap during cutover). CR-10 needs CR-08+CR-09. CR-13 last. **Level-2 chain (SEC-H2/H3, PLAN-M1): CR-14 (event_code) + CR-OIDC (identity) are hard predecessors of CR-12** — Level-2 does not go live until both land and OQ-CR-13 is answered.

**(PLAN-M2) Pre-implementation action item (restored F10):** before applying V004, verify the migration runner sorts by full filename and that `V004__github_slack_linkage.sql` is lexically last; confirm the two coexisting `V002__*.sql` files converge on a single `projects` definition (verified identical columns — `casdm_tracking` is canonical, `jira_sync` additionally defines `project_gates`); and run the SEC-H1 ownership audit (`SELECT tablename, tableowner FROM pg_tables WHERE schemaname='public'`) to confirm the `ALTER ... OWNER TO kiro_migrator` targets.

**Phasing (~20 pts/week, single dev):**

- **Week 1 (~19):** P0 (3) + CR-11 (2) + CR-01 (5, incl. ownership reassignment) + CR-04 (4) + start CR-06 backfill prep. *(CR-02 starts if capacity.)*

- **Week 2 (~21):** CR-02 (5) + CR-05 (8) + CR-09 (8) — with CR-08 gated behind validated CR-06.

- **Week 3 (~18):** CR-08 (5) + CR-03 (5) + CR-10 (5) + CR-13 (3).

- **Week 4 (optional, Level-2 + hardening ~16):** CR-14 (3) + CR-OIDC (5) + CR-12 (5) + CR-07 (3) — only once OQ-CR-13 is answered and D-v3-8 elects OIDC.

**Core Level-1 (~56 pts): P0, CR-11, CR-01, CR-02, CR-04, CR-05, CR-06, CR-08, CR-09, CR-03, CR-10, CR-13 ≈ ~$0/mo incremental** (bot token reduces secret sprawl; Secrets Manager rotation optional ~$0.40/mo; CMK optional ~$1/mo; OIDC free). **Level-2 bundle (+13 pts): CR-14 + CR-OIDC + CR-12.** With CR-07 = ~72 pts total. Mandatory before implementation: a dedicated Phase-1 review + **security re-review** pass on CR-01 (ownership/grants/trigger), CR-05 (token split), CR-08/CR-09 (live tools), CR-OIDC, and a staged rollout on CR-08/CR-09.

## v3-9. Decisions Required From Human (go-ahead gate)

| # | Decision | Default if unanswered | Blocks |
|---|----------|-----------------------|--------|
| **D-v3-1** | Approve the v3 direction (add FR-P2-033..042; V004; MCP rewrites; CI/app split). | — (cannot proceed) | Everything |
| **D-v3-2** | Confirm **dual channels** (`slack_micro_channel_id` + `slack_macro_channel_id`) replacing the v2 single `slack_channel_id`. | Approve (per confirmed Decision C/E) | CR-01, CR-05, CR-09 |
| **D-v3-3** | Confirm the **SEC-H1 append-only repair via OWNERSHIP REASSIGNMENT** (reassign table ownership to `kiro_migrator`; grant `kiro_mcp` only `INSERT,SELECT` on events + column `SELECT` on projects + `ALTER DEFAULT PRIVILEGES`). A plain `REVOKE` is insufficient — `kiro_mcp` currently owns the tables. | Approve (code writes only via INSERT) | CR-01, CR-08, CR-09 |
| **D-v3-4** | Confirm **macro strictly app-owned** — Kiro macro events display-only (already the deployed behaviour; this locks it). | Approve | CR-03, CR-10 |
| **D-v3-5** | Confirm the **CI=micro / app=macro ownership split** and no-double-notify contract. | Approve | CR-10 |
| **D-v3-6** | Confirm **CR-06 backfill gates cutover** of CR-08/CR-09/CR-03 (with the v3-5.3 webhook transition fallback bridging the window). | Approve | CR-08/09/03 go-live |
| **D-v3-7** | **Secret store:** SSM SecureString + `aws/ssm` (POC) vs Secrets Manager + rotation and/or CMK. | SSM SecureString + `aws/ssm` (POC) | CR-05 (non-blocking) |
| **D-v3-8** | **Cross-project isolation & Level-2 identity (SEC-H2/H3 — High).** Shared MCP API key + caller-asserted repo lets one linked project post to another's channel / mis-attribute events, and lets a forged micro event falsely complete deliverables (Level-2). **Adopt GitHub OIDC (CR-OIDC) as a PREREQUISITE of Level-2 (CR-12)**, or risk-accept the shared-key model for the first-party POC with compensating controls (no-orphan + append-only bound tampering to insert-with-wrong-attribution)? **Either way requires explicit human sign-off (High).** | Adopt OIDC before enabling Level-2; Level-1 may ship under risk-accept for the POC | CR-OIDC, CR-12 |
| **D-v3-9** | **Level-2 placement:** app-side consumer (recommended, keeps MCP append-only) vs MCP-side `UPDATE` on `micro_artifacts` (weakens append-only). | App-side consumer | CR-12 |
| **D-v3-10** | **(PLAN-H2 — High) Pure-Kiro-CLI repos.** These have no in-app macro approver and lose the webhook path under v3. **Approve the CLI-macro path** (CI emits display-only macro event + macro-channel notify, preserving the demoed progress-MD→gate→Slack for CLI-only repos) **OR accept the CLI-only macro regression as a documented breaking change**? | Approve the CLI-macro path (no regression) | CR-10; CLI-only repo behaviour |
| **D-v3-11** | **(SEC-H1 dependency) Table-ownership audit + `kiro_migrator` role.** Approve creating a non-runtime `kiro_migrator` role, reassigning ownership of all governance tables to it, and running migrations as it going forward. Requires confirming the current owner/migration-runner identity first. | Approve | CR-01 |

## v3-10. Open Questions for Customer

| # | Question | Recommendation |
|---|----------|----------------|
| **OQ-CR-13** | **Level-2 mapping key vocabulary** — confirm the stable **event-code** vocabulary Kiro will emit (the mapping key is `event_code` ONLY; `source_ref` and text matching are rejected — PLAN-L4). | **Stable event-code** emitted by Kiro (e.g. `micro.phase2.solution_architecture_design`) keyed in `micro_artifact_mapping` — deterministic, rename-safe, language-agnostic. **Requires CR-14** (Phase-1 addition of `event_code` to the `record_progress` input, `GovernanceEventRecord`, and a nullable `governance_events.event_code` column — PLAN-M1). Kiro must emit/agree the code vocabulary. Blocks CR-12 alongside CR-OIDC. |
| **OQ-CR-14** | Authoritative **repo↔project mapping** for the CR-06 backfill. | PM-supplied mapping or one-time admin entry. |
| **OQ-CR-15** | **Auto-provision** Slack channels (`conversations.create`) vs admin pre-creates and the app only resolves ids? | Auto-provision for convenience; toggle off if the workspace restricts channel creation. |
| **OQ-CR-16** | Which micro events should hit the **micro Slack channel** (all, or a filtered subset) to control noise? | Start with a curated subset (phase transitions, artifact completions); make it configurable. |
| **OQ-CR-17** | Are GitHub **repo names unique & stable** (no renames)? | Handle renames by updating `github_repo` (admin, audited). |
| **OQ-CR-18** | Bot-token store: SSM SecureString (POC) or Secrets Manager (rotation ~$0.40/mo) + CMK (~$1/mo)? | Secrets Manager if rotation required; SSM SecureString + `aws/ssm` for POC. |
| **OQ-CR-19** | Adopt **GitHub OIDC** per-repo identity now (D-v3-8) to structurally prevent cross-project mis-attribution under the shared key? | Adopt if any non-first-party CI could hold the key; else accept POC risk + compensating controls. |

## v3-11. On Go-Ahead

0. **Pre-implementation (blocking, PLAN-M2/SEC-H1):** audit current table ownership + migration-runner identity; confirm migration-runner filename ordering (V004 lexically last); confirm the two `V002__*.sql` files converge.
1. Product Analyst adds FR-P2-033..042 (with the v3-3 ACs) + OQ-CR-13..19, changes FR-P2-019 (soft channel capture), bumps SRS version + changelog.
2. AWS Architect applies the v3-4 V004 delta (ownership reassignment, per-field trigger, dual channels, mapping) to `unified-data-model.md`, repoints the timeline join in gates/reporting docs, corrects the Phase-1 mcp-server-core DynamoDB→RDS wording + `classifyEvent` fix + `event_code` addition + invalid `CREATE USER` fix, and documents the dual-channel routing + two-token split.
3. Both re-reviewed by plan-reviewer + security-reviewer (**security re-review mandatory** for CR-01 ownership/grants/trigger, CR-05 token split, CR-08/CR-09 live tools, and CR-OIDC).
4. Technical PM opens CR-01..14 (+ CR-07 optional) per v3-8 phasing (Level-1 core now, CR-06 gating cutover, Level-2 chain CR-14→CR-OIDC→CR-12 held until OQ-CR-13 answered and D-v3-8 elects OIDC).

---


---

# V2-R2 — Round-2 Review Consolidation (2026-07-02) — AUTHORITATIVE

> **⚠️ SUPERSEDED (v3.1, PLAN-L1):** This section (and v2 below) instruct "remove/de-wire gates §5.3 macro auto-completion." **v3 verified that NO §5.3 governance→`macro_checkpoints` auto-completion write path exists in the current codebase** — completion is already app-owned via the gates §4 state machine. **Do NOT act on the "remove §5.3" instruction.** The only real Level-1 change is repointing the display-only `v_timeline` join (`jira_key`→`github_repo`). See the "v3 — Final Design of Record" section for authoritative behaviour.

> This section consolidates the round-2 reviews of the v2 design: security (S-11..S-18), plan-review (F1..F12), and capacity (Technical PM). It disposes **every** finding and, where a finding invalidates a v2 artifact, restates the **finalized** version here. Per the approval threshold, **all Critical/High are resolved in design** (0 Critical, 2 High); Medium/Low are resolved or parked with justification. Two source facts were re-verified and change the picture materially:
>
> - **DB privilege (drives S-11):** `migrations/V001__governance_events.sql` line 30 = `GRANT ALL PRIVILEGES ON DATABASE kiro_governance TO kiro_mcp`. The v2 "governance_events remains append-only" claim is therefore **FALSE at the RDS layer** — that DENY was DynamoDB-only. `kiro_mcp` today can `UPDATE`/`DELETE` events and can directly rewrite `projects.github_repo`/`slack_channel_id`, bypassing app-layer authz + audit.
> - **Persistence reality (resolves F7/P0/S-9):** `packages/mcp-server/src/tools/record-progress.ts` already imports `writeGovernanceEvent` from `../services/postgres.service` and the tool description is "Write a governance event to PostgreSQL". **The DynamoDB→RDS migration (KG-15..18, CR 2026-06-23) is already implemented in code.** The DynamoDB wording survives only in `mcp-server-core-architecture.md §3.2/§5` (doc-drift). So the "P0 prerequisite" is a **documentation correction (~3 pts), not a code migration and not a spike.**

## R2-1. High Findings — RESOLVED IN DESIGN (blocking)

### S-11 (High) — DB least-privilege & audit integrity → RESOLVED (blocking V004 prerequisite)

**Finding (verified):** `kiro_mcp` holds `GRANT ALL PRIVILEGES` (V001 line 30). The column-level `GRANT SELECT` proposed in v2 is cosmetic; the audit trail is tamper-capable and MCP can rewrite linkage columns directly.

**Resolution (design of record — SUPERSEDES the GRANT block in V2-4.3 and V2-7, and the "append-only … unchanged" note in V2-4.3):** V004 (or a dedicated grants migration applied with it) MUST re-establish least privilege for `kiro_mcp`:

```sql
-- V004 (PROPOSED) — repair kiro_mcp to least privilege (S-11). BLOCKING prerequisite for D-C.
REVOKE ALL PRIVILEGES ON DATABASE kiro_governance FROM kiro_mcp;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM kiro_mcp;

GRANT CONNECT ON DATABASE kiro_governance TO kiro_mcp;
GRANT USAGE  ON SCHEMA public             TO kiro_mcp;

-- Append-only governance_events: INSERT + SELECT only (no UPDATE/DELETE → real append-only at DB layer)
GRANT INSERT, SELECT ON governance_events                TO kiro_mcp;
GRANT USAGE, SELECT  ON SEQUENCE governance_events_id_seq TO kiro_mcp;

-- Resolve-or-reject + notify_slack routing: read-only, column-scoped, NO write on projects
GRANT SELECT (jira_key, github_repo, slack_channel_id, slack_channel_name) ON projects TO kiro_mcp;
```

- This makes append-only a **real** DB guarantee (not a claim), and makes the app-layer linkage authz+audit (FR-P2-034/039) **non-bypassable** by the MCP DB user.
- **Blocking:** D-C (no-orphan) and D-E (Slack routing) both require the MCP server to read `projects`; the REVOKE/re-grant is the correct-privilege delivery of that read and MUST land in the same migration. It is elevated from a footnote to a **hard prerequisite** of CR-08/CR-09.
- **AWS IAM unchanged** — the EC2 role already holds `rds-db:connect`; only DB-level GRANTs change.

### S-12 (High) — Cross-project isolation (shared API key + caller-asserted repo) → RESOLVED BY DECISION (default: accept POC risk + compensating controls; recommended fix: OIDC)

**Finding (verified against code):** `notify_slack` and `record_progress` trust the caller-supplied `project_id` (repo name). With a single shared MCP API key, any key holder can assert **another linked project's** repo name → post into that project's Slack channel and attribute governance events to it. **No-orphan (D-C) does NOT close this** — it only blocks *unlinked* repos; a valid other-project repo name still resolves. This is the direct answer to focus-area 3: **one project CAN post to another's channel** under the shared-key model.

**Resolution (design of record):** two paths; the customer/human must choose (see "Decision Required From Human", D-13):

- **Recommended fix — verified per-repo identity:** GitHub Actions authenticates to the MCP server via **GitHub OIDC** (short-lived token carrying the repository claim); the MCP server verifies `asserted project_id == authenticated repository`. This structurally closes S-12. Cost ~$0 (OIDC is free); effort = new story CR-11 (~5 pts, Phase 1).
- **Default if OIDC deferred — accept POC risk with compensating controls:** (a) shared API key stored in SSM SecureString, rotated; (b) all writes still gated to real projects (D-C) + append-only DB (S-11) so tampering is bounded to *insert-with-wrong-attribution*, never edit/delete; (c) Slack posts limited to channels the app itself provisioned; (d) `GovernanceEventRejected` + a new cross-attribution anomaly log. Residual risk: a key holder can mis-attribute events/notifications between **linked** projects. Acceptable only as a scoped-trust POC (all callers are first-party CI in one org).

**This High is "resolved" in the governance sense = it is explicitly surfaced as a blocking human decision (D-13) with a concrete design fix, not silently accepted.** Tracked as **OQ-CR-15**.

## R2-2. Medium Findings — RESOLVED / folded into finalized artifacts

| ID | Source | Finding (short) | Resolution (design of record) |
|----|--------|-----------------|-------------------------------|
| **F1** | plan | "Linked = MICRO recording ON" wording under-describes behaviour — macro Kiro events are also persisted (display-only). | **RESOLVED — reword.** Linkage enables recording of **all resolvable Kiro governance events** for the repo: **micro = primary signal** (surfaced + optional artifact tie), **macro = display-only** (persisted, shown on timeline, never auto-completes app gates). V2-2 table + FR-P2-040 AC are restated in R2-5 accordingly. |
| **F2** | plan | FR-P2-041 self-contradictory (AC1 "never" vs AC2 "or display-only pending OQ-CR-09"). | **RESOLVED — make unconditional.** Design of record: **Kiro macro events NEVER set `macro_checkpoints.reached_at`** (D-B, strict). Gates §5.3 macro auto-completion is **removed/de-wired**. Any "convenience auto-complete from Kiro macro" is explicitly **out of scope** (would be a separate optional future FR). OQ-CR-09 downgraded from blocking to **confirm-only** (default = display-only; it changes demoed behaviour, so confirm). FR-P2-041 AC restated in R2-5. |
| **F3** | plan | FR-P2-036 micro→`micro_artifacts` "may be marked complete" is non-deterministic (depends on unresolved OQ-CR-13) → not machine-testable. | **RESOLVED — defer artifact auto-completion out of this CR.** Design of record: micro events **surface on the timeline** (deterministic, testable). Auto-completing `micro_artifacts` is **removed from FR-P2-036** and parked as a future enhancement pending a deterministic mapping rule (OQ-CR-13). FR-P2-036 AC restated in R2-5 (no hedged bullet remains). |
| **F4** | plan | No-orphan enforced at write time only; unlink/re-point re-orphans already-stored events (silent timeline drop) — re-creates the defect. | **RESOLVED — document reverse cascade.** New edge-case rule (R2-6): if `github_repo` is later **cleared or re-pointed**, previously-stored events keyed to the old repo become non-joinable. Design: (a) the timeline join is by current `github_repo`, so old-repo events simply stop showing (documented, expected); (b) admin unlink/re-point is **audited** (`project_link_audit`) and shows a UI warning of the historical-event impact; (c) re-pointing to the same repo restores visibility. No silent behaviour — the operator is warned. Added to FR-P2-040 AC. |
| **F5** | plan | Cutover: storage + Slack become linkage-conditional; un-backfilled repos silently stop storing/notifying. CR-06 backfill not a hard predecessor. | **RESOLVED — hard dependency.** Design of record: **CR-06 (backfill of `projects.github_repo`) is a HARD PREDECESSOR of the CR-08/CR-09 cutover.** No-orphan/Slack-resolve is enabled **only after** backfill is validated for every repo currently emitting events or receiving Slack. Migration/rollout order stated in R2-7. Until backfill is validated, run the legacy behaviour (OQ-CR-12 transition fallback). |
| **F6** | plan | GRANT column set inconsistent across V2-4.3 / FR-P2-038 / V2-6 / V2-7. | **RESOLVED — one authoritative set.** The S-11 GRANT block (R2-1) is the single source of truth: `SELECT (jira_key, github_repo, slack_channel_id, slack_channel_name) ON projects`. FR-P2-038 AC updated to reference this exact column set (R2-5). |
| **S-13** | security | `chat:write`-only is not achievable — provisioning needs `conversations.create`/`conversations.list` → `channels:manage`/`channels:read`. | **RESOLVED — split scopes.** Design of record (SUPERSEDES V2-5 scope wording): the workspace app requests **runtime scope `chat:write`** and **provisioning scopes `channels:read` + `channels:manage`** (for `conversations.list`/`conversations.create`). **No `admin.*`.** Optionally split into two credentials (runtime `chat:write` bot token used by `notify_slack`; provisioning token used only by the app's link/onboarding path) so the Phase-1 `notify_slack` token cannot create/rename channels. FR-P2-039 AC restated in R2-5. |
| **S-14** | security | Single workspace token concentrates blast radius; deployed SSM policy is `/kiro-governance/*` wildcard, not single-path. | **RESOLVED — narrow IAM + rotation.** Design of record: the `notify_slack` role's `ssm:GetParameter`+`kms:Decrypt` MUST be scoped to the **single bot-token parameter ARN** (e.g. `arn:aws:ssm:*:*:parameter/kiro-governance/slack/bot-token`), NOT `/kiro-governance/*`. Bot token stored in **Secrets Manager with rotation** (~$0.40/mo) OR SSM SecureString for POC (OQ-CR-14). Bot invited only to channels it provisions (channel-scoped exposure). Restated in R2-4. |
| **S-15** | security | App-layer linkage authz+audit is correct but bypassable by direct DB UPDATE until S-11 fixed. | **RESOLVED — primarily by S-11** (REVOKE removes MCP UPDATE on `projects`). Belt-and-suspenders: add a `BEFORE UPDATE` trigger on `projects` linkage columns that writes a `project_link_audit` row for **any** mutator (captures out-of-band DB changes too). Added to V004 (R2-6). |
| **S-16** | security | `GovernanceEventRejected` uses caller-supplied repo name as a CloudWatch **dimension** → unbounded cardinality / denial-of-wallet. | **RESOLVED — dimensionless counter.** Design of record (SUPERSEDES V2-4.1 metric bullet and FR-P2-038 AC2): emit `GovernanceEventRejected` as a **dimensionless count** (no repo dimension); put the repo name in the **structured log** only. Restated in R2-5 (FR-P2-038). |

## R2-3. Low / Info Findings — applied or accepted

| ID | Source | Disposition |
|----|--------|-------------|
| **F7** | plan | **RESOLVED.** KG-17 (DynamoDB→RDS) is **already in code** (`record-progress.ts` → `postgres.service`). CR-08 is therefore **not** a re-scope of the migration — it is (a) doc-drift correction in `mcp-server-core-architecture.md §3.2/§5` and (b) the new resolve-or-reject logic. Reference the approved 2026-06-23 CR (KG-15..18). |
| **F8** | plan | **APPLIED.** Deployed gates §5.4 timeline "source 1" is `WHERE ge.project_id = $1` (param = `jira_key`) — a **filter, not a join**. Exact rewrite specified (R2-6): resolve `jira_key → github_repo` for the requested project, then filter `WHERE ge.project_id = <resolved github_repo>` (or a correlated subquery). Consistent with the L1 3-way-drift reconciliation. |
| **F9** | plan | **APPLIED.** Added explicit AC to FR-P2-040 (R2-5): an **unlinked** repo **neither stores** (`record_progress` → `no_matching_project`) **nor notifies** (`notify_slack` → `channel_not_configured`) — intended, tied to backfill sequencing (F5). |
| **F10** | plan | **APPLIED.** Before adding `V004`, confirm the migration runner's ordering/uniqueness rule (two `V002__*` files + `V003` + `V003a` already coexist). Action: verify runner sorts by full filename and that `V004__github_slack_linkage.sql` is lexically last. Added to R2-7 action items. |
| **F11** | plan | **CONFIRMED.** `projects` and `governance_events` are in the **same** RDS Postgres DB (unified data model; gates §5 reads `governance_events` directly). The S-11 GRANT includes `GRANT USAGE ON SCHEMA public` so `kiro_mcp` can resolve `projects`. One-line confirmation added (R2-6). |
| **F12** | plan | **PARKED (opportunistic).** Cross-doc engine note: Phase-1 CR = `db.t3.micro` PostgreSQL **16** single-AZ; Phase-2 unified data model line 21 says "Aurora PostgreSQL **15**." Not blocking this CR; reconcile when either doc is next touched. |
| **S-17** | security | **PARKED to customer (OQ-CR-08/OQ-CR-14).** Bot token under AWS-managed `aws/ssm` key cannot be tightly decrypt-scoped; a CMK (~$1/mo) enables scoped `kms:Decrypt`. Adopt if the workspace token is deemed sensitive. |
| **S-18** | security | **Positive (Info).** Confirmed compliant: secret never in PG/API/logs (focus-1); non-secret channel ids in PG are fine; the rejected webhook-in-PG variant stays gated behind `pgcrypto`+review; the partial `UNIQUE(github_repo)` gives structural 1:1 at the resolve lookup. No action. |

## R2-4. Finalized Slack Mechanism & Secret Handling (D-D, incorporating S-13/S-14/S-17)

**Adopt:** one workspace-level Slack app + **Bot token** + `chat.postMessage`. Rejected alternative (per-project Incoming Webhook via OAuth) remains documented in V2-5.

| Element | Store | Secret? | Scope / control |
|---------|-------|---------|-----------------|
| Bot token (`xoxb-…`) | **Secrets Manager (rotation, ~$0.40/mo)** or SSM SecureString (POC) — single workspace param | **YES** | `notify_slack` role: `ssm:GetParameter`+`kms:Decrypt` scoped to the **single token ARN only** (S-14). `PutParameter` admin/out-of-band. |
| Runtime scope | — | — | **`chat:write`** only (used by `notify_slack`). |
| Provisioning scopes | — | — | **`channels:read` + `channels:manage`** for `conversations.list`/`conversations.create` (S-13). Optionally a separate provisioning credential so the runtime token cannot create channels. **No `admin.*`.** |
| `slack_channel_id` / `slack_channel_name` | **PG `projects`** | No | Non-secret identifiers; drive `notify_slack` routing (D-E). |
| Encryption key | `aws/ssm` (default) or **CMK** (~$1/mo, OQ-CR-08/14) | — | CMK enables scoped decrypt (S-17). |

**Invariant:** the bot token / any webhook URL is NEVER a PG column, API response, or log line. PG holds only non-secret channel identifiers. If the customer insists on the rejected webhook-in-PG model, the URL column MUST be `pgcrypto`/KMS-encrypted and pass a dedicated security review.

## R2-5. Finalized FR TODO List (SUPERSEDES V2-8 where restated below)

IDs continue from FR-P2-032. Full ACs live in V2-8; the **restated** ACs below are the design of record where round-2 findings changed them.

- [ ] **FR-P2-033 — Project Unique Key: Uniqueness & Immutability** (Must) — unchanged.
- [ ] **FR-P2-034 — Project ↔ GitHub Repository Link** (Must; nullable feature switch; linkage mutation admin/leadership + audit) — unchanged.
- [ ] **FR-P2-035 — Project ↔ Slack Destination (APP-MANAGED)** (Must) — unchanged from V2-8 (bot token + per-project channel id; token is a secret in SSM/Secrets Manager, never PG).
- [ ] **FR-P2-036 — GitHub-Event Reconciliation: MICRO surfacing; MACRO app-owned** (Must) — **restated (F3):** micro events **surface on the timeline** (source `kiro_mcp`); Kiro **macro** events are display-only and do **not** set `macro_checkpoints.reached_at`; macro completion is settable only via in-app triggers. **Micro→`micro_artifacts` auto-completion is removed from this CR** (parked, OQ-CR-13). No non-deterministic AC remains.
- [ ] **FR-P2-037 — MCP Governance Logs Visible Per Project** (Must) — unchanged (join repointed to `github_repo`).
- [ ] **FR-P2-038 — No-Orphan Governance Event Storage** (Must) — **restated (S-11/S-16/F6):**
  - `record_progress` resolves `SELECT jira_key FROM projects WHERE github_repo = $1 LIMIT 1` (both macro and micro); 0 rows → **not written**, returns `{ written:false, reason:'no_matching_project' }`.
  - On reject, emit a **dimensionless** `GovernanceEventRejected` counter (no repo dimension) + a structured log entry containing the repo name (S-16). **No orphan row stored.**
  - `kiro_mcp` privileges are exactly: `INSERT, SELECT ON governance_events` (+ sequence), `SELECT (jira_key, github_repo, slack_channel_id, slack_channel_name) ON projects`, `GRANT ALL` revoked (S-11). No UPDATE/DELETE anywhere.
- [ ] **FR-P2-039 — App-Managed Slack Provisioning** (Must) — **restated (S-13/S-14):** workspace app with `chat:write` (runtime) + `channels:read`/`channels:manage` (provisioning), no `admin.*`; provision channel if missing; store `slack_channel_id`; token read with least-privilege on the single token ARN.
- [ ] **FR-P2-040 — Optional Linkage Feature Switch** (Must) — **restated (F1/F4/F9):** linked = recording of **all resolvable Kiro events** (micro primary, macro display-only) + Slack routing ON; unlinked = **neither stores nor notifies**, identical to today; **reverse cascade:** clearing/re-pointing `github_repo` stops old-repo events from surfacing, is audited, and warns the operator of the historical-event impact.
- [ ] **FR-P2-041 — MACRO Gate Ownership** (Must) — **restated (F2):** macro checkpoint `reached_at` is set **only** by in-app human/computed triggers; Kiro macro events **never** set it; gates §5.3 macro auto-completion is **removed/de-wired** (unconditional — OQ-CR-09 is confirm-only, default display-only).

## R2-6. Finalized V004 Data-Model Delta (SUPERSEDES V2-7 GRANT block; augments V2-7)

The V2-7 column set (`github_repo`, `github_url`, `slack_channel_id`, `slack_channel_name`, `updated_by`, `updated_at`), partial unique index, and `project_link_audit` table are unchanged. The finalized delta **replaces the GRANT block** with the S-11 least-privilege repair and **adds** the S-15 audit trigger, F8 timeline rewrite, and F4/F11 notes:

```sql
-- V004__github_slack_linkage.sql (PROPOSED, v2.1) — finalized delta

-- (A) Columns + partial unique index + project_link_audit: as V2-7 (unchanged).

-- (B) S-11 — repair kiro_mcp to least privilege (REPLACES the V2-7 "GRANT SELECT (...)" line).
REVOKE ALL PRIVILEGES ON DATABASE kiro_governance FROM kiro_mcp;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM kiro_mcp;
GRANT CONNECT ON DATABASE kiro_governance TO kiro_mcp;
GRANT USAGE  ON SCHEMA public             TO kiro_mcp;                          -- F11: schema USAGE for projects resolve
GRANT INSERT, SELECT ON governance_events                TO kiro_mcp;          -- real append-only (no UPDATE/DELETE)
GRANT USAGE, SELECT  ON SEQUENCE governance_events_id_seq TO kiro_mcp;
GRANT SELECT (jira_key, github_repo, slack_channel_id, slack_channel_name) ON projects TO kiro_mcp;  -- F6 authoritative set

-- (C) S-15 — audit ANY change to linkage columns (belt-and-suspenders beyond app-layer authz).
CREATE OR REPLACE FUNCTION trg_audit_project_linkage() RETURNS trigger AS $$
BEGIN
  IF NEW.github_repo IS DISTINCT FROM OLD.github_repo
     OR NEW.slack_channel_id IS DISTINCT FROM OLD.slack_channel_id
     OR NEW.slack_channel_name IS DISTINCT FROM OLD.slack_channel_name
     OR NEW.github_url IS DISTINCT FROM OLD.github_url THEN
    INSERT INTO project_link_audit (project_id, field, old_value, new_value, actor_sub)
    VALUES (NEW.jira_key, 'linkage_change',
            OLD.github_repo || '|' || COALESCE(OLD.slack_channel_id,''),
            NEW.github_repo || '|' || COALESCE(NEW.slack_channel_id,''),
            COALESCE(NEW.updated_by, 'db_direct'));
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_project_linkage
  BEFORE UPDATE ON projects
  FOR EACH ROW EXECUTE FUNCTION trg_audit_project_linkage();
```

- **F8 — timeline rewrite (exact):** gates §5.4 "source 1" changes from `WHERE ge.project_id = $1` (param = `jira_key`) to: resolve the requested project's `github_repo`, then `WHERE ge.project_id = (SELECT github_repo FROM projects WHERE jira_key = $1)`. If `github_repo IS NULL` → the subquery yields NULL → zero governance rows (correct: unlinked shows none). `v_timeline` (V003 inner join) is repointed to `ON p.github_repo = ge.project_id`.
- **F4 — reverse cascade (data-model note for `unified-data-model.md §8`):** the join keys on **current** `github_repo`; clearing/re-pointing it stops old-repo events surfacing (documented, audited via the trigger, operator-warned). No replay unless OQ-CR-10 adopted.
- **F11:** `projects` and `governance_events` are confirmed co-resident in the same DB; `GRANT USAGE ON SCHEMA public` covers the resolve read.

## R2-7. Finalized Backlog & Phasing (SUPERSEDES V2-9 backlog + capacity v2, adjusted for F7)

Capacity v2 sized total **49 pts** assuming P0 might be a real DynamoDB migration. **F7 confirms P0 is doc-drift only (~3 pts, no spike)** → the total holds but the highest-risk P0 uncertainty is removed. New story **CR-11 (OIDC, S-12)** is added but conditional on D-13.

| Story | Pts | Scope (finalized) | Depends on |
|-------|-----|-------------------|-----------|
| **P0** | 3 | Doc-drift correction: `mcp-server-core-architecture.md §3.2/§5` DynamoDB→RDS (code already RDS — F7). No spike. | — |
| **CR-01** | 3 | V004 migration: columns + partial unique index + `project_link_audit` + **S-11 REVOKE/re-grant** + **S-15 audit trigger**; drop `slack_webhook_ssm_path`. | Approval; OQ-CR-02 (=1:1, resolved) |
| **CR-02** | 5 | `projects` API retrofit: fields+validation, 409 `DUPLICATE_GITHUB_REPO`, 422 `IMMUTABLE_FIELD`, 403 linkage authz (admin/leadership, Cognito-sub), audit, TS types+OpenAPI, tests. | CR-01 |
| **CR-05** | 8 | App-managed Slack: workspace app, bot token → SSM/Secrets Manager, `chat:write`+`channels:read/manage` (S-13), `conversations.list/create`, store channel id, single-ARN IAM scope (S-14), provisioning UI. | CR-01, CR-02 |
| **CR-03** | 8 | Repoint timeline to `github_repo` (F8 exact rewrite) + **remove macro auto-completion** (D-B, gates §5.3) + keep §5.4 union + reconcile reporting 3-way drift + E2E. Highest Phase-2 risk. | CR-01 |
| **CR-04** | 4 | Onboarding soft-capture `slack_channel_id`. | CR-02 |
| **CR-08** | 5 | `record_progress` resolve-or-reject + dimensionless `GovernanceEventRejected` (S-16) + RDS read. **Requires S-11 GRANT (CR-01).** | P0, CR-01 |
| **CR-09** | 5 | `notify_slack` per-project PG resolve (`slack_channel_id`) + `chat.postMessage` + bot token from SSM + optional legacy-webhook fallback. | CR-01, CR-05 |
| **CR-06** | 3 | Backfill `projects.github_repo` + validation report + drop transition fallback. **HARD PREDECESSOR of CR-08/CR-09 cutover (F5).** BLOCKED on OQ-CR-06 (mapping data). | CR-02 |
| **CR-10** | 2 | Feature-switch integration tests (linked/unlinked no-regression; unlinked neither stores nor notifies — F9). | CR-03, CR-08, CR-09 |
| **CR-11** | 5 | *(Conditional on D-13)* GitHub OIDC per-repo identity; verify asserted repo == authenticated repo (S-12). Phase 1. | CR-08, CR-09 |
| **CR-07** | 3 | *(Defer, Could-Have)* Rejected-writes metric/dashboard. | CR-08 |

**Ordering / cutover rule (F5, finalized):** `Approval + OQ-CR-02 → P0 & CR-01 → CR-02 → {CR-04, CR-05→CR-09}` and `CR-01 → CR-03`; **CR-06 backfill MUST complete and validate BEFORE CR-08/CR-09 no-orphan + Slack-resolve are switched on.** Until then, legacy behaviour runs behind the OQ-CR-12 transition fallback. CR-10 needs CR-03+CR-08+CR-09. CR-11 only if D-13 = OIDC.

**Phasing (~20 pts/week, single dev):**
- **Week 1 (~19):** P0 (3) + CR-01 (3, includes S-11/S-15) + CR-02 (5) + CR-04 (4) + start CR-06 backfill prep.
- **Week 2 (~21):** CR-05 (8) + CR-09 (5) + CR-03 (8) — with CR-08 gated behind validated CR-06 backfill.
- **Week 3 (2–13):** CR-08 (5, after backfill) + CR-10 (2); then CR-11 (5, if D-13=OIDC) and/or CR-07 (3, if adopted).

**Implement-now core (~43 pts):** P0, CR-01, CR-02, CR-03, CR-04, CR-05, CR-06, CR-08, CR-09, CR-10. **~$0/mo incremental** (bot token reduces secret sprawl; Secrets Manager rotation optional ~$0.40/mo; CMK optional ~$1/mo). **Mandatory:** a dedicated Phase-1 review pass + staged rollout on CR-08/CR-09 (live tools), and a **security re-review** pass (CR-01 S-11/S-15, CR-05 token, CR-08/09) before implementation.

**Action items before implementation (F10/F11/F12):**
- [ ] Confirm migration runner orders by full filename (V004 lexically last) — F10.
- [ ] Confirm `kiro_mcp` schema `USAGE` after REVOKE (F11) — covered by the R2-6 GRANT.
- [ ] Opportunistically reconcile the `db.t3.micro PG16` vs `Aurora PG15` cross-doc note — F12.

## R2-8. Finalized Open Questions (SUPERSEDES V2-10 additions)

Resolved (closed): OQ-CR-01 (nullable — YES), OQ-CR-02 (1:1 — YES), OQ-CR-09 (default display-only, confirm-only), OQ-CR-13 (artifact auto-complete **deferred out of scope** — no longer blocks any AC).

| # | Question | Recommendation |
|---|----------|----------------|
| **OQ-CR-15 (NEW, S-12)** | Accept the shared-key cross-project attribution risk for the POC, or adopt **GitHub OIDC** per-repo identity now (CR-11)? | Adopt OIDC if any non-first-party CI could hold the key; else accept POC risk with compensating controls (R2-1). **Blocking human decision — D-13.** |
| **OQ-CR-16 (NEW, S-security)** | Auto-provision Slack channels (`conversations.create`) vs admin pre-creates channels and the app only resolves ids? | Auto-provision for convenience; make it a toggle if the workspace restricts channel creation. |
| OQ-CR-09 | Kiro macro events display-only vs still auto-complete app gates? | **Display-only (default, D-B).** Confirm — changes demoed behaviour. |
| OQ-CR-10 | Replay rejected (no-match) events when a repo is later linked? | No — hard reject; re-emit from source if needed. |
| OQ-CR-11 | Should **micro** events trigger Slack, or macro-only (as today — code skips micro)? | Macro to Slack; micro off Slack by default (avoid noise). |
| OQ-CR-12 | Legacy per-repo webhook fallback during Slack cutover? | Yes — short transition window, retire after CR-06 backfill validated. |
| OQ-CR-14 | Bot token in SSM SecureString (default) or Secrets Manager (rotation ~$0.40/mo)? | Secrets Manager if rotation required; SSM SecureString for POC. |
| OQ-CR-08 | Customer-managed CMK (~$1/mo) for the bot-token param for scoped `kms:Decrypt` (S-17)? | Adopt if the token is deemed sensitive; else `aws/ssm`. |
| OQ-CR-05 (retained) | GitHub repo names unique & stable (no renames)? | Handle renames by updating `github_repo` (admin, audited). |
| OQ-CR-06 (retained) | Authoritative repo↔project mapping for backfill (CR-06 blocker). | PM-supplied mapping or one-time admin entry. |

## R2-9. Decision Required From Human (round-2 sign-off gate)

The v1/v2 decisions in §9 (D1–D12) still stand. Round 2 adds/updates:

| # | Decision needed | Default if unanswered | Blocks |
|---|-----------------|-----------------------|--------|
| **D13** | **S-12 cross-project isolation:** adopt **GitHub OIDC** per-repo identity (CR-11, ~5 pts, closes the High) **or** explicitly **risk-accept** the shared-key model for the POC with compensating controls? | **Risk-accept for POC** (first-party CI only) + track CR-11 as fast-follow. This is a **High** — requires explicit human sign-off either way. | CR-11; security re-review sign-off |
| **D14** | **S-11 confirmation:** approve the `kiro_mcp` `REVOKE ALL` + least-privilege re-grant (real append-only, MCP loses UPDATE/DELETE and `projects` write). Any tooling relying on the broad grant must be identified first. | Approve (no known tooling relies on the broad grant; code writes only via INSERT). | CR-01; CR-08/CR-09 |
| **D15** | **Cutover gating (F5):** confirm CR-06 backfill is a hard predecessor of the CR-08/CR-09 no-orphan + Slack cutover (un-backfilled repos stop storing/notifying otherwise). | Approve — gate cutover behind validated backfill. | CR-08/CR-09 go-live |
| **D16** | **OQ-CR-09 (F2):** confirm Kiro macro events become **display-only** (removes the demoed "progress-MD → gate done" auto-completion). | Display-only (strict D-B). | CR-03 (macro de-wire) |
| **D17** | **Secret store / key (S-14/S-17, OQ-CR-14/08):** Secrets Manager+rotation and/or CMK, or SSM SecureString + `aws/ssm` for POC? | SSM SecureString + `aws/ssm` for POC; upgrade if token deemed sensitive. | CR-05 (non-blocking; default proceeds) |

**On approval:** Product Analyst adds/updates FR-P2-033..041 (with the R2-5 ACs) + OQ-CR-01..16; AWS Architect applies the R2-6 V004 delta (incl. S-11 REVOKE/re-grant + S-15 trigger + F8 rewrite) to `unified-data-model.md` and the join repoints in gates/reporting docs, plus the P0 DynamoDB→RDS doc-drift correction; both re-reviewed by plan-reviewer + security-reviewer; Technical PM opens CR-01..11 per R2-7 phasing (core now, CR-06 gating cutover, CR-07/CR-11 conditional).

---

# v2 Customer Decisions & Design Delta (2026-07-02) — AUTHORITATIVE

> **⚠️ SUPERSEDED (v3.1, PLAN-L1):** The V2-3 "Remove/repoint gates §5.3 macro auto-completion" instruction is stale — **no §5.3 auto-completion path exists** (verified in v3). Macro completion is already app-owned. Ignore the removal instruction; see the v3 Final Design of Record.

> This section is the current design of record. It integrates the five confirmed customer decisions of 2026-07-02 and **supersedes** the v1 TODO FR list (§4), data-model delta (§5), affected-docs list (§6.1), and open questions (§8) where noted. The v1 body (§0 onward) is retained for audit.

## V2-1. The Five Confirmed Decisions

| # | Decision (confirmed 2026-07-02) | Net effect vs v1 |
|---|--------------------------------|------------------|
| **D-A** | **Linkage is OPTIONAL and is the feature switch.** `projects.github_repo` is nullable, 1:1 per project (**Variant A confirmed** — resolves v1 OQ-CR-02/D2). If `github_repo` is attached → Kiro **MICRO** governance events are recorded against that project. If not attached → current app-only architecture is unchanged. | Confirms v1 Variant A (1:1). Adds explicit conditional behaviour (feature switch). Variant C (1:N) is now **dropped** from scope. |
| **D-B** | **MACRO gates stay app-owned / human-approved inside DeliverPro. MICRO gates are the external Kiro-driven signal** mapped in via GitHub + MCP. | **Changes v1.** The v1 design auto-completed `macro_checkpoints` from Kiro **macro** governance events (gates §5.3). v2 makes macro completion app-owned; the external signal that DeliverPro ingests is **micro**. See V2-3. |
| **D-C** | **HARD NO-ORPHAN RULE.** A governance event is persisted **only** if it maps to an existing project (`projects.github_repo = event repo name`). If no project matches → **not stored**. Enforced in the MCP `record_progress` write path (resolve-or-reject) using the server's existing RDS access. | **New in v2, larger blast radius.** v1 kept Phase 1 unchanged and did read-side reconciliation. v2 moves enforcement to the **write path** — a Phase 1 `record_progress` change. |
| **D-D** | **App-managed Slack.** DeliverPro authenticates Slack **once at workspace level** (single Slack app + **Bot token** + `chat.postMessage`), provisions a per-project channel if missing, and stores `slack_channel_id` in PG (non-secret). Bot token is a **secret** in SSM SecureString / Secrets Manager — never plaintext in PG. | **Changes v1.** v1 stored a per-repo webhook SSM path reference. v2 replaces the per-repo Incoming-Webhook model with one workspace Bot token + per-project channel id. Webhook-via-OAuth is documented as the **rejected** alternative (V2-5). |
| **D-E** | **`notify_slack` resolves the destination per project from PG** (`slack_channel_id`) instead of the SSM-path-keyed-by-repo-name convention. | **Changes v1 + Phase 1.** v1 explicitly kept `notify_slack` unchanged (H1). v2 reverses that: `notify_slack` is now a Phase 1 change. Blast radius assessed in V2-6. |

**Target flow encoded by v2:**

```
Project exists (optional github_repo + Slack channel)
   → DeliverPro provisions/stores Slack destination (channel id in PG; bot token in SSM)
      → Kiro emits MICRO events via GitHub + MCP
         → MCP record_progress resolves repo → project (projects.github_repo)
            → stores ONLY if a project matches (no-orphan); else reject (not stored)
               → reporting/timeline surfaces MICRO gates on DeliverPro
                  → MACRO gates remain managed/approved in-app (human approval)
```

---

## V2-2. Conditional Behaviour — Linkage as Feature Switch (D-A)

The presence of `projects.github_repo` is the on/off switch for external governance recording:

| Project state | Kiro MICRO recording | `notify_slack` routing | MACRO gates | Timeline |
|---------------|---------------------|------------------------|-------------|----------|
| **`github_repo` attached** (linked) | **ON** — micro events whose repo = `github_repo` are stored against the project | Resolves the project's `slack_channel_id` (D-E) | App-owned human approval (unchanged) | Shows micro governance events (source `kiro_mcp`) interleaved with in-app checkpoints |
| **`github_repo` NULL** (unlinked) | **OFF** — no Kiro event resolves to this project; incoming events for an unknown repo are rejected (no-orphan) | No external Slack routing for this project | App-owned human approval (unchanged) | Shows only DeliverPro-native events (checkpoints, evidence) — **identical to today** |

**Key property:** an unlinked project behaves exactly as the current architecture. No regression. Linking a repo is the single action that turns on micro recording + Slack routing for that project. This must be an explicit, testable AC (FR-P2-040).

---

## V2-3. Macro (app-owned) vs Micro (external Kiro signal) — Reconciliation (D-B)

This precisely reconciles v2 against the deployed **gates §5.3** auto-completion (which today sets `macro_checkpoints.reached_at` from **macro** `governance_events`) and the **§5.4** timeline union.

### What AUTO-RECONCILES from `governance_events` under v2

| Item | v1 behaviour | v2 behaviour | Rationale |
|------|-------------|-------------|-----------|
| **MICRO events → timeline** | Surfaced (all events on timeline) | **Surfaced (primary external signal).** Micro events for the linked repo appear on the project timeline (source `kiro_mcp`). | D-B: micro is the external signal. |
| **MICRO events → `micro_artifacts`** | Not wired | **Optional, recommended:** a micro event may mark the matching `micro_artifacts` row complete (best-effort, name/phase match). Micro artifacts are Kiro-produced deliverables — this is the natural home for the micro signal. | D-B; `micro_artifacts` already models Kiro deliverables (V002). |
| **MACRO checkpoints (`reached_at`)** | **Auto-set from Kiro macro governance events** (§5.3) | **NO LONGER auto-set from Kiro macro events.** `macro_checkpoints.reached_at` is set only by **in-app** triggers: `human_review`, `meeting`, `transcript_analysis`, `checklist` (gates §4.1–4.4) — all human-driven/app-computed. | D-B: MACRO gates are app-owned/human-approved. |
| **Kiro MACRO governance events** | Auto-complete checkpoints (§5.3) | **Display-only on the timeline** (informational, source `kiro_mcp`). They do **not** write `macro_checkpoints`. | D-B. Removes the §5.3 `governance_events → macro_checkpoints` write. |

### Design consequence

- **Remove/repoint gates §5.3** (the `UPDATE macro_checkpoints … FROM governance_events` and `reconcileGovernanceEvents()`): under v2 this macro auto-completion is **removed**. `GATE_TO_CHECKPOINT` mapping is retained only if the customer still wants Kiro macro events to *inform* (display) the timeline — it no longer drives completion.
- **§5.4 timeline union is kept** (micro + macro governance events both display), repointed to the `github_repo` join (V2-8).
- **`v_gate_completion` / `v_project_summary`** now reflect **only** app-owned macro completions — arguably more accurate to "human-approved gates."

> ⚠️ **Residual ambiguity → OQ-CR-09 (V2-10):** Should Kiro **macro** events be *display-only* (recommended, per strict reading of D-B) or should they still *auto-complete* app macro checkpoints as a convenience? v2 designs for **display-only**; flagged for confirmation because it changes demoed behaviour ("progress-MD change dragged in as a gate").

---

## V2-4. No-Orphan Rule — Resolve-or-Reject Write Path (D-C)

### Current state (verified)

- `governance_events` (migration `V001__governance_events.sql`) is an **RDS/Postgres** table with `project_id TEXT NOT NULL` and **no foreign key** → **orphan events are stored today** (any `project_id` is accepted).
- The MCP `record_progress` handler (`mcp-server-core-architecture.md §3.2`) writes via `writeGovernanceEvent(dynamoClient, …)` — the doc still describes **DynamoDB** persistence, which contradicts V001 (RDS) and the unified data model (RDS). **This drift (v1 finding S-9) is now a design prerequisite** (see V2-4.4).

### v2 design — resolve-or-reject in `record_progress`

Insert a **resolve step before the write** in the `record_progress` handler:

```
record_progress(input)
  │
  ├─ 1. classify (macro/micro) — unchanged
  │
  ├─ 2. RESOLVE project: SELECT jira_key FROM projects WHERE github_repo = input.project_id
  │        │
  │        ├─ 0 rows  ──▶  REJECT: do NOT write. Return { written:false, reason:'no_matching_project' }.
  │        │                 Emit metric ChatOps/CloudWatch: GovernanceEventRejected (dimension: repo).
  │        │
  │        └─ 1 row   ──▶  proceed
  │
  ├─ 3. dedup (macro only) — unchanged
  │
  └─ 4. write governance_event (RDS) — unchanged shape (project_id stays the repo name)
```

### V2-4.1 Decision: hard reject vs dead-letter — **HARD REJECT (justified)**

The customer's rule is absolute ("if no project matches, it is NOT stored"). Therefore:

- **Hard reject** — the event is **not persisted** to `governance_events`. No orphan rows ever exist. This is the only design consistent with D-C.
- **Observability without storage:** rejection is surfaced via (a) a distinct return reason `no_matching_project` to the caller (GitHub Actions / agent hook log it), and (b) a **CloudWatch metric + structured log** (`GovernanceEventRejected`, dimension = repo name). This preserves the *intent* of the v1 CR-07 "unmatched count" **without** storing orphans. *(⚠️ **SUPERSEDED by R2-2 (S-16):** the metric must be a **dimensionless** counter — do NOT use the caller-supplied repo name as a CloudWatch dimension (unbounded cardinality / denial-of-wallet under shared-key abuse). Put the repo name in the **structured log only**.)*
- **CR-07 re-scoped:** v1 CR-07 was an admin **DB query** over stored orphan rows. Under no-orphan there are no orphan rows, so CR-07 becomes an **operational metric/dashboard** (count of rejected writes), not a DB view. (See V2-9 backlog.)

> **Why not dead-letter?** A dead-letter store (separate table/queue of unmatched events) would re-introduce orphan storage under a different name and contradict D-C. The metric+log path gives the same visibility with zero orphan persistence. If the customer later wants replay-on-link (a rejected event auto-appearing once its repo is linked), that requires storing rejected events → revisit D-C. Flagged as **OQ-CR-10**.

### V2-4.2 Exact resolve query

```sql
-- Executed by the MCP record_progress handler before writing the event.
-- Parameter $1 = input.project_id (the GitHub repository name from the event).
SELECT jira_key
FROM   projects
WHERE  github_repo = $1
LIMIT  1;
```

- Uses the **partial unique index** `uq_projects_github_repo (github_repo) WHERE github_repo IS NOT NULL` (V2-7) → O(log n) point lookup.
- `github_repo` is UNIQUE (1:1, D-A) → at most one row. Empty result → reject.
- Applies to **both** macro and micro events (all writes are gated).

### V2-4.3 IAM & database privilege (MCP server)

The MCP server already connects to RDS as DB user `kiro_mcp` via RDS IAM auth (`V001`: `GRANT rds_iam TO kiro_mcp`; `GRANT ALL PRIVILEGES ON DATABASE kiro_governance`). To add the resolve read under least-privilege, make the `projects` SELECT explicit:

```sql
-- PROPOSED (part of V004 or a grants migration) — least-privilege read for resolve-or-reject
GRANT SELECT (jira_key, github_repo) ON projects TO kiro_mcp;
```

> ⚠️ **SUPERSEDED by R2-1 (S-11):** this GRANT alone is **insufficient and misleading** — `kiro_mcp` already holds `GRANT ALL PRIVILEGES` (V001 line 30), so it can UPDATE/DELETE `governance_events` and rewrite `projects`. The finalized V004 must first `REVOKE ALL` and re-grant `INSERT, SELECT ON governance_events` (no UPDATE/DELETE) + `SELECT (jira_key, github_repo, slack_channel_id, slack_channel_name) ON projects`. See R2-1 / R2-6. The "governance_events remains append-only … unchanged" note below is FALSE at the RDS layer until that REVOKE lands.

- **AWS IAM:** unchanged — the EC2 instance role already holds `rds-db:connect` for the `kiro_mcp` DB user; no new IAM policy is required for the read. Only the **DB-level GRANT** is added (or is already covered by the existing broad grant — tighten to column-level SELECT as above).
- No write privilege is added; `governance_events` remains append-only (Phase 1 IAM DENY on Update/Delete unchanged).

### V2-4.4 Prerequisite: reconcile `record_progress` persistence to RDS (upgrades S-9)

Because the resolve step is a **SQL SELECT against Postgres `projects`**, the `record_progress` write path must operate against **RDS** (as V001 and the unified data model already specify), not DynamoDB. The stale DynamoDB description in `mcp-server-core-architecture.md §3.2/§5` must be corrected to RDS as part of this CR. **This is now blocking for D-C** (was v1 Low finding S-9).

---

## V2-5. App-Managed Slack Integration (D-D)

### Recommended mechanism (adopt): one Slack app + Bot token + `chat.postMessage`

| Element | Where it lives | Secret? |
|---------|----------------|---------|
| Single Slack app authorized once at **workspace** level | Slack workspace (OAuth consent by admin, one time) | — |
| **Bot token** (`xoxb-…`) | **SSM SecureString** (single workspace-level param, e.g. `/kiro-governance/slack/bot-token`) or Secrets Manager | **YES — secret** |
| Per-project **`slack_channel_id`** (e.g. `C0123ABCD`) | **PG** `projects.slack_channel_id` | No (non-secret identifier) |
| Per-project channel **display name** (e.g. `#deliverpro-delivery`) | **PG** `projects.slack_channel_name` (optional, display) | No |
| Channel **provisioning** (create if missing) | DeliverPro app at link/onboarding time (`conversations.list` → `conversations.create`) | uses bot token from SSM |

**Flow:** DeliverPro (Phase 2) provisions/stores the channel at link time → `notify_slack` (Phase 1) reads `slack_channel_id` from PG + bot token from SSM → `POST https://slack.com/api/chat.postMessage` with `{ channel: <slack_channel_id>, text }`.

**Why recommended:** one credential to rotate (not one webhook per repo); channel id is a stable non-secret; `chat.postMessage` supports richer formatting and delivery-status responses; provisioning is programmatic.

### Rejected / secondary alternative (documented): Incoming Webhook via OAuth

| Aspect | Incoming Webhook (rejected) | Bot token + `chat.postMessage` (recommended) |
|--------|-----------------------------|-----------------------------------------------|
| Credential model | **One secret webhook URL per channel** | **One bot token** for the whole workspace |
| Channel selection | Requires a **per-project OAuth consent** flow that binds the webhook to a channel chosen during consent — high friction, not "authenticate once" | Channel chosen programmatically at link time; no per-project OAuth |
| Secret sprawl | N webhook URLs (one per project) — more secrets to store/rotate | 1 token |
| PG storage risk | Tempting to store the webhook URL in PG (**prohibited** — it is a secret) | PG stores only a non-secret channel id |
| Provisioning | Cannot create channels; admin must pre-create + re-consent | `conversations.create` provisions on demand |
| Verdict | ❌ Rejected — contradicts "authenticate once at workspace level" and multiplies secrets | ✅ Adopted |

### CRITICAL security constraint (mandatory)

- The **bot token / any webhook URL is a secret** → **SSM SecureString or Secrets Manager only**. It must **never** be a plaintext PG column, never returned by an API, never logged.
- PG holds **only** `slack_channel_id` (+ optional `slack_channel_name`) — both non-secret.
- **If the customer insists on storing a webhook URL in PG** (the rejected model): it must be **encrypted at the column level via `pgcrypto` (KMS-backed key)** and is **flagged for mandatory security review**. Default design does not do this.
- Least-privilege: Phase 1 `notify_slack` role gets `ssm:GetParameter` + `kms:Decrypt` on the **single bot-token path only** (tighter than the v1 `/…/webhooks/*` wildcard — a blast-radius reduction, resolves the spirit of v1 S-7). `ssm:PutParameter` remains admin/out-of-band.

---

## V2-6. `notify_slack` Change & Blast-Radius (D-E)

### Current (`mcp-server-core-architecture.md §3.1`)

```typescript
const ssmPath = `/kiro-governance/slack/webhooks/${input.project_id}`;   // per-repo webhook
webhookUrl = (await ssm.GetParameter(ssmPath)).Value;
await fetch(webhookUrl, { method:'POST', body: JSON.stringify({ text }) });
```

### Proposed v2 lookup

```
notify_slack(input)
  ├─ event_type == micro?  → per D-B, micro is the primary external signal.
  │     (Confirm notification policy — see OQ-CR-11. Today macro→Slack, micro skipped.
  │      If micro events should notify Slack, this branch changes.)
  │
  ├─ 1. RESOLVE project + channel:
  │        SELECT jira_key, slack_channel_id
  │        FROM projects WHERE github_repo = input.project_id;
  │        - 0 rows OR slack_channel_id IS NULL → { notified:false, reason:'channel_not_configured' }
  │
  ├─ 2. GET bot token from SSM SecureString (cached; single workspace param)
  │
  └─ 3. POST https://slack.com/api/chat.postMessage { channel: slack_channel_id, text }
           - Slack API returns { ok:false, error } → { notified:false, reason:`slack_error:${error}` }
```

### Blast radius (Phase 1)

| Area | Impact | Mitigation |
|------|--------|-----------|
| `notify_slack` handler | **Changed** — new PG resolve + Slack Web API call instead of webhook POST | New unit/integration tests; the tool signature (`project_id`, `message`, `event_type`) is unchanged so callers (agent hook, GitHub Actions) need no change |
| MCP server RDS access | Now also reads `projects` in `notify_slack` (in addition to `record_progress`) | Same `GRANT SELECT (jira_key, github_repo, slack_channel_id) ON projects` |
| SSM params | From N per-repo webhooks → 1 workspace bot token | Simpler secret management; migrate/retire old webhook params |
| Existing configured repos | Old `/…/webhooks/{repo}` params become unused | **Backward-compat path (optional):** if `slack_channel_id` is NULL but a legacy webhook param exists, fall back to the old webhook POST during a transition window; log a deprecation warning. Retire after cutover. See OQ-CR-12. |
| `record_progress` ↔ `notify_slack` sequencing | Unchanged — caller still calls `notify_slack` only after `record_progress` returns `written:true` | No change |

> **Note:** With D-C (no-orphan), a `notify_slack` call for an unmatched repo would also resolve to 0 rows → `channel_not_configured`. This is consistent — unlinked projects neither store events nor notify.

---

## V2-7. Updated Data-Model Delta — V004 (SUPERSEDES §5.1)

> PROPOSED migration `V004__github_slack_linkage.sql` + edits to `unified-data-model.md`. **Not applied.** 1:1 (Variant A) confirmed → Variant C (§5.2) is dropped.

```sql
-- V004 (PROPOSED, v2) — optional GitHub linkage + app-managed Slack destination

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS github_repo        TEXT,        -- GitHub repo name; matches governance_events.project_id; FEATURE SWITCH (D-A)
  ADD COLUMN IF NOT EXISTS github_url         TEXT,        -- full HTTPS repo URL (display)
  ADD COLUMN IF NOT EXISTS slack_channel_id   TEXT,        -- Slack channel id, e.g. 'C0123ABCD' (non-secret) — app-managed destination (D-D)
  ADD COLUMN IF NOT EXISTS slack_channel_name TEXT,        -- display name, e.g. '#deliverpro-delivery' (non-secret, optional)
  ADD COLUMN IF NOT EXISTS updated_by         TEXT,        -- Cognito sub of last mutator (audit)
  ADD COLUMN IF NOT EXISTS updated_at         TIMESTAMPTZ; -- last mutation timestamp (audit)

-- 1:1 repo ↔ project; partial unique tolerates multiple NULLs (unlinked projects).
-- ALSO serves the record_progress resolve lookup (V2-4.2).
CREATE UNIQUE INDEX IF NOT EXISTS uq_projects_github_repo
  ON projects (github_repo) WHERE github_repo IS NOT NULL;

-- Least-privilege read for the MCP server's resolve-or-reject + notify_slack lookup (V2-4.3 / V2-6).
GRANT SELECT (jira_key, github_repo, slack_channel_id, slack_channel_name) ON projects TO kiro_mcp;

-- Optional full audit trail for linkage changes (else updated_by/updated_at suffice).
CREATE TABLE IF NOT EXISTS project_link_audit (
  id          BIGSERIAL   PRIMARY KEY,
  project_id  TEXT        NOT NULL REFERENCES projects(jira_key) ON DELETE CASCADE,
  field       TEXT        NOT NULL,   -- 'github_repo' | 'github_url' | 'slack_channel_id' | 'slack_channel_name'
  old_value   TEXT,
  new_value   TEXT,
  actor_sub   TEXT        NOT NULL,
  changed_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_project_link_audit_project ON project_link_audit (project_id);
```

### Columns (v2)

| Column | Type | Nullable | Secret? | Purpose | Change vs v1 |
|--------|------|----------|---------|---------|--------------|
| `github_repo` | `TEXT` | yes (partial UNIQUE) | no | Reconciliation key + **feature switch**; used by MCP resolve (V2-4.2) | **Confirmed** (Variant A) |
| `github_url` | `TEXT` | yes | no | Clickable repo link | Unchanged |
| `slack_channel_id` | `TEXT` | yes | no | App-managed Slack destination; used by `notify_slack` (V2-6) | **NEW mechanism** — replaces `slack_webhook_ssm_path` |
| `slack_channel_name` | `TEXT` | yes | no | Human-readable channel for display | **NEW** |
| `updated_by` / `updated_at` | `TEXT` / `TIMESTAMPTZ` | yes | no | Linkage-change audit | Unchanged |

**Dropped from v1:** `slack_webhook_ssm_path` is **removed** from the recommended design (app-managed bot token supersedes per-repo webhook). It is retained **only** if the customer chooses the rejected webhook alternative — in which case it stores a validated non-secret **path**, and the URL itself stays in SSM (never PG).

**Never stored in PG:** the Slack **bot token** (workspace secret → SSM SecureString / Secrets Manager) and any webhook URL. Any GitHub token (none required for the core fix).

### No-orphan enforcement (data-model note)

- Enforced in the **application** (`record_progress` write path, V2-4) — not a DB FK, because an FK cannot target a **partial** unique index and `governance_events.project_id` holds the repo name (nullable-target semantics). Document the resolve-or-reject contract in `unified-data-model.md` §8 (consistency checks).
- Optional belt-and-suspenders: a `BEFORE INSERT` trigger on `governance_events` that raises unless `EXISTS (SELECT 1 FROM projects WHERE github_repo = NEW.project_id)`. **Not recommended** for the POC (couples the append-only table to `projects`; the write-path check is sufficient and testable). Flagged as OQ-CR-10-adjacent.

### `notify_slack` lookup change (data-model note)

`notify_slack` moves from SSM-path-keyed-by-repo to **PG resolve** (`SELECT slack_channel_id FROM projects WHERE github_repo = $1`) + workspace bot token from SSM. Record this cross-domain read in `unified-data-model.md` §5 access patterns.

---

## V2-8. Updated TODO FR List (SUPERSEDES §4)

> PROPOSALS for `docs/phase2/srs.md`. IDs continue from FR-P2-032. v1 IDs FR-P2-033/034/037 are largely unchanged; **035 and 036 are revised**; **038–041 are new in v2.**

- [ ] **FR-P2-033 — Project Unique Key: Uniqueness & Immutability** (Must) — *unchanged from v1 §4.*
- [ ] **FR-P2-034 — Project ↔ GitHub Repository Link** (Must; nullable = feature switch; linkage mutation admin/leadership only + audit) — *v1, with feature-switch emphasis (see FR-P2-040).*
- [ ] **FR-P2-035 — Project ↔ Slack Destination (APP-MANAGED)** (Must) — **REVISED (D-D).** Was "SSM webhook path reference"; now "workspace bot token + per-project `slack_channel_id`; provision channel if missing; token is a secret in SSM/Secrets Manager, never PG."
- [ ] **FR-P2-036 — GitHub-Event-to-Project Reconciliation (MICRO surfacing; MACRO app-owned)** (Must) — **REVISED (D-B).** Micro events surface + optionally complete `micro_artifacts`; macro checkpoints are **not** auto-completed from Kiro macro events.
- [ ] **FR-P2-037 — MCP Governance Logs Visible Per Project** (Must) — *v1, repointed join to `github_repo`.*
- [ ] **FR-P2-038 — No-Orphan Governance Event Storage** (Must) — **NEW (D-C).** `record_progress` resolves repo → project and stores only on match; hard reject otherwise; rejection surfaced via metric/log, not stored.
- [ ] **FR-P2-039 — App-Managed Slack Provisioning** (Must) — **NEW (D-D).** DeliverPro authenticates Slack once at workspace level and provisions/stores a per-project channel.
- [ ] **FR-P2-040 — Optional Linkage Feature Switch** (Must) — **NEW (D-A).** Linked vs unlinked conditional behaviour (V2-2) is explicit and testable.
- [ ] **FR-P2-041 — MACRO Gate Ownership** (Must) — **NEW (D-B).** Macro checkpoint completion is app-owned/human-approved; Kiro macro events are display-only (pending OQ-CR-09).

### FR-P2-035 (REVISED) — Project ↔ Slack Destination (App-Managed)

**Priority:** Must Have
**Source:** Customer 2026-07-02 decision D-D ("build an app-managed Slack integration; authenticate once at workspace level; store per-project channel; token is a secret"). Prior: transcript "it will do a message in the Slack channel"; onboarding item FR-P2-019.

**Acceptance Criteria:**
- Given a project, then it exposes `slack_channel_id` (non-secret) and optional `slack_channel_name`; no raw bot token or webhook URL is ever present in any API response or log.
- Given the workspace Slack bot token, then it is stored **only** in SSM SecureString (or Secrets Manager) as a **single workspace-level** parameter; it is never a PG column.
- Given a project being linked and no channel exists, when linkage is saved, then DeliverPro provisions a channel (`conversations.create`) and persists the returned `slack_channel_id` (FR-P2-039).
- Given a change to `slack_channel_id` / `slack_channel_name`, then it is authorized to `admin`/`leadership` (Cognito-sub) and writes an audit record (actor, timestamp, old→new).
- Given the rejected webhook-in-PG alternative, when chosen by the customer, then the URL column MUST be `pgcrypto`/KMS-encrypted and MUST pass a dedicated security review (default design forbids storing it in PG).

### FR-P2-036 (REVISED) — Reconciliation: MICRO surfacing, MACRO app-owned

**Priority:** Must Have
**Source:** Customer 2026-07-02 decision D-B. Prior: FR-P2-011.

**Acceptance Criteria:**
- Given a `governance_events` row with `type='micro'` and `project_id = R`, when a project has `github_repo = R`, then that micro event appears on the project timeline (source `kiro_mcp`).
- Given a micro event whose `update_text`/`source_ref` maps to a known `micro_artifacts` row of the reconciled project, when reconciled, then that artifact **may** be marked complete (best-effort; non-blocking). *(Architect decision — confirm mapping rule; OQ-CR-13.)*
- Given a `governance_events` row with `type='macro'`, when processed, then it is displayed on the timeline but **does not** set `macro_checkpoints.reached_at` (macro completion is app-owned — FR-P2-041).
- Given a macro checkpoint, then `reached_at` is settable only via the in-app triggers (`human_review`/`meeting`/`transcript_analysis`/`checklist`) per gates §4.

### FR-P2-038 (NEW) — No-Orphan Governance Event Storage

**Priority:** Must Have
**Source:** Customer 2026-07-02 decision D-C ("stored only if it maps to an existing project; if none, do not store").

**Acceptance Criteria:**
- Given `record_progress` with `project_id = R`, when no project has `github_repo = R`, then the event is **not written** and the tool returns `{ written:false, reason:'no_matching_project' }`.
- Given the same, then a `GovernanceEventRejected` metric (dimension = repo) and a structured log entry are emitted; **no orphan row is stored**.
- Given `record_progress` with `project_id = R` and a project with `github_repo = R`, when written, then behaviour (classification, dedup, RDS write) is unchanged.
- Given resolution, then it uses `SELECT jira_key FROM projects WHERE github_repo = $1 LIMIT 1` (V2-4.2), for **both** macro and micro events.
- Given the MCP DB user, then it holds `SELECT` on `projects(jira_key, github_repo)` and no write privilege beyond the existing append-only `governance_events` insert.

### FR-P2-039 (NEW) — App-Managed Slack Provisioning

**Priority:** Must Have
**Source:** Customer 2026-07-02 decision D-D.

**Acceptance Criteria:**
- Given a single workspace-level Slack app + bot token, then DeliverPro authenticates once (admin OAuth consent) — no per-project OAuth.
- Given a project link action with no existing channel, then DeliverPro creates one (`conversations.create`) and stores `slack_channel_id`; if a channel is specified/exists, it resolves and stores its id (`conversations.list`).
- Given `notify_slack`, then it posts via `chat.postMessage` using the stored `slack_channel_id` + the SSM bot token (V2-6).
- Given the bot token, then it is read with least-privilege `ssm:GetParameter`+`kms:Decrypt` on the single token path; `ssm:PutParameter` is admin/out-of-band.

### FR-P2-040 (NEW) — Optional Linkage Feature Switch

**Priority:** Must Have
**Source:** Customer 2026-07-02 decision D-A.

**Acceptance Criteria:**
- Given a project with `github_repo = NULL`, then no Kiro governance events are recorded against it and its timeline shows only DeliverPro-native events (identical to current behaviour).
- Given a project with `github_repo` set, then Kiro micro events for that repo are recorded and surfaced, and `notify_slack` routes to its `slack_channel_id`.
- Given a project transitioning from unlinked to linked, then micro recording + Slack routing begin from that point; pre-link events for that repo that were rejected are not retroactively created (unless replay-on-link is adopted — OQ-CR-10).

### FR-P2-041 (NEW) — MACRO Gate Ownership

**Priority:** Must Have
**Source:** Customer 2026-07-02 decision D-B.

**Acceptance Criteria:**
- Given any macro checkpoint, then its completion (`reached_at`) is set only by an in-app human/computed trigger; Kiro macro governance events never set it.
- Given the deployed gates §5.3 auto-completion, then it is removed (or, pending OQ-CR-09, reduced to display-only mapping) so no external event auto-completes an app-owned gate.

---

## V2-9. Updated Affected Documents & Backlog (SUPERSEDES §6.1 additions)

### Documents to update (v2 additions/changes to the §6.1 table)

| Document | v2 Change |
|----------|-----------|
| **`docs/phase1/mcp-server-core-architecture.md`** | **CHANGED (no longer cross-ref only).** §3.2 `record_progress`: add resolve-or-reject step + reconcile persistence to **RDS** (fix DynamoDB drift, S-9 → prerequisite). §3.1 `notify_slack`: replace webhook-by-repo with PG `slack_channel_id` resolve + workspace bot token + `chat.postMessage`. §7 SSM inventory: add single bot-token param, retire per-repo webhook params. |
| **`docs/phase1/github-trigger-architecture.md`** | Cross-ref: `project_id = repo name` retained; note events for unlinked repos are now **rejected** (no-orphan) rather than stored. |
| **`docs/phase1/agent-integration-architecture.md`** | Cross-ref: `record_progress` may now return `no_matching_project`; callers log and continue (non-blocking). |
| `docs/phase2/gates-architecture.md` | **Remove/repoint §5.3 macro auto-completion (D-B).** Keep §5.4 timeline union, repoint join to `github_repo`. Add micro→`micro_artifacts` optional reconciliation. |
| `docs/phase2/reporting-architecture.md` | Repoint `v_timeline` to `github_repo` join; note macro completions are now app-owned only. |
| `docs/phase2/projects-architecture.md` | Add `github_repo`/`github_url`/`slack_channel_id`/`slack_channel_name` to `Project`/`Create`/`Update` inputs; add Slack provisioning at link time; admin/leadership linkage authz + audit. |
| `docs/phase2/architecture/unified-data-model.md` | V004 columns (V2-7); no-orphan enforcement note; `notify_slack` PG-resolve access pattern; drop `slack_webhook_ssm_path` from recommended design. |
| `docs/phase2/srs.md` | Add FR-P2-033..041; change FR-P2-019 (onboarding captures channel); add OQ-CR-01,09,10,11,12,13; bump version + changelog. |
| Shared types + OpenAPI (`specs/api/*`) | Add new project fields + `no_matching_project` / `channel_not_configured` reasons; new error codes. |

### Backlog delta (SUPERSEDES §6.3 where noted)

| Story | v2 change |
|-------|-----------|
| **CR-03** (join repoint) | Now also **removes macro auto-completion** (D-B) — scope shifts from "repoint" to "repoint + de-wire macro reconciliation." |
| **CR-05 (Slack)** | **New/expanded:** implement app-managed Slack (workspace app, bot token in SSM, `conversations.create`, store `slack_channel_id`). |
| **CR-08 (NEW, Phase 1)** | `record_progress` resolve-or-reject + RDS persistence reconciliation (D-C). **Higher risk — Phase 1 change.** |
| **CR-09 (NEW, Phase 1)** | `notify_slack` PG-resolve + `chat.postMessage` (D-E) + optional legacy-webhook fallback. |
| **CR-07 (re-scoped)** | From "admin DB count of orphan rows" → "operational metric/dashboard of rejected writes" (no orphan rows exist). |

**Blast-radius note:** v2 turns two Phase 1 tools (`record_progress`, `notify_slack`) into changed components — larger than v1 (which kept Phase 1 untouched). Recommend a dedicated Phase 1 review pass on CR-08/CR-09.

---

## V2-10. Updated Open Questions for Customer (SUPERSEDES §8)

Resolved by this v2 (no longer open): **OQ-CR-01** (nullable — YES, D-A), **OQ-CR-02** (cardinality — 1:1/Variant A, D-A). Remaining + new:

| # | Question | Why it matters | Recommendation |
|---|----------|----------------|----------------|
| OQ-CR-09 | Should Kiro **macro** governance events be **display-only** on the timeline, or still **auto-complete** app macro checkpoints? | Reconciles D-B against demoed "progress-MD → gate done" behaviour | **Display-only** (strict D-B). Confirm — this changes demoed behaviour. |
| OQ-CR-10 | Should **rejected (no-match) events** be **replayed** when a repo is later linked? | Requires storing rejected events (contradicts strict no-orphan) | No — hard reject; re-emit from source if needed. Adopt replay only if required. |
| OQ-CR-11 | Should **micro** events trigger **Slack** notifications, or Slack macro-only (as today)? | D-B makes micro the external signal; Slack volume/noise trade-off | Slack for macro milestones; keep micro off Slack by default to avoid noise. |
| OQ-CR-12 | Keep a **legacy per-repo webhook fallback** during Slack cutover? | Avoids breaking already-configured repos mid-migration | Yes, short transition window, then retire. |
| OQ-CR-13 | What is the **micro-event → `micro_artifacts`** mapping rule (by artifact name/phase/source_ref)? | Determines whether micro events auto-complete artifacts | Match on phase + artifact name; best-effort, non-blocking. |
| OQ-CR-14 | **Bot token store:** SSM SecureString (default) or **Secrets Manager** (rotation)? | Rotation vs cost (~$0.40/secret/mo) | SSM SecureString for POC; Secrets Manager if auto-rotation is required. |
| OQ-CR-05 (retained) | Are GitHub repo names **unique & stable** (no renames)? | Rename orphans historical events | Handle renames by updating `github_repo` (admin), audited. |
| OQ-CR-06 (retained) | Authoritative **repo↔project mapping** for backfill of existing projects. | Backfill data source | PM-supplied mapping or one-time admin entry. |

---

## V2-11. Verification Notes (v2 claims checked against source)

- `governance_events` is **RDS/Postgres** with `project_id TEXT NOT NULL`, **no FK** → orphans stored today. Source: `migrations/V001__governance_events.sql`. ✔
- **Two** `V002` files (`V002__projects_and_jira_sync.sql`, `V002__projects_and_casdm_tracking.sql`); **neither** has `github`/`slack` columns. ✔
- `notify_slack` uses `/kiro-governance/slack/webhooks/${project_id}` (per-repo webhook). Source: `mcp-server-core-architecture.md §3.1`. ✔
- `record_progress` doc shows `writeGovernanceEvent(dynamoClient, …)` / `dynamo-writer` (DynamoDB) — **contradicts** V001/RDS → drift is now a design prerequisite. Source: `mcp-server-core-architecture.md §3.2`. ✔
- gates **§5.3** auto-completes `macro_checkpoints.reached_at` from **macro** `governance_events` via `GATE_TO_CHECKPOINT`, join on `jira_key` — the behaviour reconciled by D-B. Source: `gates-architecture.md §5.1–5.4`. ✔
- V003 `v_timeline` joins `governance_events ge JOIN projects p ON p.jira_key = ge.project_id` (inner join → silent orphan drop). Source: `migrations/V003__phase2_additions.sql`. ✔

---

## 0. Review Consolidation & Findings Disposition

This document was reviewed by the plan-reviewer, security-reviewer, and capacity-review (Technical PM). Their findings are consolidated below. Per the approval threshold, **all Critical/High findings are resolved in the design**; Medium/Low are resolved or accepted with justification. There were **0 Critical, 3 High, 6 Medium, and 8 Low/Info** findings. All 3 High are now resolved in the sections cited.

### 0.1 High findings — RESOLVED (blocking; zero Critical/High required to pass)

| ID | Source | Finding (short) | Resolution | Where |
|----|--------|-----------------|------------|-------|
| **H1** | plan-reviewer | FR-P2-035 AC implied a Phase-1 `notify_slack` change (resolve webhook via project column) that §6.1 rules out — non-implementable. | **FR-P2-035 rewritten.** Split into (a) Phase 2 *stores* a Slack reference for visibility/management, and (b) Phase 1 `notify_slack` routing is **unchanged** and keys SSM by repo name. The "notify_slack resolves via the project column" AC is removed. | §4 FR-P2-035 |
| **S-1** | security-reviewer | Transition join `COALESCE(github_repo, jira_key)` is **not injective** — one project's `github_repo` could equal another project's `jira_key` → event attributed to two projects → false gate auto-completion. | **Join fixed to match on `github_repo` ONLY.** The `jira_key` fallback is retained *only* for projects with `github_repo IS NULL`, and is guarded by a DB `CHECK`/validation that **no `github_repo` equals any `jira_key`** before the fallback branch can match. Collision detection specified. | §3.4, §5.3 |
| **S-2** | security-reviewer | FR-P2-034 allowed `pm/leadership/admin` to mutate `github_repo`/Slack refs via `PATCH /projects`, riding the known-weak free-text `project_manager` ownership check (SG-1 #9). Linkage controls governance attribution + Slack routing. | **Linkage mutation restricted to `admin` (and `leadership`) with a Cognito-sub identity check**, as an explicit testable AC. `pm` can no longer change the GitHub/Slack linkage. | §4 FR-P2-034 (AuthZ AC) |

> **M1 (plan-reviewer)** is the same defect as **S-1** and is resolved by the same collision-safe join fix.

### 0.2 Medium findings — RESOLVED / folded into ACs

| ID | Source | Finding (short) | Disposition |
|----|--------|-----------------|-------------|
| **M2** | plan-reviewer | Item 4 framing overstates the defect — Slack already routes per-repo via Phase 1; the real gap is the project cannot *see/manage* the channel/webhook. | **RESOLVED.** Item 4 reframed as a **linkage + visibility + secret-reference** requirement (not a routing fix). See §1 Item 4 and FR-P2-035 Description. |
| **M3** | plan-reviewer | FR-P2-035's onboarding change makes the item non-completable without a `slack_channel_id` — a hard constraint with no customer source. | **RESOLVED.** Downgraded to **soft-capture** by default and added **OQ-CR-07** (mandatory vs optional channel capture). AC no longer blocks completion. |
| **S-3** | security-reviewer | No audit mechanism on `projects` link changes. | **RESOLVED (folded into ACs + V004).** Added `updated_by`/`updated_at` to `projects` and an audit AC to FR-P2-034/035: link create/change writes an audit record (actor Cognito sub, timestamp, old→new). See §5.1 and §7.2. |
| **S-4** | security-reviewer | `slack_webhook_ssm_path` derived by interpolating user-supplied `github_repo` (charset allows dots). | **RESOLVED.** Store the **resolved path explicitly**; validate fixed prefix `/kiro-governance/slack/webhooks/`; reject leading/consecutive dots; never concatenate raw input. See FR-P2-035 AC + §7.2 S-4. |
| **S-5** | security-reviewer | Whoever holds `ssm:PutParameter` on the webhooks prefix controls where `notify_slack` POSTs (SSRF/exfil lever). | **RESOLVED (folded into ACs).** Phase 2 API Lambdas are **read-only** (`GetParameter`+`Decrypt`); `PutParameter` is **admin-only / out-of-band (Phase 1)**, never on general API roles. See §7.2 S-5. |
| **S-6** | security-reviewer | Variant C (1:N) routing: Phase 1 keys webhook SSM path by the event's repo name; non-primary-repo events resolve to a missing/incorrect param. | **RESOLVED as a gating condition.** Variant C is not adopted unless OQ-CR-02 confirms multi-repo; if adopted, routing must be resolved first (per-repo param OR normalize to the `is_primary` repo). See §3.2 Option C + OQ-CR-03. |

### 0.3 Low / Info findings — ACCEPTED with justification (or applied)

| ID | Source | Finding (short) | Disposition |
|----|--------|-----------------|-------------|
| **L1** | plan-reviewer | `v_timeline` doc (§5.3, no join) vs deployed V003 (joins on `jira_key`) vs gates §5.4 (`WHERE project_id=$1`) — 3-way drift. | **APPLIED.** Drift captured in §6.1 and a dedicated reconciliation subtask added to CR-03 (§6.3). |
| **L2** | plan-reviewer | Plain `idx_projects_github_repo` redundant with the partial UNIQUE index for non-null lookups. | **APPLIED.** Redundant plain index **dropped**; the partial unique index serves reconciliation lookups. See §5.1. |
| **L3** | plan-reviewer | Cost §7.1 "O(log n)" claim wrong for the `COALESCE` predicate (Postgres can't use the index for a COALESCE expression). | **APPLIED.** §7.1 corrected: index use applies to the **strict-match** (post-transition) variant; the transition COALESCE variant may seq-scan (harmless at ≤200 projects). |
| **L4** | plan-reviewer | FR-P2-036 "unmatched governance events count" is architect-added admin scope. | **APPLIED.** Downgraded to **Could-Have**, split into deferred story **CR-07** (not bundled as Must). |
| **L5** | plan-reviewer | No story/note to reconcile reporting §5.3 vs migration, nor to update shared TS types / OpenAPI. | **APPLIED.** Added as explicit subtasks under CR-02/CR-03 (§6.3). |
| **S-7** | security-reviewer | Read scope `/kiro-governance/slack/webhooks/*` lets the notification Lambda read every project's webhook (blast radius = all channels). | **ACCEPTED (documented).** Consistent with existing Phase 1 pattern; per-param tags + ABAC noted as a future hardening. See §7.2 S-7. |
| **S-8** | security-reviewer | AWS-managed `aws/ssm` key can't be tightly decrypt-scoped; consider customer-managed CMK (~$1/mo). | **PARKED to customer.** Added **OQ-CR-08** (CMK for webhooks). |
| **S-9** | security-reviewer | Stale `mcp-server-core-architecture.md` (DynamoDB) vs data-model v1.4 (RDS). | **APPLIED.** Added to §6.1 affected docs as a cross-reference correction (Phase 1 doc drift; no behavior change). |
| **I1 / S-10** | plan-reviewer / security-reviewer | `jira_key` immutability reinforced by child FKs being `ON DELETE CASCADE` with no `ON UPDATE CASCADE`; positive security controls correctly specified. | **APPLIED.** Cited as reinforcing evidence in FR-P2-033; positive controls retained. |

### 0.4 Verdict path

- Plan-reviewer: NOT APPROVED as-is (1 High: H1). → H1 resolved; M1/M2/M3 addressed; Lows accepted.
- Security-reviewer: NOT APPROVED until S-1, S-2 resolved; fold S-3, S-5 into ACs. → S-1, S-2 resolved; S-3, S-5 folded into ACs.
- Capacity-review: Phasing accepted — implement core now, defer CR-07. Reflected in §6.3.

This consolidated revision is ready for re-submission to plan-reviewer + security-reviewer, and for the human sign-off items in §9.

---

## 1. Executive Summary — Audit of the Four Items

The customer raised four items about project identity, GitHub linkage, Slack routing, and MCP-log visibility. Each was independently verified against the Phase 1 and Phase 2 architecture docs, the SRS, the V002/V003 migrations, and the Phase 2 meeting transcript. Verdicts:

| # | Item | Verdict | Primary Evidence |
|---|------|---------|------------------|
| 1 | Every project must have a unique identifier (a key) | **PARTIALLY SATISFIED — GAP** (DB enforces it; no explicit SRS FR for uniqueness + immutability) | `migrations/V002__projects_and_casdm_tracking.sql` — `projects.id BIGSERIAL PRIMARY KEY`, `jira_key TEXT NOT NULL UNIQUE` |
| 2 | How do MCP governance logs help this dashboard and where are they visible? | **SATISFIED (design intent) but BLOCKED by Item 3 defect** | `gates-architecture.md §2.8, §5.1–5.5`; `reporting-architecture.md §2.2, §5.3`; `V003 v_timeline` view |
| 3 | Why is GitHub not part of the project entity; how does a GitHub action mark something done here? | **DEFECT** (identifier-space mismatch; no `github_repo` column; no reconciliation) | `github-trigger-architecture.md §4.2`; `mcp-server-core-architecture.md §7.1`; V002/V003 `projects` schema |
| 4 | What links a project to its GitHub repo and Slack webhook? | **DEFECT — linkage & visibility gap** (nothing on the project links to the repo or Slack destination; onboarding item is a bare boolean). *Note (M2): Slack notifications already route per-repo today via Phase 1 `notify_slack`; routing is not broken. The gap is that the project entity cannot see or manage which channel/webhook it uses.* | V002/V003 `projects` schema; `srs.md` FR-P2-019; `mcp-server-core-architecture.md §6.3, §7.1` |

### Item 1 — Project unique identifier — GAP (confirm + propose FR)

**Verified current state.** The `projects` table already guarantees uniqueness at the database layer:

- Source: `migrations/V002__projects_and_casdm_tracking.sql` —
  `id BIGSERIAL PRIMARY KEY` (surrogate) and `jira_key TEXT NOT NULL UNIQUE` (business key, e.g. `CST-674` imported, or `DP-001` generated by `projects-architecture.md §5.2`).
- Source: `projects-architecture.md §2.2` — `POST /api/projects` returns `409 DUPLICATE_JIRA_KEY` if the generated `jira_key` already exists.

**Gap.** There is **no explicit SRS Functional Requirement** stating the uniqueness and **immutability** of the project key. The SRS references `jira_key` implicitly (FR-P2-001 shows it on the card; FR-P2-009 sets it) but never states it as a first-class constraint. Immutability is asserted only for `project_type` (PD-13, `projects-architecture.md §2.4`), never for `jira_key`. The `PATCH /api/projects/{projectId}` body (`UpdateProjectInput`, `projects-architecture.md §2.4`) does not include `jira_key`, so it is *de facto* immutable — but this is not documented as a requirement and is not enforced by a test-anchored AC.

**Verdict: GAP.** DB enforces uniqueness; immutability is incidental, not specified. Propose FR-P2-033 (§4).

### Item 2 — Where are MCP governance logs visible? — SATISFIED (design), BLOCKED (data)

The Phase 1 MCP server writes `governance_events` to the **same** RDS instance/database that Phase 2 uses (`srs.md §8.3, §8.4`; `unified-data-model.md §2` marks `governance_events` as a V001 read-only table). Phase 2 does **not** sync or mirror — it reads directly. See §2 for the exact endpoints, screens, view, and join key, and the reason the join currently fails for DeliverPro projects.

**Verdict: SATISFIED in design** (the read paths exist and are documented), **but the data never surfaces** for DeliverPro projects because the join key mismatches (Item 3). This is the customer's real question — "where would I see that if I'm a PM?" (`srs.md` FR-P2-011 source quote) — and the honest answer today is: *nowhere, for any project whose GitHub repo name ≠ its `jira_key`.*

### Item 3 — GitHub not part of the project entity — DEFECT

**Verified.** Two independent identifier spaces exist and never meet:

- **Phase 1 uses the GitHub repo name as `project_id`.**
  - Source: `github-trigger-architecture.md §4.2` — `record_progress.project_id = ${{ github.event.repository.name }}`; note cites "SRS OQ-02: project_id = GitHub repository name. Source: Customer (Tariq Khan) 2026-06-11."
  - Source: `mcp-server-core-architecture.md §3.1/§3.2` — both tool input schemas describe `project_id` as "GitHub repository name."
  - Source: `agent-integration-architecture.md §3.2` — orchestrator resolves `project_id` from `KIRO_PROJECT_ID` → `git remote get-url origin` repo name → `.kiro/project.json`.
- **Phase 2 keys projects by `jira_key` and joins governance events on it.**
  - Source: `gates-architecture.md §5.1` — "Join Condition: `governance_events.project_id = projects.jira_key`."
  - Source: `V003 v_timeline` view — `FROM governance_events ge JOIN projects p ON p.jira_key = ge.project_id`.

**Consequences (all confirmed):**
1. **(a) MCP logs invisible per project.** Unless a project's `jira_key` happens to equal its GitHub repo name, the timeline join returns zero governance rows. `gates-architecture.md §5.5` confirms orphan events are "silently excluded (the JOIN naturally filters them). No error is raised" — so the failure is silent.
2. **(b) GitHub commits/merges cannot mark items done.** The auto-completion reconciliation (`gates-architecture.md §5.3`) updates `macro_checkpoints.reached_at` only `WHERE ge.project_id = mc.project_id` (i.e. `= jira_key`). With repo-name-keyed events, no checkpoint is ever auto-completed from a GitHub-triggered governance event. There is **no `github_repo` column** on `projects` to bridge this.
3. **(c) No reconciliation path.** Nothing maps a GitHub-triggered `governance_events` row back to a Phase 2 project row.

**Verdict: DEFECT.** Confirmed exactly as reported.

### Item 4 — What links a project to its GitHub repo and Slack webhook? — DEFECT

**Verified.** Nothing links them.

- **No GitHub linkage columns.** V002 and V003 `projects` schema (see `unified-data-model.md §3.1, §4.1`) contain: `jira_key, jira_id, jira_link, title, description, project_type, status, account_executive, solution_architect, project_manager, engineers_assigned, planned_kickoff_date, expected_completion_date, resource_assignment_date, created_at_jira, updated_at_jira, sow_hours, sow_link, last_synced_at, created_at, hours_consumed`. There is **no `github_repo`, `github_url`, or equivalent**.
- **No Slack linkage columns.** No `slack_webhook`, `slack_webhook_ssm_path`, or `slack_channel_id` on `projects`.
- **Onboarding "Slack channel" is only a boolean.** `srs.md` FR-P2-019 and `projects-architecture.md §3.4` seed `onboarding_checklist_items` item #1 = "Set up Slack/Teams channel" — a `completed BOOLEAN`. It records *that* a channel was set up, never *which* channel or webhook.
- **The Slack webhook lives in SSM, keyed by repo name, unreachable from the project.**
  - Source: `mcp-server-core-architecture.md §6.3, §7.1` — `notify_slack` resolves `/kiro-governance/slack/webhooks/{project_id}` (SecureString), where `{project_id}` is the GitHub repo name. Phase 2, holding only `jira_key`, cannot construct this path and has no reference to it.

**Verdict: DEFECT (linkage & visibility).** Confirmed. To be precise (per review M2): Slack notifications **already route per-repo today** — Phase 1 `notify_slack` resolves `/kiro-governance/slack/webhooks/{repo}` from the event's repo name, so routing works. The actual defect is that **the Phase 2 project entity has no link to, and no visibility of, which GitHub repo or Slack destination it uses** — the onboarding "Slack channel" checkbox records only *that* a channel was set up, never *which* one, and there is no `github_repo`/`github_url`/Slack-reference column. This is a linkage, visibility, and secret-reference gap — not a routing bug.

- ✅ **Customer-confirmed (High trust):** GitHub repo attachment and Slack notification as a delivery mechanism — Phase 2 meeting transcript, Muhammad Faraz: *"you can actually just go on, attach it to a repository, generate some documents"* and *"It works with your Github. When you upload… the project progress MD file, it will drag that change as a gate… write it down on our database, and it will do a message in the Slack channel."* (`.kiro/Knowledge/Phase2MeetingTranscript.txt`). Action item: *"attach repositories and test progress MD-based gate detection"* (`.kiro/Knowledge/Phase2MeetingNotes.txt`).
- ✅ **Customer-confirmed (High trust):** the canonical macro-gate list the governance layer tracks — Phase 2 transcript: *"SRS validated, SRS approved… design docs approved, implementation plan approved… specs file approved… code approved, UAT report approved… run books approved… project documentation approved"* (`.kiro/Knowledge/Phase2Transcript.txt` ~line 259).
- ✅ **Customer-confirmed (High trust):** `project_id = GitHub repository name` — SRS OQ-02, attributed to Tariq Khan 2026-06-11 (cited in `github-trigger-architecture.md §4.2`, `mcp-server-core-architecture.md §12`, `agent-integration-architecture.md §3.2`).
- ⚠️ **Architect decision — not customer-specified:** That the **`projects` entity must physically store** `github_repo` / `github_url` / a Slack webhook reference is an engineering inference required to reconcile the two phases. The customer confirmed the *behavior* (repo → gate → DB → Slack) but never specified the *schema*. All proposed columns in §5 are labeled accordingly.
- ⚠️ **Not traceable (flagged for customer):** whether one project maps to exactly one GitHub repo or many; whether a project may exist before its repo is attached; whether repo names are guaranteed unique and stable. See Open Questions (§8).

---

## 2. Where Are MCP Governance Logs Visible? (Precise)

The Phase 1 `governance_events` rows are surfaced through the following Phase 2 read surfaces. **All of them join on `governance_events.project_id = projects.jira_key`, and all of them therefore return zero governance rows for any DeliverPro project whose GitHub repo name ≠ its `jira_key`.**

| # | Surface | Endpoint / Object | Screen (persona) | How `governance_events` is used | Source |
|---|---------|-------------------|------------------|---------------------------------|--------|
| 1 | Project timeline | `GET /api/projects/{projectId}/timeline` | Project Detail → Timeline tab (PM, SA, Engineer, Leadership) | UNION source 1 = `governance_events` (labeled `source: 'kiro_mcp'`), interleaved with checkpoint completions + evidence | `gates-architecture.md §2.8, §5.4` |
| 2 | Gate status view (auto-completion) | `GET /api/projects/{projectId}/gates` | Project Detail → Gates view (all personas) | Reconciliation maps Phase-1 macro gate approvals → `macro_checkpoints.reached_at` (`GATE_TO_CHECKPOINT` map) | `gates-architecture.md §5.2, §5.3` |
| 3 | Leadership timeline (reporting) | `GET /api/reporting/timeline/{projectId}` | Leadership dashboard → project drill-down (leadership, admin) | Wraps the same timeline SQL, larger page size | `reporting-architecture.md §2.2` |
| 4 | Leadership summary (indirect) | `GET /api/reporting/summary` | Leadership dashboard (leadership, admin) | Phase completion & gate-completion rates depend on `reached_at`, which the reconciliation sets from governance events | `reporting-architecture.md §2.1, §4` |
| 5 | QuickSight-ready SQL view | `v_timeline` (also `v_project_summary`, `v_gate_completion`) | Future QuickSight / ad-hoc SQL | `v_timeline` UNION source 1 = `governance_events JOIN projects ON p.jira_key = ge.project_id` | `reporting-architecture.md §5.3`; `V003` migration |

**The join key:** `governance_events.project_id = projects.jira_key` (exact-match, `gates-architecture.md §5.1`).

**Why the join fails today for DeliverPro projects.** Phase 1 populates `governance_events.project_id` with the **GitHub repository name** (`github.event.repository.name`), while Phase 2 `projects` are keyed by **`jira_key`** (e.g. `CST-674`, `DP-001`). These are different identifier spaces. Unless a project's `jira_key` is coincidentally identical to its repo name, every one of the five surfaces above returns an **empty** governance contribution:

- Surface 1/3/5 (timeline): governance rows are dropped by the inner JOIN (`gates-architecture.md §5.5` — "silently excluded… No error is raised").
- Surface 2 (auto-completion): no `macro_checkpoints` row is ever auto-completed from GitHub-triggered governance events → gates that *were* passed in Kiro still appear incomplete in DeliverPro.
- Surface 4 (summary): consequently, phase-completion and gate-completion percentages under-report, and projects may be flagged "stalled" (`reporting-architecture.md §3`) despite active Kiro governance activity.

**Net effect:** the exact feature the customer asked for — *"you're collecting stuff in your database for Kiro. Where would I see that if I'm a project manager?"* (FR-P2-011 source) — is wired end-to-end in design but yields nothing at runtime for real DeliverPro projects. This is the concrete business impact of the Item 3 defect.

---

## 3. Identifier Reconciliation Design

### 3.1 The Three Identifier Spaces

| Identifier | Owned By | Example | Where used |
|-----------|----------|---------|------------|
| `projects.jira_key` | Phase 2 | `CST-674`, `DP-001` | PK for all Phase 2 FKs; timeline join target |
| `governance_events.project_id` (= GitHub repo name) | Phase 1 | `rainn`, `deliverpro` | governance event key; Slack SSM path `/kiro-governance/slack/webhooks/{repo}` |
| `github_repo` (proposed new linkage) | Phase 2 (new) | `deliverpro` | bridge between the two above |

The reconciliation goal: relate `governance_events.project_id` (repo name) to a Phase 2 project so that (i) MCP logs surface in the timeline, (ii) GitHub commits/merges mark `micro_artifacts` / `macro_checkpoints` done, and (iii) the project can **see and manage** which Slack destination it uses (per-repo Slack routing already works in Phase 1; this makes it visible/manageable from the project entity — see review M2).

### 3.2 Options

#### Option A — Add `github_repo` column to `projects`, backfill, and repoint the join (RECOMMENDED)

Add `github_repo TEXT UNIQUE` (plus `github_url`, and a Slack reference — see §5) to `projects`. Repoint every governance join and the reconciliation UPDATE from `projects.jira_key` to `projects.github_repo`. Backfill `github_repo` for existing projects.

| Aspect | Detail |
|--------|--------|
| Join change | `... JOIN projects p ON p.github_repo = ge.project_id` (was `p.jira_key = ge.project_id`) |
| Slack routing | Store the webhook reference on the project (SSM SecureString path or channel id); `notify_slack` continues to key SSM by repo name = `github_repo` — now reachable from the project |
| Cardinality | One repo ↔ one project (1:1). `github_repo` UNIQUE enforces it. |
| Pros | Minimal schema change; single source of truth per project; keeps Phase 1 untouched (no agent/CI reconfiguration); `UNIQUE` gives a clean reconciliation key |
| Cons | Assumes 1 repo per project (see OQ); requires backfill; a transition window where `github_repo` is NULL yields no timeline (same as today — no regression) |

#### Option B — Change Phase 1 to emit `jira_key` as `project_id` (NOT RECOMMENDED)

Reconfigure the agents (`KIRO_PROJECT_ID`) and GitHub Actions workflow to send `jira_key` instead of the repo name.

| Aspect | Detail |
|--------|--------|
| Pros | No Phase 2 join change; identifier spaces collapse into one |
| Cons | **High blast radius.** Breaks the Slack SSM path convention `/kiro-governance/slack/webhooks/{repo}` (would need re-keying by `jira_key`); contradicts customer-confirmed OQ-02 (`project_id = repo name`, Tariq Khan); requires every repo to know its `jira_key` at CI time (not available from `github.event`); dedup idempotency keys (`<project_id>#<gate>#<date>`) change meaning; existing `governance_events` rows become unjoinable without a separate backfill anyway |

#### Option C — Dual-key mapping table `project_github_repos` (RECOMMENDED IF many-repos-per-project)

Keep `projects.jira_key` as-is; add a mapping table `project_github_repos (project_id FK → jira_key, github_repo UNIQUE, github_url, is_primary)`. Governance joins go through the map.

| Aspect | Detail |
|--------|--------|
| Join change | `... JOIN project_github_repos m ON m.github_repo = ge.project_id JOIN projects p ON p.jira_key = m.project_id` |
| Cardinality | One project ↔ many repos (1:N) — supports mono-project/multi-repo delivery |
| Pros | Handles multi-repo projects (common in App Mod: infra repo + app repo + IaC repo); non-breaking to `projects`; `is_primary` marks the Slack-routing repo |
| Cons | Extra table + extra join on every timeline query; slightly more complex reconciliation; Slack routing must resolve the `is_primary` repo |

#### Option D — Keep join on `jira_key`, do nothing to identifiers (STATUS QUO — REJECTED)

Rejected: this is the current defective state. MCP logs remain invisible.

### 3.3 Recommendation

**Adopt Option A as the default (1:1), with a documented upgrade path to Option C (1:N) gated on OQ answer.**

- If the customer confirms **one repo per project** → Option A: add `github_repo` (+ `github_url`, + Slack reference) directly on `projects`. Simplest, lowest cost, no new join.
- If the customer confirms **many repos per project** → Option C: introduce `project_github_repos`. The FRs in §4 are written to be satisfiable by either; §5 gives both schema variants.

Both A and C **repoint the governance join to the repo-name linkage** rather than changing Phase 1 (Option B), because OQ-02 (`project_id = repo name`) is a customer-confirmed constraint and the Slack SSM convention is already built and demoed.

### 3.4 Migration / Backfill Implications for Existing `governance_events`

`governance_events` is **append-only and read-only from Phase 2** (`unified-data-model.md §2`; Phase 1 IAM DENYs Update/Delete). Therefore:

1. **Do not rewrite `governance_events`.** Existing rows keep `project_id = <repo name>`. Reconciliation happens on the **Phase 2 side** by populating the new linkage.
2. **Backfill `projects.github_repo` (or `project_github_repos`).** For each existing DeliverPro project, set `github_repo` to its actual GitHub repository name. Sources for backfill values, in priority order: (a) a known repo↔project mapping supplied by the customer/PM; (b) manual entry via a one-time admin action; (c) leave NULL → project simply shows no governance timeline until linked (no regression vs today).
3. **Transition safety — collision-safe (resolves S-1 / M1).** The naïve `ON ge.project_id = COALESCE(p.github_repo, p.jira_key)` predicate is **not injective**: one project's `github_repo` could equal a *different* project's `jira_key`, attributing a single governance event to two projects (false gate auto-completion + duplicate timeline rows). The join therefore **matches on `github_repo` first, and falls back to `jira_key` ONLY for projects whose `github_repo IS NULL`**, guarded by a validation that no `github_repo` value collides with any `jira_key`. Concretely:

   ```sql
   -- Strict github_repo match, OR jira_key match ONLY where the project has no github_repo yet
   FROM governance_events ge
   JOIN projects p
     ON  p.github_repo = ge.project_id
      OR (p.github_repo IS NULL AND p.jira_key = ge.project_id)
   ```

   This is injective as long as the collision guard holds. **Collision detection:** before enabling (and periodically during) the transition, run a guard query — `SELECT p1.jira_key FROM projects p1 JOIN projects p2 ON p2.github_repo = p1.jira_key` must return **zero rows**. Optionally enforce with a deferred `CHECK`/exclusion at the app layer (cross-row uniqueness across two columns cannot be expressed in a single-column DB constraint). **Remove the `jira_key` fallback branch entirely once backfill is complete and validated** (CR-06), leaving the strict `p.github_repo = ge.project_id` join.
4. **Idempotency / dedup unaffected.** The Phase 1 dedup key (`<project_id>#<gate>#<YYYY-MM-DD>`, `mcp-server-core-architecture.md §5.1`) is internal to Phase 1 and keyed by repo name; it does not change. Phase 2 reconciliation is a read-side join only.
5. **No duplicate timeline rows (given the collision guard).** Reconciliation is a read-side join and `github_repo` is UNIQUE (Option A) or `project_github_repos.github_repo` is UNIQUE (Option C), so one governance event maps to at most one project **via `github_repo`**. During the transition window the `jira_key` fallback is confined to `github_repo IS NULL` projects and gated by the collision-detection guard (§3.4.3), which prevents the cross-space double-match identified in S-1/M1.

---

## 4. Proposed NEW / CHANGED FRs (TODO list)

> These are PROPOSALS for `docs/phase2/srs.md`. They are not yet added. Each follows the project FR template with a `Source:` tag and machine-testable ACs. IDs continue from the current maximum (FR-P2-032). Values not traceable to a customer statement are labeled **Architect decision — not customer-specified**.

- [ ] **FR-P2-033 — Project Unique Key: Uniqueness & Immutability** (Must)
- [ ] **FR-P2-034 — Project ↔ GitHub Repository Link** (Must; linkage mutation = admin/leadership only + audit)
- [ ] **FR-P2-035 — Project ↔ Slack Destination Link (visibility & secret-reference)** (Must; Phase 1 routing unchanged; onboarding capture soft per OQ-CR-07)
- [ ] **FR-P2-036 — GitHub-Event-to-Project Reconciliation (commits/merges mark items done)** (Must; unmatched-events admin count is Could-Have → CR-07)
- [ ] **FR-P2-037 — MCP Governance Logs Visible Per Project** (Must)

---

### FR-P2-033: Project Unique Key — Uniqueness & Immutability

**Priority:** Must Have
**Source:** Customer — Phase 2 request (2026-07-02): "every project must have a unique identifier (a key)." Existing behavior verified in `migrations/V002__projects_and_casdm_tracking.sql`. Immutability is **Architect decision — not customer-specified** (inferred to protect all FK references keyed on `jira_key`).

**Description:**
Every project shall have a globally unique business key (`jira_key`) that is assigned at creation (imported from Jira, or generated as `DP-NNN`) and is immutable for the life of the project. The key is the referential anchor for all child records.

> **Reinforcing evidence (review I1):** Immutability is not merely a convenience — the child tables (`micro_artifacts`, `macro_checkpoints`, `gate_evidence`, `checkpoint_notes`, `weekly_status_logs`, `escalations`, `discovery_sessions`, `onboarding_checklist_items`) reference `projects.jira_key` via FKs declared `ON DELETE CASCADE` **with no `ON UPDATE CASCADE`**. Mutating `jira_key` would therefore orphan/break every child row's referential integrity. The DB schema itself makes immutability the only safe behaviour.

**Acceptance Criteria:**
- Given two projects, when both exist, then their `jira_key` values are distinct (enforced by `UNIQUE` constraint on `projects.jira_key`).
- Given a create request whose generated/imported `jira_key` already exists, when submitted, then the API returns HTTP 409 `{ "code": "DUPLICATE_JIRA_KEY" }`.
- Given a project, when a `PATCH /api/projects/{projectId}` body includes any attempt to change `jira_key`, then the API returns HTTP 422 `{ "code": "IMMUTABLE_FIELD", "field": "jira_key", "message": "jira_key cannot be changed after creation" }`.
- Given a directly-created project, when created, then `jira_key` matches the pattern `^DP-\d{3,}$` and is the next sequential value.
- Given any child record (`micro_artifacts`, `macro_checkpoints`, `gate_evidence`, `checkpoint_notes`, `weekly_status_logs`, `escalations`, `discovery_sessions`, `onboarding_checklist_items`), then its `project_id` FK references exactly one `projects.jira_key`.

---

### FR-P2-034: Project ↔ GitHub Repository Link

**Priority:** Must Have
**Source:** Customer — Phase 2 transcript, Muhammad Faraz: "attach it to a repository, generate some documents" and "It works with your Github… the project progress MD file… drag that change as a gate… write it down on our database" (`.kiro/Knowledge/Phase2MeetingTranscript.txt`); action item "attach repositories and test progress MD-based gate detection" (`.kiro/Knowledge/Phase2MeetingNotes.txt`). Storing the link **on the project entity** is **Architect decision — not customer-specified** (required for reconciliation).

**Description:**
A project shall be linkable to its GitHub repository. The repository name is the identifier Phase 1 governance events are keyed by (`github.event.repository.name`), so the link is the bridge that makes Phase 1 governance events reconcile to Phase 2 projects.

**Acceptance Criteria:**
- Given a project, then it exposes a `github_repo` field (the GitHub repository name, e.g. `deliverpro`) and a `github_url` field (the full HTTPS repo URL).
- **Nullable at creation:** Given a `POST /api/projects` request that omits `github_repo`, when submitted, then the project is created with `github_repo = NULL` (linking may be deferred). *(Architect decision — not customer-specified; see OQ-CR-01.)*
- **Uniqueness (1:1 model):** Given two projects, when both have a non-NULL `github_repo`, then their `github_repo` values are distinct; a duplicate returns HTTP 409 `{ "code": "DUPLICATE_GITHUB_REPO" }`.
- **Validation:** Given a `github_repo` value, when set, then it matches `^[A-Za-z0-9._-]{1,100}$` (GitHub repo-name charset); an invalid value returns HTTP 400 `{ "code": "VALIDATION_ERROR", "field": "github_repo" }`.
- **Mutable link, restricted authorization (resolves S-2):** Given a project with an incorrect link, when an **`admin` or `leadership`** user submits `PATCH /api/projects/{projectId}` with a new `github_repo`, then the link is updated (unlike `jira_key`, `github_repo` is correctable). Given a **`pm`** (or any non-admin/non-leadership) user attempts the same change, then the API returns HTTP 403 `{ "code": "FORBIDDEN", "message": "Only admin or leadership may change project linkage" }`. Authorization is enforced on the caller's **Cognito `sub`/group claim**, not on the free-text `project_manager` field. *(Rationale: `github_repo` + Slack refs control governance attribution and Slack routing; the free-text `project_manager` ownership check is known-weak — SG-1 #9 — so linkage mutation must not depend on it. Architect + security decision — not customer-specified.)*
- **Audit of link changes (resolves S-3):** Given any create or change of `github_repo` / `github_url` / Slack reference, when persisted, then an audit record is written capturing the actor's Cognito `sub`, timestamp, and old→new values (via `projects.updated_by`/`updated_at` and, where a full trail is required, a `project_link_audit` row — see §5.1). *(Architect + security decision — not customer-specified.)*
- Given a project with `github_repo` set, when its detail is viewed, then the `github_url` is rendered as a clickable link.

---

### FR-P2-035: Project ↔ Slack Destination Link (visibility & secret-reference)

**Priority:** Must Have
**Source:** Customer — Phase 2 transcript: "it will do a message in the Slack channel" (`.kiro/Knowledge/Phase2MeetingTranscript.txt`); onboarding item "Set up Slack/Teams channel" (`srs.md` FR-P2-019). Storing a **reference** on the project (for visibility/management) and treating the webhook as a **secret** is **Architect + security decision — not customer-specified**.

**Description (reframed per review H1 + M2):**
A project shall **store and display a reference to its Slack destination** so a PM/admin can *see and manage* where the project's governance notifications go. This is a **visibility and management** requirement, **not a routing change**: Slack routing itself is unchanged — Phase 1 `notify_slack` continues to resolve the webhook from the event's GitHub repo name at `/kiro-governance/slack/webhooks/{repo}` (`mcp-server-core-architecture.md §6.3`) with **no Phase 1 code change and no DB access**. The Phase 2 project row holds only a **non-secret reference**: the resolved SSM SecureString **path** plus a human-readable channel identifier. The webhook URL itself is a secret and is never stored in the database, returned by the API, or logged.

**Acceptance Criteria:**

*(Phase 2 storage & visibility — the scope of this FR)*

- Given a project, then it exposes `slack_webhook_ssm_path` (a stored reference such as `/kiro-governance/slack/webhooks/deliverpro`) and `slack_channel_id` (non-secret display value, e.g. `#deliverpro-delivery`).
- Given any API response containing a project, when serialized, then no raw Slack webhook URL is present (only the SSM path reference and channel id).
- Given the Slack webhook secret, then it is stored **only** in SSM Parameter Store as a `SecureString` (or Secrets Manager), never in `projects` and never in application logs.
- **Explicit, validated path (resolves S-4):** Given a `slack_webhook_ssm_path` value, when set or updated, then it is **stored as an explicit resolved string** (not built at read time by concatenating raw input); it must match `^/kiro-governance/slack/webhooks/[A-Za-z0-9_-]+$` (fixed prefix enforced; leading dots, consecutive dots, and `..` path traversal rejected); an invalid value returns HTTP 400 `{ "code": "VALIDATION_ERROR", "field": "slack_webhook_ssm_path" }`. The application never interpolates unvalidated `github_repo` into an SSM path.
- **Restricted mutation + audit (S-2/S-3):** Given a change to `slack_webhook_ssm_path` or `slack_channel_id`, when submitted, then it is authorized to `admin`/`leadership` only (Cognito-sub check, per FR-P2-034) and writes an audit record (actor, timestamp, old→new).

*(Onboarding — soft capture per review M3)*

- **Onboarding capture (soft by default):** Given the onboarding item "Set up Slack/Teams channel", when marked complete, then the completing user **is prompted to supply** the `slack_channel_id` (and the SSM path if known). By default the item **remains completable without them** (soft capture), and completion with the values recorded is preferred. *(Whether channel capture is made mandatory is deferred to **OQ-CR-07**; this AC must not hard-block completion until that answer is received.)*

*(Explicit non-scope — resolves H1)*

- **Phase 1 routing unchanged:** This FR introduces **no** change to `notify_slack`. `notify_slack` continues to key the SSM path by the event's repo name and has no dependency on the `projects` table. There is **no** requirement that "`notify_slack` resolves the webhook via the project column." Any future change to make Phase 1 read the project's stored path would be a separate, explicitly-scoped Phase 1 change (not in this CR). *(This bullet exists to close the H1 inconsistency: Phase 2 stores a reference for visibility; Phase 1 routing is untouched.)*
- Given a project with no Slack reference configured, when a macro event fires, then Phase 1 `notify_slack` behaves exactly as today — it attempts `/kiro-governance/slack/webhooks/{repo}` and, if absent, returns `{ notified: false, reason: 'webhook_not_configured' }` without blocking the governance DB write (`mcp-server-core-architecture.md §6.4`). Phase 2 simply has no reference to display.

---

### FR-P2-036: GitHub-Event-to-Project Reconciliation

**Priority:** Must Have
**Source:** Customer — Phase 2 transcript: progress-MD change is "drag[ged]… as a gate… write it down on our database" (`.kiro/Knowledge/Phase2MeetingTranscript.txt`); FR-P2-011 (governance integration). Reconciliation **via `github_repo`** is **Architect decision — not customer-specified** (fixes the Item 3 defect).

**Description:**
Governance events produced by GitHub commits/merges (Phase 1, keyed by repo name) shall reconcile to the correct Phase 2 project via the project's `github_repo` link, so that macro-gate approvals mark the matching `macro_checkpoints` complete and micro events surface against the project.

**Acceptance Criteria:**
- Given a `governance_events` row with `project_id = R`, when a project exists with `github_repo = R`, then that event is attributed to that project in all timeline/gate/reporting surfaces (§2 surfaces 1–5).
- Given a macro `governance_events` row whose `gate` maps (via `GATE_TO_CHECKPOINT`, `gates-architecture.md §5.2`) to a `macro_checkpoints` row of the reconciled project, when the checkpoint's `reached_at IS NULL`, then `reached_at` is set to the event's `created_at` and `reviewed_by` to the event's `actor`.
- Given multiple governance events matching the same checkpoint, when reconciled, then the earliest event (`MIN(created_at)`) determines `reached_at` (consistent with `gates-architecture.md §5.6`).
- Given a `governance_events` row whose `project_id` matches **no** project's `github_repo`, when processed, then it is silently skipped (no error). *(No regression vs today's silent drop — `gates-architecture.md §5.5`.)*
- **[Could-Have — deferred to CR-07]** The count of such unmatched governance events **may** be surfaced in an operational admin view for visibility. *(Architect-added scope, not customer-specified — per review L4 this is downgraded from Must to Could-Have and split into deferred story CR-07; it is NOT part of the core fix.)*
- Given a project whose `github_repo` is later corrected, when the timeline is next requested, then previously-unmatched events for the new repo name now appear (reconciliation is evaluated on read).

---

### FR-P2-037: MCP Governance Logs Visible Per Project

**Priority:** Must Have
**Source:** Customer — FR-P2-011 source quote: "you're collecting stuff in your database for Kiro. Where would I see that if I'm a project manager?" (`srs.md` FR-P2-011). This FR makes FR-P2-011 actually deliver by fixing the join key.

**Description:**
For every project with a valid GitHub link, the MCP governance events shall be visible in the project timeline, the gate view, and the leadership reporting surfaces, joined via `github_repo` (not `jira_key`).

**Acceptance Criteria:**
- Given a project with `github_repo = R` and one or more `governance_events` rows with `project_id = R`, when `GET /api/projects/{projectId}/timeline` is called, then those events appear as timeline entries with `source: 'kiro_mcp'`, ordered chronologically.
- Given the same project, when `GET /api/reporting/timeline/{projectId}` is called, then the same governance events appear.
- Given the `v_timeline` view, when queried for that project, then governance rows are returned (join uses `github_repo`).
- Given a project with `github_repo = NULL`, when its timeline is requested, then only DeliverPro-native events (checkpoints, evidence) appear and no error is raised.
- Given a project whose `github_repo` was just backfilled, when the timeline is requested, then historical governance events for that repo appear immediately (no reprocessing/sync required).

---

## 5. Proposed Data-Model Deltas (SPEC ONLY — not applied)

> These would be a new migration (`V004__github_slack_linkage.sql`) and corresponding edits to `docs/phase2/architecture/unified-data-model.md`. **Not applied here.** Two variants are given; pick per the OQ-CR-02 cardinality answer.

### 5.1 Variant A — 1:1 (recommended default): columns on `projects`

```sql
-- V004 (PROPOSED) — Option A: one GitHub repo + one Slack destination per project

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS github_repo            TEXT,        -- GitHub repository name (matches governance_events.project_id)
  ADD COLUMN IF NOT EXISTS github_url             TEXT,        -- full HTTPS repo URL (display/convenience)
  ADD COLUMN IF NOT EXISTS slack_webhook_ssm_path TEXT,        -- SSM SecureString PATH reference (explicit resolved string) — NOT the secret itself
  ADD COLUMN IF NOT EXISTS slack_channel_id       TEXT,        -- non-secret display value, e.g. '#deliverpro-delivery'
  ADD COLUMN IF NOT EXISTS updated_by             TEXT,        -- Cognito sub of last mutator (audit — S-3)
  ADD COLUMN IF NOT EXISTS updated_at             TIMESTAMPTZ; -- last mutation timestamp (audit — S-3)

-- Enforce 1:1 repo↔project (partial unique index tolerates multiple NULLs).
-- NOTE (review L2): this partial UNIQUE index ALSO serves reconciliation lookups
-- (you never look up github_repo IS NULL), so no separate plain btree index is created.
CREATE UNIQUE INDEX IF NOT EXISTS uq_projects_github_repo
  ON projects (github_repo)
  WHERE github_repo IS NOT NULL;

-- Optional full audit trail for linkage changes (S-3). Use this if updated_by/updated_at
-- on projects is insufficient for the compliance/audit requirement.
CREATE TABLE IF NOT EXISTS project_link_audit (
  id          BIGSERIAL   PRIMARY KEY,
  project_id  TEXT        NOT NULL REFERENCES projects(jira_key) ON DELETE CASCADE,
  field       TEXT        NOT NULL,   -- 'github_repo' | 'github_url' | 'slack_webhook_ssm_path' | 'slack_channel_id'
  old_value   TEXT,
  new_value   TEXT,
  actor_sub   TEXT        NOT NULL,   -- Cognito sub of the actor
  changed_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_project_link_audit_project ON project_link_audit (project_id);
```

> **Secret-path handling (S-4):** `slack_webhook_ssm_path` is stored as an **explicit, validated string** (fixed prefix `/kiro-governance/slack/webhooks/`, charset `[A-Za-z0-9_-]`, no leading/consecutive dots, no `..`). It is never assembled at read time by concatenating raw `github_repo`. See FR-P2-035 AC.
>
> **Index note (L3):** the partial unique index is used for the **strict-match** join (`p.github_repo = ge.project_id`, post-transition). The transition-window predicate (`p.github_repo = ge.project_id OR (p.github_repo IS NULL AND p.jira_key = ge.project_id)`) may not use the index for the OR/NULL branch and can seq-scan — harmless at ≤200 projects (NFR-P2-005).

| Column | Type | Nullable | Secret? | Purpose |
|--------|------|----------|---------|---------|
| `github_repo` | `TEXT` | yes (partial UNIQUE where NOT NULL) | no | Reconciliation key ↔ `governance_events.project_id` |
| `github_url` | `TEXT` | yes | no | Clickable repo link |
| `slack_webhook_ssm_path` | `TEXT` | yes | **reference only** | Explicit validated path to SSM SecureString; never the URL |
| `slack_channel_id` | `TEXT` | yes | no | Human-readable channel for display |
| `updated_by` | `TEXT` | yes | no | Cognito `sub` of last mutator (audit — S-3) |
| `updated_at` | `TIMESTAMPTZ` | yes | no | Last mutation timestamp (audit — S-3) |

**Never stored:** the raw Slack webhook URL and any GitHub token (see §7).

### 5.2 Variant C — 1:N (if a project has many repos): mapping table

```sql
-- V004 (PROPOSED) — Option C: multiple GitHub repos per project
CREATE TABLE IF NOT EXISTS project_github_repos (
  id            BIGSERIAL   PRIMARY KEY,
  project_id    TEXT        NOT NULL REFERENCES projects(jira_key) ON DELETE CASCADE,
  github_repo   TEXT        NOT NULL,
  github_url    TEXT,
  is_primary    BOOLEAN     NOT NULL DEFAULT false,  -- the repo whose Slack destination routes project notifications
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_project_github_repo UNIQUE (github_repo)          -- a repo maps to at most one project
);
CREATE INDEX IF NOT EXISTS idx_project_github_repos_project ON project_github_repos (project_id);
-- At most one primary repo per project:
CREATE UNIQUE INDEX IF NOT EXISTS uq_project_github_repos_primary
  ON project_github_repos (project_id) WHERE is_primary = true;

-- Slack reference still lives on projects (per §5.1 slack_* columns) OR per-repo if routing is per-repo (OQ-CR-03)
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS slack_webhook_ssm_path TEXT,
  ADD COLUMN IF NOT EXISTS slack_channel_id       TEXT;
```

### 5.3 Timeline / Reconciliation Query Change

**Current (`gates-architecture.md §5.4`, `V003 v_timeline`):**
```sql
FROM governance_events ge JOIN projects p ON p.jira_key = ge.project_id
```

**Proposed — Variant A (collision-safe transition join — resolves S-1/M1):**
```sql
FROM governance_events ge
JOIN projects p
  ON  p.github_repo = ge.project_id
   OR (p.github_repo IS NULL AND p.jira_key = ge.project_id)
```
*(The `jira_key` branch is confined to projects with `github_repo IS NULL` and is gated by the collision guard in §3.4.3. Drop the `jira_key` branch entirely once backfill is complete and validated — CR-06 — leaving `ON p.github_repo = ge.project_id`.)*

**Proposed — Variant C:**
```sql
FROM governance_events ge
JOIN project_github_repos m ON m.github_repo = ge.project_id
JOIN projects p             ON p.jira_key    = m.project_id
```

**Reconciliation UPDATE change (`gates-architecture.md §5.3`):** replace `WHERE ge.project_id = mc.project_id` with a resolution of `ge.project_id → github_repo → jira_key`, then match `mc.project_id = <resolved jira_key>`.

### 5.4 Views Affected

`v_timeline` (join repointed), and — because reconciliation now sets `reached_at` for GitHub-triggered gates — `v_project_summary` (`current_phase`, `last_checkpoint_at`) and `v_gate_completion` (`completed_count`, `completion_pct`) will begin reflecting GitHub-sourced completions. No column changes to these three views; only the underlying join fix in `v_timeline` and the reconciliation write path.

### 5.5 Documentation Note

The `slack_webhook_ssm_path` on `projects` and the `governance_events` read are **cross-domain**: the `config`/`projects` domains own the linkage columns; the `gates` and `reporting` domains consume them in the join. `governance_events` remains **read-only** from Phase 2 (no writes) — the fix is entirely on the Phase 2 join/linkage side.

---

## 6. Affected Documents & Backlog

### 6.1 Documents to Update (after approval)

| Document | Change Required |
|----------|-----------------|
| `docs/phase2/srs.md` | Add FR-P2-033..037; **change FR-P2-019** (onboarding "Slack channel" item must capture `slack_channel_id` + webhook reference, not a boolean); add OQ-CR-01..05 to §10; bump version + changelog |
| `docs/phase2/architecture/unified-data-model.md` | Add `projects.github_repo`, `github_url`, `slack_webhook_ssm_path`, `slack_channel_id` (Variant A) or new `project_github_repos` table (Variant C); update §5 access patterns; update §7 indexes; update §8 consistency check; update §6 PII inventory (repo names/channel ids are non-PII) |
| `docs/phase2/projects-architecture.md` | Add `github_repo`/`github_url`/Slack fields to `Project`, `CreateProjectInput`, `UpdateProjectInput`; add validation + 409 `DUPLICATE_GITHUB_REPO`; add `IMMUTABLE_FIELD` guard for `jira_key`; update onboarding item completion (§3.4) to capture channel |
| `docs/phase2/gates-architecture.md` | Repoint §5.1 join condition, §5.3 reconciliation UPDATE, §5.4 timeline UNION source 1 to `github_repo`; update §5.5 orphan handling (add unmatched-count) |
| `docs/phase2/reporting-architecture.md` | Repoint §5.3 `v_timeline`; note §5.1/§5.2 views now include GitHub-sourced completions. **(L1) Reconcile the 3-way drift:** reporting §5.3 documents `v_timeline` source 1 with **no** project join, but deployed V003 joins on `jira_key` and gates §5.4 filters `WHERE ge.project_id=$1`. Capture all three representations and repoint them consistently to the collision-safe `github_repo` join. |
| `docs/phase2/config-architecture.md` | If Slack reference management is admin-driven, add endpoints/notes for setting `slack_webhook_ssm_path` / `slack_channel_id` |
| `docs/phase2/architecture/domain-decomposition.md` | Note new linkage columns' ownership (`projects` domain) and cross-domain read by `gates`/`reporting` |
| Phase 1 — `docs/phase1/mcp-server-core-architecture.md` | Cross-reference only: document that Phase 2 reconciles via `github_repo`; §6.3 Slack SSM path convention `/kiro-governance/slack/webhooks/{repo}` is now also referenced from a Phase 2 project field (no Phase 1 behavior change). **(S-9) Reconcile stale persistence description:** this doc still describes DynamoDB persistence while the unified data model v1.4 uses RDS — correct the drift (documentation-only; no behavior change). |
| Shared types + API contracts (`packages/shared/types/`, `specs/api/projects.yaml`, etc.) | **(L5)** Add `github_repo`, `github_url`, `slack_webhook_ssm_path`, `slack_channel_id`, `updated_by`, `updated_at` to the shared `Project` type and OpenAPI schemas; add `409 DUPLICATE_GITHUB_REPO`, `422 IMMUTABLE_FIELD`, `403 FORBIDDEN` (linkage), and `400 VALIDATION_ERROR` (path) responses. Called out explicitly (was implicit under the API story). |
| Phase 1 — `docs/phase1/github-trigger-architecture.md` | Cross-reference only: confirm `project_id = repo name` is retained (Option A/C do not change Phase 1) |
| Phase 1 — `docs/phase1/agent-integration-architecture.md` | Cross-reference only: `KIRO_PROJECT_ID` resolution unchanged; note mapping now occurs on Phase 2 side |

### 6.2 Migrations

- New `migrations/V004__github_slack_linkage.sql` (Variant A or C). V002/V003 remain untouched (append-only migration policy).

### 6.3 Backlog Stories & Phasing (Technical PM capacity review)

Estimation basis: 1 pt = 1 hr; 20 pts/sprint; 1 developer; sequential (single dev). **Total = 29 pts (~1.5 sprints).** Core-fix subset (CR-01+02+03+06) = 19 pts (~1 sprint).

| Story | Summary | FR | Pts | Type | Depends on |
|-------|---------|----|----|------|-----------|
| **CR-01** | V004 migration: linkage columns + partial unique index + audit columns/`project_link_audit` | FR-034/035 | 3 | **Additive** | Approval; cardinality (OQ-CR-02) |
| **CR-02** | `projects` API retrofit: expose + validate fields; `409 DUPLICATE_GITHUB_REPO`; `422 IMMUTABLE_FIELD` (`jira_key`); `403` linkage-authz (admin/leadership, Cognito-sub); audit write; **update shared TS types + OpenAPI (L5)**; update tests | FR-033/034/035 | 5 | **Retrofit** (DP-05) | CR-01 |
| **CR-03** | Repoint governance join + reconciliation to `github_repo` (gates §5.3/§5.4, reporting timeline, `v_timeline`, collision-safe transition join); **reconcile reporting §5.3 vs migration 3-way drift (L1)**; update E2E | FR-036/037 | 8 | **Retrofit — highest risk** (DP-10/29/40) | CR-01 |
| **CR-04** | Onboarding item captures `slack_channel_id` + webhook reference (soft capture) instead of bare boolean | FR-P2-019 change | 4 | **Retrofit** (DP-07/08/19) | CR-02 |
| **CR-05** | Frontend: `github_repo`/`github_url`/Slack fields in create + edit form; clickable repo link | FR-034/035 | 3 | **Retrofit** (DP-16/17) | CR-02 |
| **CR-06** | One-time backfill of `github_repo` + validation report; drop transition `jira_key` fallback after validation | FR-036/037 | 3 | **Additive** — **BLOCKED on OQ-CR-06** (mapping data) | CR-02 |
| **CR-07** | *(Deferred, Could-Have)* Admin unmatched-governance-events count | FR-036 (L4) | 3 | **Additive enhancement — DEFER** | CR-03 |

**No change needed (called out):** `notify_slack`/KG-05 (Option A already keys by repo name — **no retrofit**); `governance_events` (append-only/read-only); Phase-1 GitHub Actions + agent-integration (`project_id = repo name` retained).

**Dependencies / critical path:** `OQ-CR-02 → CR-01 → CR-02 → {CR-03, CR-04, CR-05, CR-06}`; `CR-07` depends on `CR-03`. **Hard blockers:** CR-01 blocked by OQ-CR-02 (cardinality); CR-06 blocked by OQ-CR-06 (repo↔project mapping data — cannot backfill without it). Per TPM rule, CR-01 and CR-06 are **not Spec Ready** until their OQs resolve.

**Regression risk (CR-03):** rewrites the live `v_timeline` view + gate auto-completion on deployed RDS. The collision-safe transition join prevents rollout regression; DP-40 E2E must be updated; the `jira_key` fallback branch is dropped **only after CR-06 backfill is validated**. Recommend a dedicated review pass on CR-03.

**Phasing recommendation — IMPLEMENT NOW (core), DEFER one enhancement.** Item #3 is a confirmed defect breaking a customer-confirmed feature on a LIVE system; incremental cost ~$0/mo.

- **Pre-work:** resolve OQs + SRS/arch/data-model updates + plan + security re-review (security-relevant). Architect defaults if OQs stall: Variant A (1:1), `github_repo` nullable-at-creation, soft channel capture. Only **OQ-CR-06 truly blocks CR-06**.
- **CR-Sprint 1 (~20 pts):** CR-01 → CR-02 → CR-03 → CR-04.
- **CR-Sprint 2 (~9 pts):** CR-05 + CR-06 (once mapping supplied) + CR-07 (optional).
- **DEFER:** CR-07 admin count; Variant C multi-repo; GitHub repo-existence validation (OQ-CR-04 — adds a token) — none customer-specified.
- **Fallback if OQs slow:** ship CR-01 → CR-05 on defaults now; hold only CR-06 (no regression, since unlinked projects behave exactly as today).

> **In-flight stories:** existing stories that read the timeline/gate views are **not blocked** — the collision-safe join is backward-compatible during the transition window — but their tests must be updated (CR-03) to assert `github_repo`-based matching.

---

## 7. Cost & Security Notes

### 7.1 Cost

- **Storage:** 4 nullable `TEXT` columns on `projects` (Variant A) or one small mapping table (Variant C) — negligible; the table holds ≤ hundreds of rows (NFR-P2-005: ≤ 200 projects). **~$0/mo incremental.**
- **SSM Parameter Store:** Slack webhooks already stored as SecureString in Phase 1 (`/kiro-governance/slack/webhooks/{repo}`). Standard-tier SSM SecureString is free; KMS decrypt calls are fractions of a cent at this volume. **~$0/mo incremental** (reuses the Phase 1 convention).
- **Compute/RDS:** the reconciliation join changes a predicate, not the query shape. **(L3 correction)** The partial unique index on `github_repo` supports the **strict-match** (post-transition) join `p.github_repo = ge.project_id` in O(log n). The **transition-window** predicate (`p.github_repo = ge.project_id OR (p.github_repo IS NULL AND p.jira_key = ge.project_id)`) cannot use the index for the OR/NULL branch and may seq-scan — this is harmless at ≤200 projects (NFR-P2-005) and disappears once the fallback branch is dropped (CR-06). No measurable RDS cost change on the existing shared `db.t4g.medium`.
- **Net:** effectively **$0/mo** incremental. No new AWS service is introduced; existing RDS + SSM are reused (cost-conscious per standards §17).

### 7.2 Security (this is a security-relevant change)

- **Slack webhook is a secret.** Store only in SSM `SecureString` (or Secrets Manager). The DB stores a **path reference** (`slack_webhook_ssm_path`) and a non-secret `slack_channel_id`. The webhook URL must never be written to `projects`, API responses, or logs. (Consistent with SRS NFR-P2-003 "all API keys and credentials in Secrets Manager", and `mcp-server-core-architecture.md §6.3` which already keeps the webhook in SSM.)
- **GitHub token (if any).** If future GitHub API calls (e.g. validating a repo exists, or richer commit metadata) are added, the GitHub PAT/App token must live in Secrets Manager (`/deliverpro/integrations/github-token` style), never in `projects`. The current defect fix requires **no** GitHub token — it only matches an already-received repo name from `governance_events` — so no token is introduced by this change. *(Flag: if repo-existence validation is desired, that adds a token; see OQ-CR-04.)*
- **Least-privilege access + write-path control (resolves S-5).** Whoever holds `ssm:PutParameter` on the webhooks prefix controls where `notify_slack` POSTs — an SSRF/exfiltration lever. Therefore: **Phase 2 API Lambdas are READ-ONLY** — `ssm:GetParameter` (+ `kms:Decrypt`) scoped to `/kiro-governance/slack/webhooks/*` only, never `PutParameter`. **`ssm:PutParameter` is admin-only / out-of-band (Phase 1 provisioning)** and must never be attached to a general Phase 2 API role. Mirror the tight-scoping pattern in `projects-architecture.md §10.2` (import-jira `PutParameter` scoped to a single path).
- **Read blast radius (S-7 — accepted/documented).** A read scope of `/kiro-governance/slack/webhooks/*` lets the notification Lambda read *every* project's webhook (blast radius = all channels). This matches the existing Phase 1 pattern and is accepted for now; per-parameter tags + ABAC (or per-project roles) are noted as a future hardening if the channel set grows sensitive.
- **Audit (resolves S-3).** Setting/changing `github_repo`, `github_url`, `slack_webhook_ssm_path`, or `slack_channel_id` are linkage mutations — each writes an audit record (actor Cognito `sub`, timestamp, old→new) via `projects.updated_by`/`updated_at` and/or the `project_link_audit` table (§5.1). Linkage mutation is authorized to `admin`/`leadership` only (S-2).
- **No new public surface.** The change adds columns/joins only; no new unauthenticated endpoint. RBAC on the projects/gates/reporting endpoints is unchanged.
- **Input validation.** `github_repo` and `slack_channel_id` are user-supplied → validate against strict charsets (FR-P2-034/035) to avoid injection into SSM path construction. Never build an SSM path from unvalidated input.
- **Input validation & secret-path construction (resolves S-4).** `github_repo` and `slack_channel_id` are user-supplied → validated against strict charsets (FR-P2-034/035). `slack_webhook_ssm_path` is **stored as an explicit validated string** with a fixed prefix `/kiro-governance/slack/webhooks/`; leading dots, consecutive dots, and `..` are rejected. The application **never** concatenates raw `github_repo` into an SSM path at read time.
- **Encryption key (S-8 — parked to customer).** Webhooks currently use the AWS-managed `aws/ssm` key, which cannot be tightly decrypt-scoped. A customer-managed CMK for the webhooks prefix (~$1/mo) would allow scoped `kms:Decrypt`. Parked as **OQ-CR-08**.

---

## 8. Open Questions for Customer

> Items below are **not traceable** to a customer statement and require a business/stakeholder decision. They are parked (not designed around as confirmed) per source-traceability rules. Proposed SRS IDs: OQ-CR-01..05.

| # | Question | Why it matters | Recommendation |
|---|----------|----------------|----------------|
| OQ-CR-01 | Is `github_repo` **mandatory at project creation**, or may a project exist before its repo is attached? | Determines NOT NULL vs nullable; affects when governance logs start appearing | Nullable at creation, linkable later (matches "attach it to a repository" as a separate step) |
| OQ-CR-02 | **One GitHub repo per project, or many?** | Chooses Variant A (columns on `projects`) vs Variant C (mapping table) | Confirm; App Mod projects often have multiple repos → lean Variant C if in doubt |
| OQ-CR-03 | If many repos per project, **which repo's Slack destination routes project notifications** (a single primary, or per-repo)? | Slack routing design | One primary repo per project (`is_primary`) routes notifications |
| OQ-CR-04 | Should the platform **validate that a linked GitHub repo actually exists** (via GitHub API)? | Adds a GitHub token (secret) + API cost + a new integration | Defer — match on repo name only; no token needed for the core fix |
| OQ-CR-05 | Are GitHub **repo names guaranteed unique and stable** across the org (no renames)? | Repo rename would orphan historical `governance_events` from the project | If renames occur, keep old repo names in the mapping table (Variant C) as aliases |
| OQ-CR-06 | For existing projects, **what is the authoritative repo↔project mapping** for backfill? | Backfill data source (§3.4) | PM-supplied mapping or one-time admin entry |
| OQ-CR-07 | Must onboarding **mandatorily capture the `slack_channel_id`** to complete "Set up Slack/Teams channel", or is soft capture (record if provided) acceptable? | Determines whether the onboarding item hard-blocks completion (FR-P2-035 / FR-P2-019 change) | Soft capture — record the channel/webhook reference if provided, do not block completion. Make mandatory only if the customer requires it. |
| OQ-CR-08 | Should the Slack webhook SSM parameters use a **customer-managed KMS CMK** (~$1/mo) instead of the AWS-managed `aws/ssm` key, to allow tightly-scoped `kms:Decrypt`? | Tighter decrypt scoping / blast-radius reduction vs a small monthly cost (S-7/S-8) | Optional hardening — adopt if the channel set is considered sensitive; otherwise stay on `aws/ssm` (default). |

---

## 9. Decision Required From Human (sign-off gate)

**No SRS, data-model, or code change is made until the items below are signed off.** This CR is a proposal; the following decisions must be recorded before the Product Analyst amends `docs/phase2/srs.md` and the AWS Architect amends the data model.

### 9.1 Must decide before ANY SRS/data-model change (blocking)

| # | Decision needed | Default if unanswered | Blocks |
|---|-----------------|-----------------------|--------|
| D1 | **Approve the CR direction:** proceed to add FR-P2-033..037 and change FR-P2-019, fixing the GitHub↔project identifier defect on the live system. | — (cannot proceed without approval) | Everything |
| D2 | **OQ-CR-02 — cardinality:** one GitHub repo per project (Variant A) or many (Variant C)? | Variant A (1:1) | CR-01 schema shape (columns vs mapping table) |
| D3 | **OQ-CR-01 — `github_repo` nullable at creation** or mandatory? | Nullable at creation, linkable later | CR-02 API validation |
| D4 | **OQ-CR-07 — onboarding channel capture** mandatory or soft? | Soft capture (does not block completion) | CR-04 onboarding behaviour |
| D5 | **OQ-CR-06 — authoritative repo↔project mapping** for backfill. | *No default — data dependency* | **CR-06 backfill (hard block)** — and dropping the transition `jira_key` fallback |

### 9.2 Confirm the resolved High/Medium security & correctness decisions

These were resolved by architect/security defaults in this revision; confirm acceptance (they change behaviour vs the first draft):

| # | Decision | Resolution taken |
|---|----------|------------------|
| D6 | **Linkage mutation authorization (S-2).** Who may change `github_repo`/Slack refs? | Restricted to **`admin`/`leadership`** (Cognito-sub check); `pm` can no longer change linkage. Confirm this is acceptable to the customer's operating model. |
| D7 | **Collision-safe join (S-1/M1).** | Strict `github_repo` match; `jira_key` fallback only for unlinked projects, gated by a collision guard; fallback dropped after backfill. No customer decision needed — confirm acceptance. |
| D8 | **Audit of linkage changes (S-3).** | `updated_by`/`updated_at` on `projects` + optional `project_link_audit` table. Confirm whether the full audit table is required or the two columns suffice. |

### 9.3 Optional / can decide later (non-blocking)

| # | Decision | Recommendation |
|---|----------|----------------|
| D9 | **OQ-CR-04 — validate repo existence via GitHub API?** (adds a GitHub token/secret) | Defer — not needed for the core fix. |
| D10 | **OQ-CR-08 — customer-managed CMK for webhook SSM params** (~$1/mo). | Optional hardening; default to `aws/ssm`. |
| D11 | **CR-07 admin unmatched-events count** (Could-Have). | Defer to a later enhancement. |
| D12 | **OQ-CR-03 / OQ-CR-05** (multi-repo Slack routing; repo-rename handling). | Only relevant if Variant C is chosen (D2). |

### 9.4 What happens on approval

1. Product Analyst adds FR-P2-033..037 and changes FR-P2-019 in `docs/phase2/srs.md` (with `Source:` tags), bumps the SRS version + changelog, and adds OQ-CR-01..08 to §10.
2. AWS Architect applies the V004 data-model delta (chosen variant) to `docs/phase2/architecture/unified-data-model.md` and repoints the join/reconciliation in gates + reporting architecture docs (collision-safe), plus the L1/L5/S-9 doc reconciliations.
3. Both changes are re-reviewed (plan-reviewer + security-reviewer) before Technical PM opens CR-01..07 in the backlog.
4. Implementation proceeds per §6.3 phasing (core now, CR-07 deferred).

---

## Appendix — Verification Sources Consulted

- `docs/phase2/srs.md` (v1.4) — FR-P2-001, 009, 011, 019; §7 schema; §8.3/§8.4; §10 OQs
- `docs/phase2/projects-architecture.md` (v1.3) — §2.2/§2.4 (create/patch, immutability), §3.1/§3.2 (schema), §3.4 (onboarding), §10 (IAM least-privilege pattern)
- `docs/phase2/gates-architecture.md` (v1.0) — §2.8 (timeline), §5.1–5.6 (governance integration, join, reconciliation, orphan handling)
- `docs/phase2/reporting-architecture.md` (v1.0) — §2.1/§2.2, §5.1–5.3 (views)
- `docs/phase2/config-architecture.md` (v1.1) — casdm_config / analysis_prompts (context)
- `docs/phase2/architecture/unified-data-model.md` (v1.0) — §2 (governance_events read-only), §3.1 (projects), §4 (V003), §5–8
- `docs/phase2/architecture/domain-decomposition.md` (v1.0) — table ownership, cross-domain reads
- `migrations/V002__projects_and_casdm_tracking.sql` — projects PK + jira_key UNIQUE, no github/slack columns
- `migrations/V003__phase2_additions.sql` — confirms no github/slack columns added; `v_timeline` join `p.jira_key = ge.project_id`
- `docs/phase1/mcp-server-core-architecture.md` (v1.2) — §3.1/§3.2 (project_id = repo name), §6.3/§7.1 (Slack SSM path)
- `docs/phase1/github-trigger-architecture.md` (v1.3) — §4.2 (project_id = github.event.repository.name, OQ-02 Tariq Khan 2026-06-11)
- `docs/phase1/agent-integration-architecture.md` (v1.2) — §3.2 (project_id resolution)
- `.kiro/Knowledge/Phase2MeetingTranscript.txt`, `Phase2MeetingNotes.txt`, `Phase2Transcript.txt`, `kiro_governance_brief (2).md` — customer statements on repo attachment, Slack notification, macro-gate list

*End of Impact Analysis — 2026-07-02*
