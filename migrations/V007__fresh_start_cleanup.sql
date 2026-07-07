-- ============================================================================
--  V007__fresh_start_cleanup.sql   ⚠️⚠️⚠️  DESTRUCTIVE — DO NOT AUTO-RUN  ⚠️⚠️⚠️
-- ----------------------------------------------------------------------------
--  Story:  CR-17 (fresh-start cleanup; replaces cancelled CR-06 backfill)
--  Effect: PERMANENTLY DELETES all imported CST-* projects (and, via
--          ON DELETE CASCADE, their micro_artifacts / macro_checkpoints /
--          gate_evidence / checkpoint_notes / weekly_status_logs / escalations /
--          discovery_sessions / onboarding_checklist_items / project_link_audit).
--
--  PRESERVES:  '__template__' (CASDM seed — required), all DP-* projects,
--              and the append-only governance_events table (no FK; NOT cascaded).
--
--  ⚠️ IRREVERSIBLE. There is NO down-migration. Before running:
--     1. Take a backup:  pg_dump ... > pre_v007_backup.sql   (or an RDS snapshot).
--     2. Run migrations/verify/V007__preflight.sql and review the counts.
--     3. Run ONLY intentionally, in one session, with the guard flag set:
--            SET kiro.confirm_fresh_start = 'yes';   \i migrations/V007__fresh_start_cleanup.sql
--     4. Run migrations/verify/V007__verify.sql.
--
--  ⚠️ The default migration runner MUST SKIP this file (see CR-17 spec §5). It is NOT
--     part of the ordered migration set (V001..V006) and must never run in CI/CD or on deploy.
-- ============================================================================

DO $$
DECLARE
  confirmed TEXT := current_setting('kiro.confirm_fresh_start', true);  -- NULL if unset
  n_projects BIGINT;
BEGIN
  IF confirmed IS DISTINCT FROM 'yes' THEN
    RAISE NOTICE 'V007 SKIPPED: guard not set. To run intentionally: SET kiro.confirm_fresh_start = ''yes'';';
    RETURN;  -- no-op — nothing is deleted
  END IF;

  SELECT count(*) INTO n_projects
    FROM projects
   WHERE jira_key LIKE 'CST-%' AND jira_key <> '__template__';

  RAISE NOTICE 'V007: deleting % imported CST-* project(s) (+ cascaded children). Preserving __template__ and DP-*.', n_projects;

  DELETE FROM projects
   WHERE jira_key LIKE 'CST-%'
     AND jira_key <> '__template__';   -- NEVER delete the CASDM template

  RAISE NOTICE 'V007: fresh-start cleanup complete. governance_events untouched (append-only).';
END
$$;

-- ROLLBACK NOTE: none. This deletion is IRREVERSIBLE and has no down-migration.
-- Recovery is only possible by restoring the pre-run backup / RDS snapshot taken in step 1.
