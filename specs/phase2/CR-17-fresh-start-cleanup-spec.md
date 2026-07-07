# Implementation Spec: CR-17 — Fresh-Start Cleanup (gated, non-auto-run migration V007)

**Story:** CR-17
**Domain:** `migrations/`
**Status:** Spec — code + tests only. **⚠️ This migration is DESTRUCTIVE. It MUST NOT be auto-run, and MUST NOT be run as part of this task.**

**Source of design:**
- `docs/phase2/change-requests/2026-07-02-github-slack-linkage-impact.md` (fresh-start cleanup; replaces the cancelled CR-06 backfill)
- Schema: `migrations/V002__projects_and_casdm_tracking.sql` (`projects.jira_key`, `__template__` seed, child FKs `ON DELETE CASCADE`), `migrations/V003__phase2_additions.sql`, `migrations/V004__github_slack_linkage.sql` (`project_link_audit`).

**Related:** `specs/phase2/CR-16-link-time-gate-detection-spec.md`.

---

## 1. Overview

The `projects` table was seeded from a one-time Jira CST export. Those imported rows (`jira_key LIKE 'CST-%'`) are stale and should be removed for a clean start, **without** touching:
- the CASDM template row `__template__` (required — seeds every new project);
- any new-model `DP-###` projects;
- the append-only `governance_events` table (no FK; keyed by repo name; must remain intact).

Because deleting rows is **irreversible**, CR-17 is delivered as an **explicit, gated, non-auto-run migration** `migrations/V007__fresh_start_cleanup.sql`. It carries a loud warning header, a **guard that prevents accidental execution**, a preflight count, and a rollback note. The default migration runner must **skip** it (see §5).

**Deletion predicate (exact):**
```sql
WHERE jira_key LIKE 'CST-%' AND jira_key <> '__template__'
```

Child rows are removed automatically via the existing `ON DELETE CASCADE` FKs on `micro_artifacts`, `macro_checkpoints`, `gate_evidence`, `checkpoint_notes`, `weekly_status_logs`, `escalations`, `discovery_sessions`, `onboarding_checklist_items`, and `project_link_audit`. `governance_events` has **no** FK to `projects` and is **not** cascaded (intended — append-only audit trail preserved).

---

## 2. Files Touched

| File | Change |
|------|--------|
| `migrations/V007__fresh_start_cleanup.sql` | **NEW** — gated destructive cleanup (guarded; does not run without an explicit confirmation flag). |
| `migrations/verify/V007__preflight.sql` | **NEW** — read-only preflight: counts rows the DELETE would remove; confirms `__template__` and `DP-%` are untouched. |
| `migrations/verify/V007__verify.sql` | **NEW** — read-only post-run verification (run only after an intentional apply): asserts zero `CST-%` (non-template) projects remain, `__template__` present, `DP-%` count unchanged, `governance_events` count unchanged. |
| `migrations/__tests__/V007-fresh-start-cleanup.test.js` | **NEW** — static assertions on the SQL text (mirrors `V006-timeline-repoint.test.js`): correct predicate, template exclusion, guard present, non-auto-run, rollback note present. |

---

## 3. Migration Design (`migrations/V007__fresh_start_cleanup.sql`)

**Non-auto-run guard.** The runner (§5) sorts by filename and would apply V007 after V006. To prevent that, the destructive statement is wrapped in a `DO` block guarded by a session GUC (`kiro.confirm_fresh_start`) that defaults to off. Applying it requires an operator to **explicitly** set the flag in the same session — the file cannot delete anything on a normal `psql -f` / runner pass.

```sql
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
--  ⚠️ The default migration runner MUST SKIP this file (see spec §5). It is NOT
--     part of the ordered migration set and must never run in CI/CD or on deploy.
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
```

**Notes**
- `current_setting(..., true)` returns NULL (not an error) when the GUC is unset → default is a safe no-op.
- Single `DELETE`; cascades handle children. No explicit child deletes needed (FKs verified in V002/V003/V004).
- No schema change; safe to keep in the repo alongside the ordered migrations because it is inert without the flag.

---

## 4. Preflight & Verify (read-only)

`migrations/verify/V007__preflight.sql` (run BEFORE, read-only):
```sql
SELECT 'to_delete_projects' AS metric, count(*) AS value
  FROM projects WHERE jira_key LIKE 'CST-%' AND jira_key <> '__template__'
UNION ALL SELECT 'preserved_template', count(*) FROM projects WHERE jira_key = '__template__'
UNION ALL SELECT 'preserved_dp',        count(*) FROM projects WHERE jira_key LIKE 'DP-%'
UNION ALL SELECT 'governance_events',   count(*) FROM governance_events;
```

`migrations/verify/V007__verify.sql` (run AFTER an intentional apply, read-only): asserts `to_delete_projects = 0`, `preserved_template = 1`, `preserved_dp` unchanged vs preflight, `governance_events` unchanged vs preflight.

---

## 5. Runner Exclusion (MANDATORY)

CR-17 must **never** run automatically. Enforce all that apply to the project's runner:
- The migration runner's ordered set is `V001..V006` (+ CR-16 adds no migration). **V007 is explicitly excluded** from the applied set — it is an operator-run, out-of-band file.
- Because of the `kiro.confirm_fresh_start` guard, even an accidental `\i` / runner pass is a **no-op** (defence in depth).
- CI/CD deploy pipelines must not include V007 in their migration step. Document this in `packages/projects/README.md` / the migrations README.

---

## 6. Testing (static — file is never executed in tests)

`migrations/__tests__/V007-fresh-start-cleanup.test.js` (mirrors the existing static `V006-timeline-repoint.test.js` pattern — reads the SQL as text and asserts):

| Assertion |
|-----------|
| DELETE predicate is exactly `jira_key LIKE 'CST-%'` **and** `jira_key <> '__template__'` (template excluded). |
| No `DELETE FROM governance_events` anywhere in the file (append-only preserved). |
| The `kiro.confirm_fresh_start` guard exists and defaults to a no-op (`RETURN` when not `'yes'`). |
| A loud `DESTRUCTIVE` / `DO NOT AUTO-RUN` warning header is present. |
| A rollback note is present (`IRREVERSIBLE` / no down-migration). |
| Preflight + verify files exist and are read-only (no `DELETE`/`UPDATE`/`INSERT`). |

These tests never execute the SQL against a DB — they validate the guard, predicate, and safety text statically, consistent with the repo's existing migration-test style.

---

## 7. Definition of Done

- [ ] `V007__fresh_start_cleanup.sql` deletes only `CST-%` non-template projects; cascades children; leaves `__template__`, `DP-*`, and `governance_events` intact.
- [ ] Guarded by `kiro.confirm_fresh_start` (default no-op) + loud header + rollback note.
- [ ] Excluded from the automatic runner set; documented as operator-run only.
- [ ] Preflight + verify read-only scripts present.
- [ ] Static test asserts predicate, template exclusion, guard, non-auto-run, rollback note.
- [ ] **Migration NOT run. Not deployed.**
