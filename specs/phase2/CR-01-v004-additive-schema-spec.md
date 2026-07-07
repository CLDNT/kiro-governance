# Implementation Spec: CR-01 — V004 Additive Schema Migration (GitHub ↔ Slack Linkage)

**Story ID:** CR-01
**Feature:** GitHub–Slack Linkage (Phase 2 DeliverPro) — schema half of FR-P2-033..041 + inert Level-2 placeholder
**Sprint:** Sprint 9 (Phase 2)
**Owner:** Backend Developer
**Story points:** 3
**Depends on:** D-v3-1 / D-v3-2 (customer decisions — already locked 2026-07-02)
**Blocks:** CR-01A (append-only hardening), CR-02 (projects API linkage retrofit)

---

## 1. Overview

V004 is the **additive, idempotent** schema migration for the project ↔ GitHub repo ↔ dual-Slack-channel linkage feature. It changes the shape of the database only; it introduces **no** privilege, ownership, or view-behaviour changes.

V004 delivers:

- **6 nullable columns** on `projects` (`github_repo`, `github_url`, `slack_micro_channel_id`, `slack_macro_channel_id`, `updated_by`, `updated_at`)
- **1 partial unique index** — `uq_projects_github_repo ON projects(github_repo) WHERE github_repo IS NOT NULL` (1:1 repo↔project, tolerates multiple NULL/unlinked)
- **1 new table** — `project_link_audit` (+ `idx_project_link_audit_project`)
- **2 audit triggers** on `projects` — `audit_project_linkage` (BEFORE UPDATE, one row per changed field via `IS DISTINCT FROM`) and `audit_project_linkage_insert` (AFTER INSERT create-path audit, SEC-M5)
- **1 INERT table** — `micro_artifact_mapping` (created, **no seed data, no runtime-role grant**; Level-2 deferred)

**Database:** RDS PostgreSQL 16 (standard RDS, not Aurora; shared Phase-1 + Phase-2 instance). No Aurora-only or version-gated syntax.

**Migration file:** `migrations/V004__github_slack_linkage.sql` (sorts lexically last after V003a).

**Sources of truth:**

- `docs/phase2/architecture/unified-data-model.md` §4.4 (columns, index, audit table/trigger, PII inventory)
- `docs/phase2/projects-architecture.md` §12 (linkage domain, authz, validation, audit semantics)
- `docs/phase2/change-requests/2026-07-02-github-slack-linkage-impact.md` §A–E (design of record; `micro_artifact_mapping` schema in §E)
- `docs/phase2/sprint-planning/jira-backlog.csv` (CR-01 acceptance criteria)
- `docs/code-structure.md` (repo layout, migration naming `V{NNN}__{desc}.sql`, idempotency + append-only invariants)

---

## 2. Scope Boundary (what is IN vs OUT of CR-01)

This story is deliberately narrower than the original combined CR-01 story. The append-only hardening was split into **CR-01A** and the timeline repoint is tracked separately. Enforcing "additive/idempotent DDL only" keeps V004 deployable ahead of the role/ownership work with zero blast radius on running services.

| Item | In V004 (CR-01)? | Where it lives instead |
|------|------------------|------------------------|
| 6 nullable linkage columns on `projects` | ✅ | — |
| Partial unique index `uq_projects_github_repo` | ✅ | — |
| `project_link_audit` table + index | ✅ | — |
| BEFORE UPDATE per-field audit trigger | ✅ | — |
| AFTER INSERT create-path audit trigger (SEC-M5) | ✅ | — |
| INERT `micro_artifact_mapping` (no grant, no seed) | ✅ | — |
| Roles (`kiro_migrator`/`kiro_mcp`/`kiro_phase2`), `ALTER … OWNER TO`, all `GRANT`/`REVOKE`/`ALTER DEFAULT PRIVILEGES` | ❌ | **CR-01A** — separate migration (e.g. `V005__append_only_hardening.sql`) |
| `v_timeline` DROP+CREATE join repoint (`jira_key` → `github_repo`) | ❌ | **Timeline reconciliation** (CR-06 backfill era) — not additive, gated on the collision guard |
| `event_code` column on `governance_events` | ❌ | **CR-14** (Phase-1 change) |

**Automated enforcement:** `migrations/__tests__/V004-additive-scope.test.js` fails the build if any OUT-of-scope statement (`GRANT`, `REVOKE`, `ALTER … OWNER TO`, `ALTER DEFAULT PRIVILEGES`, `CREATE ROLE`, `DROP VIEW`, `CREATE VIEW`, seed `INSERT` into the mapping table) appears in V004.

---

