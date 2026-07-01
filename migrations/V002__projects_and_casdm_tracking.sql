-- Migration: V002__projects_and_casdm_tracking
-- Date: 2026-06-25
-- Purpose: Full CASDM Phase 0-4 micro/macro tracking schema.
--          Source: JIRA RSS export (CST project) + Phase 2 transcript
--          (Chris Xenos x Muhammad Faraz, 2026-06-25) + CASDM XLS micro/macro table.

-- ─────────────────────────────────────────────────────────────────────────────
-- Table: projects
-- One row per Jira CST issue. jira_key is the FK used everywhere else.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS projects (
  id                       BIGSERIAL    PRIMARY KEY,
  jira_key                 TEXT         NOT NULL UNIQUE,  -- e.g. 'CST-674'
  jira_id                  TEXT,
  jira_link                TEXT,
  title                    TEXT         NOT NULL,
  description              TEXT,
  project_type             TEXT,                          -- '5x5x5', 'App Dev', 'App Mod'
  status                   TEXT,
  account_executive        TEXT,
  solution_architect       TEXT,
  project_manager          TEXT,
  engineers_assigned       TEXT,                          -- comma-separated
  planned_kickoff_date     DATE,
  expected_completion_date DATE,
  resource_assignment_date DATE,
  created_at_jira          TIMESTAMPTZ,
  updated_at_jira          TIMESTAMPTZ,
  sow_hours                NUMERIC(8,2),
  sow_link                 TEXT,
  last_synced_at           TIMESTAMPTZ  NOT NULL DEFAULT now(),
  created_at               TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_projects_jira_key ON projects (jira_key);
CREATE INDEX IF NOT EXISTS idx_projects_status   ON projects (status);
CREATE INDEX IF NOT EXISTS idx_projects_type     ON projects (project_type);

-- ─────────────────────────────────────────────────────────────────────────────
-- Table: micro_artifacts
-- Tracks AI-generated deliverables per CASDM phase per project.
-- These are produced by Kiro agents and committed to Git.
-- Source: CASDM XLS "Micro" column.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS micro_artifacts (
  id              BIGSERIAL    PRIMARY KEY,
  project_id      TEXT         NOT NULL REFERENCES projects(jira_key) ON DELETE CASCADE,
  phase           TEXT         NOT NULL,   -- 'Phase 0' .. 'Phase 4'
  phase_name      TEXT         NOT NULL,   -- 'Internal Preparation' .. 'Launch & Enable'
  artifact_name   TEXT         NOT NULL,   -- e.g. 'Preliminary SRS', 'Workstream Decomposition'
  status          TEXT         NOT NULL DEFAULT 'pending'
                               CHECK (status IN ('pending', 'in_progress', 'complete')),
  artifact_url    TEXT,                    -- S3 key, Git path, or external URL
  completed_at    TIMESTAMPTZ,
  completed_by    TEXT,                    -- Kiro agent name or human
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),

  CONSTRAINT uq_micro_artifact UNIQUE (project_id, phase, artifact_name)
);

CREATE INDEX IF NOT EXISTS idx_micro_artifacts_project       ON micro_artifacts (project_id);
CREATE INDEX IF NOT EXISTS idx_micro_artifacts_project_phase ON micro_artifacts (project_id, phase);

-- ─────────────────────────────────────────────────────────────────────────────
-- Table: macro_checkpoints
-- Tracks human-validated gates per CASDM phase per project.
-- Includes: human-reviewed outputs, meeting yes/no flags, and transcript links.
-- Source: CASDM XLS "Macro" column.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS macro_checkpoints (
  id              BIGSERIAL    PRIMARY KEY,
  project_id      TEXT         NOT NULL REFERENCES projects(jira_key) ON DELETE CASCADE,
  phase           TEXT         NOT NULL,
  phase_name      TEXT         NOT NULL,
  checkpoint_name TEXT         NOT NULL,   -- e.g. 'Kickoff Call', 'Working SRS reviewed by SA'
  checkpoint_type TEXT         NOT NULL
                               CHECK (checkpoint_type IN (
                                 'human_review',      -- SA/Tech Lead reviewed an artifact
                                 'meeting',           -- Yes/No meeting occurred
                                 'transcript_analysis' -- Avoma transcript fetched + AI analysed
                               )),
  -- For human_review checkpoints
  reviewed_by     TEXT,                    -- SA or Tech Lead name
  reviewed_at     TIMESTAMPTZ,
  -- For meeting checkpoints (Yes/No)
  occurred        BOOLEAN,                 -- NULL = not yet confirmed
  meeting_link    TEXT,                    -- Avoma/Zoom link (optional)
  -- For transcript_analysis checkpoints
  transcript_url  TEXT,                    -- Avoma link or S3 path
  analysis_result JSONB,                   -- AI analysis output: {topics_covered: [], missing: [], passed: bool}
  analysis_run_at TIMESTAMPTZ,
  -- Common
  notes           TEXT,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),

  CONSTRAINT uq_macro_checkpoint UNIQUE (project_id, phase, checkpoint_name)
);

