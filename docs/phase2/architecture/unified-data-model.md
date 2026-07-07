# Unified Data Model — Phase 2: DeliverPro

## Changelog

| Date | Version | Author | Change |
|------|---------|--------|--------|
| 2026-07-07 | v1.5 | AWS Architect | **Level 2 micro→artifact auto-completion ACTIVATED (CR-12/CR-14, FR-P2-042) — no GitHub OIDC.** New `V008__level2_micro_artifact_autocomplete.sql`: (A) adds nullable `governance_events.event_code TEXT` + partial index `idx_governance_events_event_code(project_id, event_code)` — additive, append-only-safe (Phase-1/CR-14); (B) adds `micro_artifacts.manual_override BOOLEAN NOT NULL DEFAULT false` (override precedence); (C) **seeds the inert V004 `micro_artifact_mapping`** with 16 `event_code → (phase, artifact_name)` rows (`project_type='default'`, `is_active=true`); (D) adds append-only `micro_artifact_audit` table (reversibility trail); (E) explicit idempotent grants — `kiro_phase2` `SELECT` on `micro_artifact_mapping` + `SELECT,UPDATE` on `micro_artifacts` + `INSERT,SELECT` on `micro_artifact_audit`, and `REVOKE ALL` on those three from the MCP runtime role **`kiro_mcp_app`** (append-only posture preserved — the auto-completion `UPDATE` runs ONLY under `kiro_phase2`). Auto-completion is app-side, deterministic (`event_code` lookup), idempotent, own-repo-scoped, `completed_by='kiro:<actor>'`. Source: `specs/phase2/CR-12-14-level2-spec.md`. |
| 2026-07-03 | v1.4 | Backend Developer | **Append-only master-collision fix (iam-review Finding 2 / SEC-H1).** V005 previously used `kiro_mcp` as the "locked-down runtime role", but `kiro_mcp` is the RDS **master** (superuser) — so its `INSERT/SELECT`-only grants were silently bypassed and append-only was defeated. §4.4.4 now introduces a DISTINCT non-master runtime role **`kiro_mcp_app`** (`LOGIN NOSUPERUSER NOINHERIT`); all runtime grants (`INSERT,SELECT` on `governance_events` + sequence, column-scoped `SELECT` on `projects`, NO `UPDATE/DELETE`, no `micro_artifact_mapping`) move onto it. Master `kiro_mcp` = admin/migrations ONLY (unchanged — renaming the master would force replacement of the RETAIN/deletion-protected instance). GATE 2 repoints the MCP runtime `DB_USER` + IAM `rds-db:connect` ARN to `kiro_mcp_app`. Updated: V005 migration + `V005__verify.sql` (+ `kiro_mcp_app` NOSUPERUSER assertions) + `V005__preflight_audit.sql` (GATE 1 hard-fail if `kiro_mcp_app` is superuser; GATE 2 session check → `kiro_mcp_app`); infra `governance-stack.ts` (IAM ARN, SSM db-user, `.env.example`, output); `packages/mcp-server` (`DB_USER=kiro_mcp_app`); deploy runbook GATE 2. §5 access-patterns + §8 cross-doc rows repointed to `kiro_mcp_app`. |
| 2026-07-03 | v1.3 | AWS Architect | **V006/V007 reconciliation.** The `v_timeline` `jira_key`→`github_repo` repoint (§4.4.6) — described in v1.2 as a "separate timeline-reconciliation CR, not yet delivered" — is now **delivered by `V006__timeline_repoint.sql` (CR-03)**, preserving the 11-column contract and carrying the collision-safe interim `jira_key` fallback branch. **CR-06 backfill is CANCELLED** (customer fresh-start decision 2026-07-03); the interim fallback branch is now dropped at cutover (fresh start → no legacy imported projects), not "after CR-06 validates". Added **`V007__fresh_start_cleanup.sql` (CR-17)** — a destructive, guard-gated, NOT-auto-run cleanup of legacy `CST-*` imports (preserves `__template__`, `DP-*`, and append-only `governance_events`). Migration table + §2 + §4.4.6 status updated accordingly. |
| 2026-07-02 | v1.2 | Backend Developer | **CR-01/CR-01A split reconciliation.** The v1.1 entry attributed the append-only hardening AND the `v_timeline` repoint to V004; both are now correctly attributed. **V004 (CR-01) = ADDITIVE ONLY** (columns, index, `project_link_audit` + triggers, inert `micro_artifact_mapping`). **V005 (CR-01A) = real append-only** via ownership reassignment to `kiro_migrator` + hardened `kiro_mcp` grants (§4.4.4). The `v_timeline` `jira_key`→`github_repo` repoint (§4.4.6) is a **separate timeline-reconciliation CR** (gated on CR-06 backfill) — not yet delivered by any migration. `kiro_mcp` column-grant on `projects` corrected to the 6-column set (`github_repo, jira_key, slack_micro_channel_id, slack_macro_channel_id, id, title`). |
| 2026-07-02 | v1.1 | AWS Architect | V004 additions for GitHub↔Slack linkage change request (FR-P2-033..041): added `github_repo`, `github_url`, `slack_micro_channel_id`, `slack_macro_channel_id`, `updated_by`, `updated_at` to `projects`; partial unique index `uq_projects_github_repo`; new `project_link_audit` table + per-field `BEFORE UPDATE` trigger; real append-only via ownership reassignment to `kiro_migrator` (hardened `kiro_mcp` grants); no-orphan governance-event note; `v_timeline` join repointed `jira_key`→`github_repo` (collision-safe transition). Level-2 auto-completion (`micro_artifact_mapping`, `event_code`) DEFERRED — not in this migration. *(SUPERSEDED by v1.2 — the append-only hardening moved to V005/CR-01A and the `v_timeline` repoint to a separate reconciliation CR.)* |
| 2026-06-30 | v1.0 | AWS Architect | Initial unified data model consolidating V001 (read-only), V002 (base), V003 (additions) from all Phase 2 architecture docs |

---

## 1. Overview

Phase 2 DeliverPro operates on three migration layers:

