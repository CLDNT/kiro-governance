# Implementation Spec: CR-01A — Append-Only Hardening Migration (V005)

**Story ID:** CR-01A
**Feature:** GitHub–Slack Linkage (Phase 2 DeliverPro) — **real append-only enforcement** for the governance DB (SEC-H1 / SEC-L4)
**Sprint:** Sprint 9 (Phase 2)
**Owner:** Backend Developer
**Story points:** 5
**Depends on:** CR-01 (V004 additive schema — delivered); D-v3-3 / D-v3-11 (customer/human sign-off on ownership reassignment + `kiro_migrator` role)
**Blocks:** CR-08 (`record_progress` resolve-or-reject), CR-09 (`notify_slack` dual-channel) — both rely on the hardened `kiro_mcp` grants
**Classification:** 🔒 **Security-sensitive + ops-gated. Code + tests only — DO NOT deploy to RDS from this repo.**

---

## 1. Overview

CR-01A delivers the **privilege/ownership/role** half of the GitHub–Slack linkage change request — the part CR-01 (V004) deliberately excluded. It makes `governance_events` (and the whole DeliverPro schema) **genuinely append-only** for the runtime MCP role by:

1. Creating a non-runtime owner role `kiro_migrator` (DO-block guard — **not** the invalid `CREATE USER IF NOT EXISTS`, SEC-L4).
2. Reassigning **ownership** of every public table/sequence/view off the runtime role to `kiro_migrator`.
3. Reducing `kiro_mcp` to **exactly** `INSERT, SELECT ON governance_events` (+ its sequence) and **column-scoped** `SELECT` on `projects` — no `UPDATE`/`DELETE`/write anywhere.
4. `ALTER DEFAULT PRIVILEGES` + `REVOKE CREATE ON SCHEMA public` so future objects stay closed.
5. Re-establishing the DeliverPro app role `kiro_phase2` DML (ownership reassignment strips it otherwise).

**Migration file:** `migrations/V005__append_only_hardening.sql` (sorts lexically after V004; the reserved stub is now implemented).

**Database:** RDS PostgreSQL 16 (standard RDS, not Aurora; shared Phase-1 + Phase-2 instance). No Aurora-only or version-gated syntax. Validated locally on PostgreSQL 14 (see §6).

**Sources of truth:**

- `docs/phase2/architecture/unified-data-model.md` §4.4.4 (Real Append-Only via Ownership Reassignment) — authoritative design.
- `docs/phase2/change-requests/2026-07-02-github-slack-linkage-impact.md` **v3.1 §F** (SEC-H1 root cause + drafted hardening SQL) and §v3.1 findings SEC-H1 / SEC-L4 / PLAN-L2.
- `migrations/V005__append_only_hardening.sql` (relocated reserved stub — now implemented by this spec).
- `specs/phase2/CR-01-v004-additive-schema-spec.md` §2 (scope split rationale).

---

## 2. Root Cause — Why Ownership Reassignment (SEC-H1)

`V001` granted `kiro_mcp` only `ALL PRIVILEGES ON DATABASE kiro_governance` — that is **database scope** (`CONNECT`/`CREATE`/`TEMP`), **not** table DML. `kiro_mcp` can `INSERT` today **only because it OWNS the tables** (it was the creating/connecting role). A table **owner keeps every right** (`UPDATE`/`DELETE`/`DROP`/`GRANT`) regardless of `REVOKE`, and can re-grant to itself.

**Therefore a plain `REVOKE ALL ... FROM kiro_mcp` is cosmetic** — it does not make `governance_events` append-only. Real append-only **requires moving ownership** off the runtime role to a dedicated non-runtime owner (`kiro_migrator`), then granting `kiro_mcp` only `INSERT, SELECT`. This is the SEC-H1 finding and the design in §4.4.4.

---

## 3. Two Mandatory Gates (ops/human)

### GATE 1 — Pre-implementation ownership/role audit (BLOCKING, SEC-H1)

Before applying V005, run the **read-only** audit and review its output:

```bash
psql "$KIRO_GOV_DB_URL" -f migrations/verify/V005__preflight_audit.sql
```

It reports, from the LIVE database:

1. Current owner of every public table / sequence / view (the `ALTER ... OWNER TO` targets).
2. The migration-runner identity (`current_user`, `is_superuser`).
3. Runtime role attributes — **`kiro_mcp` must be a non-superuser** for enforcement to be real.
4. Whether `kiro_mcp` is a member of `rds_superuser` (the master-user check for GATE 2).
5. Whether runtime roles are members of `kiro_migrator` (must **not** be — SEC-H1 §4.4.4.5).
6. Whether `kiro_phase2` exists (governs whether V005 §F app re-grant runs).

