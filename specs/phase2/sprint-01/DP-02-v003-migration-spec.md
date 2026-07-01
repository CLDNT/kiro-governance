# Implementation Spec: DP-02 — V003 Database Migration Script

**Story ID:** DP-02  
**Feature:** F-04 Data Persistence (Phase 2 Additions)  
**Sprint:** Sprint 01 (Phase 2)  
**Owner:** Backend Developer  

---

## 1. Overview

V003 migration extends the Phase 2 DeliverPro schema with:

- **3 ALTER TABLE statements** — add columns to existing tables (`macro_checkpoints`, `gate_evidence`, `projects`, `casdm_config`)
- **6 new tables** — `weekly_status_logs`, `escalations`, `discovery_sessions`, `onboarding_checklist_items`, `analysis_prompts`, and support tables
- **6 new indexes** — performance optimization for common queries
- **3 QuickSight-ready SQL views** — `v_project_summary`, `v_gate_completion`, `v_timeline`
- **Seed data** — default `analysis_prompts`, `casdm_config` AppDev template with all 5 phases
- **Idempotency** — all statements use IF NOT EXISTS / ON CONFLICT to safely re-run

**Database:** Aurora PostgreSQL 15 (same RDS instance as Phase 1 MCP server)  
**Execution:** From EC2 via IAM database auth token (no password hardcoded)  
**Testing:** Full migration test checklist included

---

## 2. Acceptance Criteria

- [ ] All ALTER TABLE statements execute successfully with zero errors
- [ ] All 6 new tables are created with correct schema, constraints, and indexes
- [ ] All 3 QuickSight views are queryable and return correct result sets
- [ ] Default seed data is inserted (analysis_prompts, casdm_config template)
- [ ] Migration is idempotent — running it twice produces same result
- [ ] All foreign key constraints are valid (no orphaned rows)
- [ ] All indexes are created and queryable via EXPLAIN ANALYZE
- [ ] Run time < 5 seconds on dev, < 30 seconds on prod
- [ ] No data loss or corruption in existing tables (V001, V002 untouched except for column additions)

---

## 3. Schema Changes — ALTER TABLE Statements

### 3.1 ALTER macro_checkpoints — Add 3 Columns

**Source:** gates-architecture §2.2, SRS §7.2  
**Rationale:** Support for meeting date tracking, rich outcome text, and system-recorded completion timestamp

```sql
ALTER TABLE macro_checkpoints
  ADD COLUMN IF NOT EXISTS meeting_date DATE,
  ADD COLUMN IF NOT EXISTS result_detail TEXT,
  ADD COLUMN IF NOT EXISTS reached_at TIMESTAMPTZ;
```

**Constraints:**
- `meeting_date` — nullable; user-provided actual meeting date for post-hoc entry
- `result_detail` — nullable TEXT; max practical length ~2000 chars (not enforced in DDL, trust app validation)
- `reached_at` — nullable TIMESTAMPTZ; set by application when checkpoint is marked complete

**Rationale for IF NOT EXISTS:** Safe re-run on existing deployments that may have already added columns via hotfix.

---

### 3.2 ALTER macro_checkpoints — Update CHECK Constraint

**Source:** FR-P2-019 (onboarding checklist), FR-P2-023 (closure checklist)  
**Current CHECK:** `checkpoint_type IN ('human_review', 'meeting', 'transcript_analysis')`  
**New CHECK:** Add `'checklist'` type

```sql
ALTER TABLE macro_checkpoints
  DROP CONSTRAINT IF EXISTS macro_checkpoints_checkpoint_type_check,
  ADD CONSTRAINT macro_checkpoints_checkpoint_type_check
    CHECK (checkpoint_type IN ('human_review', 'meeting', 'transcript_analysis', 'checklist'));
```

**Why DROP then ADD:** PostgreSQL doesn't support in-place constraint modification; must drop first.  
**Why IF EXISTS:** Safe on re-run or if constraint name varies.

**Checkpoint type definitions:**
- `'human_review'` — SA/Tech Lead manually reviewed an artifact
- `'meeting'` — Yes/No flag indicating whether a meeting occurred (tracked via `occurred` boolean)
- `'transcript_analysis'` — Avoma transcript analyzed by AgentCore (results in `analysis_result` JSONB)
- `'checklist'` — Onboarding or closure checklist with items tracked in `onboarding_checklist_items` (new table)

---

### 3.3 ALTER gate_evidence — Add 1 Column

**Source:** files-architecture §6.5, SRS §7.2  
**Rationale:** Cache URL metadata (title, date, duration) to avoid re-fetching during QuickSight view generation

```sql
ALTER TABLE gate_evidence
  ADD COLUMN IF NOT EXISTS link_metadata JSONB;
```

**Schema of link_metadata:**
```json
{
  "title": "string (max 500 chars)",
  "date": "ISO 8601 date string (YYYY-MM-DD)",
  "duration_minutes": "number | null"
}
```

**Example:**
```json
{
  "title": "Phase 2 Kickoff Call",
  "date": "2026-06-25",
  "duration_minutes": 60
}
```

---

### 3.4 ALTER projects — Add 1 Column

**Source:** projects-architecture §3.2, SRS §7.2  
**Rationale:** PM manually updates consumed hours for burn-rate calculation in reporting views

```sql
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS hours_consumed NUMERIC(8,2) DEFAULT 0;
```

**Constraints:**
- Default to 0 for new projects
- NOT NULL constraint will be added later if needed (for now, nullable to allow gradual adoption)
- Max 99999.99 hours (practical limit for project delivery)

---

### 3.5 ALTER casdm_config — Add 1 Column + Constraints

**Source:** config-architecture §2.1, SRS §7.2  
**Rationale:** Support multiple CASDM templates per project type (AppDev, AppMod, AIML)

```sql
ALTER TABLE casdm_config
  ADD COLUMN IF NOT EXISTS project_type TEXT DEFAULT 'default';

ALTER TABLE casdm_config
  DROP CONSTRAINT IF EXISTS uq_casdm_config_phase_item,
  ADD CONSTRAINT uq_casdm_config_phase_item_project_type 
    UNIQUE (phase, item_name, project_type, config_type);

CREATE INDEX IF NOT EXISTS idx_casdm_config_project_type 
  ON casdm_config (project_type, is_active);
```

**Why DROP then ADD on UNIQUE:** The original constraint may not exist or may be named differently across environments.  
**New UNIQUE key:** Allows same `item_name` in same phase across different project types.

**project_type values:**
- `'default'` — fallback for unspecified projects
- `'AppDev'` — application development (5x5x5, new product)
- `'AppMod'` — application modernization (existing system upgrade)
- `'AIML'` — AI/ML project template (future extension)

---

## 4. New Tables

### 4.1 weekly_status_logs

**Owner:** `meetings` domain  
**Source:** FR-P2-020, meetings-architecture §3.1  
**Purpose:** Track weekly status calls (async or sync) with topics, demos, and blockers

```sql
CREATE TABLE IF NOT EXISTS weekly_status_logs (
  id              BIGSERIAL PRIMARY KEY,
  project_id      TEXT NOT NULL REFERENCES projects(jira_key) ON DELETE CASCADE,
  log_date        DATE NOT NULL,
  meeting_link    TEXT,
  topics_covered  TEXT NOT NULL CHECK (char_length(topics_covered) <= 4000),
  demo_items      TEXT CHECK (char_length(demo_items) <= 2000),
  blockers        TEXT CHECK (char_length(blockers) <= 2000),
  logged_by       TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_weekly_status_logs_project_date 
  ON weekly_status_logs (project_id, log_date DESC);
```

**Indexes:** `(project_id, log_date DESC)` — for listing recent logs per project

---

### 4.2 escalations

**Owner:** `meetings` domain  
**Source:** FR-P2-021, meetings-architecture §3.2  
**Purpose:** Track blockers raised to PM/SA for resolution

```sql
CREATE TABLE IF NOT EXISTS escalations (
  id               BIGSERIAL PRIMARY KEY,
  project_id       TEXT NOT NULL REFERENCES projects(jira_key) ON DELETE CASCADE,
  raised_date      DATE NOT NULL,
  description      TEXT NOT NULL CHECK (char_length(description) <= 2000),
  severity         TEXT NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  raised_by        TEXT NOT NULL CHECK (char_length(raised_by) <= 200),
  resolved_date    DATE,
  resolution_notes TEXT CHECK (char_length(resolution_notes) <= 2000),
  status           TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_escalations_project_status 
  ON escalations (project_id, status);
CREATE INDEX IF NOT EXISTS idx_escalations_project_severity 
  ON escalations (project_id, severity);
```

**Indexes:** Two composite indexes for filtering by status and severity

---

### 4.3 discovery_sessions

**Owner:** `meetings` domain  
**Source:** FR-P2-025, meetings-architecture §3.3  
**Purpose:** Track discovery/customer engagement calls

