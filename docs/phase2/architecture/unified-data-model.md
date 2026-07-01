# Unified Data Model — Phase 2: DeliverPro

## Changelog

| Date | Version | Author | Change |
|------|---------|--------|--------|
| 2026-06-30 | v1.0 | AWS Architect | Initial unified data model consolidating V001 (read-only), V002 (base), V003 (additions) from all Phase 2 architecture docs |

---

## 1. Overview

Phase 2 DeliverPro operates on three migration layers:

| Migration | Status | Purpose |
|-----------|--------|---------|
| `V001__governance_events.sql` | Deployed (Phase 1) | Append-only governance events from Kiro MCP server. **Read-only from Phase 2.** |
| `V002__projects_and_casdm_tracking.sql` | Deployed | Base tables: projects, micro_artifacts, macro_checkpoints, gate_evidence, casdm_config, checkpoint_notes |
| `V003__phase2_additions.sql` | New | Column additions to existing tables + 6 new tables + 3 SQL views |

**Database:** Aurora PostgreSQL 15 (shared with Phase 1 MCP server on the same RDS instance).

**Total tables:** 10 (1 Phase 1 read-only + 6 from V002 + 3 new from V003)
**Total views:** 3 (QuickSight-ready, V003)

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
- Timeline interleaving (`gates` domain §5.4) — merges governance events with checkpoint completions
- Auto-completion reconciliation (`gates` domain §5.3) — maps Phase 1 gate approvals to Phase 2 macro checkpoints

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

**Indexes:**

| Name | Columns |
|------|---------|
| `idx_projects_jira_key` | `(jira_key)` |
| `idx_projects_status` | `(status)` |
| `idx_projects_type` | `(project_type)` |

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

**Key columns:** `event_id`, `project_id`, `event_type`, `event_timestamp`, `phase`, `title`, `actor`, `detail`, `source`

---

## 5. Access Patterns

| Table | Owner Domain | Writes | Reads |
|-------|-------------|--------|-------|
| `governance_events` | Phase 1 MCP (external) | Phase 1 MCP server only | `gates` (timeline + reconciliation), `reporting` (views) |
| `projects` | `projects` | `projects` (create, import, update, close, hours) | `gates` (join), `reporting` (summary), `files` (auth check), `meetings` (project verification) |
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

**Total indexes:** 6 (V001) + 10 (V002) + 6 (V003) = **19 indexes** + UNIQUE constraint indexes (5 implicit).

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

**Discrepancies found:** None. All column references in architecture docs match this data model exactly.

**Minor documentation note:** gates-architecture §6.3 references `POST /api/files/presigned-url` while files-architecture §4.1 defines it as `POST /api/files/upload-url`. This is a prose reference, not a schema discrepancy — no data model impact.

---

*End of Unified Data Model v1.0*
