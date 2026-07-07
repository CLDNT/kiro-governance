-- Migration: V008__level2_micro_artifact_autocomplete
-- Date: 2026-07-07
-- Stories: CR-14 (governance_events.event_code) + CR-12 (Level-2 app-side micro-artifact
--          auto-completion). Activates SRS FR-P2-042.
-- Scope: ADDITIVE column + seed + NEW audit table + explicit idempotent GRANTs/REVOKEs.
--        NO destructive DDL. Run by the migration runner as / via kiro_migrator (V005 ownership
--        model). Do NOT run against the live DB as part of this change — code + tests only.
-- Trust model (customer-accepted 2026-07-07): GitHub OIDC is NOT a prerequisite. Auto-completion
--        consumes already-authorised, append-only governance_events written via record_progress.
-- Source: specs/phase2/CR-12-14-level2-spec.md §3;
--         migrations/V004__github_slack_linkage.sql (inert micro_artifact_mapping);
--         migrations/V005__append_only_hardening.sql (role/ownership model);
--         migrations/V002__projects_and_casdm_tracking.sql (micro_artifacts template + artifact_name fidelity).
-- Database: RDS PostgreSQL 16 (standard RDS, shared Phase 1 + Phase 2 instance).
-- Idempotency: ADD COLUMN IF NOT EXISTS / CREATE ... IF NOT EXISTS / INSERT ... ON CONFLICT DO
--              NOTHING / re-runnable GRANT/REVOKE. Safe to apply more than once.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- SCOPE BOUNDARY (READ BEFORE EDITING)
--   IN : (A) governance_events.event_code (nullable) + partial index;
--        (B) micro_artifacts.manual_override (default false);
--        (C) seed the 16 event_code -> (phase, artifact_name) rows into micro_artifact_mapping;
--        (D) NEW append-only micro_artifact_audit table;
--        (E) explicit idempotent Level-2 grants for kiro_phase2 + REVOKE-all for kiro_mcp_app.
--   OUT: no role creation (V005), no ownership model change, no view repoint, no destructive DDL.
--   INVARIANT: kiro_mcp_app (MCP runtime) gets NO grant on micro_artifact_mapping /
--              micro_artifacts / micro_artifact_audit — the MCP role stays strictly append-only.
--              Level-2 mutates artifact state APP-SIDE under kiro_phase2 only.
-- ─────────────────────────────────────────────────────────────────────────────

-- ═════════════════════════════════════════════════════════════════════════════
-- (A) CR-14: nullable event_code on the append-only governance store. Additive → append-only-safe.
--     kiro_migrator owns the table; kiro_mcp_app already holds table-level INSERT,SELECT (V005),
--     which covers the new column — no new MCP grant required (append-only posture unchanged).
-- ═════════════════════════════════════════════════════════════════════════════
ALTER TABLE IF EXISTS governance_events
  ADD COLUMN IF NOT EXISTS event_code TEXT;

-- Reconcile lookup: repo-keyed micro events carrying an event_code. Partial index keeps it small.
CREATE INDEX IF NOT EXISTS idx_governance_events_event_code
  ON governance_events (project_id, event_code)
  WHERE event_code IS NOT NULL;

-- ═════════════════════════════════════════════════════════════════════════════
-- (B) CR-12: manual override flag. Set TRUE whenever a human changes status via PATCH /artifacts.
--     The reconciler SKIPS rows with manual_override = true, so a deliberate human decision is
--     never clobbered by a re-sync (reversibility guarantee). Default false = auto-eligible.
-- ═════════════════════════════════════════════════════════════════════════════
ALTER TABLE IF EXISTS micro_artifacts
  ADD COLUMN IF NOT EXISTS manual_override BOOLEAN NOT NULL DEFAULT false;