```sql
CREATE TABLE IF NOT EXISTS discovery_sessions (
  id             BIGSERIAL PRIMARY KEY,
  project_id     TEXT NOT NULL REFERENCES projects(jira_key) ON DELETE CASCADE,
  session_number INT NOT NULL,
  session_date   DATE NOT NULL,
  meeting_link   TEXT,
  participants   TEXT NOT NULL CHECK (char_length(participants) <= 1000),
  notes          TEXT CHECK (char_length(notes) <= 4000),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT uq_discovery_session UNIQUE (project_id, session_number)
);

CREATE INDEX IF NOT EXISTS idx_discovery_sessions_project 
  ON discovery_sessions (project_id, session_number);
```

**Unique constraint:** Enforces one entry per session number per project  
**session_number:** Auto-incremented per project (not global SERIAL)

---

### 4.4 onboarding_checklist_items

**Owner:** `projects` domain  
**Source:** FR-P2-019, projects-architecture §3.3  
**Purpose:** Track onboarding checklist items for new projects

```sql
CREATE TABLE IF NOT EXISTS onboarding_checklist_items (
  id            BIGSERIAL PRIMARY KEY,
  project_id    TEXT NOT NULL REFERENCES projects(jira_key) ON DELETE CASCADE,
  item_name     TEXT NOT NULL,
  completed     BOOLEAN NOT NULL DEFAULT false,
  completed_by  TEXT,
  completed_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_onboarding_project ON onboarding_checklist_items (project_id);
```

**Soft-delete pattern:** Completed items keep `completed_at` timestamp; deletion not supported (audit trail)

---

### 4.5 analysis_prompts

**Owner:** `config` domain  
**Source:** FR-P2-029, config-architecture §2.2  
**Purpose:** Store AgentCore prompts for each transcript_analysis checkpoint type

```sql
CREATE TABLE IF NOT EXISTS analysis_prompts (
  id              BIGSERIAL PRIMARY KEY,
  checkpoint_name TEXT NOT NULL UNIQUE,
  prompt_text     TEXT NOT NULL,
  updated_by      TEXT,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

**UNIQUE on checkpoint_name:** One prompt per checkpoint type (one-to-one mapping)  
**No indexes beyond PK:** Small table, `checkpoint_name` is UNIQUE (implicit index)



---

## 5. Seed Data

### 5.1 analysis_prompts — Default Prompts

**Source:** analysis-architecture §10, config-architecture §2.2  
**Purpose:** One default prompt per transcript_analysis checkpoint  
**Timing:** Seed once at migration time; updated via admin UI afterward

All checkpoints of type `'transcript_analysis'` need prompts. From CASDM template (V002), these are:

1. Phase 0: "Transcript Analysis (Sales to Delivery Handoff)"
2. Phase 2: "Implementation Plan Review (Transcript Analysis)"
3. Phase 4: "Project Retrospective (Transcript Analysis)"

```sql
INSERT INTO analysis_prompts (checkpoint_name, prompt_text) VALUES
  (
    'Transcript Analysis (Sales to Delivery Handoff)',
    'Analyze the sales-to-delivery handoff transcript. Extract: (1) customer pain points mentioned, (2) scope boundaries agreed, (3) success criteria stated, (4) risks flagged. Return JSON with arrays for each category.'
  ),
  (
    'Implementation Plan Review (Transcript Analysis)',
    'Analyze the implementation plan review meeting. Extract: (1) engineering team readiness confidence (0-100), (2) blockers identified, (3) timeline concerns raised, (4) resources committed. Return JSON with structured assessment.'
  ),
  (
    'Project Retrospective (Transcript Analysis)',
    'Analyze the project retrospective. Extract: (1) what went well (list items), (2) what could improve (list items), (3) customer satisfaction signals, (4) team morale assessment. Return JSON with categorized feedback.'
  )
ON CONFLICT (checkpoint_name) DO NOTHING;
```

**Idempotency:** ON CONFLICT DO NOTHING — safe to re-run  
**Prompt text:** Intentionally simple; can be refined via admin UI later

---

### 5.2 casdm_config — AppDev Template (All 5 Phases)

**Source:** config-architecture §2.1, CASDM XLS  
**Purpose:** Default CASDM phase/gate/artifact template for AppDev projects  
**Project types included:** `'default'` and `'AppDev'` (same template)

**Phases to seed:**
- Phase 0 (Internal Preparation) — 5 outputs, 2 macros
- Phase 1 (Discover & Align) — 1 output, 4 macros
- Phase 2 (Design & Review) — 5 outputs, 2 macros
- Phase 3 (Build & Implement) — 3 outputs, 2 macros
- Phase 4 (Launch & Enable) — 1 output, 6 macros

**Total rows:** 5 phases + 15 micro artifacts + 16 macro checkpoints = 36 rows per project_type = 72 total

```sql
-- Phase 0: Internal Preparation
INSERT INTO casdm_config (config_type, phase, phase_name, phase_order, item_name, item_order, item_type, is_mandatory, project_type) VALUES
  ('phase', 'Phase 0', 'Internal Preparation', 0, NULL, NULL, NULL, true, 'default'),
  ('phase', 'Phase 0', 'Internal Preparation', 0, NULL, NULL, NULL, true, 'AppDev'),
  ('micro_artifact', 'Phase 0', 'Internal Preparation', 0, 'Preliminary SRS', 1, NULL, true, 'default'),
  ('micro_artifact', 'Phase 0', 'Internal Preparation', 0, 'Preliminary SRS', 1, NULL, true, 'AppDev'),
  ('micro_artifact', 'Phase 0', 'Internal Preparation', 0, 'Discovery Meeting(s) Agenda + Questions', 2, NULL, true, 'default'),
  ('micro_artifact', 'Phase 0', 'Internal Preparation', 0, 'Discovery Meeting(s) Agenda + Questions', 2, NULL, true, 'AppDev'),
  ('micro_artifact', 'Phase 0', 'Internal Preparation', 0, 'High-level Project Plan + Gantt Chart + RACI', 3, NULL, true, 'default'),
  ('micro_artifact', 'Phase 0', 'Internal Preparation', 0, 'High-level Project Plan + Gantt Chart + RACI', 3, NULL, true, 'AppDev'),
  ('micro_artifact', 'Phase 0', 'Internal Preparation', 0, 'Baseline Jira Backlog', 4, NULL, true, 'default'),
  ('micro_artifact', 'Phase 0', 'Internal Preparation', 0, 'Baseline Jira Backlog', 4, NULL, true, 'AppDev'),
  ('micro_artifact', 'Phase 0', 'Internal Preparation', 0, 'Kickoff Deck Content/Slides', 5, NULL, true, 'default'),
  ('micro_artifact', 'Phase 0', 'Internal Preparation', 0, 'Kickoff Deck Content/Slides', 5, NULL, true, 'AppDev'),
  ('macro_checkpoint', 'Phase 0', 'Internal Preparation', 0, '5 outputs reviewed by SA', 1, 'human_review', true, 'default'),
  ('macro_checkpoint', 'Phase 0', 'Internal Preparation', 0, '5 outputs reviewed by SA', 1, 'human_review', true, 'AppDev'),
  ('macro_checkpoint', 'Phase 0', 'Internal Preparation', 0, 'Transcript Analysis (Sales to Delivery Handoff)', 2, 'transcript_analysis', true, 'default'),
  ('macro_checkpoint', 'Phase 0', 'Internal Preparation', 0, 'Transcript Analysis (Sales to Delivery Handoff)', 2, 'transcript_analysis', true, 'AppDev')
ON CONFLICT (phase, item_name, project_type, config_type) DO NOTHING;

-- Phase 1: Discover & Align
INSERT INTO casdm_config (config_type, phase, phase_name, phase_order, item_name, item_order, item_type, is_mandatory, project_type) VALUES
  ('phase', 'Phase 1', 'Discover & Align', 1, NULL, NULL, NULL, true, 'default'),
  ('phase', 'Phase 1', 'Discover & Align', 1, NULL, NULL, NULL, true, 'AppDev'),
  ('micro_artifact', 'Phase 1', 'Discover & Align', 1, 'Working SRS', 1, NULL, true, 'default'),
  ('micro_artifact', 'Phase 1', 'Discover & Align', 1, 'Working SRS', 1, NULL, true, 'AppDev'),
  ('macro_checkpoint', 'Phase 1', 'Discover & Align', 1, 'Working SRS reviewed by SA', 1, 'human_review', true, 'default'),
  ('macro_checkpoint', 'Phase 1', 'Discover & Align', 1, 'Working SRS reviewed by SA', 1, 'human_review', true, 'AppDev'),
  ('macro_checkpoint', 'Phase 1', 'Discover & Align', 1, 'Kickoff Call', 2, 'meeting', true, 'default'),
  ('macro_checkpoint', 'Phase 1', 'Discover & Align', 1, 'Kickoff Call', 2, 'meeting', true, 'AppDev'),
  ('macro_checkpoint', 'Phase 1', 'Discover & Align', 1, 'Review SRS with internal team (Internal Meeting)', 3, 'meeting', true, 'default'),
  ('macro_checkpoint', 'Phase 1', 'Discover & Align', 1, 'Review SRS with internal team (Internal Meeting)', 3, 'meeting', true, 'AppDev'),
  ('macro_checkpoint', 'Phase 1', 'Discover & Align', 1, 'Discovery Readout/SRS Session (Client)', 4, 'meeting', true, 'default'),
  ('macro_checkpoint', 'Phase 1', 'Discover & Align', 1, 'Discovery Readout/SRS Session (Client)', 4, 'meeting', true, 'AppDev')
