-- Migration: V005__append_only_hardening
-- Date: 2026-07-02
-- Story: CR-01A — Real append-only hardening for the Phase 2 DeliverPro governance DB.
-- Scope: PRIVILEGE / OWNERSHIP / ROLE DDL ONLY. No schema (columns/tables/indexes/views) is added
--        or altered here — that is CR-01 (V004__github_slack_linkage.sql).
-- Source: docs/phase2/architecture/unified-data-model.md §4.4.4 (ownership reassignment);
--         docs/phase2/change-requests/2026-07-02-github-slack-linkage-impact.md §F (v3.1 SEC-H1/SEC-L4);
--         specs/phase2/CR-01-v004-additive-schema-spec.md §2 (scope split).
-- Database: RDS PostgreSQL 16 (standard RDS, NOT Aurora; shared Phase 1 + Phase 2 instance).
-- Idempotency: All statements are safe to re-run (DO-block role guards, ALTER ... OWNER TO is a
--              no-op when already owned, REVOKE/GRANT are idempotent, ALTER DEFAULT PRIVILEGES is
--              declarative). Safe to apply more than once.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- WHY CR-01/CR-01A ARE SPLIT
--   The original CR-01 story bundled the additive linkage schema with this append-only hardening.
--   The split lets the additive schema (V004) deploy ahead of the role/ownership work with zero
--   blast radius on running services, and keeps this security-sensitive, ops-gated privilege change
--   as its own independently-reviewable, independently-deployable migration.
--     * CR-01  (V004__github_slack_linkage.sql) — ADDITIVE schema only. DELIVERED.
--     * CR-01A (this file, V005)                — append-only hardening. THIS MIGRATION.
--
-- WHAT THIS MIGRATION DOES (SEC-H1 / SEC-L4)
--   Root cause (verified): V001 grants kiro_mcp only `ALL PRIVILEGES ON DATABASE` (database scope:
--   CONNECT/CREATE/TEMP — NOT table DML). kiro_mcp can INSERT today ONLY because it OWNS the tables
--   (it is the connecting/migration role). A table OWNER keeps every right regardless of REVOKE and
--   can re-grant — so a plain `REVOKE ALL` is COSMETIC and does NOT make governance_events
--   append-only. Real append-only requires moving table OWNERSHIP off the runtime role:
--     (F.1) create a dedicated non-runtime, NOINHERIT owner/DDL role `kiro_migrator`
--           (DO-block CREATE ROLE — `CREATE USER IF NOT EXISTS` in V001 is invalid PG syntax, SEC-L4);
--     (F.2) reassign OWNERSHIP of every table/sequence/view to `kiro_migrator`;
--     (F.3) grant the DEDICATED non-master runtime MCP role `kiro_mcp_app` EXACTLY
--           `INSERT, SELECT ON governance_events` (+ its sequence) and column-scoped `SELECT` on
--           `projects` — NO UPDATE/DELETE anywhere, and NO grant on `micro_artifact_mapping`
--           (PLAN-L2 — Level-2 runs app-side). NB: `kiro_mcp` is the RDS MASTER (superuser) and is
--           reserved for admin/migrations ONLY — it is NOT the runtime writer (see the collision
--           note below). The runtime grants therefore live on `kiro_mcp_app`, never on `kiro_mcp`;
--     (F.4) re-establish the Phase-2 app role `kiro_phase2` DML on DeliverPro-owned tables (its DML
--           does NOT survive the ownership move, so it must be re-granted) — read-only on
--           governance_events (append-only for the app too);
--     (F.5) `ALTER DEFAULT PRIVILEGES` so future objects inherit the same least-privilege posture,
--           and lock down `CREATE ON SCHEMA public`.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- 🚨 BLOCKING OPS PREREQUISITE (SEC-H1 — append-only is NOT enforced without this)
--   ROOT-CAUSE COLLISION (iam-review Finding 2): the RDS instance MASTER username is `kiro_mcp`
--   (member of rds_superuser — see docs/phase1/data-persistence-architecture.md §2), and an earlier
--   revision of this migration ALSO used `kiro_mcp` as the "locked-down runtime role". Those are the
--   SAME PostgreSQL role — so every `INSERT/SELECT`-only grant placed on `kiro_mcp` was silently
--   BYPASSED, because a superuser ignores table grants and can `SET ROLE` to the owner and re-grant
--   itself DML. Naming the runtime role identically to the master defeated the whole append-only
--   model. We do NOT change the RDS master username (that forces replacement of a RETAIN /
--   deletion-protected instance — see data-persistence-architecture.md §2).
--
--   FIX (this migration): introduce a DISTINCT, non-master runtime role `kiro_mcp_app`
--   (LOGIN NOSUPERUSER NOINHERIT) and move ALL runtime grants onto it. `kiro_mcp` (the master) is
--   reserved for admin / break-glass / running migrations ONLY and holds NO runtime DML grant.
--
--   Append-only becomes a REAL DB guarantee ONLY when the MCP runtime authenticates as
--   `kiro_mcp_app` (non-master, NOSUPERUSER) holding exactly the F.3 grants. Ops MUST, before/at
--   cutover (GATE 2 — an ops action, not DDL; V005 cannot repoint a running service):
--     1. Reserve the RDS master `kiro_mcp` for admin / break-glass / running migrations (as
--        kiro_migrator or via SET ROLE kiro_migrator). It is no longer a runtime identity.
--     2. Repoint the MCP server onto `kiro_mcp_app`: set its `DB_USER=kiro_mcp_app` and repoint the
--        IAM `rds-db:connect` dbuser ARN to `.../dbuser:*/kiro_mcp_app` (RDS IAM auth / RDS Signer).
--     3. POSITIVE CUTOVER CHECK (SEC review L1): after the repoint, verify the LIVE MCP connection
--        actually authenticates as `kiro_mcp_app` — the GATE-1 preflight only checks role
--        attributes/membership, not the live session identity. With the MCP server running, query
--        the live DB:
--          SELECT usename, count(*) FROM pg_stat_activity
--          WHERE datname = current_database() AND usename IS NOT NULL GROUP BY usename;
--        GATE 2 is complete ONLY when the MCP session's usename = `kiro_mcp_app` and NO application
--        session authenticates as the master `kiro_mcp`. This closes the residual window objectively.
--   If ops keep the MCP runtime on the master `kiro_mcp` for the POC, append-only is a BEST-EFFORT
--   claim, NOT a guarantee — that residual must be risk-accepted (see docs/phase2/srs.md §NFR
--   security, SEC-H2). Do NOT ship it labelled "enforced" until the runtime is on `kiro_mcp_app`
--   AND step 3 confirms it.
--
-- ⚠️ MANDATORY PRE-IMPLEMENTATION OWNERSHIP & ROLE AUDIT (run against the LIVE DB before applying)
--     * Current object ownership:
--         SELECT tablename,   tableowner    FROM pg_tables    WHERE schemaname='public';
--         SELECT sequencename, sequenceowner FROM pg_sequences WHERE schemaname='public';
--         SELECT viewname,     viewowner     FROM pg_views     WHERE schemaname='public';
--       → confirm the ALTER ... OWNER TO targets below cover EVERY discovered object; add any that
--         are missing (e.g. project_gates if the alternate V002__projects_and_jira_sync.sql applied
--         — the dynamic sweep in F.2 catches it, but confirm).
--     * Migration-runner identity: it must be the RDS master OR a member of kiro_migrator (with
--       SET ROLE, since kiro_migrator is NOINHERIT). NEVER the runtime role.
--     * Role attributes: kiro_migrator = NOINHERIT NOLOGIN; runtime roles (kiro_mcp_app, kiro_phase2)
--       rolsuper=false. NB: kiro_mcp (the RDS master) IS a superuser — that is expected; it is NOT a
--       runtime role anymore (admin/migrations only).
--     * Membership: runtime roles (kiro_mcp_app, kiro_phase2) are NOT members of kiro_migrator
--       (pg_auth_members) — else INHERIT/SET ROLE re-grants owner DML and reproduces the defect.
--     * F10: confirm the two historical V002 files converge on one deployed `projects`.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- SCOPE BOUNDARY
--   OUT of this file: additive schema (that is V004). OUT of this file: the v_timeline view repoint
--   (jira_key → github_repo) — that is the separate timeline-reconciliation migration, gated on the
--   CR-06 backfill collision guard. This migration touches privileges/ownership only.
--
-- PORTABILITY NOTE
--   DATABASE-level GRANT/REVOKE use current_database() via a DO/format so this migration is runnable
--   in an ephemeral verification Postgres (db name = 'postgres') and on RDS (db name =
--   'kiro_governance') without change. `GRANT rds_iam` is guarded to run only where the rds_iam role
--   exists (RDS), so local verification does not fail. This migration assumes it is executed by a
--   role able to reassign ownership + grant on behalf of the new owner (RDS master / superuser, or a
--   member that SET ROLE kiro_migrator) — see the audit gate above.
-- ─────────────────────────────────────────────────────────────────────────────

