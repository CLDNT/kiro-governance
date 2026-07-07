-- Migration: V004__github_slack_linkage
-- Date: 2026-07-02
-- Story: CR-01 — Additive schema for the Project ↔ GitHub ↔ dual-Slack linkage feature.
-- Scope: ADDITIVE / IDEMPOTENT DDL ONLY (see spec specs/phase2/CR-01-v004-additive-schema-spec.md).
--        Implements the schema half of FR-P2-033..041 (Level 1) and the INERT Level-2 placeholder.
-- Source: docs/phase2/architecture/unified-data-model.md §4.4;
--         docs/phase2/projects-architecture.md §12;
--         docs/phase2/change-requests/2026-07-02-github-slack-linkage-impact.md §A-E;
--         docs/phase2/sprint-planning/jira-backlog.csv (CR-01 acceptance criteria).
-- Idempotency: All statements safe to re-run (ADD COLUMN IF NOT EXISTS / CREATE ... IF NOT EXISTS /
--              CREATE OR REPLACE FUNCTION / DROP TRIGGER IF EXISTS then CREATE TRIGGER).
-- Database: RDS PostgreSQL 16 (standard RDS, NOT Aurora; shared Phase 1 + Phase 2 instance).
--           Engine reconciliation: some Phase-2 data-model prose historically said "Aurora PG15";
--           the deployed Phase-1 instance is standard RDS PostgreSQL 16 per
--           docs/phase1/data-persistence-architecture.md (authoritative). No Aurora-only / no
--           version-specific syntax is used here.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- SCOPE BOUNDARY (READ BEFORE EDITING)
--   IN  (CR-01, this file): additive columns, partial unique index, project_link_audit table +
--        per-field BEFORE UPDATE audit trigger + AFTER INSERT create-path audit trigger,
--        and the INERT micro_artifact_mapping table (created, no seed data, NO grants).
--   OUT (CR-01A, a SEPARATE migration — e.g. V005): the real append-only hardening
--        (kiro_migrator/kiro_mcp/kiro_phase2 roles, ALTER ... OWNER TO reassignment, and all
--        GRANT/REVOKE/ALTER DEFAULT PRIVILEGES statements). It carries a BLOCKING pre-implementation
--        ownership/role audit + human sign-off (SEC-H1) and is intentionally NOT in V004.
--   OUT (timeline reconciliation — tracked separately, NOT CR-01): the v_timeline DROP VIEW +
--        CREATE VIEW join repoint (jira_key → github_repo). That is a behavioural change on an
--        existing view (not additive) and depends on the CR-06 backfill collision guard, so it is
--        deliberately excluded here. The deployed V003 v_timeline (jira_key join) stays in place
--        until the reconciliation migration repoints it.
--   Keeping non-additive DDL out of V004 lets it be applied safely, ahead of the role/ownership
--   hardening, with zero blast radius on running services.
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Pre-implementation note (F10): two historical V002 files (V002__projects_and_jira_sync.sql and
--   V002__projects_and_casdm_tracking.sql) both define `projects` with CREATE TABLE IF NOT EXISTS
--   and identical linkage-relevant columns (jira_key TEXT UNIQUE, project_type, status, ...).
--   V004 only uses ALTER TABLE IF EXISTS + ADD COLUMN IF NOT EXISTS, so it is correct regardless of
--   which V002 applied. Confirm the two files converge on a single deployed `projects` definition
--   before deploy (does not block authoring/testing).
--
-- Locked customer decisions (2026-07-02) reflected by this schema:
--   * Linkage is OPTIONAL per project = the feature switch (github_repo nullable, 1:1).
--   * Dual Slack channels per project (micro + macro) stored as NON-SECRET channel ids.
--   * Slack bot token is a SECRET — SSM SecureString ONLY; never a PG column (no column added here).
--   * CI = micro / app = macro coexist; macro completion is app-owned (display-only Kiro macros).

