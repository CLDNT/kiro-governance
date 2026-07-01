-- Migration: V002__projects_and_jira_sync
-- Date: 2026-06-25
-- Purpose: Add projects table (Phase 2 scope) to store Jira CST project data
--          alongside the existing governance_events table.
--          Source: JIRA RSS export (CST project, e.g. CST-674) + Phase 2 transcript
--          (Chris Xenos x Muhammad Faraz, 2026-06-25)

-- ─────────────────────────────────────────────────────────────────────────────
-- Table: projects
-- One row per Jira CST issue (delivery project).
-- project_id matches the Jira key (e.g. 'CST-674') and is the FK used in
-- governance_events.project_id — linking AI governance data to delivery projects.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS projects (
  id                      BIGSERIAL    PRIMARY KEY,

  -- Jira identifiers
  jira_key                TEXT         NOT NULL UNIQUE,   -- e.g. 'CST-674'
  jira_id                 TEXT,                           -- numeric Jira issue id
  jira_link               TEXT,                           -- full Atlassian URL

  -- Project metadata
  title                   TEXT         NOT NULL,          -- e.g. 'Incentive Concepts LLC (5x5x5)'
  description             TEXT,
  project_type            TEXT,                           -- e.g. '5x5x5', 'App Dev', 'App Mod'
  status                  TEXT,                           -- Jira status label

  -- Team
  account_executive       TEXT,
  solution_architect      TEXT,
  project_manager         TEXT,
  engineers_assigned      TEXT,                           -- comma-separated names

  -- Dates
  planned_kickoff_date    DATE,
  expected_completion_date DATE,
  resource_assignment_date DATE,
  created_at_jira         TIMESTAMPTZ,
  updated_at_jira         TIMESTAMPTZ,

  -- SOW
  sow_hours               NUMERIC(8,2),
  sow_link                TEXT,

  -- Sync tracking
  last_synced_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
  created_at              TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_projects_jira_key  ON projects (jira_key);
CREATE INDEX IF NOT EXISTS idx_projects_status    ON projects (status);
CREATE INDEX IF NOT EXISTS idx_projects_type      ON projects (project_type);

-- ─────────────────────────────────────────────────────────────────────────────
-- Table: project_gates
-- One row per CASDM gate per project.
-- Tracks whether each gate has been reached and what evidence was attached.
-- Gates not reached yet have reached_at = NULL.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS project_gates (
  id              BIGSERIAL    PRIMARY KEY,
  project_id      TEXT         NOT NULL REFERENCES projects(jira_key) ON DELETE CASCADE,
  gate_name       TEXT         NOT NULL,   -- canonical gate name (matches governance_events.gate)
  phase           TEXT         NOT NULL,   -- e.g. 'Phase 0'
  phase_name      TEXT         NOT NULL,   -- e.g. 'Internal Preparation'
  reached_at      TIMESTAMPTZ,             -- NULL = not yet reached
  reached_by      TEXT,                    -- actor who triggered/approved
  notes           TEXT,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),

  CONSTRAINT uq_project_gate UNIQUE (project_id, gate_name)
);

CREATE INDEX IF NOT EXISTS idx_project_gates_project ON project_gates (project_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- Table: gate_evidence
-- Artifacts attached to a project gate: uploaded files, meeting links,
-- transcript analysis results, or any external artifact URL.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS gate_evidence (
  id              BIGSERIAL    PRIMARY KEY,
  project_id      TEXT         NOT NULL REFERENCES projects(jira_key) ON DELETE CASCADE,
  gate_name       TEXT         NOT NULL,
  evidence_type   TEXT         NOT NULL CHECK (evidence_type IN (
                    'meeting_link',    -- Avoma/Zoom/Teams link
                    'transcript',      -- raw transcript text or S3 path
                    'file_upload',     -- S3 key for uploaded artifact
                    'url',             -- generic external URL (SOW, doc, etc.)
                    'ai_analysis'      -- AI transcript analysis result
                  )),
  label           TEXT,                -- human-readable label, e.g. 'Kickoff Call Recording'
  value           TEXT         NOT NULL, -- the link, S3 key, or analysis JSON
  uploaded_by     TEXT,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_gate_evidence_project_gate ON gate_evidence (project_id, gate_name);

-- ─────────────────────────────────────────────────────────────────────────────
-- FK: governance_events.project_id → projects.jira_key (soft reference)
-- Not enforcing as hard FK because governance_events may exist before the
-- project is synced from Jira (GitHub Actions fires on any project_id string).
-- The join is: governance_events.project_id = projects.jira_key
-- ─────────────────────────────────────────────────────────────────────────────

-- Seed the 10 canonical CASDM gates as template rows.
-- project_id='__template__' — copied to real projects on creation.
INSERT INTO projects (jira_key, title, status, created_at, last_synced_at)
VALUES ('__template__', 'Gate Template (do not delete)', 'TEMPLATE', now(), now())
ON CONFLICT (jira_key) DO NOTHING;

INSERT INTO project_gates (project_id, gate_name, phase, phase_name) VALUES
  ('__template__', 'Discovery outputs validated',    'Phase 0', 'Internal Preparation'),
  ('__template__', 'Preliminary SRS validated',      'Phase 0', 'Internal Preparation'),
  ('__template__', 'SRS approved',                   'Phase 1', 'Discover & Align'),
  ('__template__', 'Design docs approved',           'Phase 2', 'Design & Review'),
  ('__template__', 'Implementation plan approved',   'Phase 2', 'Design & Review'),
  ('__template__', 'Spec strategy approved',         'Phase 3', 'Build & Implement'),
  ('__template__', 'Code approved',                  'Phase 3', 'Build & Implement'),
  ('__template__', 'UAT report approved',            'Phase 3', 'Build & Implement'),
  ('__template__', 'Runbooks approved',              'Phase 4', 'Launch & Enable'),
  ('__template__', 'Project documentation approved', 'Phase 4', 'Launch & Enable')
ON CONFLICT (project_id, gate_name) DO NOTHING;