**The reassignment must not be applied blindly** — the enumerated object set and the owner targets depend on this audit result.

### GATE 2 — Repoint the MCP runtime OFF the RDS master (BLOCKING for enforcement)

> ⚠️ **Ownership reassignment alone does NOT enforce append-only while the MCP server connects as the RDS master** (a member of `rds_superuser`). A superuser **bypasses ownership and privilege checks entirely** and can `UPDATE`/`DELETE` `governance_events` regardless of the grants in V005.

Per `unified-data-model.md` §4.4.4 (blocking note) and `data-persistence-architecture.md` §2 / `deploy-outputs.md`, the deployed MCP runtime currently authenticates as the RDS master. For append-only to become a **real DB guarantee**, ops must, **after** applying V005:

1. Set the MCP server `DB_USER` to `kiro_mcp` (was the master).
2. Update the IAM policy so the MCP EC2 role's `rds-db:connect` resource ARN targets `dbuser:<db-resource-id>/kiro_mcp` (not the master).
3. Confirm `SELECT rolsuper FROM pg_roles WHERE rolname='kiro_mcp';` → `false`.
4. Reserve the RDS master for admin/break-glass + running migrations (as `kiro_migrator` or master).

**Until GATE 2 is complete, append-only is a best-effort claim, NOT a guarantee**, and the residual must be risk-accepted (tracked with SEC-H2). The control must not be labelled "enforced" before the runtime repoint is verified. This is an **ops prerequisite**, not DDL — V005 cannot perform it.

---

## 4. Scope Boundary (what is IN vs OUT of CR-01A)

| Item | In V005 (CR-01A)? | Where it lives instead |
|------|-------------------|------------------------|
| `kiro_migrator` role creation (DO-block, NOLOGIN NOINHERIT) | ✅ | — |
| `ALTER … OWNER TO kiro_migrator` for all tables/sequences/views | ✅ | — |
| `kiro_mcp` least-privilege grants (INSERT,SELECT events + column SELECT projects) | ✅ | — |
| `REVOKE` of `kiro_mcp` broad DB/table privileges | ✅ | — |
| `ALTER DEFAULT PRIVILEGES` + `REVOKE CREATE ON SCHEMA public` | ✅ | — |
| `kiro_phase2` app-role DML re-establishment (guarded) | ✅ | — |
| Additive columns/index/audit table/trigger, inert `micro_artifact_mapping` | ❌ | **CR-01 / V004** (delivered) |
| `v_timeline` DROP+CREATE join repoint (`jira_key`→`github_repo`) | ❌ | **Timeline reconciliation CR** (CR-06 backfill era) |
| `event_code` column on `governance_events` | ❌ | **CR-14** (Phase-1 change) |
| Any grant to `kiro_mcp` on `micro_artifact_mapping` | ❌ (never) | Level-2 runs app-side under `kiro_phase2` (PLAN-L2) |
| MCP runtime repoint off master (DB_USER + IAM) | ❌ (ops) | **GATE 2 ops step** (runtime config, not DDL) |

**Automated enforcement:** `migrations/__tests__/V005-append-only-hardening.test.js` fails the build if the hardening DDL is missing/mis-scoped, if any `GRANT ... TO kiro_mcp` carries `UPDATE`/`DELETE`/`TRUNCATE`/`ALL`, if schema-shape DDL (CREATE TABLE/INDEX/ADD COLUMN) or a view repoint appears, or if the ops gates are not documented in the header. The V004 guard (`V004-additive-scope.test.js`) still asserts the *inverse* — that V004 stays additive-only.

---

## 5. Design Detail

### 5.1 Roles (§A)

```sql
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kiro_migrator') THEN
    CREATE ROLE kiro_migrator NOLOGIN NOINHERIT;   -- owner/DDL role; never authenticates
  ELSE
    ALTER ROLE kiro_migrator NOLOGIN NOINHERIT;     -- enforce attributes idempotently
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kiro_mcp') THEN
    CREATE ROLE kiro_mcp LOGIN;
  END IF;
END $$;
```

- **`NOLOGIN`** — `kiro_migrator` is never a connection identity (migrations run as it via `SET ROLE`/master).
- **`NOINHERIT`** — a session that is a member of `kiro_migrator` does not implicitly gain its owner rights; it must explicitly `SET ROLE` (SEC-H1 §4.4.4.5). Combined with §E (runtime roles are not members), this closes the "member re-acquires owner DML" hole.
- `rds_iam` is granted to `kiro_mcp` **guarded** (skipped on a local Postgres that lacks the `rds_iam` role, so the file stays runnable in CI/ephemeral verification).