CREATE INDEX IF NOT EXISTS idx_macro_checkpoints_project       ON macro_checkpoints (project_id);
CREATE INDEX IF NOT EXISTS idx_macro_checkpoints_project_phase ON macro_checkpoints (project_id, phase);

-- ─────────────────────────────────────────────────────────────────────────────
-- Table: gate_evidence
-- Any artifact attached to a macro checkpoint: files, links, analysis.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS gate_evidence (
  id              BIGSERIAL    PRIMARY KEY,
  project_id      TEXT         NOT NULL REFERENCES projects(jira_key) ON DELETE CASCADE,
  checkpoint_name TEXT         NOT NULL,
  evidence_type   TEXT         NOT NULL CHECK (evidence_type IN (
                    'meeting_link', 'transcript', 'file_upload', 'url', 'ai_analysis'
                  )),
  label           TEXT,
  value           TEXT         NOT NULL,
  uploaded_by     TEXT,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_gate_evidence_project ON gate_evidence (project_id, checkpoint_name);

-- ─────────────────────────────────────────────────────────────────────────────
-- SEED: CASDM micro artifacts template (all phases)
-- Source: CASDM XLS Micro column, 2026-06-25
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO projects (jira_key, title, status, created_at, last_synced_at)
VALUES ('__template__', 'CASDM Template (do not delete)', 'TEMPLATE', now(), now())
ON CONFLICT (jira_key) DO NOTHING;

INSERT INTO micro_artifacts (project_id, phase, phase_name, artifact_name) VALUES
  -- Phase 0: Internal Preparation
  ('__template__', 'Phase 0', 'Internal Preparation', 'Preliminary SRS'),
  ('__template__', 'Phase 0', 'Internal Preparation', 'Discovery Meeting(s) Agenda + Questions'),
  ('__template__', 'Phase 0', 'Internal Preparation', 'High-level Project Plan + Gantt Chart + RACI'),
  ('__template__', 'Phase 0', 'Internal Preparation', 'Baseline Jira Backlog'),
  ('__template__', 'Phase 0', 'Internal Preparation', 'Kickoff Deck Content/Slides'),
  -- Phase 1: Discover & Align
  ('__template__', 'Phase 1', 'Discover & Align', 'Working SRS'),
  -- Phase 2: Design & Review
  ('__template__', 'Phase 2', 'Design & Review', 'Workstream Decomposition'),
  ('__template__', 'Phase 2', 'Design & Review', 'Spec Strategy per Workstream'),
  ('__template__', 'Phase 2', 'Design & Review', 'Data Readiness'),
  ('__template__', 'Phase 2', 'Design & Review', 'Solution Architecture Design'),
  ('__template__', 'Phase 2', 'Design & Review', 'TCO'),
  ('__template__', 'Phase 2', 'Design & Review', 'Jira stories/sprint plan using validated SRS/design docs'),
  -- Phase 3: Build & Implement
  ('__template__', 'Phase 3', 'Build & Implement', 'Specs per story-id'),
  ('__template__', 'Phase 3', 'Build & Implement', 'Code'),
  ('__template__', 'Phase 3', 'Build & Implement', 'UAT report'),
  -- Phase 4: Launch & Enable
  ('__template__', 'Phase 4', 'Launch & Enable', 'Runbooks / Documentation')
ON CONFLICT (project_id, phase, artifact_name) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- SEED: CASDM macro checkpoints template (all phases)
-- Source: CASDM XLS Macro column, 2026-06-25
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO macro_checkpoints (project_id, phase, phase_name, checkpoint_name, checkpoint_type) VALUES
  -- Phase 0: Internal Preparation
  ('__template__', 'Phase 0', 'Internal Preparation', '5 outputs reviewed by SA',                          'human_review'),
  ('__template__', 'Phase 0', 'Internal Preparation', 'Transcript Analysis (Sales to Delivery Handoff)',   'transcript_analysis'),
  -- Phase 1: Discover & Align
  ('__template__', 'Phase 1', 'Discover & Align', 'Working SRS reviewed by SA',                           'human_review'),
  ('__template__', 'Phase 1', 'Discover & Align', 'Kickoff Call',                                         'meeting'),
  ('__template__', 'Phase 1', 'Discover & Align', 'Review SRS with internal team (Internal Meeting)',     'meeting'),
  ('__template__', 'Phase 1', 'Discover & Align', 'Discovery Readout/SRS Session (Client)',               'meeting'),
  -- Phase 2: Design & Review
  ('__template__', 'Phase 2', 'Design & Review', 'Technically validate 6 design docs with spec strategy by SA', 'human_review'),
  ('__template__', 'Phase 2', 'Design & Review', 'Implementation Plan Review (Transcript Analysis)',      'transcript_analysis'),
  -- Phase 3: Build & Implement
  ('__template__', 'Phase 3', 'Build & Implement', 'Review 3 generated outputs by Tech Lead',             'human_review'),
  ('__template__', 'Phase 3', 'Build & Implement', 'Validate performance, security, compliance by Tech Lead', 'human_review'),
  -- Phase 4: Launch & Enable
  ('__template__', 'Phase 4', 'Launch & Enable', 'Validate customer documentation by Tech Lead',          'human_review'),
  ('__template__', 'Phase 4', 'Launch & Enable', 'UAT Review with Client (SA Support)',                   'meeting'),
  ('__template__', 'Phase 4', 'Launch & Enable', 'Share Signoff Document with Customer',                  'meeting'),
  ('__template__', 'Phase 4', 'Launch & Enable', 'Project Retrospective (Transcript Analysis)',           'transcript_analysis'),
  ('__template__', 'Phase 4', 'Launch & Enable', 'Executive Check-in Call 2',                             'meeting'),
  ('__template__', 'Phase 4', 'Launch & Enable', 'Conduct KT Sessions with customer',                     'meeting')
ON CONFLICT (project_id, phase, checkpoint_name) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- Table: casdm_config
-- Stores the configurable CASDM phase/gate template.
-- Admin changes here drive what gets seeded on new projects.
-- Source: FR-P2-006, FR-P2-017
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS casdm_config (
  id              BIGSERIAL    PRIMARY KEY,
  config_type     TEXT         NOT NULL CHECK (config_type IN ('phase', 'micro_artifact', 'macro_checkpoint')),
  phase           TEXT         NOT NULL,
  phase_name      TEXT         NOT NULL,
  phase_order     INT          NOT NULL,
  item_name       TEXT,                    -- NULL for phase rows
  item_order      INT,
  item_type       TEXT,                    -- checkpoint_type for macro, NULL for micro
  is_mandatory    BOOLEAN      NOT NULL DEFAULT true,
  is_active       BOOLEAN      NOT NULL DEFAULT true,
  changed_by      TEXT,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_casdm_config_phase ON casdm_config (phase, config_type);

-- ─────────────────────────────────────────────────────────────────────────────
-- Table: checkpoint_notes
-- Append-only notes on macro checkpoints. Source: FR-P2-018
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS checkpoint_notes (
  id              BIGSERIAL    PRIMARY KEY,
  project_id      TEXT         NOT NULL REFERENCES projects(jira_key) ON DELETE CASCADE,
  checkpoint_name TEXT         NOT NULL,
  note_text       TEXT         NOT NULL CHECK (char_length(note_text) <= 4000),
  author          TEXT         NOT NULL,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_checkpoint_notes_project ON checkpoint_notes (project_id, checkpoint_name);