## 3. Reconciliation With the Drafted Migration

The pre-existing draft of `migrations/V004__github_slack_linkage.sql` was reconciled against the CR-01 acceptance criteria and the design of record. Changes made:

1. **Removed §E/§F append-only hardening** (roles, `ALTER … OWNER TO` reassignment, `GRANT`/`REVOKE`, `ALTER DEFAULT PRIVILEGES`, `REVOKE CREATE ON SCHEMA public`). → Moves to **CR-01A**. The drafted SQL is preserved in the impact doc §F and git history; CR-01A owns re-deriving it after the mandatory ownership/role audit + SEC-H1 human sign-off.
2. **Removed §F `v_timeline` DROP+CREATE repoint.** A view repoint is a behavioural change on an existing object (not additive) and depends on the CR-06 collision guard. The deployed V003 `v_timeline` (11-column contract, `jira_key` join) stays in place until the reconciliation migration repoints it.
3. **Added the INERT `micro_artifact_mapping` table.** The draft header incorrectly said "no `micro_artifact_mapping`". The CR-01 backlog AC and the impact doc §E require it created **inert**. Schema taken verbatim from impact doc §E (key = `event_code`, per PLAN-L4). No seed rows; no grant.
4. **Kept the AFTER INSERT create-path trigger** (`audit_project_linkage_insert`, SEC-M5) — the draft on disk already had it, and it is an explicit CR-01 AC. It is additive/idempotent.
5. **Engine note corrected** to RDS PostgreSQL 16 (was "Aurora PG15" in some prose).

> ⚠️ **Doc inconsistency to resolve (route to aws-architect):** `unified-data-model.md` §4.4 currently describes the append-only ownership reassignment and the `v_timeline` repoint as part of **V004**, and §4.4.6 says "No `micro_artifact_mapping` table … in V004." Both statements are now stale given the CR-01/CR-01A split and the inert-table decision. The data-model doc should be updated: (a) V004 = additive only + inert `micro_artifact_mapping`; (b) ownership/GRANT hardening = CR-01A; (c) `v_timeline` repoint = timeline reconciliation CR. This spec does not edit architecture docs (developer scope); flagged for the architect.

---

## 4. Acceptance Criteria (from backlog CR-01)

- [ ] V004 adds nullable columns to `projects`: `github_repo`, `github_url`, `slack_micro_channel_id`, `slack_macro_channel_id`, `updated_by`, `updated_at`
- [ ] Partial unique index `uq_projects_github_repo ON projects(github_repo) WHERE github_repo IS NOT NULL` created
- [ ] `project_link_audit` table created (`id`, `project_id` FK→`projects(jira_key)` ON DELETE CASCADE, `field`, `old_value`, `new_value`, `actor_sub`, `changed_at`) + `idx_project_link_audit_project`
- [ ] BEFORE UPDATE trigger `audit_project_linkage` emits **one row per changed linkage field** using `IS DISTINCT FROM` (PLAN-M3)
- [ ] AFTER INSERT trigger `audit_project_linkage_insert` writes one row per non-NULL linkage field at create, `old_value` NULL (SEC-M5)
- [ ] `micro_artifact_mapping` table created **INERT** (Level-2 deferred; no seed data, no `kiro_mcp` grant)
- [ ] Migration idempotent (IF NOT EXISTS / CREATE OR REPLACE / DROP…IF EXISTS) and V004 sorts lexically last
- [ ] **Additive only** — no `GRANT`/`REVOKE`/`ALTER … OWNER TO`/`CREATE ROLE`/view repoint (those are CR-01A / reconciliation)

---

## 5. Schema Detail

### 5.1 `projects` — new columns (all nullable)

| Column | Type | Nullable | Secret? | Purpose | Source |
|--------|------|----------|---------|---------|--------|
| `github_repo` | `TEXT` | yes (partial UNIQUE) | no | Reconciliation key + feature switch; MCP resolve-by-repo lookup | FR-P2-034/038 |
| `github_url` | `TEXT` | yes | no | Clickable repo link (`https://github.com/...` only) | FR-P2-034 |
| `slack_micro_channel_id` | `TEXT` | yes | no | MICRO notification destination (CI/Kiro-owned) | FR-P2-035/039 |
| `slack_macro_channel_id` | `TEXT` | yes | no | MACRO notification destination (app-owned) | FR-P2-035/039 |
| `updated_by` | `TEXT` | yes | no | Cognito `sub` of last linkage mutator | FR-P2-034 |
| `updated_at` | `TIMESTAMPTZ` | yes | no | Last linkage mutation timestamp | FR-P2-034 |