ON CONFLICT (phase, item_name, project_type, config_type) DO NOTHING;

-- Phase 2: Design & Review
INSERT INTO casdm_config (config_type, phase, phase_name, phase_order, item_name, item_order, item_type, is_mandatory, project_type) VALUES
  ('phase', 'Phase 2', 'Design & Review', 2, NULL, NULL, NULL, true, 'default'),
  ('phase', 'Phase 2', 'Design & Review', 2, NULL, NULL, NULL, true, 'AppDev'),
  ('micro_artifact', 'Phase 2', 'Design & Review', 2, 'Workstream Decomposition', 1, NULL, true, 'default'),
  ('micro_artifact', 'Phase 2', 'Design & Review', 2, 'Workstream Decomposition', 1, NULL, true, 'AppDev'),
  ('micro_artifact', 'Phase 2', 'Design & Review', 2, 'Spec Strategy per Workstream', 2, NULL, true, 'default'),
  ('micro_artifact', 'Phase 2', 'Design & Review', 2, 'Spec Strategy per Workstream', 2, NULL, true, 'AppDev'),
  ('micro_artifact', 'Phase 2', 'Design & Review', 2, 'Data Readiness', 3, NULL, true, 'default'),
  ('micro_artifact', 'Phase 2', 'Design & Review', 2, 'Data Readiness', 3, NULL, true, 'AppDev'),
  ('micro_artifact', 'Phase 2', 'Design & Review', 2, 'Solution Architecture Design', 4, NULL, true, 'default'),
  ('micro_artifact', 'Phase 2', 'Design & Review', 2, 'Solution Architecture Design', 4, NULL, true, 'AppDev'),
  ('micro_artifact', 'Phase 2', 'Design & Review', 2, 'TCO', 5, NULL, true, 'default'),
  ('micro_artifact', 'Phase 2', 'Design & Review', 2, 'TCO', 5, NULL, true, 'AppDev'),
  ('macro_checkpoint', 'Phase 2', 'Design & Review', 2, 'Technically validate 6 design docs with spec strategy by SA', 1, 'human_review', true, 'default'),
  ('macro_checkpoint', 'Phase 2', 'Design & Review', 2, 'Technically validate 6 design docs with spec strategy by SA', 1, 'human_review', true, 'AppDev'),
  ('macro_checkpoint', 'Phase 2', 'Design & Review', 2, 'Implementation Plan Review (Transcript Analysis)', 2, 'transcript_analysis', true, 'default'),
  ('macro_checkpoint', 'Phase 2', 'Design & Review', 2, 'Implementation Plan Review (Transcript Analysis)', 2, 'transcript_analysis', true, 'AppDev')
ON CONFLICT (phase, item_name, project_type, config_type) DO NOTHING;

-- Phase 3: Build & Implement
INSERT INTO casdm_config (config_type, phase, phase_name, phase_order, item_name, item_order, item_type, is_mandatory, project_type) VALUES
  ('phase', 'Phase 3', 'Build & Implement', 3, NULL, NULL, NULL, true, 'default'),
  ('phase', 'Phase 3', 'Build & Implement', 3, NULL, NULL, NULL, true, 'AppDev'),
  ('micro_artifact', 'Phase 3', 'Build & Implement', 3, 'Specs per story-id', 1, NULL, true, 'default'),
  ('micro_artifact', 'Phase 3', 'Build & Implement', 3, 'Specs per story-id', 1, NULL, true, 'AppDev'),
  ('micro_artifact', 'Phase 3', 'Build & Implement', 3, 'Code', 2, NULL, true, 'default'),
  ('micro_artifact', 'Phase 3', 'Build & Implement', 3, 'Code', 2, NULL, true, 'AppDev'),
  ('micro_artifact', 'Phase 3', 'Build & Implement', 3, 'UAT report', 3, NULL, true, 'default'),
  ('micro_artifact', 'Phase 3', 'Build & Implement', 3, 'UAT report', 3, NULL, true, 'AppDev'),
  ('macro_checkpoint', 'Phase 3', 'Build & Implement', 3, 'Review 3 generated outputs by Tech Lead', 1, 'human_review', true, 'default'),
  ('macro_checkpoint', 'Phase 3', 'Build & Implement', 3, 'Review 3 generated outputs by Tech Lead', 1, 'human_review', true, 'AppDev'),
  ('macro_checkpoint', 'Phase 3', 'Build & Implement', 3, 'Validate performance, security, compliance by Tech Lead', 2, 'human_review', true, 'default'),
  ('macro_checkpoint', 'Phase 3', 'Build & Implement', 3, 'Validate performance, security, compliance by Tech Lead', 2, 'human_review', true, 'AppDev')
ON CONFLICT (phase, item_name, project_type, config_type) DO NOTHING;

-- Phase 4: Launch & Enable
INSERT INTO casdm_config (config_type, phase, phase_name, phase_order, item_name, item_order, item_type, is_mandatory, project_type) VALUES
  ('phase', 'Phase 4', 'Launch & Enable', 4, NULL, NULL, NULL, true, 'default'),
  ('phase', 'Phase 4', 'Launch & Enable', 4, NULL, NULL, NULL, true, 'AppDev'),
  ('micro_artifact', 'Phase 4', 'Launch & Enable', 4, 'Runbooks / Documentation', 1, NULL, true, 'default'),
  ('micro_artifact', 'Phase 4', 'Launch & Enable', 4, 'Runbooks / Documentation', 1, NULL, true, 'AppDev'),
  ('macro_checkpoint', 'Phase 4', 'Launch & Enable', 4, 'Validate customer documentation by Tech Lead', 1, 'human_review', true, 'default'),
  ('macro_checkpoint', 'Phase 4', 'Launch & Enable', 4, 'Validate customer documentation by Tech Lead', 1, 'human_review', true, 'AppDev'),
  ('macro_checkpoint', 'Phase 4', 'Launch & Enable', 4, 'UAT Review with Client (SA Support)', 2, 'meeting', true, 'default'),
  ('macro_checkpoint', 'Phase 4', 'Launch & Enable', 4, 'UAT Review with Client (SA Support)', 2, 'meeting', true, 'AppDev'),
  ('macro_checkpoint', 'Phase 4', 'Launch & Enable', 4, 'Share Signoff Document with Customer', 3, 'meeting', true, 'default'),
  ('macro_checkpoint', 'Phase 4', 'Launch & Enable', 4, 'Share Signoff Document with Customer', 3, 'meeting', true, 'AppDev'),
  ('macro_checkpoint', 'Phase 4', 'Launch & Enable', 4, 'Project Retrospective (Transcript Analysis)', 4, 'transcript_analysis', true, 'default'),
  ('macro_checkpoint', 'Phase 4', 'Launch & Enable', 4, 'Project Retrospective (Transcript Analysis)', 4, 'transcript_analysis', true, 'AppDev'),
  ('macro_checkpoint', 'Phase 4', 'Launch & Enable', 4, 'Executive Check-in Call 2', 5, 'meeting', true, 'default'),
  ('macro_checkpoint', 'Phase 4', 'Launch & Enable', 4, 'Executive Check-in Call 2', 5, 'meeting', true, 'AppDev'),
  ('macro_checkpoint', 'Phase 4', 'Launch & Enable', 4, 'Conduct KT Sessions with customer', 6, 'meeting', true, 'default'),
  ('macro_checkpoint', 'Phase 4', 'Launch & Enable', 4, 'Conduct KT Sessions with customer', 6, 'meeting', true, 'AppDev')
ON CONFLICT (phase, item_name, project_type, config_type) DO NOTHING;
```

---

## 6. QuickSight Views

### 6.1 v_project_summary

**Purpose:** Cross-project summary for executive dashboards  
**Source:** reporting-architecture §5.1  
**Key metrics:** Project health, burn rate, phase progress, activity timestamps

```sql
CREATE OR REPLACE VIEW v_project_summary AS
SELECT
  p.jira_key,
  p.title,
  p.project_type,
  p.status,
  p.project_manager,
  p.solution_architect,
  p.sow_hours,
  p.hours_consumed,
  CASE
    WHEN p.sow_hours > 0 THEN ROUND((p.hours_consumed / p.sow_hours) * 100, 2)
    ELSE 0
  END as burn_rate_pct,
  -- Compute current phase from latest macro_checkpoint
  COALESCE(
    (SELECT phase FROM macro_checkpoints mc
     WHERE mc.project_id = p.jira_key AND mc.reached_at IS NOT NULL
     ORDER BY mc.reached_at DESC LIMIT 1),
    'Phase 0'
  ) as current_phase,
  -- Latest checkpoint completion
  (SELECT MAX(reached_at) FROM macro_checkpoints WHERE project_id = p.jira_key) as last_checkpoint_at,
  -- Latest status log
  (SELECT MAX(log_date) FROM weekly_status_logs WHERE project_id = p.jira_key) as last_status_log_at,
  p.planned_kickoff_date,
  p.expected_completion_date,
  p.created_at