| Migration | Status | Purpose |
|-----------|--------|---------|
| `V001__governance_events.sql` | Deployed (Phase 1) | Append-only governance events from Kiro MCP server. **Read-only from Phase 2.** |
| `V002__projects_and_casdm_tracking.sql` | Deployed | Base tables: projects, micro_artifacts, macro_checkpoints, gate_evidence, casdm_config, checkpoint_notes |
| `V003__phase2_additions.sql` | New | Column additions to existing tables + 6 new tables + 3 SQL views |
| `V004__github_slack_linkage.sql` | New | **Additive only:** GitHub/Slack linkage columns on `projects` + `project_link_audit` table + per-field audit trigger + partial unique index + inert `micro_artifact_mapping` (CR-01) |
| `V005__append_only_hardening.sql` | New | **Privilege/ownership only:** real append-only — ownership reassignment to `kiro_migrator` + hardened `kiro_mcp` grants (INSERT/SELECT on events + column SELECT on projects) + `kiro_phase2` app re-grant (CR-01A). Security-sensitive + ops-gated. |
| `V006__timeline_repoint.sql` | New | **Behavioural (view repoint):** `v_timeline` source-1 join `jira_key`→`github_repo` with a collision-safe interim `jira_key` fallback branch; preserves the 11-column contract; macro stays app-owned/display-only (CR-03). |
| `V007__fresh_start_cleanup.sql` | New | **DESTRUCTIVE / NOT auto-run:** guard-gated (`SET kiro.confirm_fresh_start='yes'`) removal of legacy `CST-*` imports (+ cascaded children). Preserves `__template__`, `DP-*`, and `governance_events`. Replaces the cancelled CR-06 backfill (CR-17). Excluded from the ordered migration set. |
| `V008__level2_micro_artifact_autocomplete.sql` | New | **Additive + seed + grants (Level 2 / CR-12/CR-14):** nullable `governance_events.event_code` (+partial index); `micro_artifacts.manual_override`; seeds the inert `micro_artifact_mapping` (16 rows); new append-only `micro_artifact_audit`; explicit `kiro_phase2` grants (SELECT mapping, SELECT/UPDATE `micro_artifacts`, INSERT/SELECT audit) with `kiro_mcp_app` kept append-only (no grant on the Level-2 tables). Activates FR-P2-042. |

**Database:** RDS PostgreSQL 16 (standard RDS, not Aurora; shared with Phase 1 MCP server on the same instance). *(Some earlier prose said "Aurora PG15"; the deployed instance is standard RDS PostgreSQL 16 per `docs/phase1/data-persistence-architecture.md`.)*

**Total tables:** 15 (1 Phase 1 read-only + 6 from V002 + 5 from V003 + 2 new from V004 + 1 new from V008 [`micro_artifact_audit`]); **V005/V006 add no tables; V007 deletes rows only (no schema change); V008 adds `micro_artifact_audit` + 2 columns (`governance_events.event_code`, `micro_artifacts.manual_override`).**
**Total views:** 3 (QuickSight-ready, V003). *(The `v_timeline` `jira_key`→`github_repo` repoint in §4.4.6 is delivered by `V006__timeline_repoint.sql` (CR-03), preserving the 3-view count and the 11-column contract.)*

> **Migration split note (CR-01/CR-01A):** V004 is intentionally additive/idempotent and carries **no** role/ownership/GRANT DDL, so it deploys ahead of the hardening with zero blast radius. V005 carries the append-only hardening and is **security-sensitive + ops-gated** (mandatory pre-impl ownership audit + a runtime-repoint-off-master ops prerequisite — see §4.4.4).

---

## 2. V001 — Phase 1 Read-Only Table

### `governance_events`

Phase 1's Kiro MCP server writes to this table. Phase 2 DeliverPro **reads only** — it never writes, updates, or deletes rows in this table.

| Column | Type | Constraints | Purpose |
|--------|------|------------|---------|
| `id` | `BIGSERIAL` | PK | Surrogate key |
| `project_id` | `TEXT` | NOT NULL | Kiro project identifier (matches `projects.jira_key`) |
| `update_text` | `TEXT` | NOT NULL, max 4096 chars | Human-readable event description |
| `type` | `TEXT` | NOT NULL, CHECK `('macro','micro')` | Event classification |
| `flag_override` | `BOOLEAN` | — | Manual type override flag |
| `gate` | `TEXT` | — | Canonical gate name (e.g., `'SRS approved'`) |
| `phase` | `TEXT` | — | Phase identifier (e.g., `'Phase 1'`) |
| `phase_name` | `TEXT` | — | Human-readable phase name |
| `source_ref` | `TEXT` | NOT NULL | Artifact path or reference |
| `actor` | `TEXT` | NOT NULL | Agent or human who produced the event |
| `created_at` | `TIMESTAMPTZ` | NOT NULL, DEFAULT now() | Event timestamp |
| `idempotency_key` | `TEXT` | NOT NULL, UNIQUE | Dedup key (prevents double-writes) |

**Indexes:**

| Name | Columns | Notes |
|------|---------|-------|
| `idx_project_created` | `(project_id, created_at DESC)` | Timeline query |
| `idx_type_created` | `(type, created_at DESC)` | Filter by event type |
| `idx_gate_created` | `(gate, created_at DESC) WHERE gate IS NOT NULL` | Gate-specific lookups |

**Phase 2 reads this table for:**
- Timeline interleaving (`gates` domain §5) — merges governance events with checkpoint completions. The join is `projects.github_repo = governance_events.project_id` (`project_id` is the GitHub repo name, not `jira_key`); this repoint is **delivered by `V006__timeline_repoint.sql` (CR-03, §4.4.6)** with a collision-safe interim `jira_key` fallback dropped at cutover (CR-06 backfill cancelled — fresh start). V004 (additive) and V005 (append-only) do not touch the view.
- Leadership reporting timeline and the `v_timeline` view (same `github_repo` join)

> **V005 append-only enforcement (FR-P2-038 / SEC-H1 / iam-review Finding 2 — CR-01A):** From **V005**, table ownership of `governance_events` (and all other tables/sequences/views) is reassigned to a non-runtime `kiro_migrator` role. The DEDICATED non-master runtime role **`kiro_mcp_app`** (`NOSUPERUSER`) holds **only** `INSERT, SELECT ON governance_events` (+ its sequence) — no `UPDATE`/`DELETE` on any table. This makes append-only a real DB guarantee (a plain `REVOKE` was insufficient because the tables were previously *owned* by the connecting role, and grants on the RDS master `kiro_mcp` were bypassed because the master is a superuser). See §4.4.4. **Ops-gated:** ownership reassignment does NOT enforce append-only while the MCP runtime connects as the RDS master (superuser bypasses ownership) — the MCP runtime must be repointed to the non-master `kiro_mcp_app` role (GATE 2, §4.4.4). The master `kiro_mcp` is admin/migrations only.

> **Macro events are display-only:** Phase 1 `type = 'macro'` governance events surface on the timeline but **never** set `macro_checkpoints.reached_at`. Macro completion is app-owned (FR-P2-041). There is no `governance_events → macro_checkpoints` auto-completion write path.

---

## 3. V002 Tables (Already Written)

### 3.1 `projects`

**Owner:** `projects` domain