-- ═════════════════════════════════════════════════════════════════════════════
-- F.1 — Roles (SEC-L4: DO-block guards; `CREATE USER IF NOT EXISTS` is invalid PostgreSQL).
--        kiro_migrator OWNS the schema objects and runs migrations (NOLOGIN, NOINHERIT).
--        kiro_mcp      = RDS MASTER / admin / migrations ONLY — NOT the runtime writer. It is a
--                        superuser (rds_superuser member); do NOT place runtime grants on it (they
--                        would be bypassed — iam-review Finding 2 collision). Not created here on
--                        RDS (already exists as the master); the guarded CREATE only fires in the
--                        ephemeral local verify DB so the verify script can run standalone.
--        kiro_mcp_app  = DEDICATED non-master runtime MCP role (RDS IAM auth) — append-only writer.
--                        LOGIN NOSUPERUSER NOINHERIT. All F.3 runtime grants live here.
--        kiro_phase2   = Phase-2 DeliverPro app role (RDS IAM auth) — DeliverPro DML owner-of-record.
-- ═════════════════════════════════════════════════════════════════════════════
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kiro_migrator') THEN
    -- NOINHERIT: a member session does NOT implicitly gain owner rights (must SET ROLE explicitly).
    CREATE ROLE kiro_migrator NOLOGIN NOINHERIT;
  ELSE
    ALTER ROLE kiro_migrator NOLOGIN NOINHERIT;
  END IF;

  -- kiro_mcp: the RDS master. Guarded CREATE exists only so the ephemeral local verify DB has the
  -- role; on RDS it already exists as the master and this is a no-op. Do NOT ALTER its attributes
  -- (never demote/promote the master here) and do NOT grant it runtime DML (F.3 targets kiro_mcp_app).
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kiro_mcp') THEN
    CREATE ROLE kiro_mcp LOGIN;          -- RDS master proxy for local verify (admin/migrations only)
  END IF;

  -- kiro_mcp_app: the ACTUAL non-master runtime MCP role. NOSUPERUSER is the crux of the fix —
  -- without it, table grants are bypassed exactly like the master collision they replace.
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kiro_mcp_app') THEN
    CREATE ROLE kiro_mcp_app LOGIN NOSUPERUSER NOINHERIT;
  ELSE
    ALTER ROLE kiro_mcp_app LOGIN NOSUPERUSER NOINHERIT;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kiro_phase2') THEN
    CREATE ROLE kiro_phase2 LOGIN;       -- Phase-2 DeliverPro app role
  END IF;