All added via a single `ALTER TABLE IF EXISTS projects ADD COLUMN IF NOT EXISTS …`. Nullable is required — existing rows are unlinked (feature OFF) and must remain valid without backfill.

> **Secret handling:** The Slack **bot token** is never a column — it lives in SSM SecureString only (FR-P2-035). `projects` holds only non-secret channel ids.

### 5.2 Partial unique index

```sql
CREATE UNIQUE INDEX IF NOT EXISTS uq_projects_github_repo
  ON projects (github_repo) WHERE github_repo IS NOT NULL;
```

Enforces 1:1 repo↔project among linked projects; the partial predicate lets many projects stay `NULL` (unlinked). Backs the 409 `DUPLICATE_GITHUB_REPO` path in CR-02 and the MCP resolve lookup.

### 5.3 `project_link_audit`

Columns per §4.4.3 of the data model. FK `project_id → projects(jira_key) ON DELETE CASCADE`; index on `(project_id)`. `actor_sub` is `NOT NULL` (`'db_direct'` sentinel for out-of-band SQL). Non-secret values only — no bot token ever recorded (§6 PII inventory).

### 5.4 Audit triggers

- `audit_project_linkage` — `BEFORE UPDATE … FOR EACH ROW`, function `trg_audit_project_linkage()`. One INSERT per field where `NEW.<field> IS DISTINCT FROM OLD.<field>`. `actor := COALESCE(NEW.updated_by, 'db_direct')`.
- `audit_project_linkage_insert` — `AFTER INSERT … FOR EACH ROW`, function `trg_audit_project_linkage_insert()`. One INSERT per non-NULL linkage field at create (`old_value = NULL`). Returns NULL (AFTER trigger).

Both use `CREATE OR REPLACE FUNCTION` + `DROP TRIGGER IF EXISTS` then `CREATE TRIGGER` → idempotent.

> **Known limitation (SEC-L3, accepted for POC):** for an out-of-band SQL update that does not reset `updated_by`, `actor_sub` records the previous app mutator's `sub` rather than `'db_direct'`. Documented in projects-architecture §12.3; not a CR-01 blocker.

### 5.5 INERT `micro_artifact_mapping`

```sql
CREATE TABLE IF NOT EXISTS micro_artifact_mapping (
  id            BIGSERIAL   PRIMARY KEY,
  event_code    TEXT        NOT NULL,
  project_type  TEXT        NOT NULL DEFAULT 'default',
  phase         TEXT        NOT NULL,
  artifact_name TEXT        NOT NULL,
  is_active     BOOLEAN     NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_micro_artifact_mapping UNIQUE (event_code, project_type, phase)
);
```

**"Inert" means:** table exists (forward-compatible placeholder), **zero seed rows**, and **no runtime-role grant** (CR-01 grants nothing; CR-01A explicitly grants nothing on it either — PLAN-L2, Level-2 runs app-side). No `event_code` column is added to `governance_events` (Phase-1 CR-14). The `is_active DEFAULT true` matches the impact-doc §E design of record; inertness is achieved by having no rows and no grant, not by a column flag.

---

## 6. Verification Approach

Two complementary layers (neither touches RDS — CR-01 is code + tests only):

### 6.1 Static scope guard (runs in CI now)

`migrations/__tests__/V004-additive-scope.test.js` — plain CommonJS Jest test (the repo has no `jest.config`/ts-jest preset, so a `.js` test is guaranteed to run under `npm test`). It strips SQL comments, then asserts:

- all six `ADD COLUMN IF NOT EXISTS` linkage columns present
- partial unique index present with `WHERE github_repo IS NOT NULL`
- `project_link_audit` + FK to `projects(jira_key)` + its index
- BEFORE UPDATE trigger + exactly 4 `IS DISTINCT FROM` branches
- AFTER INSERT create-path trigger
- INERT `micro_artifact_mapping` present, with **no** `INSERT INTO micro_artifact_mapping` seed
- idempotency: every `CREATE TABLE`/`CREATE INDEX`/`ADD COLUMN` guarded; every `CREATE TRIGGER` paired with `DROP TRIGGER IF EXISTS`
- **scope boundary:** no `GRANT`/`REVOKE`/`ALTER … OWNER TO`/`ALTER DEFAULT PRIVILEGES`/`CREATE ROLE`/`DROP VIEW`/`CREATE VIEW`, and no `event_code` on `governance_events`

Run: `npx jest migrations/__tests__/V004-additive-scope.test.js` → **11 tests pass** (verified).

### 6.2 Behavioural verification against ephemeral Postgres 16