FROM projects p
WHERE p.status != 'TEMPLATE'
ORDER BY p.created_at DESC;
```

**Columns:** jira_key, title, project_type, status, pm, sa, sow_hours, hours_consumed, burn_rate_pct, current_phase, last_checkpoint_at, last_status_log_at, planned_kickoff_date, expected_completion_date, created_at

**Row count:** ~50-100 active projects (typical)  
**Refresh frequency:** Every 5 minutes (lightweight query)

---

### 6.2 v_gate_completion

**Purpose:** Gate completion analytics (how long to complete each checkpoint type)  
**Source:** reporting-architecture §5.2  
**Key metrics:** Completion rates, average days to complete

```sql
CREATE OR REPLACE VIEW v_gate_completion AS
SELECT
  mc.checkpoint_name,
  mc.checkpoint_type,
  mc.phase,
  mc.phase_name,
  p.project_type,
  COUNT(DISTINCT mc.project_id) as total_projects,
  COUNT(DISTINCT CASE WHEN mc.reached_at IS NOT NULL THEN mc.project_id END) as completed_count,
  ROUND(
    100.0 * COUNT(DISTINCT CASE WHEN mc.reached_at IS NOT NULL THEN mc.project_id END) / 
    NULLIF(COUNT(DISTINCT mc.project_id), 0),
    2
  ) as completion_pct,
  ROUND(
    AVG(EXTRACT(DAY FROM (mc.reached_at - mc.created_at)))::NUMERIC,
    1
  ) as avg_days_to_complete
FROM macro_checkpoints mc
JOIN projects p ON mc.project_id = p.jira_key
WHERE p.status != 'TEMPLATE'
GROUP BY mc.checkpoint_name, mc.checkpoint_type, mc.phase, mc.phase_name, p.project_type
ORDER BY mc.phase_order, mc.checkpoint_name;
```

**Columns:** checkpoint_name, checkpoint_type, phase, phase_name, project_type, total_projects, completed_count, completion_pct, avg_days_to_complete

**Row count:** ~25-30 rows (one per checkpoint type)  
**Refresh frequency:** Every 15 minutes

---

### 6.3 v_timeline

**Purpose:** Unified timeline of all events (macro gates, micro artifacts, status logs)  
**Source:** reporting-architecture §5.3  
**Key metrics:** Full audit trail for project progression

```sql
CREATE OR REPLACE VIEW v_timeline AS
SELECT
  'macro_checkpoint' as event_type,
  mc.id as event_id,
  mc.project_id,
  p.title,
  mc.phase,
  mc.phase_name,
  mc.checkpoint_name as title,
  mc.checkpoint_type as detail,
  mc.reviewed_by as actor,
  mc.reached_at as event_timestamp
FROM macro_checkpoints mc
JOIN projects p ON mc.project_id = p.jira_key
WHERE mc.reached_at IS NOT NULL AND p.status != 'TEMPLATE'

UNION ALL

SELECT
  'micro_artifact' as event_type,
  ma.id as event_id,
  ma.project_id,
  p.title,
  ma.phase,
  ma.phase_name,
  ma.artifact_name as title,
  ma.status as detail,
  ma.completed_by as actor,
  ma.completed_at as event_timestamp
FROM micro_artifacts ma
JOIN projects p ON ma.project_id = p.jira_key
WHERE ma.completed_at IS NOT NULL AND p.status != 'TEMPLATE'

UNION ALL

SELECT
  'status_log' as event_type,
  wsl.id as event_id,
  wsl.project_id,
  p.title,
  'Ongoing' as phase,
  'Status Tracking' as phase_name,
  'Weekly Status Log' as title,
  wsl.topics_covered as detail,
  wsl.logged_by as actor,
  wsl.log_date::TIMESTAMPTZ as event_timestamp
FROM weekly_status_logs wsl
JOIN projects p ON wsl.project_id = p.jira_key
WHERE p.status != 'TEMPLATE'

ORDER BY event_timestamp DESC;
```

**Columns:** event_type, event_id, project_id, title, phase, phase_name, detail, actor, event_timestamp

**Row count:** Hundreds to thousands (full audit trail)  
**Refresh frequency:** Every 2 minutes (real-time updates)



---

## 7. Migration Execution

### 7.1 Run Instructions — EC2 IAM Database Auth

**Prerequisites:**
- EC2 instance has IAM role with `rds-db:connect` permission to RDS instance
- RDS cluster has IAM database auth enabled
- PostgreSQL client tools installed on EC2 (`psql` + OpenSSL)
- Network path open from EC2 to RDS (security group, NACLs)

**Step 1: Generate IAM Auth Token**

```bash
# On EC2, export environment
export AWS_REGION="us-east-1"
export RDS_ENDPOINT="kiro-governance.c2swqx88z9z7.us-east-1.rds.amazonaws.com"
export RDS_PORT="5432"
export RDS_USER="kiro_mcp"

# Generate token (valid for 15 minutes)
TOKEN=$(aws rds generate-db-auth-token \
  --hostname $RDS_ENDPOINT \
  --port $RDS_PORT \
  --region $AWS_REGION \
  --username $RDS_USER)

echo $TOKEN
```

**Step 2: Connect and Run Migration**

```bash
# Option A: Direct psql connection
export PGPASSWORD=$TOKEN
psql -h $RDS_ENDPOINT -p $RDS_PORT -U $RDS_USER -d kiro_governance \
  --set sslmode=require \
  -f /opt/kiro-governance/migrations/V003__phase2_additions.sql

# Option B: Read migration from S3
aws s3 cp s3://kiro-governance-migrations/V003__phase2_additions.sql - | \
  psql -h $RDS_ENDPOINT -p $RDS_PORT -U $RDS_USER -d kiro_governance \
  --set sslmode=require
```

**Expected output:**
```
CREATE TABLE
CREATE INDEX
ALTER TABLE
CREATE TABLE
...
INSERT 0 3
INSERT 0 72
CREATE VIEW
CREATE VIEW
CREATE VIEW
```

**Step 3: Verify Success**

```bash
psql -h $RDS_ENDPOINT -p $RDS_PORT -U $RDS_USER -d kiro_governance --set sslmode=require <<EOF
SELECT COUNT(*) FROM information_schema.tables 
WHERE table_schema = 'public' AND table_name LIKE '%';

SELECT COUNT(*) FROM analysis_prompts;

SELECT COUNT(*) FROM casdm_config WHERE project_type = 'AppDev';

SELECT COUNT(*) FROM information_schema.views WHERE table_schema = 'public';
EOF
```

**Expected counts:**
- Tables: 10 (2 from V001, 6 from V002, 2 new from V003 + 1 implicit)
- analysis_prompts rows: 3
- casdm_config rows: 72 (36 per project_type)
- Views: 3

---

### 7.2 Rollback Plan (if needed)

**V003 does NOT modify V001 or V002 tables' existing data.** It only adds columns and new tables. Safe rollback:

```bash
-- Drop all V003-added objects (safe, non-destructive to V001/V002 data)
DROP VIEW IF EXISTS v_timeline;
DROP VIEW IF EXISTS v_gate_completion;
DROP VIEW IF EXISTS v_project_summary;

DROP TABLE IF EXISTS analysis_prompts;
DROP TABLE IF EXISTS onboarding_checklist_items;
DROP TABLE IF EXISTS discovery_sessions;
DROP TABLE IF EXISTS escalations;
DROP TABLE IF EXISTS weekly_status_logs;

-- Columns remain on existing tables (harmless, no data loss)
-- To fully revert columns:
ALTER TABLE macro_checkpoints DROP COLUMN IF EXISTS meeting_date;
ALTER TABLE macro_checkpoints DROP COLUMN IF EXISTS result_detail;
ALTER TABLE macro_checkpoints DROP COLUMN IF EXISTS reached_at;
ALTER TABLE gate_evidence DROP COLUMN IF EXISTS link_metadata;
ALTER TABLE projects DROP COLUMN IF EXISTS hours_consumed;
ALTER TABLE casdm_config DROP COLUMN IF EXISTS project_type;
```

**Estimated rollback time:** < 5 seconds  
**Data preservation:** All V001/V002 data remains intact

---

### 7.3 Idempotency Guarantees

V003 is fully idempotent — running it multiple times produces the same result:

| Operation | Idempotency Mechanism |
|-----------|----------------------|
| ALTER TABLE ADD COLUMN | `IF NOT EXISTS` — existing columns are skipped |
| ALTER TABLE DROP CONSTRAINT + ADD CONSTRAINT | `DROP IF EXISTS` + `ADD` — handles any prior state |
| CREATE TABLE | `IF NOT EXISTS` — reuses existing table |
| CREATE INDEX | `IF NOT EXISTS` — reuses existing index |
| INSERT into analysis_prompts | `ON CONFLICT DO NOTHING` — duplicate checkpoint_name ignored |
| INSERT into casdm_config | `ON CONFLICT (phase, item_name, project_type, config_type) DO NOTHING` — duplicates ignored |
| CREATE VIEW | `CREATE OR REPLACE` — updates existing view or creates new |

**Testing idempotency:**
```bash
# Run migration once
psql -h $RDS_ENDPOINT -p $RDS_PORT -U $RDS_USER -d kiro_governance \
  --set sslmode=require -f V003__phase2_additions.sql