END
$$;

-- RDS IAM auth for the runtime roles (guarded — rds_iam exists only on RDS, not in local verify).
-- The MCP runtime authenticates as kiro_mcp_app (NOT the master kiro_mcp) via RDS Signer.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rds_iam') THEN
    EXECUTE 'GRANT rds_iam TO kiro_mcp_app';
    EXECUTE 'GRANT rds_iam TO kiro_phase2';
  END IF;
END
$$;

-- Defensive: runtime roles must NOT be members of the owner role (else owner DML leaks back in).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_auth_members m
             JOIN pg_roles owner  ON owner.oid  = m.roleid
             JOIN pg_roles member ON member.oid = m.member
             WHERE owner.rolname = 'kiro_migrator' AND member.rolname = 'kiro_mcp_app') THEN
    EXECUTE 'REVOKE kiro_migrator FROM kiro_mcp_app';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_auth_members m
             JOIN pg_roles owner  ON owner.oid  = m.roleid
             JOIN pg_roles member ON member.oid = m.member
             WHERE owner.rolname = 'kiro_migrator' AND member.rolname = 'kiro_phase2') THEN
    EXECUTE 'REVOKE kiro_migrator FROM kiro_phase2';
  END IF;
END
$$;

-- ═════════════════════════════════════════════════════════════════════════════
-- F.2 — Reassign OWNERSHIP of all objects to the non-runtime migrator role.
--        This is what actually removes the runtime role's implicit owner rights
--        (UPDATE/DELETE/DROP/GRANT). Explicit ALTERs for every known object (IF EXISTS = safe
--        against the two-V002-variant ambiguity) + a dynamic safety sweep that catches ANY public
--        object not yet owned by kiro_migrator (e.g. project_gates from the alternate V002).
-- ═════════════════════════════════════════════════════════════════════════════