| Column | Type | Constraints | Purpose |
|--------|------|------------|---------|
| `id` | `BIGSERIAL` | PK | Surrogate key |
| `jira_key` | `TEXT` | NOT NULL, UNIQUE | Primary business key (e.g., `CST-674`, `DP-001`) |
| `jira_id` | `TEXT` | — | Jira internal ID (from import) |
| `jira_link` | `TEXT` | — | Jira issue URL |
| `title` | `TEXT` | NOT NULL | Project title |
| `description` | `TEXT` | — | Project description |
| `project_type` | `TEXT` | — | Type: `'AppDev'`, `'AppMod'`, `'AIML'`, etc. |
| `status` | `TEXT` | — | `'Active'`, `'Closing'`, `'Closed'`, `'On Hold'`, `'TEMPLATE'` |
| `account_executive` | `TEXT` | — | AE name |
| `solution_architect` | `TEXT` | — | SA name |
| `project_manager` | `TEXT` | — | PM name |
| `engineers_assigned` | `TEXT` | — | Comma-separated engineer names |
| `planned_kickoff_date` | `DATE` | — | Target kickoff date |
| `expected_completion_date` | `DATE` | — | Target completion date |
| `resource_assignment_date` | `DATE` | — | When resources were assigned |
| `created_at_jira` | `TIMESTAMPTZ` | — | Original Jira creation timestamp |
| `updated_at_jira` | `TIMESTAMPTZ` | — | Last Jira update timestamp |
| `sow_hours` | `NUMERIC(8,2)` | — | SOW budgeted hours |
| `sow_link` | `TEXT` | — | SOW document link |
| `last_synced_at` | `TIMESTAMPTZ` | NOT NULL, DEFAULT now() | Last Jira sync timestamp |
| `created_at` | `TIMESTAMPTZ` | NOT NULL, DEFAULT now() | Row creation timestamp |
| `hours_consumed` | `NUMERIC(8,2)` | DEFAULT 0 (V003) | Hours consumed to date (manually updated by PM) |
| `github_repo` | `TEXT` | nullable, partial UNIQUE (V004) | GitHub repo name — reconciliation key for governance events + linkage feature switch |
| `github_url` | `TEXT` | nullable (V004) | Full HTTPS repo URL (`https://github.com/...` only); clickable display link |
| `slack_micro_channel_id` | `TEXT` | nullable (V004) | Non-secret Slack channel id for MICRO notifications (CI/Kiro-owned) |
| `slack_macro_channel_id` | `TEXT` | nullable (V004) | Non-secret Slack channel id for MACRO notifications (app-owned) |
| `updated_by` | `TEXT` | nullable (V004) | Cognito `sub` of last mutator (linkage audit) |
| `updated_at` | `TIMESTAMPTZ` | nullable (V004) | Last mutation timestamp (linkage audit) |

> **Secret handling:** The Slack workspace **bot token is a SECRET** stored only in SSM SecureString (default KMS key) as a single workspace-level parameter — it is **never** a column, API response, or log line. `projects` holds only the non-secret channel ids (FR-P2-035).

**Indexes:**

| Name | Columns |
|------|---------|
| `idx_projects_jira_key` | `(jira_key)` |
| `idx_projects_status` | `(status)` |
| `idx_projects_type` | `(project_type)` |
| `uq_projects_github_repo` (V004) | `(github_repo) WHERE github_repo IS NOT NULL` — partial unique, 1:1 repo↔project |

---

### 3.2 `micro_artifacts`

**Owner:** `gates` domain

| Column | Type | Constraints | Purpose |
|--------|------|------------|---------|
| `id` | `BIGSERIAL` | PK | Surrogate key |
| `project_id` | `TEXT` | NOT NULL, FK → `projects(jira_key)` ON DELETE CASCADE | Project reference |
| `phase` | `TEXT` | NOT NULL | Phase identifier |
| `phase_name` | `TEXT` | NOT NULL | Human-readable phase name |
| `artifact_name` | `TEXT` | NOT NULL | Artifact label |
| `status` | `TEXT` | NOT NULL, DEFAULT `'pending'`, CHECK `('pending','in_progress','complete')` | Artifact status |
| `artifact_url` | `TEXT` | — | S3 key, Git path, or external URL |
| `completed_at` | `TIMESTAMPTZ` | — | Completion timestamp |
| `completed_by` | `TEXT` | — | Who/what completed it |
| `created_at` | `TIMESTAMPTZ` | NOT NULL, DEFAULT now() | Row creation timestamp |

**Constraints:**
- `uq_micro_artifact` UNIQUE `(project_id, phase, artifact_name)`

**Indexes:**

| Name | Columns |
|------|---------|
| `idx_micro_artifacts_project` | `(project_id)` |
| `idx_micro_artifacts_project_phase` | `(project_id, phase)` |

---

### 3.3 `macro_checkpoints`

**Owner:** `gates` domain

| Column | Type | Constraints | Purpose |
|--------|------|------------|---------|
| `id` | `BIGSERIAL` | PK | Surrogate key |
| `project_id` | `TEXT` | NOT NULL, FK → `projects(jira_key)` ON DELETE CASCADE | Project reference |
| `phase` | `TEXT` | NOT NULL | Phase identifier |
| `phase_name` | `TEXT` | NOT NULL | Human-readable phase name |
| `checkpoint_name` | `TEXT` | NOT NULL | Gate label |
| `checkpoint_type` | `TEXT` | NOT NULL, CHECK (see V003 §4.1) | `'human_review'`, `'meeting'`, `'transcript_analysis'`, `'checklist'` |
| `reviewed_by` | `TEXT` | — | SA/Tech Lead name (human_review) |
| `reviewed_at` | `TIMESTAMPTZ` | — | Review timestamp |
| `occurred` | `BOOLEAN` | — | Meeting yes/no |
| `meeting_link` | `TEXT` | — | Avoma/Zoom URL |
| `transcript_url` | `TEXT` | — | Transcript S3 reference |
| `analysis_result` | `JSONB` | — | AI analysis structured output |
| `analysis_run_at` | `TIMESTAMPTZ` | — | When AI analysis completed |
| `notes` | `TEXT` | — | Inline notes (legacy — use checkpoint_notes table) |
| `created_at` | `TIMESTAMPTZ` | NOT NULL, DEFAULT now() | Row creation timestamp |

**Constraints:**
- `uq_macro_checkpoint` UNIQUE `(project_id, phase, checkpoint_name)`

**Indexes:**

| Name | Columns |
|------|---------|
| `idx_macro_checkpoints_project` | `(project_id)` |
| `idx_macro_checkpoints_project_phase` | `(project_id, phase)` |

---

### 3.4 `gate_evidence`

**Owner:** `gates` domain

| Column | Type | Constraints | Purpose |
|--------|------|------------|---------|
| `id` | `BIGSERIAL` | PK | Surrogate key |
| `project_id` | `TEXT` | NOT NULL, FK → `projects(jira_key)` ON DELETE CASCADE | Project reference |
| `checkpoint_name` | `TEXT` | NOT NULL | Associated checkpoint |
| `evidence_type` | `TEXT` | NOT NULL, CHECK `('meeting_link','transcript','file_upload','url','ai_analysis')` | Evidence category |
| `label` | `TEXT` | — | Display label |
| `value` | `TEXT` | NOT NULL | URL, S3 key, or JSON string |
| `uploaded_by` | `TEXT` | — | Who attached it |
| `created_at` | `TIMESTAMPTZ` | NOT NULL, DEFAULT now() | Row creation timestamp |

**Indexes:**

| Name | Columns |
|------|---------|
| `idx_gate_evidence_project` | `(project_id, checkpoint_name)` |

---

### 3.5 `casdm_config`

**Owner:** `config` domain

