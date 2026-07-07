-- Pre-implementation audit (GATE 1): V005__append_only_hardening (CR-01A / SEC-H1)
-- Purpose: READ-ONLY audit of the LIVE database BEFORE applying V005. It changes NOTHING — it only
--          reports the facts the SEC-H1 hardening depends on, and RAISES EXCEPTION on the two
--          conditions that would make the hardening unsafe or ineffective, so a human can resolve
--          them before V005 is applied. Referenced by unified-data-model.md §4.4.4 (GATE 1).
--
-- Run as the migration runner (or an admin) against the live DB:
--   psql "$LIVE_DB_URL" -f migrations/verify/V005__preflight_audit.sql
--
-- This is GATE 1 of the V005 deploy. GATE 2 (ops) is the runtime-repoint-off-master prerequisite
-- documented in unified-data-model.md §4.4.4 — it is an operational action, not SQL, and cannot be
-- checked here (it concerns which role the MCP *server process* authenticates as at runtime).

\echo '================ V005 PRE-IMPLEMENTATION AUDIT (read-only) ================'

\echo ''
\echo '--- Current object ownership (public schema) ---'
\echo '    Every table/sequence/view listed here will be reassigned OWNER TO kiro_migrator by V005.'
SELECT 'table'    AS objkind, tablename    AS objname, tableowner    AS owner FROM pg_tables    WHERE schemaname='public'
UNION ALL
SELECT 'sequence' AS objkind, sequencename AS objname, sequenceowner AS owner FROM pg_sequences WHERE schemaname='public'
UNION ALL
SELECT 'view'     AS objkind, viewname     AS objname, viewowner     AS owner FROM pg_views     WHERE schemaname='public'
ORDER BY objkind, objname;

\echo ''
\echo '--- Connected (migration-runner) identity + attributes ---'
SELECT current_user AS connected_role,
       (SELECT rolsuper    FROM pg_roles WHERE rolname = current_user) AS is_superuser,
       (SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user) AS bypasses_rls;

\echo ''
\echo '--- Runtime / owner role attributes (expected: kiro_migrator NOLOGIN NOINHERIT; kiro_mcp_app + kiro_phase2 NOT superuser; kiro_mcp = RDS master = superuser, admin/migrations only) ---'
SELECT rolname, rolsuper, rolinherit, rolcanlogin
FROM pg_roles
WHERE rolname IN ('kiro_migrator','kiro_mcp','kiro_mcp_app','kiro_phase2','rds_superuser')
ORDER BY rolname;

\echo ''
\echo '--- Runtime session identities currently connected (GATE 2 signal — expect MCP as kiro_mcp_app, NOT the master kiro_mcp) ---'
SELECT usename, count(*) AS sessions
FROM pg_stat_activity
WHERE datname = current_database() AND usename IS NOT NULL
GROUP BY usename
ORDER BY usename;

\echo ''
\echo '--- Role memberships involving kiro_migrator (runtime roles MUST NOT be members) ---'
SELECT owner.rolname AS granted_role, member.rolname AS member_role
FROM pg_auth_members m
JOIN pg_roles owner  ON owner.oid  = m.roleid
JOIN pg_roles member ON member.oid = m.member
WHERE owner.rolname = 'kiro_migrator'
ORDER BY member.rolname;

\echo ''
\echo '--- Is the RDS master (kiro_mcp) still a member of rds_superuser? (expected YES — it is admin/migrations only; the RUNTIME must be kiro_mcp_app, NOT this role) ---'
SELECT owner.rolname AS granted_role, member.rolname AS member_role
FROM pg_auth_members m
JOIN pg_roles owner  ON owner.oid  = m.roleid
JOIN pg_roles member ON member.oid = m.member
WHERE member.rolname = 'kiro_mcp'
ORDER BY owner.rolname;

\echo ''
\echo '--- Is the runtime role kiro_mcp_app (correctly) NOT a superuser? (expected: rolsuper=f) ---'
SELECT rolname, rolsuper FROM pg_roles WHERE rolname = 'kiro_mcp_app';

-- ── Hard fails: block the apply if these unsafe conditions hold ──────────────────────────────
DO $$
DECLARE
  n INT;
BEGIN
  -- (1) Runtime roles must NOT be members of kiro_migrator (else owner DML leaks back — SEC-H1).
  SELECT count(*) INTO n
  FROM pg_auth_members m
  JOIN pg_roles owner  ON owner.oid  = m.roleid
  JOIN pg_roles member ON member.oid = m.member
  WHERE owner.rolname = 'kiro_migrator' AND member.rolname IN ('kiro_mcp_app','kiro_phase2');
  IF n > 0 THEN
    RAISE EXCEPTION 'AUDIT FAIL (SEC-H1): a runtime role is a member of kiro_migrator — remove the membership before applying V005 (owner DML would leak back via INHERIT/SET ROLE).';
  END IF;

  -- (2) kiro_migrator, if it already exists, must be NOINHERIT (else members implicitly gain owner DML).
  SELECT count(*) INTO n FROM pg_roles WHERE rolname='kiro_migrator' AND rolinherit = true;
  IF n > 0 THEN
    RAISE EXCEPTION 'AUDIT FAIL (SEC-H1): kiro_migrator exists but is INHERIT — it must be NOINHERIT before applying V005.';
  END IF;

  -- (3) The dedicated runtime role kiro_mcp_app, if it already exists, must NOT be a superuser
  --     (iam-review Finding 2: a superuser bypasses table grants, defeating append-only — this is
  --     exactly the master collision the fix removes).
  SELECT count(*) INTO n FROM pg_roles WHERE rolname='kiro_mcp_app' AND rolsuper = true;
  IF n > 0 THEN
    RAISE EXCEPTION 'AUDIT FAIL (iam-review Finding 2 / SEC-H1): kiro_mcp_app is a SUPERUSER — it must be NOSUPERUSER or its append-only grants are bypassed. ALTER ROLE kiro_mcp_app NOSUPERUSER before applying V005.';
  END IF;

  RAISE NOTICE 'V005 pre-implementation audit: no BLOCKING conditions detected in-DB.';
  RAISE NOTICE 'REMINDER (GATE 2, ops — not checkable here): before/at cutover, repoint the MCP server DB_USER=kiro_mcp_app + IAM rds-db:connect dbuser ARN to .../dbuser:*/kiro_mcp_app (OFF the RDS master kiro_mcp). Until then, append-only is best-effort, NOT enforced. See unified-data-model.md §4.4.4.';
  RAISE NOTICE 'REMINDER (GATE 2 positive check, SEC review L1): AFTER cutover, verify the LIVE MCP session identity with: SELECT usename FROM pg_stat_activity WHERE datname = current_database(); — GATE 2 is complete only when the MCP usename is kiro_mcp_app (the non-master runtime role), NOT the master kiro_mcp.';
END $$;

\echo ''
\echo '================ END V005 PRE-IMPLEMENTATION AUDIT ================'