`migrations/verify/V004__verify.sql` — plpgsql `ASSERT` blocks over `information_schema`/`pg_catalog` confirming the objects are actually created (columns + nullability + types, partial-unique index def, audit table columns + FK, both triggers + functions, inert mapping table is empty, and — if a `kiro_mcp` role exists — that it has **no** privilege on `micro_artifact_mapping`). Intended for CI against a throwaway container, applying V001→V004 and **V004 a second time** to prove idempotency:

```bash
docker run --rm -e POSTGRES_PASSWORD=pw -p 5433:5432 -d --name v004pg postgres:16
psql "postgresql://postgres:pw@localhost:5433/postgres" -v ON_ERROR_STOP=1 \
  -f migrations/V001__governance_events.sql \
  -f migrations/V002__projects_and_casdm_tracking.sql \
  -f migrations/V003__phase2_additions.sql \
  -f migrations/V004__github_slack_linkage.sql \
  -f migrations/V004__github_slack_linkage.sql \
  -f migrations/verify/V004__verify.sql   # prints "V004 verification PASSED"
docker rm -f v004pg
```

> Not runnable in this environment (no Docker/RDS access). The script is written for the reviewer/CI to execute; the static guard (§6.1) is the runnable-now gate.

---

## 7. Rollback

V004 is purely additive, so rollback is low-risk and only needed if the migration must be fully reverted before CR-02 uses the columns. There is no framework-managed down-migration; the manual reverse (run by a role with ownership/DDL rights) is:

```sql
DROP TRIGGER IF EXISTS audit_project_linkage_insert ON projects;
DROP TRIGGER IF EXISTS audit_project_linkage ON projects;
DROP FUNCTION IF EXISTS trg_audit_project_linkage_insert();
DROP FUNCTION IF EXISTS trg_audit_project_linkage();
DROP TABLE IF EXISTS project_link_audit;         -- audit history; capture before dropping if needed
DROP TABLE IF EXISTS micro_artifact_mapping;     -- inert, empty
DROP INDEX IF EXISTS uq_projects_github_repo;
ALTER TABLE projects
  DROP COLUMN IF EXISTS github_repo,
  DROP COLUMN IF EXISTS github_url,
  DROP COLUMN IF EXISTS slack_micro_channel_id,
  DROP COLUMN IF EXISTS slack_macro_channel_id,
  DROP COLUMN IF EXISTS updated_by,
  DROP COLUMN IF EXISTS updated_at;
```

**Notes:** (a) Preferred recovery is roll-**forward** (fix + new migration), not down-migration. (b) Dropping `project_link_audit` destroys linkage audit history — export first if any linkage writes have occurred. (c) Do **not** roll back after CR-01A has reassigned ownership — coordinate with the CR-01A owner (the drop statements must run as the object owner). (d) Rollback is a manual, owner-privileged operation and must not be run against production without change approval.

---

## 8. Definition of Done

- [ ] `migrations/V004__github_slack_linkage.sql` contains only additive/idempotent DDL per §5 and the AC in §4
- [ ] `npx jest migrations/__tests__/V004-additive-scope.test.js` passes (scope + idempotency + boundary)
- [ ] `migrations/verify/V004__verify.sql` passes against an ephemeral Postgres 16 with V004 applied twice (CI or reviewer-run)
- [ ] No `GRANT`/`REVOKE`/`ALTER … OWNER TO`/`CREATE ROLE`/`ALTER DEFAULT PRIVILEGES`/view repoint present in V004
- [ ] `micro_artifact_mapping` exists, empty, ungranted
- [ ] Migration file naming + lexical ordering correct (`V004…` after `V003a…`)
- [ ] Not deployed to RDS (out of CR-01 scope) — deploy sequencing handed to ops with CR-01A
- [ ] Follow-ups flagged to orchestrator/architect: (1) update `unified-data-model.md` §4.4/§4.4.6 to reflect the CR-01/CR-01A split + inert table; (2) F10 pre-impl — confirm the two V002 files converge on a single `projects` definition; (3) CR-01A carries the ownership/GRANT hardening with the SEC-H1 sign-off; (4) timeline reconciliation CR carries the `v_timeline` repoint

---

## 9. Files Delivered

| File | Purpose |
|------|---------|
| `migrations/V004__github_slack_linkage.sql` | Reconciled additive-only migration (CR-01) |
| `migrations/verify/V004__verify.sql` | plpgsql ASSERT verification against ephemeral Postgres |
| `migrations/__tests__/V004-additive-scope.test.js` | Static scope + idempotency + boundary guard (Jest) |
| `specs/phase2/CR-01-v004-additive-schema-spec.md` | This spec |

---

*End of CR-01 spec.*