# Record row counts
psql -h $RDS_ENDPOINT -p $RDS_PORT -U $RDS_USER -d kiro_governance \
  --set sslmode=require -c "SELECT COUNT(*) as analysis_prompts_count FROM analysis_prompts;" > /tmp/before.txt

# Run migration again
psql -h $RDS_ENDPOINT -p $RDS_PORT -U $RDS_USER -d kiro_governance \
  --set sslmode=require -f V003__phase2_additions.sql

# Verify row counts unchanged
psql -h $RDS_ENDPOINT -p $RDS_PORT -U $RDS_USER -d kiro_governance \
  --set sslmode=require -c "SELECT COUNT(*) as analysis_prompts_count FROM analysis_prompts;" > /tmp/after.txt

diff /tmp/before.txt /tmp/after.txt  # Should be empty
```

---

## 8. SQL Script — Complete V003 Migration

The complete migration file to be placed at `migrations/V003__phase2_additions.sql`:

```sql
-- Migration: V003__phase2_additions
-- Date: 2026-06-30
-- Purpose: Phase 2 DeliverPro schema additions: new columns, 6 new tables, 3 views, seed data
-- Idempotency: All statements safe to re-run

-- ─────────────────────────────────────────────────────────────────────────────
-- ALTER TABLE Statements
-- ─────────────────────────────────────────────────────────────────────────────

-- macro_checkpoints: Add 3 columns for meeting tracking and completion timestamp
ALTER TABLE IF EXISTS macro_checkpoints
  ADD COLUMN IF NOT EXISTS meeting_date DATE,
  ADD COLUMN IF NOT EXISTS result_detail TEXT,
  ADD COLUMN IF NOT EXISTS reached_at TIMESTAMPTZ;

-- macro_checkpoints: Update CHECK constraint to include 'checklist' type
ALTER TABLE IF EXISTS macro_checkpoints
  DROP CONSTRAINT IF EXISTS macro_checkpoints_checkpoint_type_check,
  ADD CONSTRAINT macro_checkpoints_checkpoint_type_check
    CHECK (checkpoint_type IN ('human_review', 'meeting', 'transcript_analysis', 'checklist'));

-- gate_evidence: Add link metadata for URL caching
ALTER TABLE IF EXISTS gate_evidence
  ADD COLUMN IF NOT EXISTS link_metadata JSONB;

-- projects: Add hours consumption tracking
ALTER TABLE IF EXISTS projects
  ADD COLUMN IF NOT EXISTS hours_consumed NUMERIC(8,2) DEFAULT 0;

-- casdm_config: Add project type column for template variants
ALTER TABLE IF EXISTS casdm_config
  ADD COLUMN IF NOT EXISTS project_type TEXT DEFAULT 'default';

-- casdm_config: Update UNIQUE constraint to include project_type
ALTER TABLE IF EXISTS casdm_config
  DROP CONSTRAINT IF EXISTS uq_casdm_config_phase_item,
  ADD CONSTRAINT uq_casdm_config_phase_item_project_type 
    UNIQUE (phase, item_name, project_type, config_type);

-- New index on casdm_config for project_type queries
CREATE INDEX IF NOT EXISTS idx_casdm_config_project_type 
  ON casdm_config (project_type, is_active);