-- ═════════════════════════════════════════════════════════════════════════════
-- (C) Activate the inert V004 mapping: seed the 16 event_code -> (phase, artifact_name) rows.
--     project_type = 'default' (artifact names are project-type-independent in the CASDM template;
--     per-type overrides can be added later without schema change). is_active = true.
--     artifact_name copied VERBATIM from V002 __template__ micro_artifacts so the reconcile join
--     matches per project.
-- ═════════════════════════════════════════════════════════════════════════════
INSERT INTO micro_artifact_mapping (event_code, project_type, phase, artifact_name, is_active) VALUES
  ('casdm.p0.preliminary_srs',              'default', 'Phase 0', 'Preliminary SRS', true),
  ('casdm.p0.discovery_agenda',             'default', 'Phase 0', 'Discovery Meeting(s) Agenda + Questions', true),
  ('casdm.p0.project_plan',                 'default', 'Phase 0', 'High-level Project Plan + Gantt Chart + RACI', true),
  ('casdm.p0.baseline_backlog',             'default', 'Phase 0', 'Baseline Jira Backlog', true),
  ('casdm.p0.kickoff_deck',                 'default', 'Phase 0', 'Kickoff Deck Content/Slides', true),
  ('casdm.p1.working_srs',                  'default', 'Phase 1', 'Working SRS', true),
  ('casdm.p2.workstream_decomposition',     'default', 'Phase 2', 'Workstream Decomposition', true),
  ('casdm.p2.spec_strategy',                'default', 'Phase 2', 'Spec Strategy per Workstream', true),
  ('casdm.p2.data_readiness',               'default', 'Phase 2', 'Data Readiness', true),
  ('casdm.p2.solution_architecture_design', 'default', 'Phase 2', 'Solution Architecture Design', true),
  ('casdm.p2.tco',                          'default', 'Phase 2', 'TCO', true),
  ('casdm.p2.sprint_plan',                  'default', 'Phase 2', 'Jira stories/sprint plan using validated SRS/design docs', true),
  ('casdm.p3.specs_per_story',              'default', 'Phase 3', 'Specs per story-id', true),
  ('casdm.p3.code',                         'default', 'Phase 3', 'Code', true),
  ('casdm.p3.uat_report',                   'default', 'Phase 3', 'UAT report', true),
  ('casdm.p4.runbooks',                     'default', 'Phase 4', 'Runbooks / Documentation', true)
ON CONFLICT (event_code, project_type, phase) DO NOTHING;

-- ═════════════════════════════════════════════════════════════════════════════
-- (D) CR-12: append-only audit of every auto-completion, manual override, and reverse. This is the
--     immutable trail behind the reversible+audited requirement (beyond the mutable completed_by).
-- ═════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS micro_artifact_audit (
  id            BIGSERIAL   PRIMARY KEY,
  project_id    TEXT        NOT NULL REFERENCES projects(jira_key) ON DELETE CASCADE,
  artifact_id   BIGINT      REFERENCES micro_artifacts(id) ON DELETE SET NULL,
  phase         TEXT        NOT NULL,
  artifact_name TEXT        NOT NULL,
  event_code    TEXT,                 -- the code that drove an auto_complete (NULL for manual actions)
  event_actor   TEXT,                 -- governance_events.actor for auto_complete (e.g. 'aws-architect')
  action        TEXT        NOT NULL CHECK (action IN ('auto_complete', 'manual_override', 'reverse')),
  old_status    TEXT,
  new_status    TEXT,
  actor         TEXT        NOT NULL, -- 'system:artifact-sync' (auto) or Cognito sub/email (manual)
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_micro_artifact_audit_project ON micro_artifact_audit (project_id);

-- ═════════════════════════════════════════════════════════════════════════════
-- (E) Ownership + grants (keep MCP append-only; app performs Level 2).
-- ═════════════════════════════════════════════════════════════════════════════

-- (E.1) New objects owned by the non-runtime migrator role (consistent with V005).
ALTER TABLE    IF EXISTS micro_artifact_audit        OWNER TO kiro_migrator;
ALTER SEQUENCE IF EXISTS micro_artifact_audit_id_seq OWNER TO kiro_migrator;

-- (E.2) EXPLICIT, idempotent Level-2 grants for the Phase-2 app role kiro_phase2.
--       (V005 F.4 already granted broad DML to kiro_phase2 as a snapshot; these re-state the exact
--        Level-2 privileges so intent is documented and re-runnable, and cover micro_artifact_audit.)
GRANT SELECT                       ON micro_artifact_mapping TO kiro_phase2;   -- read the lookup
GRANT SELECT, UPDATE               ON micro_artifacts        TO kiro_phase2;   -- auto-complete
GRANT SELECT                       ON governance_events      TO kiro_phase2;   -- read micro events (append-only for app)
GRANT INSERT, SELECT               ON micro_artifact_audit   TO kiro_phase2;   -- append-only audit
GRANT USAGE,  SELECT ON SEQUENCE micro_artifact_audit_id_seq TO kiro_phase2;

-- (E.3) MCP runtime role stays APPEND-ONLY — assert NO Level-2 surface is granted to it.
--       No GRANT statements for kiro_mcp_app here. The REVOKEs make the append-only posture
--       explicit and belt-and-suspenders; the verify script asserts kiro_mcp_app has NO privilege
--       on micro_artifact_mapping / micro_artifacts / micro_artifact_audit.
REVOKE ALL ON micro_artifact_mapping FROM kiro_mcp_app;
REVOKE ALL ON micro_artifact_audit   FROM kiro_mcp_app;
-- micro_artifacts: kiro_mcp_app must never hold UPDATE. (It was never granted; belt-and-suspenders.)
REVOKE ALL ON micro_artifacts        FROM kiro_mcp_app;

-- End V008 migration (CR-12/14 — Level-2 micro-artifact auto-completion; code + tests only, do NOT deploy)