| Column | Type | Constraints | Purpose |
|--------|------|------------|---------|
| `id` | `BIGSERIAL` | PK | Surrogate key |
| `config_type` | `TEXT` | NOT NULL, CHECK `('phase','micro_artifact','macro_checkpoint')` | Row discriminator |
| `phase` | `TEXT` | NOT NULL | Phase identifier |
| `phase_name` | `TEXT` | NOT NULL | Human-readable phase name |
| `phase_order` | `INT` | NOT NULL | Display order |
| `item_name` | `TEXT` | — | Gate/artifact name (NULL for phase rows) |
| `item_order` | `INT` | — | Display order within phase |
| `item_type` | `TEXT` | — | Checkpoint type for macros |
| `is_mandatory` | `BOOLEAN` | NOT NULL, DEFAULT true | Required for phase advancement |
| `is_active` | `BOOLEAN` | NOT NULL, DEFAULT true | Soft-delete |
| `changed_by` | `TEXT` | — | Last modifier |
| `created_at` | `TIMESTAMPTZ` | NOT NULL, DEFAULT now() | Row creation timestamp |
| `updated_at` | `TIMESTAMPTZ` | NOT NULL, DEFAULT now() | Last modification timestamp |

**Indexes:**

| Name | Columns |
|------|---------|
| `idx_casdm_config_phase` | `(phase, config_type)` |

---

### 3.6 `checkpoint_notes`

**Owner:** `gates` domain

| Column | Type | Constraints | Purpose |
|--------|------|------------|---------|
| `id` | `BIGSERIAL` | PK | Surrogate key |
| `project_id` | `TEXT` | NOT NULL, FK → `projects(jira_key)` ON DELETE CASCADE | Project reference |
| `checkpoint_name` | `TEXT` | NOT NULL | Associated checkpoint |
| `note_text` | `TEXT` | NOT NULL, max 4000 chars | Note content |
| `author` | `TEXT` | NOT NULL | Note author |
| `created_at` | `TIMESTAMPTZ` | NOT NULL, DEFAULT now() | Row creation timestamp |

**Indexes:**

| Name | Columns |
|------|---------|
| `idx_checkpoint_notes_project` | `(project_id, checkpoint_name)` |

---

## 4. V003 Additions

### 4.1 ALTER TABLE — Existing Table Changes

#### `macro_checkpoints` — New Columns

| Column | Type | Default | Purpose | Source |
|--------|------|---------|---------|--------|
| `meeting_date` | `DATE` | NULL | When the meeting actually happened (user-provided) | gates-architecture §2.2, SRS §7.2 |
| `result_detail` | `TEXT` | NULL | Rich outcome text (e.g., "3 of 5 topics covered") | gates-architecture §2.2, SRS §7.2 |
| `reached_at` | `TIMESTAMPTZ` | NULL | System timestamp when checkpoint was logged as complete | gates-architecture §4, SRS §7.2 |

#### `macro_checkpoints` — Updated CHECK Constraint

```sql
ALTER TABLE macro_checkpoints
  DROP CONSTRAINT IF EXISTS macro_checkpoints_checkpoint_type_check,
  ADD CONSTRAINT macro_checkpoints_checkpoint_type_check
    CHECK (checkpoint_type IN ('human_review', 'meeting', 'transcript_analysis', 'checklist'));
```

The `'checklist'` type supports onboarding (FR-P2-019) and closure (FR-P2-023) checkpoints.

#### `gate_evidence` — New Column

| Column | Type | Default | Purpose | Source |
|--------|------|---------|---------|--------|
| `link_metadata` | `JSONB` | NULL | URL metadata: `{ "title": string, "date": string, "duration_minutes": number | null }` | files-architecture §6.5, SRS §7.2 |

#### `projects` — New Column

| Column | Type | Default | Purpose | Source |
|--------|------|---------|---------|--------|
| `hours_consumed` | `NUMERIC(8,2)` | 0 | Hours consumed to date (manually updated by PM) | projects-architecture §3.2, SRS §7.2 |

#### `casdm_config` — New Column + Constraints

| Column | Type | Default | Purpose | Source |
|--------|------|---------|---------|--------|
| `project_type` | `TEXT` | `'default'` | Template key per project type | config-architecture §2.1, SRS §7.2 |

New constraints:
- `casdm_config_item_type_check` — validates `item_type` values per `config_type`
- `uq_casdm_config_phase_item_project_type` — UNIQUE `(phase, item_name, project_type, config_type)`
- `idx_casdm_config_project_type` — index on `(project_type, is_active)`

---

### 4.2 New Tables

#### `weekly_status_logs`

**Owner:** `meetings` domain
**Source:** FR-P2-020, meetings-architecture §3.1

| Column | Type | Constraints | Purpose |
|--------|------|------------|---------|
| `id` | `BIGSERIAL` | PK | Surrogate key |
| `project_id` | `TEXT` | NOT NULL, FK → `projects(jira_key)` ON DELETE CASCADE | Project reference |
| `log_date` | `DATE` | NOT NULL | Date of the status call |
| `meeting_link` | `TEXT` | — | Avoma URL |
| `topics_covered` | `TEXT` | NOT NULL, max 4000 chars | Meeting topics |
| `demo_items` | `TEXT` | max 2000 chars | Demo items discussed |
| `blockers` | `TEXT` | max 2000 chars | Blockers raised |
| `logged_by` | `TEXT` | NOT NULL | Who logged the entry |
| `created_at` | `TIMESTAMPTZ` | NOT NULL, DEFAULT now() | Row creation timestamp |

**Indexes:**

| Name | Columns |
|------|---------|
| `idx_weekly_status_logs_project_date` | `(project_id, log_date DESC)` |

---

#### `escalations`

**Owner:** `meetings` domain
**Source:** FR-P2-021, meetings-architecture §3.2

| Column | Type | Constraints | Purpose |
|--------|------|------------|---------|
| `id` | `BIGSERIAL` | PK | Surrogate key |
| `project_id` | `TEXT` | NOT NULL, FK → `projects(jira_key)` ON DELETE CASCADE | Project reference |
| `raised_date` | `DATE` | NOT NULL | When escalation was raised |
| `description` | `TEXT` | NOT NULL, max 2000 chars | Escalation description |
| `severity` | `TEXT` | NOT NULL, CHECK `('low','medium','high','critical')` | Severity level |
| `raised_by` | `TEXT` | NOT NULL, max 200 chars | Person who raised it |
| `resolved_date` | `DATE` | — | When resolved |
| `resolution_notes` | `TEXT` | max 2000 chars | Resolution details |
| `status` | `TEXT` | NOT NULL, DEFAULT `'open'`, CHECK `('open','resolved')` | Current status |
| `created_at` | `TIMESTAMPTZ` | NOT NULL, DEFAULT now() | Row creation timestamp |

**Indexes:**

| Name | Columns |
|------|---------|
| `idx_escalations_project_status` | `(project_id, status)` |
| `idx_escalations_project_severity` | `(project_id, severity)` |

---

#### `discovery_sessions`