### 5.2 Ownership reassignment (§B)

A **dynamic `DO`-block loop** over `pg_class` reassigns ownership of every public **table/partitioned table/view/matview** and **sequence** whose current owner is not already `kiro_migrator`:

- Chosen over a static `ALTER TABLE x OWNER TO …` list so the reassignment stays **complete against the live schema** (satisfies §4.4.4's "enumerate ALL per the audit") and is **idempotent** (only touches objects not already owned by `kiro_migrator`).
- The migration comments enumerate the 14 known tables, their `_id_seq` sequences, and the 3 views for reviewer reference.

### 5.3 `kiro_mcp` least privilege (§C)

```sql
REVOKE ALL ON ALL TABLES     IN SCHEMA public FROM kiro_mcp;
REVOKE ALL ON ALL SEQUENCES  IN SCHEMA public FROM kiro_mcp;
REVOKE ALL ON ALL FUNCTIONS  IN SCHEMA public FROM kiro_mcp;
REVOKE ALL PRIVILEGES ON DATABASE kiro_governance FROM kiro_mcp;   -- undo V001 broad grant
GRANT CONNECT ON DATABASE kiro_governance TO kiro_mcp;
GRANT USAGE  ON SCHEMA public             TO kiro_mcp;
GRANT INSERT, SELECT ON governance_events                 TO kiro_mcp;   -- append-only
GRANT USAGE,  SELECT ON SEQUENCE governance_events_id_seq TO kiro_mcp;
GRANT SELECT (github_repo, jira_key, slack_micro_channel_id, slack_macro_channel_id, id, title)
  ON projects TO kiro_mcp;                                                -- column-scoped read
```

**Column set for `projects`** — `github_repo` + `jira_key` (resolve-or-reject key/result), `slack_micro_channel_id` + `slack_macro_channel_id` (dual-channel routing), `id` (stable surrogate join key), `title` (project-labelled Slack message body, `[jira_key] title …`).

> **Note — column set differs from §4.4.4's 4-column list.** The orchestrator's CR-01A instruction adds `id` and `title` to the four columns in `unified-data-model.md` §4.4.4. `title` is required by `notify_slack`'s project-labelled message (impact doc §v3-5.2 "project-labelled using `jira_key` (and title when available)"); `id` is the stable surrogate key. This spec implements the 6-column set per the orchestrator instruction and the doc is reconciled to match (see §7). **Flag for security-reviewer:** confirm `id`/`title` are acceptable additions to the least-privilege read surface (both non-secret; `title` is an internal project title, not customer PII per §6 PII inventory).

`kiro_mcp` gets **no** grant on `micro_artifact_mapping` (PLAN-L2 — Level-2 is app-side).

### 5.4 Default privileges + schema hardening (§D)

```sql
ALTER DEFAULT PRIVILEGES FOR ROLE kiro_migrator IN SCHEMA public REVOKE ALL ON TABLES    FROM kiro_mcp;
ALTER DEFAULT PRIVILEGES FOR ROLE kiro_migrator IN SCHEMA public REVOKE ALL ON SEQUENCES FROM kiro_mcp;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;    -- SEC-L9 (matters on PG < 15)
REVOKE CREATE ON SCHEMA public FROM kiro_mcp;
```

### 5.5 Defensive membership revoke (§E)

Guarded `REVOKE kiro_migrator FROM kiro_mcp` if the membership exists — prevents `kiro_mcp` from re-acquiring owner DML via `SET ROLE`. `kiro_migrator` `NOINHERIT` is the second layer.

### 5.6 `kiro_phase2` app-role re-establishment (§F)

Reassigning ownership to `kiro_migrator` strips the DeliverPro app's implicit access. The app authenticates as `kiro_phase2` (per DP-01 CDK), not `kiro_mcp`, and owns the macro-completion + linkage write paths. Guarded on role existence, V005 re-grants `kiro_phase2`:

- `SELECT, INSERT, UPDATE, DELETE` on all DeliverPro tables (projects, micro_artifacts, macro_checkpoints, gate_evidence, checkpoint_notes, onboarding_checklist_items, casdm_config, weekly_status_logs, escalations, discovery_sessions, analysis_prompts, project_link_audit, micro_artifact_mapping).
- `SELECT` on `governance_events` (**append-only applies to the app too** — it reads, never mutates the event log) + the 3 views.
- `USAGE, SELECT` on all sequences.
- `ALTER DEFAULT PRIVILEGES` so future migrator-created tables stay writable by the app.

If `kiro_phase2` does not yet exist, V005 raises a NOTICE and skips — **ops must run §F once `kiro_phase2` is provisioned, or the DeliverPro app write path will fail.** Flagged in §8.

---

## 6. Verification Approach

Three layers; **none touches RDS** (CR-01A is code + tests only).

### 6.1 Static scope + correctness guard (runs in CI now)

`migrations/__tests__/V005-append-only-hardening.test.js` — CommonJS Jest (repo has no ts-jest preset, so `.js` is guaranteed to run). Strips SQL comments, then asserts:

- `kiro_migrator` created via DO-block (no invalid `CREATE ROLE IF NOT EXISTS`), NOLOGIN NOINHERIT.
- Ownership reassigned for tables + sequences + views (dynamic `pg_class` loop).
- `kiro_mcp` broad privileges revoked; exactly `INSERT, SELECT` on `governance_events` + sequence.
- Column-scoped `SELECT` on `projects` with the **exact 6-column set**.
- `ALTER DEFAULT PRIVILEGES` present; `REVOKE kiro_migrator FROM kiro_mcp` present.
- `kiro_phase2` DML re-grant present; app gets only `SELECT` on `governance_events`.
- **Append-only invariant:** no `GRANT ... TO kiro_mcp` carries `UPDATE`/`DELETE`/`TRUNCATE`/`ALL`; no grant to `kiro_mcp` on `micro_artifact_mapping`.
- **Scope boundary:** no `CREATE TABLE`/`INDEX`/`ADD COLUMN`, no view repoint.
- **Ops gates documented** in the header (preflight audit reference + "DO NOT DEPLOY" + superuser/repoint).

Run: `npx jest migrations/__tests__/` → **25 tests pass** (11 V004 + 14 V005) — verified.

### 6.2 Behavioural verification against ephemeral Postgres

`migrations/verify/V005__verify.sql` — plpgsql `ASSERT` blocks over `pg_class`/`pg_roles`/`has_table_privilege`/`has_column_privilege`/`has_sequence_privilege`/`has_schema_privilege` confirming: `kiro_migrator` attributes; every public object owned by `kiro_migrator`; `kiro_mcp` has INSERT+SELECT (not UPDATE/DELETE/TRUNCATE) on `governance_events`; column-scoped SELECT on `projects` (allowed cols present, `sow_link` **denied**, no write); no privilege on `micro_artifact_mapping`; not a member of `kiro_migrator`; no `CREATE` on `public`. Run V001→V005 with **V005 applied twice** to prove idempotency (chain + command in the file header).

### 6.3 Pre-implementation audit (GATE 1, live DB only)

`migrations/verify/V005__preflight_audit.sql` — read-only; run against the live DB before applying V005 (§3 GATE 1). Not a CI test (needs the live DB).

### 6.4 Validation performed for this spec

Ran the full chain on an **ephemeral local PostgreSQL 14** cluster (Docker daemon unavailable; local `postgres` binary used): applied V001 (tolerating its invalid `CREATE USER` tail — SEC-L4), V002/V003/V004, then **V005 twice**, then `V005__verify.sql` → **"V005 verification PASSED"**. Real negative tests as `SET ROLE kiro_mcp`: `INSERT` succeeded; `UPDATE` and `DELETE` on `governance_events` → **permission denied**; `SELECT sow_link FROM projects` → **permission denied** (column scope holds); `SELECT github_repo` → allowed. PostgreSQL 14 also exercises SEC-L9 (public schema not locked by default) — the `REVOKE CREATE` and `has_schema_privilege(...,'CREATE') = false` assertion passed.

---

## 7. Doc Staleness Fix (unified-data-model.md — CR-01 follow-up)

CR-01's DoD flagged that `unified-data-model.md` attributed the append-only hardening (and the `v_timeline` repoint) to **V004**, which is stale after the CR-01/CR-01A split. This spec's story also updates the data model to reflect reality:

- Changelog v1.1 entry split: V004 = additive only; **V005/CR-01A** = ownership reassignment + hardened grants; `v_timeline` repoint = separate timeline-reconciliation CR (still pending).
- §1 migrations table: V004 row = additive only; **new V005 row** for append-only hardening.
- §2 "append-only enforcement" note repointed from V004 → **V005 (CR-01A)**.
- §4.4.4 intro migration reference set to `V005__append_only_hardening.sql`; the 4→6 column grant reconciled (`id`, `title` added with rationale).
- §5 access-pattern + §8 cross-doc rows: append-only grant rows marked **✅ V005** (was V004).

The `v_timeline` join-repoint attribution (`✅ V004`) is left for the timeline-reconciliation CR that actually implements it — noted, not changed here beyond the changelog clarification, to avoid claiming a repoint that no migration yet performs.

---

## 8. Rollback

V005 changes privileges/ownership, not schema shape. Roll-forward is preferred; the manual reverse (run by the RDS master or a `kiro_migrator` member) restores the pre-hardening owner and V001-era grant:

```sql
-- Reassign ownership back to the pre-hardening runtime owner (confirm the real prior owner via the
-- GATE-1 audit output before running — this assumes it was kiro_mcp).
DO $$
DECLARE obj RECORD;
BEGIN
  FOR obj IN SELECT relname, relkind FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
             WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','S') LOOP
    IF obj.relkind IN ('r','p') THEN EXECUTE format('ALTER TABLE public.%I OWNER TO kiro_mcp;', obj.relname);
    ELSIF obj.relkind='v'      THEN EXECUTE format('ALTER VIEW public.%I OWNER TO kiro_mcp;', obj.relname);
    ELSIF obj.relkind='S'      THEN EXECUTE format('ALTER SEQUENCE public.%I OWNER TO kiro_mcp;', obj.relname);
    END IF;
  END LOOP;
END $$;
GRANT ALL PRIVILEGES ON DATABASE kiro_governance TO kiro_mcp;   -- restore V001-era grant
-- Optionally: DROP ROLE kiro_migrator; (only if no object still owned by it)
```

**Notes:** (a) preferred recovery is roll-forward (new migration), not this reverse; (b) do **not** roll back after GATE 2 has repointed the runtime unless you also revert the runtime `DB_USER`/IAM, or the MCP server loses DB access; (c) rollback is master/owner-privileged and must not run against production without change approval.

---

## 9. Definition of Done

- [x] `migrations/V005__append_only_hardening.sql` implements roles + ownership reassignment + least-privilege grants + default privileges + app re-grant (privilege/ownership DDL only)
- [x] DO-block role creation (no invalid `CREATE USER/ROLE IF NOT EXISTS`); `kiro_migrator` NOLOGIN NOINHERIT
- [x] `kiro_mcp` reduced to `INSERT,SELECT` on `governance_events` + column-scoped `SELECT` on `projects`; **no** UPDATE/DELETE anywhere; **no** grant on `micro_artifact_mapping`
- [x] Idempotent (guards + dynamic ownership loop only touches non-migrator-owned objects); safe to re-run
- [x] Pre-impl ownership/role audit (`migrations/verify/V005__preflight_audit.sql`) authored — GATE 1
- [x] Ops prerequisite (runtime repoint off master) documented as GATE 2 in the migration header + this spec
- [x] Rollback documented
- [x] `npx jest migrations/__tests__/` passes (25 tests: V004 additive guard + V005 hardening guard)
- [x] `migrations/verify/V005__verify.sql` passes against ephemeral Postgres (V005 applied twice) — validated on PG14; real negative tests confirm UPDATE/DELETE denied, column scope enforced
- [x] `unified-data-model.md` staleness fixed (V004 additive vs V005 hardening attribution)
- [ ] **Not deployed to RDS** — deploy sequencing (GATE 1 audit → apply → GATE 2 runtime repoint) handed to ops with human sign-off (D-v3-3 / D-v3-11)
- [ ] Follow-ups flagged to orchestrator/architect: (1) security-reviewer confirm `id`/`title` column-grant additions; (2) V001 SEC-L4 invalid `CREATE USER IF NOT EXISTS` correction (superseded by V005 §A DO-block — Phase-1 migration/doc fix); (3) provision `kiro_phase2` before deploy or the app write path fails (§F); (4) timeline-reconciliation CR owns the `v_timeline` repoint

---

## 10. Files Delivered

| File | Purpose |
|------|---------|
| `migrations/V005__append_only_hardening.sql` | CR-01A append-only hardening (roles + ownership reassignment + least-privilege grants) — replaces the reserved stub |
| `migrations/verify/V005__preflight_audit.sql` | Read-only pre-implementation ownership/role audit (GATE 1, SEC-H1) |
| `migrations/verify/V005__verify.sql` | plpgsql ASSERT behavioural verification against ephemeral Postgres |
| `migrations/__tests__/V005-append-only-hardening.test.js` | Static scope + correctness + idempotency + ops-gate-doc guard (Jest) |
| `migrations/__tests__/V004-additive-scope.test.js` | Updated — removed obsolete "V005 is an inert stub" assertions (V005 now implemented) |
| `docs/phase2/architecture/unified-data-model.md` | Staleness fix — V004 additive vs V005/CR-01A append-only attribution |
| `specs/phase2/CR-01A-append-only-hardening-spec.md` | This spec |

---

*End of CR-01A spec.*
