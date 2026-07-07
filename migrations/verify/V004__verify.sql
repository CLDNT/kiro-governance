-- Verification: V004__github_slack_linkage (CR-01, additive schema only)
-- Purpose: Assert the V004 additive objects exist AND that the CR-01 scope boundary holds
--          (no ownership/GRANT hardening, no v_timeline repoint). Uses plpgsql ASSERT so any
--          failure aborts with a clear message and a non-zero exit.
-- How to run (do NOT run against RDS — use an ephemeral Postgres 16):
--   docker run --rm -e POSTGRES_PASSWORD=pw -p 5433:5432 -d --name v004pg postgres:16
--   psql "postgresql://postgres:pw@localhost:5433/postgres" \
--     -v ON_ERROR_STOP=1 \
--     -f migrations/V001__governance_events.sql \
--     -f migrations/V002__projects_and_casdm_tracking.sql \
--     -f migrations/V003__phase2_additions.sql \
--     -f migrations/V004__github_slack_linkage.sql \
--     -f migrations/V004__github_slack_linkage.sql \  -- run TWICE to prove idempotency
--     -f migrations/verify/V004__verify.sql
-- Expected: prints "V004 verification PASSED" and exits 0.

DO $$
DECLARE
  missing TEXT;
BEGIN
  -- (A) six nullable columns on projects -------------------------------------------------
  FOREACH missing IN ARRAY ARRAY[
    'github_repo','github_url','slack_micro_channel_id','slack_macro_channel_id','updated_by','updated_at'
  ] LOOP
    ASSERT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'projects' AND column_name = missing
    ), format('MISSING projects.%s', missing);

    ASSERT (
      SELECT is_nullable = 'YES' FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'projects' AND column_name = missing
    ), format('projects.%s must be NULLABLE (additive)', missing);
  END LOOP;

  -- column types
  ASSERT (SELECT data_type = 'timestamp with time zone' FROM information_schema.columns
          WHERE table_name='projects' AND column_name='updated_at'), 'updated_at must be TIMESTAMPTZ';

  -- (B) partial unique index --------------------------------------------------------------
  ASSERT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname='public' AND tablename='projects' AND indexname='uq_projects_github_repo'
  ), 'MISSING index uq_projects_github_repo';

  ASSERT (
    SELECT indexdef ILIKE '%UNIQUE%' AND indexdef ILIKE '%WHERE (github_repo IS NOT NULL)%'
    FROM pg_indexes WHERE indexname='uq_projects_github_repo'
  ), 'uq_projects_github_repo must be a PARTIAL UNIQUE index (WHERE github_repo IS NOT NULL)';

  -- (C) project_link_audit table + columns + index ---------------------------------------
  ASSERT EXISTS (SELECT 1 FROM information_schema.tables
                 WHERE table_schema='public' AND table_name='project_link_audit'),
         'MISSING table project_link_audit';
  FOREACH missing IN ARRAY ARRAY['id','project_id','field','old_value','new_value','actor_sub','changed_at'] LOOP
    ASSERT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name='project_link_audit' AND column_name=missing),
           format('MISSING project_link_audit.%s', missing);
  END LOOP;
  ASSERT EXISTS (SELECT 1 FROM pg_indexes
                 WHERE tablename='project_link_audit' AND indexname='idx_project_link_audit_project'),
         'MISSING index idx_project_link_audit_project';
  -- FK to projects(jira_key)
  ASSERT EXISTS (
    SELECT 1 FROM information_schema.table_constraints tc
    JOIN information_schema.constraint_column_usage ccu ON tc.constraint_name = ccu.constraint_name
    WHERE tc.table_name='project_link_audit' AND tc.constraint_type='FOREIGN KEY'
      AND ccu.table_name='projects' AND ccu.column_name='jira_key'
  ), 'project_link_audit.project_id must FK -> projects(jira_key)';

  -- (D) audit triggers exist --------------------------------------------------------------
  ASSERT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='audit_project_linkage' AND NOT tgisinternal),
         'MISSING BEFORE UPDATE trigger audit_project_linkage';
  ASSERT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='audit_project_linkage_insert' AND NOT tgisinternal),
         'MISSING AFTER INSERT trigger audit_project_linkage_insert';
  ASSERT EXISTS (SELECT 1 FROM pg_proc WHERE proname='trg_audit_project_linkage'),
         'MISSING function trg_audit_project_linkage';
  ASSERT EXISTS (SELECT 1 FROM pg_proc WHERE proname='trg_audit_project_linkage_insert'),
         'MISSING function trg_audit_project_linkage_insert';

  -- (E) INERT micro_artifact_mapping: exists, empty, and NOT granted to kiro_mcp -----------
  ASSERT EXISTS (SELECT 1 FROM information_schema.tables
                 WHERE table_schema='public' AND table_name='micro_artifact_mapping'),
         'MISSING table micro_artifact_mapping';
  ASSERT (SELECT count(*) = 0 FROM micro_artifact_mapping),
         'micro_artifact_mapping must be INERT (no seed data)';
  ASSERT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name='micro_artifact_mapping' AND constraint_type='UNIQUE'
      AND constraint_name='uq_micro_artifact_mapping'
  ), 'MISSING unique constraint uq_micro_artifact_mapping';

  -- CR-01 SCOPE BOUNDARY: no kiro_mcp grant on micro_artifact_mapping (if role exists at all).
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='kiro_mcp') THEN
    ASSERT NOT has_table_privilege('kiro_mcp','micro_artifact_mapping','SELECT'),
           'SCOPE VIOLATION: kiro_mcp must NOT have any grant on micro_artifact_mapping (PLAN-L2)';
  END IF;

  RAISE NOTICE 'V004 verification PASSED';
END $$;