-- ─────────────────────────────────────────────────────────────────────────────
-- (A) Optional GitHub linkage + DUAL app-managed Slack channels (FR-P2-034, FR-P2-035).
--     All columns NULLABLE — an unlinked project (github_repo IS NULL) behaves exactly as today.
--     The Slack BOT TOKEN is a SECRET (SSM SecureString only) — NEVER a column.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE IF EXISTS projects
  ADD COLUMN IF NOT EXISTS github_repo            TEXT,        -- repo name; matches governance_events.project_id; FEATURE SWITCH
  ADD COLUMN IF NOT EXISTS github_url             TEXT,        -- full HTTPS repo URL (display; https://github.com/... only)
  ADD COLUMN IF NOT EXISTS slack_micro_channel_id TEXT,        -- non-secret Slack channel id for MICRO notifications (CI/Kiro-owned)
  ADD COLUMN IF NOT EXISTS slack_macro_channel_id TEXT,        -- non-secret Slack channel id for MACRO notifications (app-owned)
  ADD COLUMN IF NOT EXISTS updated_by             TEXT,        -- Cognito sub of last linkage mutator (linkage audit)
  ADD COLUMN IF NOT EXISTS updated_at             TIMESTAMPTZ; -- last linkage mutation timestamp (linkage audit)

-- ─────────────────────────────────────────────────────────────────────────────
-- (B) 1:1 repo ↔ project. Partial unique index tolerates multiple NULLs (unlinked projects).
--     Also serves the record_progress / notify_slack resolve-by-repo lookup (FR-P2-038/039).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS uq_projects_github_repo
  ON projects (github_repo) WHERE github_repo IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- (C) Linkage-change audit table (FR-P2-034/035). One row PER CHANGED FIELD.
-- ─────────────────────────────────────────────────────────────────────────────
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

-- ─────────────────────────────────────────────────────────────────────────────
-- (D) BEFORE UPDATE trigger — audits ANY linkage mutation, ONE ROW PER CHANGED FIELD
--     (uses IS DISTINCT FROM per column; PLAN-M3). Belt-and-suspenders beyond app authz.
--     actor := projects.updated_by (Cognito sub set by the app); 'db_direct' for out-of-band SQL.
-- ─────────────────────────────────────────────────────────────────────────────
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

DROP TRIGGER IF EXISTS audit_project_linkage ON projects;
CREATE TRIGGER audit_project_linkage
  BEFORE UPDATE ON projects FOR EACH ROW EXECUTE FUNCTION trg_audit_project_linkage();

-- ─────────────────────────────────────────────────────────────────────────────
-- (D.2) CREATE-PATH audit (SEC-M5). The BEFORE UPDATE trigger above never fires for a project that
--       is created ALREADY linked (INSERT with a non-NULL linkage field). This AFTER INSERT trigger
--       records one project_link_audit row per non-NULL linkage field present at creation
--       (old_value = NULL), so create-time linkage is audited identically to a later change.
--       actor := projects.updated_by (Cognito sub set by the app on create); 'db_direct' otherwise.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION trg_audit_project_linkage_insert() RETURNS trigger AS $$
DECLARE
  actor TEXT := COALESCE(NEW.updated_by, 'db_direct');
BEGIN
  IF NEW.github_repo IS NOT NULL THEN
    INSERT INTO project_link_audit (project_id, field, old_value, new_value, actor_sub)
    VALUES (NEW.jira_key, 'github_repo', NULL, NEW.github_repo, actor);
  END IF;
  IF NEW.github_url IS NOT NULL THEN
    INSERT INTO project_link_audit (project_id, field, old_value, new_value, actor_sub)
    VALUES (NEW.jira_key, 'github_url', NULL, NEW.github_url, actor);
  END IF;
  IF NEW.slack_micro_channel_id IS NOT NULL THEN
    INSERT INTO project_link_audit (project_id, field, old_value, new_value, actor_sub)
    VALUES (NEW.jira_key, 'slack_micro_channel_id', NULL, NEW.slack_micro_channel_id, actor);
  END IF;
  IF NEW.slack_macro_channel_id IS NOT NULL THEN
    INSERT INTO project_link_audit (project_id, field, old_value, new_value, actor_sub)
    VALUES (NEW.jira_key, 'slack_macro_channel_id', NULL, NEW.slack_macro_channel_id, actor);
  END IF;
  RETURN NULL; -- AFTER trigger: return value ignored
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS audit_project_linkage_insert ON projects;
CREATE TRIGGER audit_project_linkage_insert
  AFTER INSERT ON projects FOR EACH ROW EXECUTE FUNCTION trg_audit_project_linkage_insert();

-- ─────────────────────────────────────────────────────────────────────────────
-- (E) INERT Level-2 mapping table (FR-P2-042 — DEFERRED). Created now as a forward-compatible
--     placeholder so CR-01A only needs to reassign its ownership and a future reactivation CR
--     (blocked on OQ-CR-13 + CR-14 event_code + CR-OIDC) only needs to seed rows and wire the
--     app-side consumer. It is INERT: NO seed data, and NO runtime-role grant is created here.
--     (PLAN-L2) Level-2 runs APP-SIDE — kiro_mcp gets NO grant on this table, ever.
--     Schema mirrors the impact doc §E design of record (key = event_code, per PLAN-L4).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS micro_artifact_mapping (
  id            BIGSERIAL   PRIMARY KEY,
  event_code    TEXT        NOT NULL,                    -- stable code emitted by Kiro (Level-2 key; requires CR-14)
  project_type  TEXT        NOT NULL DEFAULT 'default',
  phase         TEXT        NOT NULL,
  artifact_name TEXT        NOT NULL,                    -- must match micro_artifacts.artifact_name for (project, phase)
  is_active     BOOLEAN     NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_micro_artifact_mapping UNIQUE (event_code, project_type, phase)
);

-- NOTE (Level-2 DEFERRED): no event_code column is added to governance_events here (that is a
--   Phase-1 change delivered by CR-14). This table stays empty and ungranted until Level-2 is
--   reactivated app-side under the DeliverPro app role.

-- NOTE (append-only hardening): the ownership reassignment to kiro_migrator and the exact-least-
--   privilege GRANTs for kiro_mcp / kiro_phase2 are delivered by CR-01A (separate migration), NOT
--   here. See docs/phase2/architecture/unified-data-model.md §4.4.4 and the impact doc §F.

-- End V004 migration (additive schema only)