-- V001
ALTER TABLE    IF EXISTS governance_events          OWNER TO kiro_migrator;
ALTER SEQUENCE IF EXISTS governance_events_id_seq   OWNER TO kiro_migrator;

-- V002
ALTER TABLE    IF EXISTS projects                   OWNER TO kiro_migrator;
ALTER SEQUENCE IF EXISTS projects_id_seq            OWNER TO kiro_migrator;
ALTER TABLE    IF EXISTS micro_artifacts            OWNER TO kiro_migrator;
ALTER SEQUENCE IF EXISTS micro_artifacts_id_seq     OWNER TO kiro_migrator;
ALTER TABLE    IF EXISTS macro_checkpoints          OWNER TO kiro_migrator;
ALTER SEQUENCE IF EXISTS macro_checkpoints_id_seq   OWNER TO kiro_migrator;
ALTER TABLE    IF EXISTS gate_evidence              OWNER TO kiro_migrator;
ALTER SEQUENCE IF EXISTS gate_evidence_id_seq       OWNER TO kiro_migrator;
ALTER TABLE    IF EXISTS casdm_config               OWNER TO kiro_migrator;
ALTER SEQUENCE IF EXISTS casdm_config_id_seq        OWNER TO kiro_migrator;
ALTER TABLE    IF EXISTS checkpoint_notes           OWNER TO kiro_migrator;
ALTER SEQUENCE IF EXISTS checkpoint_notes_id_seq    OWNER TO kiro_migrator;

-- V003
ALTER TABLE    IF EXISTS weekly_status_logs             OWNER TO kiro_migrator;
ALTER SEQUENCE IF EXISTS weekly_status_logs_id_seq      OWNER TO kiro_migrator;
ALTER TABLE    IF EXISTS escalations                    OWNER TO kiro_migrator;
ALTER SEQUENCE IF EXISTS escalations_id_seq             OWNER TO kiro_migrator;
ALTER TABLE    IF EXISTS discovery_sessions             OWNER TO kiro_migrator;
ALTER SEQUENCE IF EXISTS discovery_sessions_id_seq      OWNER TO kiro_migrator;
ALTER TABLE    IF EXISTS onboarding_checklist_items     OWNER TO kiro_migrator;
ALTER SEQUENCE IF EXISTS onboarding_checklist_items_id_seq OWNER TO kiro_migrator;
ALTER TABLE    IF EXISTS analysis_prompts               OWNER TO kiro_migrator;
ALTER SEQUENCE IF EXISTS analysis_prompts_id_seq        OWNER TO kiro_migrator;

-- V004
ALTER TABLE    IF EXISTS project_link_audit             OWNER TO kiro_migrator;
ALTER SEQUENCE IF EXISTS project_link_audit_id_seq      OWNER TO kiro_migrator;
ALTER TABLE    IF EXISTS micro_artifact_mapping         OWNER TO kiro_migrator;
ALTER SEQUENCE IF EXISTS micro_artifact_mapping_id_seq  OWNER TO kiro_migrator;

