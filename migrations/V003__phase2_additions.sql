-- Migration: V003__phase2_additions
-- Date: 2026-06-30
-- Purpose: Phase 2 DeliverPro schema additions: new columns, 6 new tables, 3 views, seed data
-- Idempotency: All statements safe to re-run
-- Database: Aurora PostgreSQL 15

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

-- CASDM template configuration (AppDev project type) — all 5 phases, 36 rows per project_type × 2 = 72 rows total

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

-- Total: 5 phases + 15 artifacts + 16 macros = 36 rows per project_type × 2 = 72 rows

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
ORDER BY mc.phase, mc.checkpoint_name;

DROP VIEW IF EXISTS v_timeline;
CREATE VIEW v_timeline AS
SELECT
  p.jira_key AS project_id,
  p.title AS project_title,
  'governance_event'::text AS event_type,
  ge.id::text AS event_id,
  ge.created_at AS event_timestamp,
  ge.phase,
  ge.phase_name,
  ge.update_text AS title,
  ge.actor,
  ge.gate AS detail,
  ge.type AS sub_type
FROM governance_events ge
JOIN projects p ON p.jira_key = ge.project_id

UNION ALL

SELECT
  mc.project_id,
  p.title,
  'checkpoint'::text,
  mc.id::text,
  mc.reached_at,
  mc.phase,
  mc.phase_name,
  mc.checkpoint_name,
  mc.reviewed_by,
  mc.result_detail,
  mc.checkpoint_type
FROM macro_checkpoints mc
JOIN projects p ON p.jira_key = mc.project_id
WHERE mc.reached_at IS NOT NULL

UNION ALL

SELECT
  ge2.project_id,
  p.title,
  'evidence'::text,
  ge2.id::text,
  ge2.created_at,
  NULL,
  NULL,
  ge2.label,
  ge2.uploaded_by,
  ge2.value,
  ge2.evidence_type
FROM gate_evidence ge2
JOIN projects p ON p.jira_key = ge2.project_id;

-- End V003 migration