**Owner:** `meetings` domain
**Source:** FR-P2-025, meetings-architecture §3.3

| Column | Type | Constraints | Purpose |
|--------|------|------------|---------|
| `id` | `BIGSERIAL` | PK | Surrogate key |
| `project_id` | `TEXT` | NOT NULL, FK → `projects(jira_key)` ON DELETE CASCADE | Project reference |
| `session_number` | `INT` | NOT NULL | Auto-incremented per project |
| `session_date` | `DATE` | NOT NULL | Session date |
| `meeting_link` | `TEXT` | — | Avoma/Zoom URL |
| `participants` | `TEXT` | NOT NULL, max 1000 chars | Attendee names |
| `notes` | `TEXT` | max 4000 chars | Session notes |
| `created_at` | `TIMESTAMPTZ` | NOT NULL, DEFAULT now() | Row creation timestamp |

**Constraints:**
- `uq_discovery_session` UNIQUE `(project_id, session_number)`

**Indexes:**

| Name | Columns |
|------|---------|
| `idx_discovery_sessions_project` | `(project_id, session_number)` |

---

#### `onboarding_checklist_items`

**Owner:** `projects` domain
**Source:** FR-P2-019, projects-architecture §3.3

| Column | Type | Constraints | Purpose |
|--------|------|------------|---------|
| `id` | `BIGSERIAL` | PK | Surrogate key |
| `project_id` | `TEXT` | NOT NULL, FK → `projects(jira_key)` ON DELETE CASCADE | Project reference |
| `item_name` | `TEXT` | NOT NULL | Checklist item label |
| `completed` | `BOOLEAN` | NOT NULL, DEFAULT false | Completion state |
| `completed_by` | `TEXT` | — | Who checked it off |
| `completed_at` | `TIMESTAMPTZ` | — | When checked off |
| `created_at` | `TIMESTAMPTZ` | NOT NULL, DEFAULT now() | Row creation timestamp |

**Indexes:**

| Name | Columns |
|------|---------|
| `idx_onboarding_project` | `(project_id)` |

---

#### `analysis_prompts`

**Owner:** `config` domain
**Source:** FR-P2-029, config-architecture §2.2

| Column | Type | Constraints | Purpose |
|--------|------|------------|---------|
| `id` | `BIGSERIAL` | PK | Surrogate key |
| `checkpoint_name` | `TEXT` | NOT NULL, UNIQUE | Maps to `macro_checkpoints.checkpoint_name` |
| `prompt_text` | `TEXT` | NOT NULL | AgentCore prompt template |
| `updated_by` | `TEXT` | — | Last editor |
| `updated_at` | `TIMESTAMPTZ` | NOT NULL, DEFAULT now() | Last edit timestamp |
| `created_at` | `TIMESTAMPTZ` | NOT NULL, DEFAULT now() | Row creation timestamp |

---

### 4.3 QuickSight-Ready Views

#### `v_project_summary`

Cross-project summary with computed phase, burn rate, and activity timestamps. Source: reporting-architecture §5.1.

**Key columns:** `jira_key`, `title`, `project_type`, `status`, `project_manager`, `solution_architect`, `sow_hours`, `hours_consumed`, `burn_rate_pct`, `current_phase`, `last_checkpoint_at`, `last_status_log_at`, `planned_kickoff_date`, `expected_completion_date`, `created_at`

---

#### `v_gate_completion`

Per-checkpoint completion rates across all projects. Source: reporting-architecture §5.2.

**Key columns:** `checkpoint_name`, `checkpoint_type`, `phase`, `phase_name`, `project_type`, `total_projects`, `completed_count`, `completion_pct`, `avg_days_to_complete`

---

#### `v_timeline`

Full activity timeline (3-source UNION ALL). Source: reporting-architecture §5.3.

**Key columns (11-column contract, as deployed in V003 and preserved unchanged by V004/V005/V006):** `project_id`, `project_title`, `event_type`, `event_id`, `event_timestamp`, `phase`, `phase_name`, `title`, `actor`, `detail`, `sub_type`.

> **Note (plan LOW-9):** an earlier draft listed a `source` column and omitted `project_title`/`phase_name`/`sub_type`. The deployed view emits `sub_type` and has **no** `source` column — the `source` label (`'kiro_mcp'`/`'deliverpro'`) belongs to the `gates-architecture.md` §5.4 project-timeline handler CTE, which is a different query, not `v_timeline`.

> **`v_timeline` join repoint (DELIVERED by V006 — CR-03):** `v_timeline` source-1 now joins `projects.github_repo = governance_events.project_id` and emits `projects.jira_key` as the `project_id` column so downstream consumers remain `jira_key`-keyed (see §4.4.6). V006 carries a **collision-safe interim** `OR (p.github_repo IS NULL AND p.jira_key = ge.project_id)` fallback branch; with the CR-06 backfill cancelled (fresh start), that branch is dropped at cutover per the deploy runbook. The repoint is delivered by `V006__timeline_repoint.sql`, not V004 (additive) or V005 (append-only).

---

## 4.4 V004 Additions (GitHub ↔ Slack Linkage)

**Source:** SRS FR-P2-033..041; change request `docs/phase2/change-requests/2026-07-02-github-slack-linkage-impact.md` §v3-4.
**Migrations:** §4.4.1–4.4.3 (additive schema) = `V004__github_slack_linkage.sql` (CR-01). §4.4.4 (append-only hardening) = `V005__append_only_hardening.sql` (CR-01A). §4.4.5 (no-orphan write-path note) is enforced in application code. §4.4.6 (`v_timeline` repoint) = `V006__timeline_repoint.sql` (CR-03).

### 4.4.1 `projects` — New Columns

| Column | Type | Nullable | Secret? | Purpose | Source |
|--------|------|----------|---------|---------|--------|
| `github_repo` | `TEXT` | yes (partial UNIQUE) | no | Reconciliation key + linkage feature switch; resolve lookup for MCP | FR-P2-034/038 |
| `github_url` | `TEXT` | yes | no | Clickable repo link (`https://github.com/...` only) | FR-P2-034 |
| `slack_micro_channel_id` | `TEXT` | yes | no | MICRO notification destination (CI/Kiro-owned) | FR-P2-035/039 |
| `slack_macro_channel_id` | `TEXT` | yes | no | MACRO notification destination (app-owned) | FR-P2-035/039 |
| `updated_by` | `TEXT` | yes | no | Cognito `sub` of last mutator (linkage audit) | FR-P2-034 |
| `updated_at` | `TIMESTAMPTZ` | yes | no | Last mutation timestamp (linkage audit) | FR-P2-034 |

### 4.4.2 `projects` — New Index

| Name | Columns | Type |
|------|---------|------|
| `uq_projects_github_repo` | `(github_repo) WHERE github_repo IS NOT NULL` | partial unique btree — enforces 1:1 repo↔project; tolerates multiple NULLs (unlinked) |

### 4.4.3 New Table: `project_link_audit`

**Owner:** `projects` domain
**Source:** FR-P2-034, FR-P2-035 (per-field old→new audit)