-- Views (V003)
ALTER VIEW IF EXISTS v_timeline        OWNER TO kiro_migrator;
ALTER VIEW IF EXISTS v_project_summary OWNER TO kiro_migrator;
ALTER VIEW IF EXISTS v_gate_completion OWNER TO kiro_migrator;

-- Dynamic safety sweep — reassign ANY remaining public table/sequence/view not yet owned by
-- kiro_migrator (future-proofs against objects the explicit list above missed; idempotent).
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN SELECT tablename FROM pg_tables
           WHERE schemaname = 'public' AND tableowner <> 'kiro_migrator' LOOP
    EXECUTE format('ALTER TABLE public.%I OWNER TO kiro_migrator', r.tablename);
  END LOOP;
  FOR r IN SELECT sequencename FROM pg_sequences
           WHERE schemaname = 'public' AND sequenceowner <> 'kiro_migrator' LOOP
    EXECUTE format('ALTER SEQUENCE public.%I OWNER TO kiro_migrator', r.sequencename);
  END LOOP;
  FOR r IN SELECT viewname FROM pg_views
           WHERE schemaname = 'public' AND viewowner <> 'kiro_migrator' LOOP
    EXECUTE format('ALTER VIEW public.%I OWNER TO kiro_migrator', r.viewname);
  END LOOP;
END
$$;

-- ═════════════════════════════════════════════════════════════════════════════
-- F.3 — kiro_mcp_app (non-master runtime MCP): strip everything, then grant EXACTLY least
--        privilege. Append-only = INSERT + SELECT on governance_events only. NO write on any table.
--        NB: runtime grants go on kiro_mcp_app, NEVER on the master kiro_mcp (iam-review Finding 2 —
--        a superuser bypasses grants, so any grant on the master is cosmetic/misleading). We also
--        defensively strip runtime table/sequence privileges from the master kiro_mcp so no stale
--        least-privilege grant lingers on it (moot on a superuser, but keeps intent unambiguous and
--        cleans up the pre-fix state in the local verify DB).
-- ═════════════════════════════════════════════════════════════════════════════
REVOKE ALL ON ALL TABLES    IN SCHEMA public FROM kiro_mcp_app;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM kiro_mcp_app;
-- Clean up any runtime grants a prior (colliding) revision put on the master kiro_mcp.
REVOKE ALL ON ALL TABLES    IN SCHEMA public FROM kiro_mcp;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM kiro_mcp;

-- DATABASE-level: portable (current_database() = 'kiro_governance' on RDS, 'postgres' in verify).
DO $$
BEGIN
  EXECUTE format('REVOKE ALL PRIVILEGES ON DATABASE %I FROM kiro_mcp_app', current_database());
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO kiro_mcp_app',           current_database());
END
$$;
GRANT USAGE ON SCHEMA public TO kiro_mcp_app;

-- Real append-only: INSERT + SELECT only (no UPDATE/DELETE — kiro_mcp_app is not the owner and is
-- NOSUPERUSER, so these grants are actually enforced, unlike the bypassed master collision).
GRANT INSERT, SELECT ON governance_events                 TO kiro_mcp_app;
GRANT USAGE,  SELECT ON SEQUENCE governance_events_id_seq TO kiro_mcp_app;

-- Resolve-or-reject (no-orphan) + dual-channel notify_slack routing: read-only, column-scoped,
-- NO write on projects (FR-P2-038/039). Column set = the 4 resolve/routing columns from impact-doc
-- §F.3 (jira_key, github_repo, slack_micro_channel_id, slack_macro_channel_id) PLUS `id` (stable
-- surrogate join key) and `title` (project-labelled Slack message body `[jira_key] title …`,
-- FR-P2-039 "project-labelled using jira_key and title when available"). All six are NON-SECRET and
-- read-only — no append-only weakening. See unified-data-model.md §4.4.4.
GRANT SELECT (github_repo, jira_key, slack_micro_channel_id, slack_macro_channel_id, id, title)
  ON projects TO kiro_mcp_app;

