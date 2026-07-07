-- Verification: V005__append_only_hardening (CR-01A — real append-only hardening)
-- Purpose: Assert the CR-01A privilege/ownership posture holds after V001–V005:
--          roles exist with the right attributes, ALL public objects are owned by kiro_migrator,
--          the NON-MASTER runtime role kiro_mcp_app is a pure append-only writer (INSERT+SELECT on
--          governance_events, NO UPDATE/DELETE anywhere, column-scoped SELECT on projects, NO grant
--          on micro_artifact_mapping) and is NOT a superuser, and kiro_phase2 retains DeliverPro DML
--          but is READ-ONLY on governance_events. NB: the RDS master `kiro_mcp` is admin/migrations
--          ONLY (not a runtime writer) — the append-only grants live on kiro_mcp_app, never on the
--          master (iam-review Finding 2 collision fix). Uses plpgsql ASSERT so any failure aborts
--          with a clear message and non-zero exit.
--
-- ⚠️ Do NOT run against RDS. Use an ephemeral Postgres 16.
--
-- How to run (V001's trailing RDS-only role/grant lines — invalid `CREATE USER IF NOT EXISTS`,
-- `GRANT rds_iam`, `GRANT ... ON DATABASE kiro_governance` — are NOT portable and are superseded by
-- V005's DO-block role creation; strip them with sed and let V005 create the roles):
--
--   docker run --rm -e POSTGRES_PASSWORD=pw -p 5433:5432 -d --name v005pg postgres:16
--   sed '/^-- Initial setup/,$d' migrations/V001__governance_events.sql > /tmp/V001_ddl.sql
--   psql "postgresql://postgres:pw@localhost:5433/postgres" -v ON_ERROR_STOP=1 \
--     -f /tmp/V001_ddl.sql \
--     -f migrations/V002__projects_and_casdm_tracking.sql \
--     -f migrations/V003__phase2_additions.sql \
--     -f migrations/V004__github_slack_linkage.sql \
--     -f migrations/V005__append_only_hardening.sql \
--     -f migrations/V005__append_only_hardening.sql \  -- run TWICE to prove idempotency
--     -f migrations/verify/V005__verify.sql
-- Expected: prints "V005 verification PASSED" and exits 0.
--
-- Note: the connecting role (postgres/superuser locally) can reassign ownership + grant on behalf
-- of kiro_migrator. On RDS the migration runner must be the master or a member that SET ROLE
-- kiro_migrator (see V005 header audit gate).

DO $$
DECLARE
  r RECORD;
  bad TEXT;
BEGIN
  -- ── Roles exist with the right attributes ────────────────────────────────────────────
  ASSERT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='kiro_migrator'), 'MISSING role kiro_migrator';
  ASSERT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='kiro_mcp'),      'MISSING role kiro_mcp';
  ASSERT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='kiro_mcp_app'),  'MISSING role kiro_mcp_app';
  ASSERT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='kiro_phase2'),   'MISSING role kiro_phase2';

  ASSERT (SELECT NOT rolinherit FROM pg_roles WHERE rolname='kiro_migrator'),
         'kiro_migrator must be NOINHERIT (SEC-H1)';
  ASSERT (SELECT NOT rolcanlogin FROM pg_roles WHERE rolname='kiro_migrator'),
         'kiro_migrator must be NOLOGIN';
  -- The DEDICATED non-master runtime role: NOSUPERUSER is the crux of the iam-review Finding 2 fix
  -- (a superuser bypasses table grants, which is exactly the master collision we are replacing).
  ASSERT (SELECT NOT rolsuper FROM pg_roles WHERE rolname='kiro_mcp_app'),
         'kiro_mcp_app must NOT be a superuser (iam-review Finding 2 / SEC-H1 collision fix)';
  ASSERT (SELECT rolcanlogin FROM pg_roles WHERE rolname='kiro_mcp_app'),
         'kiro_mcp_app must be able to LOGIN (runtime MCP role)';
  ASSERT (SELECT NOT rolinherit FROM pg_roles WHERE rolname='kiro_mcp_app'),
         'kiro_mcp_app must be NOINHERIT';
  ASSERT (SELECT NOT rolsuper FROM pg_roles WHERE rolname='kiro_phase2'),
         'kiro_phase2 must NOT be a superuser';

  -- Runtime roles must NOT be members of the owner role (else owner DML leaks back — SEC-H1).
  ASSERT NOT EXISTS (
    SELECT 1 FROM pg_auth_members m
    JOIN pg_roles o ON o.oid=m.roleid JOIN pg_roles mem ON mem.oid=m.member
    WHERE o.rolname='kiro_migrator' AND mem.rolname IN ('kiro_mcp_app','kiro_phase2')
  ), 'runtime roles must NOT be members of kiro_migrator (SEC-H1)';

  -- ── Ownership: every public table / sequence / view owned by kiro_migrator ───────────
  SELECT string_agg(tablename, ', ') INTO bad
  FROM pg_tables WHERE schemaname='public' AND tableowner <> 'kiro_migrator';
  ASSERT bad IS NULL, format('tables NOT owned by kiro_migrator: %s', bad);

  SELECT string_agg(sequencename, ', ') INTO bad
  FROM pg_sequences WHERE schemaname='public' AND sequenceowner <> 'kiro_migrator';
  ASSERT bad IS NULL, format('sequences NOT owned by kiro_migrator: %s', bad);

  SELECT string_agg(viewname, ', ') INTO bad
  FROM pg_views WHERE schemaname='public' AND viewowner <> 'kiro_migrator';
  ASSERT bad IS NULL, format('views NOT owned by kiro_migrator: %s', bad);

  -- ── kiro_mcp_app: append-only writer on governance_events ────────────────────────────
  ASSERT has_table_privilege('kiro_mcp_app','governance_events','INSERT'),
         'kiro_mcp_app must have INSERT on governance_events';
  ASSERT has_table_privilege('kiro_mcp_app','governance_events','SELECT'),
         'kiro_mcp_app must have SELECT on governance_events';
  ASSERT NOT has_table_privilege('kiro_mcp_app','governance_events','UPDATE'),
         'kiro_mcp_app must NOT have UPDATE on governance_events (append-only)';
  ASSERT NOT has_table_privilege('kiro_mcp_app','governance_events','DELETE'),
         'kiro_mcp_app must NOT have DELETE on governance_events (append-only)';

  -- kiro_mcp_app: NO write on projects; column-scoped SELECT only.
  ASSERT NOT has_table_privilege('kiro_mcp_app','projects','INSERT'),
         'kiro_mcp_app must NOT have INSERT on projects';
  ASSERT NOT has_table_privilege('kiro_mcp_app','projects','UPDATE'),
         'kiro_mcp_app must NOT have UPDATE on projects';
  ASSERT NOT has_table_privilege('kiro_mcp_app','projects','DELETE'),
         'kiro_mcp_app must NOT have DELETE on projects';
  -- table-level SELECT must be absent (only the named columns are granted)...
  ASSERT NOT has_table_privilege('kiro_mcp_app','projects','SELECT'),
         'kiro_mcp_app must NOT have table-wide SELECT on projects (column-scoped only)';
  FOREACH bad IN ARRAY ARRAY['jira_key','github_repo','slack_micro_channel_id','slack_macro_channel_id','id','title'] LOOP
    ASSERT has_column_privilege('kiro_mcp_app','projects',bad,'SELECT'),
           format('kiro_mcp_app must have column SELECT on projects.%s', bad);
  END LOOP;
  -- ...and NOT on non-granted columns (e.g. sow_hours, project_manager).
  ASSERT NOT has_column_privilege('kiro_mcp_app','projects','sow_hours','SELECT'),
         'kiro_mcp_app must NOT have SELECT on projects.sow_hours (column scope leaked)';
  ASSERT NOT has_column_privilege('kiro_mcp_app','projects','project_manager','SELECT'),
         'kiro_mcp_app must NOT have SELECT on projects.project_manager (column scope leaked)';

  -- (PLAN-L2) kiro_mcp_app has NO privilege on micro_artifact_mapping.
  ASSERT NOT has_table_privilege('kiro_mcp_app','micro_artifact_mapping','SELECT'),
         'kiro_mcp_app must NOT have any grant on micro_artifact_mapping (PLAN-L2)';
  ASSERT NOT has_table_privilege('kiro_mcp_app','micro_artifact_mapping','INSERT'),
         'kiro_mcp_app must NOT have INSERT on micro_artifact_mapping (PLAN-L2)';

  -- Spot-check kiro_mcp_app holds NO write on other governance/DeliverPro tables.
  FOR r IN SELECT unnest(ARRAY['micro_artifacts','macro_checkpoints','project_link_audit']) AS t LOOP
    ASSERT NOT has_table_privilege('kiro_mcp_app', r.t, 'INSERT'),
           format('kiro_mcp_app must NOT have INSERT on %s', r.t);
    ASSERT NOT has_table_privilege('kiro_mcp_app', r.t, 'UPDATE'),
           format('kiro_mcp_app must NOT have UPDATE on %s', r.t);
  END LOOP;

  -- ── kiro_phase2: DeliverPro DML retained, but READ-ONLY on governance_events ──────────
  ASSERT has_table_privilege('kiro_phase2','projects','INSERT'),
         'kiro_phase2 must have INSERT on projects';
  ASSERT has_table_privilege('kiro_phase2','projects','UPDATE'),
         'kiro_phase2 must have UPDATE on projects (linkage write path)';
  ASSERT has_table_privilege('kiro_phase2','macro_checkpoints','UPDATE'),
         'kiro_phase2 must have UPDATE on macro_checkpoints (app-owned reached_at)';
  ASSERT has_table_privilege('kiro_phase2','project_link_audit','SELECT'),
         'kiro_phase2 must have SELECT on project_link_audit';
  ASSERT has_table_privilege('kiro_phase2','governance_events','SELECT'),
         'kiro_phase2 must have SELECT on governance_events (timeline read)';
  ASSERT NOT has_table_privilege('kiro_phase2','governance_events','INSERT'),
         'kiro_phase2 must NOT have INSERT on governance_events (append-only; only kiro_mcp_app writes)';
  ASSERT NOT has_table_privilege('kiro_phase2','governance_events','UPDATE'),
         'kiro_phase2 must NOT have UPDATE on governance_events';
  ASSERT NOT has_table_privilege('kiro_phase2','governance_events','DELETE'),
         'kiro_phase2 must NOT have DELETE on governance_events';

  -- ── Schema CREATE lockdown (SEC-L9) ──────────────────────────────────────────────────
  ASSERT NOT has_schema_privilege('kiro_mcp_app','public','CREATE'),
         'kiro_mcp_app must NOT have CREATE on schema public (SEC-L9)';
  ASSERT NOT has_schema_privilege('kiro_phase2','public','CREATE'),
         'kiro_phase2 must NOT have CREATE on schema public (SEC-L9)';
  ASSERT has_schema_privilege('kiro_mcp_app','public','USAGE'),
         'kiro_mcp_app must have USAGE on schema public';
  ASSERT has_schema_privilege('kiro_phase2','public','USAGE'),
         'kiro_phase2 must have USAGE on schema public';

  -- ── Default privileges for future kiro_migrator objects keep kiro_mcp_app closed ─────
  -- pg_default_acl entry for role kiro_migrator on TABLES must not grant kiro_mcp_app anything.
  ASSERT NOT EXISTS (
    SELECT 1
    FROM pg_default_acl d
    JOIN pg_roles owner ON owner.oid = d.defaclrole
    CROSS JOIN LATERAL aclexplode(d.defaclacl) AS ae
    JOIN pg_roles grantee ON grantee.oid = ae.grantee
    WHERE owner.rolname = 'kiro_migrator' AND d.defaclobjtype = 'r' AND grantee.rolname = 'kiro_mcp_app'
  ), 'default privileges must NOT grant kiro_mcp_app anything on future TABLES';

  RAISE NOTICE 'V005 verification PASSED';
END $$;