| Column | Type | Constraints | Purpose |
|--------|------|------------|---------|
| `id` | `BIGSERIAL` | PK | Surrogate key |
| `project_id` | `TEXT` | NOT NULL, FK → `projects(jira_key)` ON DELETE CASCADE | Project reference |
| `field` | `TEXT` | NOT NULL | Changed column: `github_repo` / `github_url` / `slack_micro_channel_id` / `slack_macro_channel_id` |
| `old_value` | `TEXT` | — | Previous value |
| `new_value` | `TEXT` | — | New value |
| `actor_sub` | `TEXT` | NOT NULL | Cognito `sub`, or `'db_direct'` for out-of-band SQL changes |
| `changed_at` | `TIMESTAMPTZ` | NOT NULL, DEFAULT now() | Change timestamp |

**Indexes:** `idx_project_link_audit_project` on `(project_id)`.

**Trigger:** `audit_project_linkage` — `BEFORE UPDATE ON projects FOR EACH ROW`, function `trg_audit_project_linkage()`. Writes **one row per changed field** (uses `IS DISTINCT FROM` per column), so a single PATCH touching two fields produces two audit rows (matches FR-P2-034/035 ACs). `actor_sub` derives from `NEW.updated_by`, falling back to `'db_direct'`.

### 4.4.4 Real Append-Only via Ownership Reassignment (SEC-H1)

**Source:** FR-P2-038; SEC-H1. **Migration:** `V005__append_only_hardening.sql` (CR-01A) — **not** V004 (V004 is additive-only).

V001 granted `kiro_mcp` only `ALL PRIVILEGES ON DATABASE` (database scope: CONNECT/CREATE/TEMP — not table DML). `kiro_mcp` could `INSERT` **only because it owned the tables**; an owner keeps all rights regardless of `REVOKE`. V005 fixes this:

1. Creates a non-runtime `kiro_migrator` role (DO-block guard — `CREATE USER IF NOT EXISTS` is invalid PostgreSQL) that **owns** all tables and sequences. It is **`NOINHERIT`** (SEC-H1) so a member session does not implicitly gain owner rights.
2. `ALTER TABLE ... OWNER TO kiro_migrator` for every governance/DeliverPro table (and every sequence and view — the V005 migration uses a dynamic `pg_class` loop so it covers ALL objects found by the audit).
3. Grants the DEDICATED non-master runtime role `kiro_mcp_app` **exactly** `INSERT, SELECT ON governance_events` (+ its sequence) and column-scoped `SELECT (github_repo, jira_key, slack_micro_channel_id, slack_macro_channel_id, id, title) ON projects` — **no** `UPDATE`/`DELETE`/write on any table. *(The column set adds `id` (stable surrogate join key) and `title` (project-labelled Slack message body, `[jira_key] title …`) to the four resolve/routing columns; both are non-secret. Per the CR-01A build instruction.)* **The RDS master `kiro_mcp` is NOT granted these runtime privileges** — it is a superuser (see the blocking finding) and any grant on it would be bypassed; runtime grants therefore live only on `kiro_mcp_app` (iam-review Finding 2 collision fix).
4. `ALTER DEFAULT PRIVILEGES FOR ROLE kiro_migrator` keeps future tables/sequences closed to `kiro_mcp_app`, plus `REVOKE CREATE ON SCHEMA public FROM PUBLIC, kiro_mcp_app` (SEC-L9 — matters on PG < 15).
5. **The runtime roles are NOT members of `kiro_migrator`** (SEC-H1). If `kiro_mcp_app` were a member, `INHERIT`/`SET ROLE` would re-grant it owner DML — reproducing the cosmetic-`REVOKE` defect. `V005` `REVOKE kiro_migrator FROM kiro_mcp_app` defensively; the pre-implementation audit verifies `pg_auth_members`.
6. **Phase-2 app role `kiro_phase2`** (plan H2): the DeliverPro Lambdas authenticate as `kiro_phase2` (per DP-01 CDK `dbuser:*/kiro_phase2`), NOT `kiro_mcp`. V005 §F re-establishes its DML (`INSERT/UPDATE/DELETE`) on the DeliverPro-owned tables (projects, micro_artifacts, macro_checkpoints, gate_evidence, checkpoint_notes, onboarding_checklist_items, casdm_config, meetings tables, project_link_audit, micro_artifact_mapping), `SELECT` on `governance_events` + `v_timeline`, and sequence `USAGE, SELECT` — these survive the ownership reassignment. This is the app-owned macro-completion write path (`macro_checkpoints.reached_at`) and linkage writes.

> 🚨 **BLOCKING pre-implementation finding (SEC-H1 / iam-review Finding 2 — human/ops sign-off required):** the RDS instance **master username is `kiro_mcp`** (member of `rds_superuser` — see `data-persistence-architecture.md` §2 and `deploy-outputs.md`), and an earlier revision of V005 ALSO used `kiro_mcp` as the "locked-down runtime role". Those are the **same PostgreSQL role**, so every `INSERT/SELECT`-only grant placed on `kiro_mcp` was **silently bypassed** — a superuser ignores table grants and can `SET ROLE` to the owner and re-grant itself DML. Ownership reassignment ALONE does **not** enforce append-only while the MCP server authenticates as the master. **Fix (V005):** a **distinct non-master runtime role `kiro_mcp_app`** (`LOGIN NOSUPERUSER NOINHERIT`) now holds all runtime grants; the master `kiro_mcp` is reserved for **admin / break-glass / running migrations ONLY**. We do **not** rename the RDS master (that forces replacement of the RETAIN + deletion-protected instance). Append-only becomes a real DB guarantee only when the MCP runtime authenticates as `kiro_mcp_app`: repoint the MCP server (`DB_USER=kiro_mcp_app` + IAM `rds-db:connect` dbuser ARN → `.../dbuser:*/kiro_mcp_app`). If ops keep the runtime on the master for the POC, append-only is a best-effort claim (not a guarantee) and that residual must be risk-accepted alongside SEC-H2 (see `docs/phase2/srs.md` §NFR security). Do not ship it labelled "enforced". **This is GATE 2 of the V005/CR-01A deploy — an ops prerequisite, not DDL; V005 cannot perform the runtime repoint.**

> ⚠️ **Mandatory pre-implementation ownership & role audit (GATE 1):** Before applying `V005__append_only_hardening.sql`, run the read-only `migrations/verify/V005__preflight_audit.sql` and confirm current object ownership (`SELECT tablename, tableowner FROM pg_tables WHERE schemaname='public';`, `pg_sequences`, `pg_views`); the migration-runner identity (member of `kiro_migrator` or the RDS master — never a runtime role); role attributes (`kiro_migrator` NOINHERIT; runtime roles `kiro_mcp_app` + `kiro_phase2` `rolsuper=false` — the audit hard-fails if `kiro_mcp_app` is a superuser); and `pg_auth_members` (runtime roles NOT members of `kiro_migrator`). The V005 ownership loop reassigns ALL discovered public tables/sequences/views. Confirm the MCP runtime `DB_USER` is `kiro_mcp_app` and Phase-2 Lambda `DB_USER` is `kiro_phase2` (repoint from the master/`kiro_mcp` if needed). Do not apply blindly.