-- (PLAN-L2) NO grant to kiro_mcp_app on micro_artifact_mapping — Level-2 runs APP-SIDE under
--           kiro_phase2. Do NOT widen the MCP runtime surface. (Intentionally omitted; asserted in
--           verify.)

-- ═════════════════════════════════════════════════════════════════════════════
-- F.4 — kiro_phase2 (Phase-2 DeliverPro app): re-establish DML on DeliverPro-owned tables.
--        The app's DML does NOT survive the ownership reassignment, so it must be re-granted here.
--        This is the app-owned macro-completion write path (macro_checkpoints.reached_at) and the
--        linkage-write path (projects.github_repo/slack_*), plus Level-1 timeline reads.
--        governance_events stays READ-ONLY for the app too (append-only; only kiro_mcp_app inserts).
-- ═════════════════════════════════════════════════════════════════════════════
DO $$
BEGIN
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO kiro_phase2', current_database());
END
$$;
GRANT USAGE ON SCHEMA public TO kiro_phase2;

-- Broad DeliverPro DML across all app-owned tables (snapshot), then lock governance_events to
-- read-only for the app (append-only). ALL TABLES also covers the views (SELECT is what matters).
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO kiro_phase2;
REVOKE INSERT, UPDATE, DELETE ON governance_events FROM kiro_phase2;   -- app never writes events
GRANT  SELECT                 ON governance_events TO   kiro_phase2;   -- app reads for timeline
GRANT  USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO kiro_phase2;

-- ═════════════════════════════════════════════════════════════════════════════
-- F.5 — Default privileges for FUTURE objects the migrator creates + schema CREATE lockdown.
--        Keeps the runtime MCP role closed on future tables/sequences and keeps the app working.
--
--   RDS FIX (rds_superuser master — SEC-H1 apply blocker):
--     `ALTER DEFAULT PRIVILEGES FOR ROLE kiro_migrator ...` requires the executing session to have
--     the privileges of kiro_migrator (INHERIT-membership), not merely SET membership. On RDS the
--     master (kiro_mcp) is `rds_superuser`, NOT a TRUE superuser, so it cannot alter another role's
--     default privileges directly → `permission denied` (this is the observed failure). The
--     ownership ALTERs above succeed because SET membership is enough for `ALTER ... OWNER TO`, but
--     `ALTER DEFAULT PRIVILEGES FOR ROLE` is stricter.
--
--     Fix: `SET ROLE kiro_migrator` so the session *becomes* kiro_migrator, then it alters its OWN
--     default privileges — always permitted, no membership check. In PG16 the role that CREATEd
--     kiro_migrator (the master, via the F.1 DO-block) is automatically granted membership WITH SET,
--     so `SET ROLE kiro_migrator` succeeds. We add NO new role membership (the implicit creator SET
--     grant already exists) — the append-only design is unchanged: kiro_mcp_app still gets NO
--     future-table privileges, kiro_phase2 still gets them, and no runtime role becomes a member of
--     kiro_migrator. On ephemeral Postgres the connecting superuser can `SET ROLE` freely.
--
--     `SET ROLE` is transaction-aware: on error/rollback it auto-reverts, so this is
--     single-transaction-safe; in psql autocommit it persists until the explicit `RESET ROLE`.
--     `RESET ROLE` restores the master identity BEFORE the schema-CREATE lockdown below (those
--     REVOKEs act on the public schema and must run as the master, not as kiro_migrator).
--     Idempotent: ALTER DEFAULT PRIVILEGES is declarative and safe to re-run.
-- ═════════════════════════════════════════════════════════════════════════════
SET ROLE kiro_migrator;

ALTER DEFAULT PRIVILEGES FOR ROLE kiro_migrator IN SCHEMA public
  REVOKE ALL ON TABLES FROM kiro_mcp_app;
ALTER DEFAULT PRIVILEGES FOR ROLE kiro_migrator IN SCHEMA public
  REVOKE ALL ON SEQUENCES FROM kiro_mcp_app;