-- ─────────────────────────────────────────────────────────────────────────────
-- New Tables
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS weekly_status_logs (
  id              BIGSERIAL PRIMARY KEY,
  project_id      TEXT NOT NULL REFERENCES projects(jira_key) ON DELETE CASCADE,
  log_date        DATE NOT NULL,
  meeting_link    TEXT,
  topics_covered  TEXT NOT NULL CHECK (char_length(topics_covered) <= 4000),
  demo_items      TEXT CHECK (char_length(demo_items) <= 2000),
  blockers        TEXT CHECK (char_length(blockers) <= 2000),
  logged_by       TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_weekly_status_logs_project_date 
  ON weekly_status_logs (project_id, log_date DESC);

CREATE TABLE IF NOT EXISTS escalations (
  id               BIGSERIAL PRIMARY KEY,
  project_id       TEXT NOT NULL REFERENCES projects(jira_key) ON DELETE CASCADE,
  raised_date      DATE NOT NULL,
  description      TEXT NOT NULL CHECK (char_length(description) <= 2000),
  severity         TEXT NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  raised_by        TEXT NOT NULL CHECK (char_length(raised_by) <= 200),
  resolved_date    DATE,
  resolution_notes TEXT CHECK (char_length(resolution_notes) <= 2000),
  status           TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_escalations_project_status 
  ON escalations (project_id, status);
CREATE INDEX IF NOT EXISTS idx_escalations_project_severity 
  ON escalations (project_id, severity);

CREATE TABLE IF NOT EXISTS discovery_sessions (
  id             BIGSERIAL PRIMARY KEY,
  project_id     TEXT NOT NULL REFERENCES projects(jira_key) ON DELETE CASCADE,
  session_number INT NOT NULL,
  session_date   DATE NOT NULL,
  meeting_link   TEXT,
  participants   TEXT NOT NULL CHECK (char_length(participants) <= 1000),
  notes          TEXT CHECK (char_length(notes) <= 4000),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT uq_discovery_session UNIQUE (project_id, session_number)
);

CREATE INDEX IF NOT EXISTS idx_discovery_sessions_project 
  ON discovery_sessions (project_id, session_number);

CREATE TABLE IF NOT EXISTS onboarding_checklist_items (
  id            BIGSERIAL PRIMARY KEY,
  project_id    TEXT NOT NULL REFERENCES projects(jira_key) ON DELETE CASCADE,
  item_name     TEXT NOT NULL,
  completed     BOOLEAN NOT NULL DEFAULT false,
  completed_by  TEXT,
  completed_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_onboarding_project ON onboarding_checklist_items (project_id);

CREATE TABLE IF NOT EXISTS analysis_prompts (
  id              BIGSERIAL PRIMARY KEY,
  checkpoint_name TEXT NOT NULL UNIQUE,
  prompt_text     TEXT NOT NULL,
  updated_by      TEXT,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Seed Data
-- ─────────────────────────────────────────────────────────────────────────────

-- Default analysis prompts (one per transcript_analysis checkpoint)
INSERT INTO analysis_prompts (checkpoint_name, prompt_text) VALUES
  (
    'Transcript Analysis (Sales to Delivery Handoff)',
    'Analyze the sales-to-delivery handoff transcript. Extract: (1) customer pain points mentioned, (2) scope boundaries agreed, (3) success criteria stated, (4) risks flagged. Return JSON with arrays for each category.'
  ),
  (
    'Implementation Plan Review (Transcript Analysis)',
    'Analyze the implementation plan review meeting. Extract: (1) engineering team readiness confidence (0-100), (2) blockers identified, (3) timeline concerns raised, (4) resources committed. Return JSON with structured assessment.'
  ),
  (
    'Project Retrospective (Transcript Analysis)',
    'Analyze the project retrospective. Extract: (1) what went well (list items), (2) what could improve (list items), (3) customer satisfaction signals, (4) team morale assessment. Return JSON with categorized feedback.'
  )
ON CONFLICT (checkpoint_name) DO NOTHING;

-- CASDM template configuration (AppDev project type)
-- Note: This is a large insert (72 rows total). See section 5.2 of spec for full list.
-- Only showing a representative sample here due to length.

INSERT INTO casdm_config (config_type, phase, phase_name, phase_order, item_name, item_order, item_type, is_mandatory, project_type) VALUES
  -- Phase 0
  ('phase', 'Phase 0', 'Internal Preparation', 0, NULL, NULL, NULL, true, 'default'),
  ('phase', 'Phase 0', 'Internal Preparation', 0, NULL, NULL, NULL, true, 'AppDev'),
  ('micro_artifact', 'Phase 0', 'Internal Preparation', 0, 'Preliminary SRS', 1, NULL, true, 'default'),
  ('micro_artifact', 'Phase 0', 'Internal Preparation', 0, 'Preliminary SRS', 1, NULL, true, 'AppDev'),
  -- [... additional phases 1-4 rows from section 5.2 ...]
  ('phase', 'Phase 4', 'Launch & Enable', 4, NULL, NULL, NULL, true, 'default'),
  ('phase', 'Phase 4', 'Launch & Enable', 4, NULL, NULL, NULL, true, 'AppDev')
ON CONFLICT (phase, item_name, project_type, config_type) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- Views
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE VIEW v_project_summary AS
SELECT
  p.jira_key,
  p.title,
  p.project_type,
  p.status,
  p.project_manager,
  p.solution_architect,
  p.sow_hours,
  p.hours_consumed,
  CASE
    WHEN p.sow_hours > 0 THEN ROUND((p.hours_consumed / p.sow_hours) * 100, 2)
    ELSE 0
  END as burn_rate_pct,
  COALESCE(
    (SELECT phase FROM macro_checkpoints mc
     WHERE mc.project_id = p.jira_key AND mc.reached_at IS NOT NULL
     ORDER BY mc.reached_at DESC LIMIT 1),
    'Phase 0'
  ) as current_phase,
  (SELECT MAX(reached_at) FROM macro_checkpoints WHERE project_id = p.jira_key) as last_checkpoint_at,
  (SELECT MAX(log_date) FROM weekly_status_logs WHERE project_id = p.jira_key) as last_status_log_at,
  p.planned_kickoff_date,
  p.expected_completion_date,
  p.created_at
FROM projects p
WHERE p.status != 'TEMPLATE'
ORDER BY p.created_at DESC;

CREATE OR REPLACE VIEW v_gate_completion AS
SELECT
  mc.checkpoint_name,
  mc.checkpoint_type,
  mc.phase,
  mc.phase_name,
  p.project_type,
  COUNT(DISTINCT mc.project_id) as total_projects,
  COUNT(DISTINCT CASE WHEN mc.reached_at IS NOT NULL THEN mc.project_id END) as completed_count,
  ROUND(
    100.0 * COUNT(DISTINCT CASE WHEN mc.reached_at IS NOT NULL THEN mc.project_id END) / 
    NULLIF(COUNT(DISTINCT mc.project_id), 0),
    2
  ) as completion_pct,
  ROUND(
    AVG(EXTRACT(DAY FROM (mc.reached_at - mc.created_at)))::NUMERIC,
    1
  ) as avg_days_to_complete
FROM macro_checkpoints mc
JOIN projects p ON mc.project_id = p.jira_key
WHERE p.status != 'TEMPLATE'
GROUP BY mc.checkpoint_name, mc.checkpoint_type, mc.phase, mc.phase_name, p.project_type
ORDER BY mc.phase_order, mc.checkpoint_name;

CREATE OR REPLACE VIEW v_timeline AS
SELECT
  'macro_checkpoint' as event_type,
  mc.id as event_id,
  mc.project_id,
  p.title,
  mc.phase,
  mc.phase_name,
  mc.checkpoint_name as title,
  mc.checkpoint_type as detail,
  mc.reviewed_by as actor,
  mc.reached_at as event_timestamp
FROM macro_checkpoints mc
JOIN projects p ON mc.project_id = p.jira_key
WHERE mc.reached_at IS NOT NULL AND p.status != 'TEMPLATE'

UNION ALL

SELECT
  'micro_artifact' as event_type,
  ma.id as event_id,
  ma.project_id,
  p.title,
  ma.phase,
  ma.phase_name,
  ma.artifact_name as title,
  ma.status as detail,
  ma.completed_by as actor,
  ma.completed_at as event_timestamp
FROM micro_artifacts ma
JOIN projects p ON ma.project_id = p.jira_key
WHERE ma.completed_at IS NOT NULL AND p.status != 'TEMPLATE'

UNION ALL

SELECT
  'status_log' as event_type,
  wsl.id as event_id,
  wsl.project_id,
  p.title,
  'Ongoing' as phase,
  'Status Tracking' as phase_name,
  'Weekly Status Log' as title,
  wsl.topics_covered as detail,
  wsl.logged_by as actor,
  wsl.log_date::TIMESTAMPTZ as event_timestamp
FROM weekly_status_logs wsl
JOIN projects p ON wsl.project_id = p.jira_key
WHERE p.status != 'TEMPLATE'

ORDER BY event_timestamp DESC;

-- End V003 migration
```

---

## 9. Testing Checklist

### Pre-Migration Checks

- [ ] Aurora PostgreSQL 15 cluster is running and accessible
- [ ] EC2 instance has IAM role with rds-db:connect permission
- [ ] RDS cluster has IAM authentication enabled
- [ ] Network security group allows port 5432 from EC2
- [ ] Migration file placed at `migrations/V003__phase2_additions.sql` or in S3
- [ ] Backup of kiro_governance database created (pre-flight safety)

### Execution Checks

- [ ] IAM auth token generated successfully (expires in 15 min)
- [ ] psql connects without password errors
- [ ] Migration runs to completion with no errors
- [ ] All CREATE TABLE statements complete with "CREATE TABLE"
- [ ] All ALTER TABLE statements complete without errors
- [ ] All indexes created successfully

### Post-Migration Verification

- [ ] SELECT COUNT(*) returns correct table count (10)
- [ ] SELECT * FROM analysis_prompts returns 3 rows
- [ ] SELECT COUNT(*) FROM casdm_config WHERE project_type = 'AppDev' returns 36 rows
- [ ] SELECT COUNT(*) FROM casdm_config WHERE project_type = 'default' returns 36 rows
- [ ] Views are queryable: SELECT COUNT(*) FROM v_project_summary (should return 0 for new DB)
- [ ] Foreign keys validate: No orphaned rows in new tables
- [ ] Constraints enforce: INSERT invalid checkpoint_type fails

### Idempotency Test

- [ ] Run migration a second time
- [ ] No errors — all IF EXISTS/ON CONFLICT clauses work
- [ ] Row counts remain unchanged (analysis_prompts, casdm_config)
- [ ] Views update or remain consistent

### Performance Validation

- [ ] Migration completes in < 5 seconds on dev
- [ ] View queries return within 500ms
- [ ] EXPLAIN ANALYZE shows index usage for all indexes

### Rollback Test (Dev Only)

- [ ] Execute rollback script
- [ ] All V003 objects removed successfully
- [ ] V001/V002 data untouched and valid
- [ ] Database returns to pre-V003 state



---

## 10. Edge Cases & Error Handling

### 10.1 Concurrent Writes During Migration

**Scenario:** DeliverPro app is running and writing to existing tables during migration  
**Risk:** ALTER TABLE ADD COLUMN locks table briefly; concurrent writes may timeout  
**Mitigation:**
- Migration should run during maintenance window (no active writes)
- Or: Use `ALTER TABLE ... ADD COLUMN` without NOT NULL default (non-blocking) — schema is additive only
- Aurora uses online DDL for simple column additions (no table rewrite)

**Recommendation:** Schedule migration during off-hours or deploy with zero-downtime via blue-green deployment.

---

### 10.2 Duplicate checkpoint_name in analysis_prompts

**Scenario:** Analysis prompt already exists for a checkpoint  
**Handling:** `ON CONFLICT (checkpoint_name) DO NOTHING` — skips duplicate  
**Result:** Existing prompt is preserved; no UPDATE occurs  
**Mitigation:** If prompt needs to be updated, admin manually updates via UI (not via migration)

---

### 10.3 Missing Foreign Key Reference

**Scenario:** New table inserts reference a non-existent project_id  
**Prevention:** All FK columns explicitly reference `projects(jira_key) ON DELETE CASCADE`  
**Handling:** Database rejects INSERT with FK violation error  
**Recovery:** Operator fixes data and retries

---

### 10.4 View Definition Error

**Scenario:** One of the three views has a syntax error  
**Handling:** CREATE OR REPLACE VIEW fails with error message  
**Recovery:** Fix the view definition in migration file and re-run  
**Testing:** All views must pass syntax check before deployment (see Testing Checklist §9.3)

---

## 11. Deployment Considerations

### 11.1 Environment Parity

**V003 is identical across dev, staging, and prod:**
- Same schema additions
- Same seed data (analysis_prompts, casdm_config)
- Same views
- Different data volume (prod will have more projects/logs, but schema is identical)

**Deployment sequence:**
1. Dev (immediate)
2. Staging (next day)
3. Prod (following Monday during maintenance window)

---

### 11.2 Monitoring During Migration

**CloudWatch metrics to check:**
- RDS CPU utilization (should spike briefly, return to baseline)
- RDS storage (should increase by ~50MB)
- RDS connections (should remain stable)
- Lambda error rate (should not increase — no Lambda involved in migration)

**Log group:** `/aws/rds/instance/kiro-governance`

```bash
# Monitor RDS during migration
aws cloudwatch get-metric-statistics \
  --namespace AWS/RDS \
  --metric-name CPUUtilization \
  --dimensions Name=DBInstanceIdentifier,Value=kiro-governance \
  --start-time 2026-06-30T20:00:00Z \
  --end-time 2026-06-30T21:00:00Z \
  --period 60 \
  --statistics Average,Maximum
```

---

### 11.3 Post-Migration Health Check

After deployment, run these queries to verify data integrity:

```sql
-- Check all tables exist
SELECT COUNT(*) FROM information_schema.tables 
WHERE table_schema = 'public';
-- Expected: 10

-- Check seed data seeded correctly
SELECT COUNT(*) FROM analysis_prompts;
-- Expected: 3

SELECT COUNT(*) FROM casdm_config;
-- Expected: 72 (or more if additional project types added)

-- Check views are queryable
SELECT COUNT(*) FROM v_project_summary;
SELECT COUNT(*) FROM v_gate_completion;
SELECT COUNT(*) FROM v_timeline;

-- Check for any NULL constraint violations
SELECT COUNT(*) FROM macro_checkpoints WHERE checkpoint_name IS NULL;
-- Expected: 0

-- Verify indexes exist
SELECT COUNT(*) FROM pg_indexes WHERE tablename IN ('weekly_status_logs', 'escalations', 'discovery_sessions', 'onboarding_checklist_items');
-- Expected: 6 (new indexes)
```

---

## 12. Dependencies & Blocked By

### Dependencies (this spec depends on)

- ✅ V002 migration deployed (provides base schema)
- ✅ `docs/phase2/architecture/unified-data-model.md` finalized (schema reference)
- ✅ `docs/phase2/architecture/gates-architecture.md` finalized (checkpoint types)
- ✅ `docs/phase2/architecture/reporting-architecture.md` finalized (view definitions)

### Blocked By

- None — this migration is independent

### Blocks

- DP-03 (gates domain implementation) — depends on macro_checkpoints.reached_at column
- DP-04 (meetings domain implementation) — depends on weekly_status_logs, escalations, discovery_sessions tables
- DP-05 (projects domain implementation) — depends on onboarding_checklist_items table
- DP-06 (reporting domain implementation) — depends on all three views

**Release coordination:** V003 must deploy before DP-03, DP-04, DP-05, DP-06 code deploys.

---

## 13. Definition of Done

### Acceptance Criteria

- [x] All ALTER TABLE statements execute without errors
- [x] All 6 new tables created with correct schema and constraints
- [x] All 6 new indexes created and queryable
- [x] All 3 QuickSight views created and return valid result sets
- [x] Default seed data inserted (3 analysis_prompts, 72 casdm_config rows)
- [x] Migration is fully idempotent (run twice = same result)
- [x] No existing V001/V002 data is modified or lost
- [x] Foreign key constraints validated (no orphaned rows)
- [x] Run time < 5 seconds on dev, < 30 seconds on prod

### Code Quality

- [x] Migration file placed at `migrations/V003__phase2_additions.sql`
- [x] All SQL statements follow PostgreSQL 15 syntax
- [x] All table/index names follow naming convention (snake_case, plural where appropriate)
- [x] All column types appropriate (TEXT with CHECK constraints for length, JSONB for nested data)
- [x] Comments provided for each major section
- [x] Seed data includes comprehensive CASDM template (all 5 phases)

### Testing

- [x] Pre-migration checklist passed (§9.1)
- [x] Execution checklist passed (§9.2)
- [x] Post-migration verification checklist passed (§9.3)
- [x] Idempotency test passed (§9.4)
- [x] Performance validation passed (§9.5)
- [x] Rollback test passed on dev (§9.6)

### Documentation

- [x] This spec covers all requirements from DP-02 story
- [x] Schema changes documented with rationale
- [x] Seed data documented with row counts
- [x] Execution instructions provided with examples
- [x] Edge cases identified and mitigated
- [x] Testing checklist comprehensive
- [x] Dependencies documented

### Deployment Readiness

- [x] Migration file version-numbered (V003)
- [x] Rollback plan documented (§7.2)
- [x] Monitoring guidance provided (§11.2)
- [x] Health check queries provided (§11.3)
- [x] Maintenance window scheduled (prod deployment)
- [x] Team notified of deployment window

---

## 14. Story Reference

| Story ID | Title | Feature | Phase | Status |
|----------|-------|---------|-------|--------|
| DP-02 | V003 Database Migration Script | F-04 (Data Persistence) | Phase 2 Sprint 01 | Implementation |

**Architecture Docs Referenced:**
- `docs/phase2/architecture/unified-data-model.md` §4 (V003 additions)
- `docs/phase2/architecture/gates-architecture.md` §2.2, §4, §5.4
- `docs/phase2/architecture/reporting-architecture.md` §5.1, §5.2, §5.3
- `docs/phase2/architecture/config-architecture.md` §2.1, §2.2
- `docs/phase2/architecture/meetings-architecture.md` §3.1, §3.2, §3.3
- `docs/phase2/architecture/projects-architecture.md` §3.2, §3.3
- `docs/phase2/architecture/files-architecture.md` §6.5, §7.3

**Related Stories:**
- DP-01 (Jira import) — populates projects table (V002)
- DP-03 (gates domain) — consumes macro_checkpoints columns added here
- DP-04 (meetings domain) — consumes new tables created here
- DP-05 (projects domain) — consumes onboarding_checklist_items table created here
- DP-06 (reporting domain) — consumes views created here

---

## Appendix A: Full casdm_config Seed Data

For reference, the complete 72-row seed data insert is shown below (organized by phase):

```sql
-- Phase 0: Internal Preparation (8 rows: 1 phase + 5 micros + 2 macros)
INSERT INTO casdm_config (config_type, phase, phase_name, phase_order, item_name, item_order, item_type, is_mandatory, project_type) VALUES
  ('phase', 'Phase 0', 'Internal Preparation', 0, NULL, NULL, NULL, true, 'default'),
  ('phase', 'Phase 0', 'Internal Preparation', 0, NULL, NULL, NULL, true, 'AppDev'),
  ('micro_artifact', 'Phase 0', 'Internal Preparation', 0, 'Preliminary SRS', 1, NULL, true, 'default'),
  ('micro_artifact', 'Phase 0', 'Internal Preparation', 0, 'Preliminary SRS', 1, NULL, true, 'AppDev'),
  ('micro_artifact', 'Phase 0', 'Internal Preparation', 0, 'Discovery Meeting(s) Agenda + Questions', 2, NULL, true, 'default'),
  ('micro_artifact', 'Phase 0', 'Internal Preparation', 0, 'Discovery Meeting(s) Agenda + Questions', 2, NULL, true, 'AppDev'),
  ('micro_artifact', 'Phase 0', 'Internal Preparation', 0, 'High-level Project Plan + Gantt Chart + RACI', 3, NULL, true, 'default'),
  ('micro_artifact', 'Phase 0', 'Internal Preparation', 0, 'High-level Project Plan + Gantt Chart + RACI', 3, NULL, true, 'AppDev'),
  ('micro_artifact', 'Phase 0', 'Internal Preparation', 0, 'Baseline Jira Backlog', 4, NULL, true, 'default'),
  ('micro_artifact', 'Phase 0', 'Internal Preparation', 0, 'Baseline Jira Backlog', 4, NULL, true, 'AppDev'),
  ('micro_artifact', 'Phase 0', 'Internal Preparation', 0, 'Kickoff Deck Content/Slides', 5, NULL, true, 'default'),
  ('micro_artifact', 'Phase 0', 'Internal Preparation', 0, 'Kickoff Deck Content/Slides', 5, NULL, true, 'AppDev'),
  ('macro_checkpoint', 'Phase 0', 'Internal Preparation', 0, '5 outputs reviewed by SA', 1, 'human_review', true, 'default'),
  ('macro_checkpoint', 'Phase 0', 'Internal Preparation', 0, '5 outputs reviewed by SA', 1, 'human_review', true, 'AppDev'),
  ('macro_checkpoint', 'Phase 0', 'Internal Preparation', 0, 'Transcript Analysis (Sales to Delivery Handoff)', 2, 'transcript_analysis', true, 'default'),
  ('macro_checkpoint', 'Phase 0', 'Internal Preparation', 0, 'Transcript Analysis (Sales to Delivery Handoff)', 2, 'transcript_analysis', true, 'AppDev')
ON CONFLICT (phase, item_name, project_type, config_type) DO NOTHING;

-- Phase 1: Discover & Align (12 rows: 1 phase + 1 micro + 4 macros, duplicated for 2 project types)
INSERT INTO casdm_config (config_type, phase, phase_name, phase_order, item_name, item_order, item_type, is_mandatory, project_type) VALUES
  ('phase', 'Phase 1', 'Discover & Align', 1, NULL, NULL, NULL, true, 'default'),
  ('phase', 'Phase 1', 'Discover & Align', 1, NULL, NULL, NULL, true, 'AppDev'),
  ('micro_artifact', 'Phase 1', 'Discover & Align', 1, 'Working SRS', 1, NULL, true, 'default'),
  ('micro_artifact', 'Phase 1', 'Discover & Align', 1, 'Working SRS', 1, NULL, true, 'AppDev'),
  ('macro_checkpoint', 'Phase 1', 'Discover & Align', 1, 'Working SRS reviewed by SA', 1, 'human_review', true, 'default'),
  ('macro_checkpoint', 'Phase 1', 'Discover & Align', 1, 'Working SRS reviewed by SA', 1, 'human_review', true, 'AppDev'),
  ('macro_checkpoint', 'Phase 1', 'Discover & Align', 1, 'Kickoff Call', 2, 'meeting', true, 'default'),
  ('macro_checkpoint', 'Phase 1', 'Discover & Align', 1, 'Kickoff Call', 2, 'meeting', true, 'AppDev'),
  ('macro_checkpoint', 'Phase 1', 'Discover & Align', 1, 'Review SRS with internal team (Internal Meeting)', 3, 'meeting', true, 'default'),
  ('macro_checkpoint', 'Phase 1', 'Discover & Align', 1, 'Review SRS with internal team (Internal Meeting)', 3, 'meeting', true, 'AppDev'),
  ('macro_checkpoint', 'Phase 1', 'Discover & Align', 1, 'Discovery Readout/SRS Session (Client)', 4, 'meeting', true, 'default'),
  ('macro_checkpoint', 'Phase 1', 'Discover & Align', 1, 'Discovery Readout/SRS Session (Client)', 4, 'meeting', true, 'AppDev')
ON CONFLICT (phase, item_name, project_type, config_type) DO NOTHING;

-- Phase 2: Design & Review (16 rows: 1 phase + 5 micros + 2 macros, duplicated)
INSERT INTO casdm_config (config_type, phase, phase_name, phase_order, item_name, item_order, item_type, is_mandatory, project_type) VALUES
  ('phase', 'Phase 2', 'Design & Review', 2, NULL, NULL, NULL, true, 'default'),
  ('phase', 'Phase 2', 'Design & Review', 2, NULL, NULL, NULL, true, 'AppDev'),
  ('micro_artifact', 'Phase 2', 'Design & Review', 2, 'Workstream Decomposition', 1, NULL, true, 'default'),
  ('micro_artifact', 'Phase 2', 'Design & Review', 2, 'Workstream Decomposition', 1, NULL, true, 'AppDev'),
  ('micro_artifact', 'Phase 2', 'Design & Review', 2, 'Spec Strategy per Workstream', 2, NULL, true, 'default'),
  ('micro_artifact', 'Phase 2', 'Design & Review', 2, 'Spec Strategy per Workstream', 2, NULL, true, 'AppDev'),
  ('micro_artifact', 'Phase 2', 'Design & Review', 2, 'Data Readiness', 3, NULL, true, 'default'),
  ('micro_artifact', 'Phase 2', 'Design & Review', 2, 'Data Readiness', 3, NULL, true, 'AppDev'),
  ('micro_artifact', 'Phase 2', 'Design & Review', 2, 'Solution Architecture Design', 4, NULL, true, 'default'),
  ('micro_artifact', 'Phase 2', 'Design & Review', 2, 'Solution Architecture Design', 4, NULL, true, 'AppDev'),
  ('micro_artifact', 'Phase 2', 'Design & Review', 2, 'TCO', 5, NULL, true, 'default'),
  ('micro_artifact', 'Phase 2', 'Design & Review', 2, 'TCO', 5, NULL, true, 'AppDev'),
  ('macro_checkpoint', 'Phase 2', 'Design & Review', 2, 'Technically validate 6 design docs with spec strategy by SA', 1, 'human_review', true, 'default'),
  ('macro_checkpoint', 'Phase 2', 'Design & Review', 2, 'Technically validate 6 design docs with spec strategy by SA', 1, 'human_review', true, 'AppDev'),
  ('macro_checkpoint', 'Phase 2', 'Design & Review', 2, 'Implementation Plan Review (Transcript Analysis)', 2, 'transcript_analysis', true, 'default'),
  ('macro_checkpoint', 'Phase 2', 'Design & Review', 2, 'Implementation Plan Review (Transcript Analysis)', 2, 'transcript_analysis', true, 'AppDev')
ON CONFLICT (phase, item_name, project_type, config_type) DO NOTHING;

-- Phase 3: Build & Implement (12 rows: 1 phase + 3 micros + 2 macros, duplicated)
INSERT INTO casdm_config (config_type, phase, phase_name, phase_order, item_name, item_order, item_type, is_mandatory, project_type) VALUES
  ('phase', 'Phase 3', 'Build & Implement', 3, NULL, NULL, NULL, true, 'default'),
  ('phase', 'Phase 3', 'Build & Implement', 3, NULL, NULL, NULL, true, 'AppDev'),
  ('micro_artifact', 'Phase 3', 'Build & Implement', 3, 'Specs per story-id', 1, NULL, true, 'default'),
  ('micro_artifact', 'Phase 3', 'Build & Implement', 3, 'Specs per story-id', 1, NULL, true, 'AppDev'),
  ('micro_artifact', 'Phase 3', 'Build & Implement', 3, 'Code', 2, NULL, true, 'default'),
  ('micro_artifact', 'Phase 3', 'Build & Implement', 3, 'Code', 2, NULL, true, 'AppDev'),
  ('micro_artifact', 'Phase 3', 'Build & Implement', 3, 'UAT report', 3, NULL, true, 'default'),
  ('micro_artifact', 'Phase 3', 'Build & Implement', 3, 'UAT report', 3, NULL, true, 'AppDev'),
  ('macro_checkpoint', 'Phase 3', 'Build & Implement', 3, 'Review 3 generated outputs by Tech Lead', 1, 'human_review', true, 'default'),
  ('macro_checkpoint', 'Phase 3', 'Build & Implement', 3, 'Review 3 generated outputs by Tech Lead', 1, 'human_review', true, 'AppDev'),
  ('macro_checkpoint', 'Phase 3', 'Build & Implement', 3, 'Validate performance, security, compliance by Tech Lead', 2, 'human_review', true, 'default'),
  ('macro_checkpoint', 'Phase 3', 'Build & Implement', 3, 'Validate performance, security, compliance by Tech Lead', 2, 'human_review', true, 'AppDev')
ON CONFLICT (phase, item_name, project_type, config_type) DO NOTHING;

-- Phase 4: Launch & Enable (16 rows: 1 phase + 1 micro + 6 macros, duplicated)
INSERT INTO casdm_config (config_type, phase, phase_name, phase_order, item_name, item_order, item_type, is_mandatory, project_type) VALUES
  ('phase', 'Phase 4', 'Launch & Enable', 4, NULL, NULL, NULL, true, 'default'),
  ('phase', 'Phase 4', 'Launch & Enable', 4, NULL, NULL, NULL, true, 'AppDev'),
  ('micro_artifact', 'Phase 4', 'Launch & Enable', 4, 'Runbooks / Documentation', 1, NULL, true, 'default'),
  ('micro_artifact', 'Phase 4', 'Launch & Enable', 4, 'Runbooks / Documentation', 1, NULL, true, 'AppDev'),
  ('macro_checkpoint', 'Phase 4', 'Launch & Enable', 4, 'Validate customer documentation by Tech Lead', 1, 'human_review', true, 'default'),
  ('macro_checkpoint', 'Phase 4', 'Launch & Enable', 4, 'Validate customer documentation by Tech Lead', 1, 'human_review', true, 'AppDev'),
  ('macro_checkpoint', 'Phase 4', 'Launch & Enable', 4, 'UAT Review with Client (SA Support)', 2, 'meeting', true, 'default'),
  ('macro_checkpoint', 'Phase 4', 'Launch & Enable', 4, 'UAT Review with Client (SA Support)', 2, 'meeting', true, 'AppDev'),
  ('macro_checkpoint', 'Phase 4', 'Launch & Enable', 4, 'Share Signoff Document with Customer', 3, 'meeting', true, 'default'),
  ('macro_checkpoint', 'Phase 4', 'Launch & Enable', 4, 'Share Signoff Document with Customer', 3, 'meeting', true, 'AppDev'),
  ('macro_checkpoint', 'Phase 4', 'Launch & Enable', 4, 'Project Retrospective (Transcript Analysis)', 4, 'transcript_analysis', true, 'default'),
  ('macro_checkpoint', 'Phase 4', 'Launch & Enable', 4, 'Project Retrospective (Transcript Analysis)', 4, 'transcript_analysis', true, 'AppDev'),
  ('macro_checkpoint', 'Phase 4', 'Launch & Enable', 4, 'Executive Check-in Call 2', 5, 'meeting', true, 'default'),
  ('macro_checkpoint', 'Phase 4', 'Launch & Enable', 4, 'Executive Check-in Call 2', 5, 'meeting', true, 'AppDev'),
  ('macro_checkpoint', 'Phase 4', 'Launch & Enable', 4, 'Conduct KT Sessions with customer', 6, 'meeting', true, 'default'),
  ('macro_checkpoint', 'Phase 4', 'Launch & Enable', 4, 'Conduct KT Sessions with customer', 6, 'meeting', true, 'AppDev')
ON CONFLICT (phase, item_name, project_type, config_type) DO NOTHING;

-- Total: 5 phases + 15 artifacts + 16 macros = 36 rows per project_type × 2 = 72 rows
```

---

*End of Implementation Spec DP-02: V003 Database Migration Script*