### 4.4.5 No-Orphan Governance Event Storage

**Source:** FR-P2-038.

The MCP `record_progress` tool resolves `SELECT jira_key FROM projects WHERE github_repo = $1 LIMIT 1` before writing. No match → **hard reject** (`{ "written": false, "reason": "no_matching_project" }`), a dimensionless `GovernanceEventRejected` CloudWatch counter increments (no repo dimension), and the repo name is written to the structured log only. No orphan row is stored. This is enforced in application code (write-path check) plus the column-scoped read grant above; a coupling DB trigger was considered and rejected to avoid coupling the append-only table (SEC-M4, accepted for POC).

### 4.4.6 `v_timeline` Join Repoint (Level 1)

**Source:** FR-P2-036/037.

`governance_events.project_id` is the **GitHub repo name**, not `jira_key`. The **target** state repoints `v_timeline` source-1 to `JOIN projects p ON p.github_repo = ge.project_id` and emits `p.jira_key` as the `project_id` column so downstream consumers remain `jira_key`-keyed. Unlinked projects (`github_repo IS NULL`) yield zero governance rows — correct feature-switch behaviour. Macro governance events surface but never set `reached_at` (display-only).

> **STATUS — DELIVERED by `V006__timeline_repoint.sql` (CR-03):** The repoint is a DROP+CREATE VIEW behavioural change (neither additive like V004 nor privilege-only like V005), so it ships as its own migration V006. It preserves the deployed 11-column contract; only source-1's join predicate changes. Sources 2 (macro_checkpoints) and 3 (gate_evidence) are byte-for-byte the V003 definitions.

**Collision-safe transition:** V006 uses the interim predicate `ON p.github_repo = ge.project_id OR (p.github_repo IS NULL AND p.jira_key = ge.project_id)` so any already-imported-but-not-yet-linked project keeps showing its events during transition, guarded by the pre-implementation check that **no `github_repo` equals any other project's `jira_key`**. **CR-06 backfill is CANCELLED** (customer fresh-start, 2026-07-03): with no legacy imported projects retained, the `jira_key` fallback branch is dropped at cutover (see the deploy runbook `docs/phase2/runbooks/cr-github-slack-linkage-deploy.md`), leaving only the `github_repo` join. `packages/gates/handlers/project-timeline.ts` and the reporting-timeline SQL are repointed identically.

> **Level-2 DEFERRED:** V004 creates `micro_artifact_mapping` **inert** (no seed rows, no runtime-role grant); there is **no** `event_code` column on `governance_events` (that is Phase-1 CR-14). Level-2 micro→artifact auto-completion (FR-P2-042) is deferred and, when reactivated, runs app-side (no `kiro_mcp` grant) gated on GitHub OIDC (CR-OIDC) + the `event_code` field (CR-14).

---

## 5. Access Patterns

| Table | Owner Domain | Writes | Reads |
|-------|-------------|--------|-------|
| `governance_events` | Phase 1 MCP (external) | Phase 1 MCP server only (`kiro_mcp_app`: **INSERT, SELECT** only — append-only, V005; the non-master runtime role, NOT the RDS master `kiro_mcp`) | `gates` (timeline + reconciliation via `github_repo`), `reporting` (views) |
| `projects` | `projects` | `projects` (create, import, update, close, hours, linkage). MCP `kiro_mcp_app` has **column-scoped SELECT only** (`github_repo, jira_key, slack_micro_channel_id, slack_macro_channel_id, id, title`) — no write (V005) | `gates` (join), `reporting` (summary), `files` (auth check), `meetings` (project verification), MCP (`record_progress`/`notify_slack` resolve) |
| `micro_artifacts` | `gates` | `projects` (seeding on create), `gates` (status updates) | `gates` (gate view), `reporting` (views) |
| `macro_checkpoints` | `gates` | `projects` (seeding on create), `gates` (completion), `analysis` (analysis results) | `gates` (gate view), `projects` (phase computation), `reporting` (views, stalled detection) |
| `gate_evidence` | `gates` | `gates` (attach evidence), `analysis` (ai_analysis results) | `gates` (evidence list), `files` (download auth check), `reporting` (timeline view) |
| `casdm_config` | `config` | `config` (CRUD) | `projects` (template lookup during seeding), `gates` (phase completion logic) |
| `checkpoint_notes` | `gates` | `gates` (add note) | `gates` (list notes) |
| `weekly_status_logs` | `meetings` | `meetings` (create) | `meetings` (list), `reporting` (stalled detection, views) |
| `escalations` | `meetings` | `meetings` (create, resolve) | `meetings` (list) |
| `discovery_sessions` | `meetings` | `meetings` (create) | `meetings` (list) |
| `onboarding_checklist_items` | `projects` | `projects` (seed on create, toggle items) | `projects` (list checklist), `gates` (checklist checkpoint evaluation) |
| `analysis_prompts` | `config` | `config` (create, update) | `analysis` (prompt lookup) |
| `project_link_audit` | `projects` | `projects` (via `BEFORE UPDATE` trigger on `projects`) | `projects` (linkage audit history), admin/leadership review |

---

## 6. PII Inventory

| Table | Field | PII Type | Handling |
|-------|-------|----------|----------|
| `projects` | `project_manager` | Name | Internal employee name — not customer PII. Stored in plain text. |
| `projects` | `solution_architect` | Name | Internal employee name — not customer PII. |
| `projects` | `account_executive` | Name | Internal employee name — not customer PII. |
| `projects` | `engineers_assigned` | Names (CSV) | Internal employee names — not customer PII. |
| `macro_checkpoints` | `reviewed_by` | Name/Email | Internal employee name or email. |
| `gate_evidence` | `uploaded_by` | Name/Email | Internal employee name or email. |
| `checkpoint_notes` | `author` | Name/Email | Internal employee name or email. |
| `weekly_status_logs` | `logged_by` | Name/Email | Internal employee name or email. |
| `escalations` | `raised_by` | Name | Internal employee name. |
| `onboarding_checklist_items` | `completed_by` | Name/Email | Internal employee name or email. |
| `casdm_config` | `changed_by` | Name/Email | Internal employee name or email. |
| `analysis_prompts` | `updated_by` | Name/Email | Internal employee name or email. |
| `governance_events` | `actor` | Agent/Name | Kiro agent name or internal employee. |
| `discovery_sessions` | `participants` | Names | Internal + potentially customer names in free-text. |
| `projects` | `updated_by` | Cognito sub | Opaque Cognito subject id of the linkage mutator — pseudonymous internal identifier. |
| `project_link_audit` | `actor_sub` | Cognito sub | Opaque Cognito subject id (or `'db_direct'`) — pseudonymous internal identifier. |
| `project_link_audit` | `old_value` / `new_value` | Repo/channel ids | Non-secret GitHub repo names, URLs, and Slack channel ids. No secrets (bot token never stored). |