ALTER DEFAULT PRIVILEGES FOR ROLE kiro_migrator IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO kiro_phase2;
ALTER DEFAULT PRIVILEGES FOR ROLE kiro_migrator IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO kiro_phase2;

RESET ROLE;

-- SEC-L9: no ad-hoc object creation by the runtime role / PUBLIC (matters on PG < 15 where PUBLIC
-- has CREATE on the public schema by default). Revoke from the non-master runtime role kiro_mcp_app;
-- the master kiro_mcp is a superuser (CREATE is inherent and cannot be meaningfully revoked) so it
-- is not listed here.
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE CREATE ON SCHEMA public FROM kiro_mcp_app;
REVOKE CREATE ON SCHEMA public FROM kiro_phase2;

-- ═════════════════════════════════════════════════════════════════════════════
-- ROLLBACK (manual, commented — NOT executed by this migration)
-- ─────────────────────────────────────────────────────────────────────────────
-- V005 changes PRIVILEGES/OWNERSHIP, not schema shape. Preferred recovery is ROLL-FORWARD (a new
-- migration), NOT this reverse. The block below is documentation of the manual reverse only.
--
-- ⚠️ PRECONDITIONS before running any of this:
--   (a) Run as the RDS master / superuser, or a role that has SET ROLE kiro_migrator (NOINHERIT).
--   (b) Confirm the REAL pre-hardening owner via the GATE-1 audit output
--       (migrations/verify/V005__preflight_audit.sql). This reverse ASSUMES it was kiro_mcp — if the
--       audit shows a different prior owner, edit the OWNER TO target accordingly.
--   (c) If GATE 2 (runtime repoint off master onto kiro_mcp_app) has already happened, do NOT roll
--       back unless you also revert the MCP server DB_USER + IAM rds-db:connect ARN (kiro_mcp_app →
--       previous value), or the MCP server loses DB access.
--   (d) This is a privileged, production-affecting change — it must go through change approval.
--
-- -- Step 1: reassign ownership of every public object back to the pre-hardening runtime owner.
-- DO $$
-- DECLARE obj RECORD;
-- BEGIN
--   FOR obj IN SELECT c.relname, c.relkind
--              FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
--              WHERE n.nspname = 'public' AND c.relkind IN ('r','p','v','m','S') LOOP
--     IF    obj.relkind IN ('r','p') THEN EXECUTE format('ALTER TABLE public.%I OWNER TO kiro_mcp;',    obj.relname);
--     ELSIF obj.relkind = 'v'        THEN EXECUTE format('ALTER VIEW public.%I OWNER TO kiro_mcp;',     obj.relname);
--     ELSIF obj.relkind = 'm'        THEN EXECUTE format('ALTER MATERIALIZED VIEW public.%I OWNER TO kiro_mcp;', obj.relname);
--     ELSIF obj.relkind = 'S'        THEN EXECUTE format('ALTER SEQUENCE public.%I OWNER TO kiro_mcp;', obj.relname);
--     END IF;
--   END LOOP;
-- END $$;
--
-- -- Step 2: restore the V001-era broad database grant (undoes F.3's least-privilege reduction).
-- GRANT ALL PRIVILEGES ON DATABASE kiro_governance TO kiro_mcp;
--
-- -- Step 3 (optional): drop the reversed default-privilege / schema-lockdown posture if required.
-- -- ALTER DEFAULT PRIVILEGES FOR ROLE kiro_migrator IN SCHEMA public GRANT ALL ON TABLES    TO kiro_mcp;
-- -- ALTER DEFAULT PRIVILEGES FOR ROLE kiro_migrator IN SCHEMA public GRANT ALL ON SEQUENCES TO kiro_mcp;
-- -- GRANT CREATE ON SCHEMA public TO kiro_mcp;   -- only if the pre-V005 state actually allowed this
--
-- -- Step 4 (optional): drop the owner role — ONLY if no object is still owned by it.
-- -- DROP ROLE kiro_migrator;   -- fails if any object still owned by kiro_migrator (safe guard)
-- ═════════════════════════════════════════════════════════════════════════════

-- End V005 migration (CR-01A — real append-only via ownership reassignment)
