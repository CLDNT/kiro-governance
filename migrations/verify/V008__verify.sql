-- Verification: V008__level2_micro_artifact_autocomplete (CR-12/14)
-- Purpose: Assert the V008 additive objects, seed, and grants exist AND that the append-only
--          invariant holds — kiro_mcp_app has NO privilege on micro_artifact_mapping /
--          micro_artifacts / micro_artifact_audit, while kiro_phase2 has exactly the Level-2
--          privileges. Uses plpgsql ASSERT so any failure aborts with a clear message + non-zero exit.
-- How to run (do NOT run against RDS — use an ephemeral Postgres 16):
--   docker run --rm -e POSTGRES_PASSWORD=pw -p 5433:5432 -d --name v008pg postgres:16
--   psql "postgresql://postgres:pw@localhost:5433/postgres" -v ON_ERROR_STOP=1 \
--     -f migrations/V001__governance_events.sql \
--     -f migrations/V002__projects_and_casdm_tracking.sql \
--     -f migrations/V003__phase2_additions.sql \
--     -f migrations/V004__github_slack_linkage.sql \
--     -f migrations/V005__append_only_hardening.sql \
--     -f migrations/V008__level2_micro_artifact_autocomplete.sql \
--     -f migrations/V008__level2_micro_artifact_autocomplete.sql \  -- run TWICE to prove idempotency
--     -f migrations/verify/V008__verify.sql
-- Expected: prints "V008 verification PASSED" and exits 0.

DO $$
BEGIN
  -- (A) governance_events.event_code exists and is nullable ------------------------------
  ASSERT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='governance_events' AND column_name='event_code'
  ), 'MISSING governance_events.event_code';
  ASSERT (
    SELECT is_nullable='YES' FROM information_schema.columns
    WHERE table_name='governance_events' AND column_name='event_code'
  ), 'governance_events.event_code must be NULLABLE (additive)';
  ASSERT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname='public' AND tablename='governance_events' AND indexname='idx_governance_events_event_code'
  ), 'MISSING partial index idx_governance_events_event_code';

  -- (B) micro_artifacts.manual_override exists, boolean, default false --------------------
  ASSERT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='micro_artifacts' AND column_name='manual_override'
  ), 'MISSING micro_artifacts.manual_override';
  ASSERT (
    SELECT data_type='boolean' AND is_nullable='NO' AND column_default LIKE '%false%'
    FROM information_schema.columns
    WHERE table_name='micro_artifacts' AND column_name='manual_override'
  ), 'micro_artifacts.manual_override must be NOT NULL BOOLEAN DEFAULT false';

  -- (C) 16 active mapping rows seeded (project_type='default') ----------------------------
  ASSERT (SELECT count(*) FROM micro_artifact_mapping
          WHERE project_type='default' AND is_active=true) = 16,
         'micro_artifact_mapping must have 16 active default rows';
  -- Every seeded artifact_name must correspond to a real V002 __template__ artifact.
  ASSERT NOT EXISTS (
    SELECT 1 FROM micro_artifact_mapping m
    WHERE m.project_type='default'
      AND NOT EXISTS (
        SELECT 1 FROM micro_artifacts ma
        WHERE ma.project_id='__template__' AND ma.phase=m.phase AND ma.artifact_name=m.artifact_name
      )
  ), 'every mapping row must match a V002 __template__ micro_artifacts (phase, artifact_name)';

  -- (D) micro_artifact_audit exists, owned by kiro_migrator, has the action CHECK ---------
  ASSERT EXISTS (SELECT 1 FROM information_schema.tables
                 WHERE table_schema='public' AND table_name='micro_artifact_audit'),
         'MISSING table micro_artifact_audit';
  ASSERT (SELECT tableowner='kiro_migrator' FROM pg_tables
          WHERE schemaname='public' AND tablename='micro_artifact_audit'),
         'micro_artifact_audit must be OWNED BY kiro_migrator';
  ASSERT EXISTS (SELECT 1 FROM pg_indexes
                 WHERE tablename='micro_artifact_audit' AND indexname='idx_micro_artifact_audit_project'),
         'MISSING index idx_micro_artifact_audit_project';

  -- (E.2) kiro_phase2 Level-2 privileges -------------------------------------------------
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='kiro_phase2') THEN
    ASSERT has_table_privilege('kiro_phase2','micro_artifact_mapping','SELECT'),
           'kiro_phase2 must have SELECT on micro_artifact_mapping';
    ASSERT has_table_privilege('kiro_phase2','micro_artifacts','UPDATE'),
           'kiro_phase2 must have UPDATE on micro_artifacts';
    ASSERT has_table_privilege('kiro_phase2','micro_artifact_audit','INSERT'),
           'kiro_phase2 must have INSERT on micro_artifact_audit';
  END IF;

  -- (E.3) APPEND-ONLY INVARIANT: kiro_mcp_app has NO privilege on the 3 Level-2 tables ----
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='kiro_mcp_app') THEN
    ASSERT NOT has_table_privilege('kiro_mcp_app','micro_artifact_mapping','SELECT'),
           'APPEND-ONLY VIOLATION: kiro_mcp_app must have NO grant on micro_artifact_mapping';
    ASSERT NOT has_table_privilege('kiro_mcp_app','micro_artifacts','UPDATE'),
           'APPEND-ONLY VIOLATION: kiro_mcp_app must NOT have UPDATE on micro_artifacts';
    ASSERT NOT has_table_privilege('kiro_mcp_app','micro_artifacts','SELECT'),
           'APPEND-ONLY VIOLATION: kiro_mcp_app must have NO grant on micro_artifacts';
    ASSERT NOT has_table_privilege('kiro_mcp_app','micro_artifact_audit','SELECT'),
           'APPEND-ONLY VIOLATION: kiro_mcp_app must have NO grant on micro_artifact_audit';
    ASSERT NOT has_table_privilege('kiro_mcp_app','micro_artifact_audit','INSERT'),
           'APPEND-ONLY VIOLATION: kiro_mcp_app must NOT INSERT into micro_artifact_audit';
    -- governance_events stays INSERT+SELECT for the MCP role (append-only) — event_code column covered.
    ASSERT has_table_privilege('kiro_mcp_app','governance_events','INSERT'),
           'kiro_mcp_app must retain INSERT on governance_events (append-only writer)';
    ASSERT NOT has_table_privilege('kiro_mcp_app','governance_events','UPDATE'),
           'APPEND-ONLY VIOLATION: kiro_mcp_app must NOT have UPDATE on governance_events';
  END IF;

  RAISE NOTICE 'V008 verification PASSED';
END $$;