**Assessment:** No customer PII (SSN, date of birth, medical records, financial data) is stored in the DeliverPro schema. All "PII" is limited to internal employee names and emails used for audit trail attribution. `discovery_sessions.participants` may contain customer names in free-text form.

**Mitigation:**
- Encryption at rest via Aurora PostgreSQL default encryption (AES-256)
- Encryption in transit via TLS 1.2+ (enforced by RDS)
- Access controlled via Cognito JWT + RBAC middleware (no unauthenticated access)
- No direct DB access from internet — Lambda in VPC only

---

## 7. Indexes Summary

### V001 Indexes

| Table | Index Name | Columns | Type |
|-------|-----------|---------|------|
| `governance_events` | `idx_project_created` | `(project_id, created_at DESC)` | btree |
| `governance_events` | `idx_type_created` | `(type, created_at DESC)` | btree |
| `governance_events` | `idx_gate_created` | `(gate, created_at DESC) WHERE gate IS NOT NULL` | partial btree |

### V002 Indexes

| Table | Index Name | Columns | Type |
|-------|-----------|---------|------|
| `projects` | `idx_projects_jira_key` | `(jira_key)` | btree |
| `projects` | `idx_projects_status` | `(status)` | btree |
| `projects` | `idx_projects_type` | `(project_type)` | btree |
| `micro_artifacts` | `idx_micro_artifacts_project` | `(project_id)` | btree |
| `micro_artifacts` | `idx_micro_artifacts_project_phase` | `(project_id, phase)` | btree |
| `macro_checkpoints` | `idx_macro_checkpoints_project` | `(project_id)` | btree |
| `macro_checkpoints` | `idx_macro_checkpoints_project_phase` | `(project_id, phase)` | btree |
| `gate_evidence` | `idx_gate_evidence_project` | `(project_id, checkpoint_name)` | btree |
| `casdm_config` | `idx_casdm_config_phase` | `(phase, config_type)` | btree |
| `checkpoint_notes` | `idx_checkpoint_notes_project` | `(project_id, checkpoint_name)` | btree |

### V003 Indexes

| Table | Index Name | Columns | Type |
|-------|-----------|---------|------|
| `casdm_config` | `idx_casdm_config_project_type` | `(project_type, is_active)` | btree |
| `weekly_status_logs` | `idx_weekly_status_logs_project_date` | `(project_id, log_date DESC)` | btree |
| `escalations` | `idx_escalations_project_status` | `(project_id, status)` | btree |
| `escalations` | `idx_escalations_project_severity` | `(project_id, severity)` | btree |
| `discovery_sessions` | `idx_discovery_sessions_project` | `(project_id, session_number)` | btree |
| `onboarding_checklist_items` | `idx_onboarding_project` | `(project_id)` | btree |

### V004 Indexes

| Table | Index Name | Columns | Type |
|-------|-----------|---------|------|
| `projects` | `uq_projects_github_repo` | `(github_repo) WHERE github_repo IS NOT NULL` | partial unique btree |
| `project_link_audit` | `idx_project_link_audit_project` | `(project_id)` | btree |

**Total indexes:** 6 (V001) + 10 (V002) + 6 (V003) + 2 (V004) = **24 indexes** + UNIQUE constraint indexes (5 implicit).

---

## 8. Cross-Document Consistency Check

| Column Reference (Architecture Doc) | Table.Column (Data Model) | Status |
|--------------------------------------|--------------------------|--------|
| gates-architecture §3.1: `mc.meeting_date` | `macro_checkpoints.meeting_date` | ✅ V003 ADD |
| gates-architecture §3.1: `mc.result_detail` | `macro_checkpoints.result_detail` | ✅ V003 ADD |
| gates-architecture §3.1: `mc.reached_at` | `macro_checkpoints.reached_at` | ✅ V003 ADD |
| gates-architecture §6.5: `gate_evidence.link_metadata` | `gate_evidence.link_metadata` | ✅ V003 ADD |
| projects-architecture §3.2: `projects.hours_consumed` | `projects.hours_consumed` | ✅ V003 ADD |
| config-architecture §2.1: `casdm_config.project_type` | `casdm_config.project_type` | ✅ V003 ADD |
| reporting-architecture §5.1: `v_project_summary.hours_consumed` | `projects.hours_consumed` | ✅ V003 ADD |
| reporting-architecture §5.1: `v_project_summary.last_checkpoint_at` → `macro_checkpoints.reached_at` | `macro_checkpoints.reached_at` | ✅ V003 ADD |
| reporting-architecture §5.2: `v_gate_completion.reached_at` | `macro_checkpoints.reached_at` | ✅ V003 ADD |
| reporting-architecture §5.3: `v_timeline.result_detail` | `macro_checkpoints.result_detail` | ✅ V003 ADD |
| gates-architecture §5.4: `ge.id`, `ge.project_id`, `ge.created_at`, `ge.phase`, `ge.gate`, `ge.actor`, `ge.update_text` | All in `governance_events` | ✅ V001 |
| files-architecture §7.3: `gate_evidence.value` (download auth) | `gate_evidence.value` | ✅ V002 |
| config-architecture §2.2: `analysis_prompts.checkpoint_name`, `.prompt_text` | `analysis_prompts` | ✅ V003 |
| analysis-architecture §10: `SELECT prompt_text FROM analysis_prompts WHERE checkpoint_name = $1` | `analysis_prompts.checkpoint_name`, `.prompt_text` | ✅ V003 |
| projects-architecture §5.1: `casdm_config.project_type`, `casdm_config.is_active` | `casdm_config.project_type`, `.is_active` | ✅ V002 + V003 |
| projects-architecture (V004): `projects.github_repo/github_url/slack_micro_channel_id/slack_macro_channel_id/updated_by/updated_at` | `projects` V004 columns | ✅ V004 |
| projects-architecture (V004): `project_link_audit` per-field audit | `project_link_audit` + trigger | ✅ V004 |
| gates-architecture §5: timeline join `p.github_repo = ge.project_id` (macro display-only) | `v_timeline` §4.4.6 repoint | ⏳ PENDING (timeline-reconciliation CR; deployed view still `jira_key`) |
| reporting-architecture §5.3: `v_timeline` governance source join on `github_repo` | `v_timeline` §4.4.6 | ⏳ PENDING (timeline-reconciliation CR) |
| mcp-server-core (Phase 1): `record_progress` resolve-or-reject; `notify_slack` dual-channel; `kiro_mcp_app` append-only grants | `governance_events` INSERT/SELECT + column-scoped `projects` SELECT (runtime role `kiro_mcp_app`, non-master) | ✅ V004 (additive schema) + ✅ V005 §4.4.4 (append-only grants) |

**Discrepancies found:** None. All column references in architecture docs match this data model exactly.

**Minor documentation note:** gates-architecture §6.3 references `POST /api/files/presigned-url` while files-architecture §4.1 defines it as `POST /api/files/upload-url`. This is a prose reference, not a schema discrepancy — no data model impact.

---

*End of Unified Data Model v1.4*
