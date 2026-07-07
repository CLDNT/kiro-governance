# Implementation Spec: CR-12 / CR-14 — Level 2 Micro-Event → Micro-Artifact Auto-Completion (no GitHub OIDC)

**Stories:** CR-14 (Phase-1 `event_code` addition) + CR-12 (Level-2 app-side auto-completion). Activates **SRS FR-P2-042**.
**Feature:** F-05 governance ↔ Phase-2 projects (micro Level 2).
**Domains:** `packages/shared` (event-code vocabulary + type), `packages/mcp-server` (record_progress `event_code` passthrough), `packages/gates` (reconciliation service + endpoint + gate-view trigger), `packages/projects` (link-time trigger), `frontend` (source badge + override), `migrations` (V008).
**Status:** Spec — **code + tests only. Do NOT deploy. Do NOT run V008 against the live DB.**
**Trust model (customer-accepted 2026-07-07):** GitHub OIDC (CR-OIDC) is **NOT** a prerequisite. Auto-completion trusts the **same authenticated MCP path as `record_progress`** — see §1.2.

**Source of design:**
- `docs/phase2/change-requests/2026-07-02-github-slack-linkage-impact.md` — v3 Decision I (Level 2), FR-P2-042, V004 §E inert `micro_artifact_mapping`, OQ-CR-13 (event-code vocabulary).
- `docs/phase2/gates-architecture.md` §2.5 (`PATCH /artifacts`), §5.3 (macro app-owned, passive join display-only).
- `migrations/V004__github_slack_linkage.sql` (inert `micro_artifact_mapping`), `V005__append_only_hardening.sql` (roles: `kiro_migrator` / `kiro_mcp` (master) / `kiro_mcp_app` / `kiro_phase2`), `V002/V003` (`micro_artifacts`, CASDM seeds), `V006` (`v_timeline` repoint).
- `.kiro/steering/*` "Micro Logging (MANDATORY)" tables (agent micro events).
- `specs/phase2/CR-16-link-time-gate-detection-spec.md` (sync pattern this mirrors), `packages/projects/services/gate-sync.service.ts` (`triggerLinkTimeSync` idempotent/audited/own-repo pattern).

---

## 1. Overview

### 1.1 What Level 2 does

Level 1 (delivered, FR-P2-036 / V006) surfaces micro `governance_events` on the project **timeline** (display-only). Level 2 (this CR) **drives the CASDM checklist**: when a linked project's repo has a micro governance event whose **`event_code`** resolves through a deterministic `micro_artifact_mapping` row to a `(phase, artifact_name)`, the matching `micro_artifacts` row is idempotently set `status = 'complete'`, `completed_by = 'kiro:<actor>'`, `completed_at = <event.created_at>`.

This is **app-side** (runs under the Phase-2 app DB role `kiro_phase2`) — the MCP runtime role `kiro_mcp_app` stays strictly append-only (`INSERT, SELECT` on `governance_events` only; **no** grant on `micro_artifact_mapping` or `micro_artifacts`). It is **deterministic** (config/lookup on `event_code`, never fuzzy text), **idempotent**, **reversible**, **audited**, and **own-repo-scoped**.

### 1.2 Trust model — why GitHub OIDC is no longer a precondition

The earlier design (impact doc v3.1 SEC-H3) gated Level 2 on GitHub OIDC because auto-completion mutates deliverable state from a caller-asserted micro event. **The customer accepts the trust model (2026-07-07):** Level 2 reads governance events that were **already** written through the authenticated, API-key-gated MCP `record_progress` path, which already enforces **no-orphan resolve-or-reject** (FR-P2-038) and **append-only** persistence (V005). Level 2 therefore introduces **no new trust surface** beyond what `record_progress` already established — it consumes already-persisted, already-authorised events. Removing the OIDC precondition is acceptable under this documented risk-accept, bounded by these compensating controls (all in scope here):

1. **Allow-list by construction** — only an `event_code` present in `micro_artifact_mapping` with `is_active = true` can complete an artifact. Any other micro event is timeline-only (Level 1).
2. **Deterministic** — config/lookup on `event_code` + `(project_type, phase)`; never fuzzy text matching.
3. **Idempotent** — re-running never re-completes or double-writes.
4. **Reversible + audited** — every auto-completion writes an append-only `micro_artifact_audit` row; a manual override (existing `PATCH /artifacts`) reverses it and is also audited; reconciliation never clobbers a manual override.
5. **Own-repo-scoped** — reconciliation reads only the requested project's own `github_repo` events (read from the project row, never request input) and only writes that project's `micro_artifacts`.
6. **App-owned / MCP append-only preserved** — the `UPDATE` runs under `kiro_phase2`; `kiro_mcp_app` gets no new grant. Macro completion (FR-P2-041) and the passive `v_timeline` join are unchanged.

> Residual risk (recorded, POC-accepted): under the shared MCP API key a key holder could emit a micro event with a mapped `event_code` for another **linked** project's repo and falsely complete that project's artifact. This is bounded to *insert-with-wrong-attribution* (never edit/delete — append-only) and is **reversible + audited** here. This is the same residual already accepted for Level 1 in SRS §NFR-P2-003 (SEC-H2/H3). Revisit if a non-first-party CI ever holds the key.

### 1.3 Triggers (mirror CR-16)

| # | Trigger | Behaviour |
|---|---------|-----------|
| T1 | `github_repo` set/changed (create/update project) | Best-effort, non-blocking `triggerMicroArtifactReconcile(projectId, actor)` (mirrors `triggerLinkTimeSync`; always resolves). |
| T2 | `POST /api/projects/{projectId}/sync-artifacts` (**admin/leadership**) | Synchronous; returns `{ project_id, matched, completed, skipped }`. |
| T3 | Gate-view load (`GET /api/projects/{projectId}/gates`) | Best-effort opportunistic reconcile **before** the response is assembled, only when `github_repo IS NOT NULL`, so a PM opening the project sees fresh Kiro completions. Non-blocking — a reconcile failure never breaks the gate view. |

All three call the same `reconcileMicroArtifacts(projectId, actor)` service. Idempotent — re-running produces `completed: 0`.

---

## 2. Event-Code Vocabulary (CR-14 / OQ-CR-13)

### 2.1 Design

`event_code` is a **stable, rename-safe, language-agnostic** string emitted by Kiro and persisted on `governance_events`. It is the **only** Level-2 mapping key (`source_ref` and text matching are rejected — PLAN-L4). Format:

```
casdm.<phase-slug>.<artifact-slug>
```

- Lowercase, dot-delimited, `[a-z0-9._]` only, ≤ 64 chars.
- `<phase-slug>` = `p0`..`p4` (CASDM phase). `<artifact-slug>` = stable snake_case artifact identifier (independent of the human artifact title, which may be reworded).
- The code is globally unique on its own; the mapping row additionally carries `phase` + `project_type` for the `(event_code, project_type, phase)` unique key.

### 2.2 Canonical codes — the 16 CASDM template micro artifacts

Grounded in the 16 seeded `micro_artifacts` (`V002__projects_and_casdm_tracking.sql` `__template__` rows). `event_code → (phase, artifact_name)`:

| # | event_code | phase | artifact_name (must equal seeded `micro_artifacts.artifact_name`) |
|---|------------|-------|-------------------------------------------------------------------|
| 1 | `casdm.p0.preliminary_srs` | Phase 0 | Preliminary SRS |
| 2 | `casdm.p0.discovery_agenda` | Phase 0 | Discovery Meeting(s) Agenda + Questions |
| 3 | `casdm.p0.project_plan` | Phase 0 | High-level Project Plan + Gantt Chart + RACI |
| 4 | `casdm.p0.baseline_backlog` | Phase 0 | Baseline Jira Backlog |
| 5 | `casdm.p0.kickoff_deck` | Phase 0 | Kickoff Deck Content/Slides |
| 6 | `casdm.p1.working_srs` | Phase 1 | Working SRS |
| 7 | `casdm.p2.workstream_decomposition` | Phase 2 | Workstream Decomposition |
| 8 | `casdm.p2.spec_strategy` | Phase 2 | Spec Strategy per Workstream |
| 9 | `casdm.p2.data_readiness` | Phase 2 | Data Readiness |
| 10 | `casdm.p2.solution_architecture_design` | Phase 2 | Solution Architecture Design |
| 11 | `casdm.p2.tco` | Phase 2 | TCO |
| 12 | `casdm.p2.sprint_plan` | Phase 2 | Jira stories/sprint plan using validated SRS/design docs |
| 13 | `casdm.p3.specs_per_story` | Phase 3 | Specs per story-id |
| 14 | `casdm.p3.code` | Phase 3 | Code |
| 15 | `casdm.p3.uat_report` | Phase 3 | UAT report |
| 16 | `casdm.p4.runbooks` | Phase 4 | Runbooks / Documentation |

> **artifact_name fidelity:** each `artifact_name` above is copied verbatim from the `V002` `__template__` seed so the reconcile join (`micro_artifacts.artifact_name = micro_artifact_mapping.artifact_name`) matches per project. If a project's seeded set omits an artifact (e.g. the `casdm_config` set omits `Jira stories/sprint plan…`), that code resolves in the mapping but finds no target row → counted `skipped` (never errors).

### 2.3 Recommended agent emission (grounds vocabulary in existing `.kiro/steering` micro events)

Level 2 completes an artifact **only** when a Kiro agent emits the matching `event_code` on a **completion** event. The existing `.kiro/steering` "Micro Logging" tables emit free-text `update_text`; a **follow-up steering update** adds an `event_code` column to those tables so agents emit these codes. Recommended assignment (completion-semantics only):

| Agent | Existing micro event (`update_text`) | Emit `event_code` | Notes |
|-------|--------------------------------------|-------------------|-------|
| product-analyst | "Draft SRS sections written" | `casdm.p1.working_srs` | Primary SRS deliverable. (A Phase-0 draft would emit `casdm.p0.preliminary_srs`.) |
| product-analyst | "Requirements gathering started" | — (timeline-only) | "started", not a completion. |
| aws-architect | "Domain decomposition done" | `casdm.p2.workstream_decomposition` | Confident 1:1. |
| aws-architect | "Data model draft complete" | `casdm.p2.data_readiness` | Data readiness deliverable. |
| aws-architect | "Feature list defined" | — (timeline-only) | No CASDM artifact. |
| executioner | "Handler implementation complete" | `casdm.p3.code` | Code artifact. |
| executioner | "Spec file generation started" | — (timeline-only) | "started". |
| plan-reviewer | "Architecture review started" / "Review findings documented" | — (timeline-only) | Review activity, not an artifact. |
| qa-agent | "Test plan created" | — (timeline-only) | Test plan ≠ UAT report. |
| code-reviewer | "Code review started" | — (timeline-only) | Review activity. |

**Rule:** any micro event with **no** `event_code`, or an `event_code` not in `micro_artifact_mapping`, is **timeline-only** — it surfaces on the timeline (Level 1) but never mutates artifact state. This is the allow-list from §1.2.

### 2.4 Shared constant (`packages/shared/constants/micro-artifact-events.ts` — NEW)

```typescript
/**
 * Level-2 CASDM micro-artifact event-code vocabulary (CR-14 / OQ-CR-13).
 * The mapping ROWS live in micro_artifact_mapping (seeded by V008 — the DB is the runtime
 * source of truth). This constant is the typed, unit-testable mirror used by the shared
 * type, tests, and the V008 seed generator. Import from here — never hardcode event codes.
 */
export const MICRO_ARTIFACT_EVENT_CODES = {
  'casdm.p0.preliminary_srs':              { phase: 'Phase 0', artifact_name: 'Preliminary SRS' },
  'casdm.p0.discovery_agenda':             { phase: 'Phase 0', artifact_name: 'Discovery Meeting(s) Agenda + Questions' },
  'casdm.p0.project_plan':                 { phase: 'Phase 0', artifact_name: 'High-level Project Plan + Gantt Chart + RACI' },
  'casdm.p0.baseline_backlog':             { phase: 'Phase 0', artifact_name: 'Baseline Jira Backlog' },
  'casdm.p0.kickoff_deck':                 { phase: 'Phase 0', artifact_name: 'Kickoff Deck Content/Slides' },
  'casdm.p1.working_srs':                  { phase: 'Phase 1', artifact_name: 'Working SRS' },
  'casdm.p2.workstream_decomposition':     { phase: 'Phase 2', artifact_name: 'Workstream Decomposition' },
  'casdm.p2.spec_strategy':                { phase: 'Phase 2', artifact_name: 'Spec Strategy per Workstream' },
  'casdm.p2.data_readiness':               { phase: 'Phase 2', artifact_name: 'Data Readiness' },
  'casdm.p2.solution_architecture_design': { phase: 'Phase 2', artifact_name: 'Solution Architecture Design' },
  'casdm.p2.tco':                          { phase: 'Phase 2', artifact_name: 'TCO' },
  'casdm.p2.sprint_plan':                  { phase: 'Phase 2', artifact_name: 'Jira stories/sprint plan using validated SRS/design docs' },
  'casdm.p3.specs_per_story':              { phase: 'Phase 3', artifact_name: 'Specs per story-id' },
  'casdm.p3.code':                         { phase: 'Phase 3', artifact_name: 'Code' },
  'casdm.p3.uat_report':                   { phase: 'Phase 3', artifact_name: 'UAT report' },
  'casdm.p4.runbooks':                     { phase: 'Phase 4', artifact_name: 'Runbooks / Documentation' },
} as const;

export type MicroArtifactEventCode = keyof typeof MICRO_ARTIFACT_EVENT_CODES;

/** Non-throwing validation used by the record_progress passthrough (unknown codes still persist). */
export function isKnownEventCode(code: string): code is MicroArtifactEventCode {
  return Object.prototype.hasOwnProperty.call(MICRO_ARTIFACT_EVENT_CODES, code);
}
```

Export both from `packages/shared/index.ts`.

---

## 3. Data Model Delta — `migrations/V008__level2_micro_artifact_autocomplete.sql` (NEW)

**Next lexical version = V008** (V007 is the highest existing). Additive + seed + explicit idempotent grants only. Run by the migration runner as / via `kiro_migrator` (per V005 ownership model). Idempotent (`ADD COLUMN IF NOT EXISTS`, `CREATE TABLE IF NOT EXISTS`, `INSERT … ON CONFLICT DO NOTHING`, `GRANT` re-runnable).

### 3.1 (A) Phase-1 additive column — `governance_events.event_code`

```sql
-- (A) CR-14: nullable event_code on the append-only governance store. Additive → append-only-safe.
--     kiro_migrator owns the table; kiro_mcp_app already holds table-level INSERT,SELECT (V005),
--     which covers the new column — no new MCP grant required (append-only posture unchanged).
ALTER TABLE IF EXISTS governance_events
  ADD COLUMN IF NOT EXISTS event_code TEXT;

-- Reconcile lookup: repo-keyed micro events carrying an event_code. Partial index keeps it small.
CREATE INDEX IF NOT EXISTS idx_governance_events_event_code
  ON governance_events (project_id, event_code)
  WHERE event_code IS NOT NULL;
```

### 3.2 (B) `micro_artifacts.manual_override` — override precedence

```sql
-- (B) CR-12: manual override flag. Set TRUE whenever a human changes status via PATCH /artifacts.
--     The reconciler SKIPS rows with manual_override = true, so a deliberate human decision is
--     never clobbered by a re-sync (reversibility guarantee). Default false = auto-eligible.
ALTER TABLE IF EXISTS micro_artifacts
  ADD COLUMN IF NOT EXISTS manual_override BOOLEAN NOT NULL DEFAULT false;
```

### 3.3 (C) Seed `micro_artifact_mapping` (created inert in V004)

```sql
-- (C) Activate the inert V004 mapping: seed the 16 event_code → (phase, artifact_name) rows.
--     project_type = 'default' (artifact names are project-type-independent in the CASDM template;
--     per-type overrides can be added later without schema change). is_active = true.
INSERT INTO micro_artifact_mapping (event_code, project_type, phase, artifact_name, is_active) VALUES
  ('casdm.p0.preliminary_srs',              'default', 'Phase 0', 'Preliminary SRS', true),
  ('casdm.p0.discovery_agenda',             'default', 'Phase 0', 'Discovery Meeting(s) Agenda + Questions', true),
  ('casdm.p0.project_plan',                 'default', 'Phase 0', 'High-level Project Plan + Gantt Chart + RACI', true),
  ('casdm.p0.baseline_backlog',             'default', 'Phase 0', 'Baseline Jira Backlog', true),
  ('casdm.p0.kickoff_deck',                 'default', 'Phase 0', 'Kickoff Deck Content/Slides', true),
  ('casdm.p1.working_srs',                  'default', 'Phase 1', 'Working SRS', true),
  ('casdm.p2.workstream_decomposition',     'default', 'Phase 2', 'Workstream Decomposition', true),
  ('casdm.p2.spec_strategy',                'default', 'Phase 2', 'Spec Strategy per Workstream', true),
  ('casdm.p2.data_readiness',               'default', 'Phase 2', 'Data Readiness', true),
  ('casdm.p2.solution_architecture_design', 'default', 'Phase 2', 'Solution Architecture Design', true),
  ('casdm.p2.tco',                          'default', 'Phase 2', 'TCO', true),
  ('casdm.p2.sprint_plan',                  'default', 'Phase 2', 'Jira stories/sprint plan using validated SRS/design docs', true),
  ('casdm.p3.specs_per_story',              'default', 'Phase 3', 'Specs per story-id', true),
  ('casdm.p3.code',                         'default', 'Phase 3', 'Code', true),
  ('casdm.p3.uat_report',                   'default', 'Phase 3', 'UAT report', true),
  ('casdm.p4.runbooks',                     'default', 'Phase 4', 'Runbooks / Documentation', true)
ON CONFLICT (event_code, project_type, phase) DO NOTHING;
```

### 3.4 (D) `micro_artifact_audit` — append-only reversibility trail (NEW)

```sql
-- (D) CR-12: append-only audit of every auto-completion, manual override, and reverse. This is the
--     immutable trail behind the reversible+audited requirement (beyond the mutable completed_by).
CREATE TABLE IF NOT EXISTS micro_artifact_audit (
  id            BIGSERIAL   PRIMARY KEY,
  project_id    TEXT        NOT NULL REFERENCES projects(jira_key) ON DELETE CASCADE,
  artifact_id   BIGINT      REFERENCES micro_artifacts(id) ON DELETE SET NULL,
  phase         TEXT        NOT NULL,
  artifact_name TEXT        NOT NULL,
  event_code    TEXT,                 -- the code that drove an auto_complete (NULL for manual actions)
  event_actor   TEXT,                 -- governance_events.actor for auto_complete (e.g. 'aws-architect')
  action        TEXT        NOT NULL CHECK (action IN ('auto_complete', 'manual_override', 'reverse')),
  old_status    TEXT,
  new_status    TEXT,
  actor         TEXT        NOT NULL, -- 'system:artifact-sync' (auto) or Cognito sub/email (manual)
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_micro_artifact_audit_project ON micro_artifact_audit (project_id);
```

### 3.5 (E) Ownership + grants (keep MCP append-only; app performs Level 2)

```sql
-- (E.1) New objects owned by the non-runtime migrator role (consistent with V005).
ALTER TABLE    IF EXISTS micro_artifact_audit        OWNER TO kiro_migrator;
ALTER SEQUENCE IF EXISTS micro_artifact_audit_id_seq OWNER TO kiro_migrator;

-- (E.2) EXPLICIT, idempotent Level-2 grants for the Phase-2 app role kiro_phase2.
--       (V005 F.4 already granted broad DML to kiro_phase2 as a snapshot; these re-state the exact
--        Level-2 privileges so intent is documented and re-runnable, and cover micro_artifact_audit.)
GRANT SELECT                       ON micro_artifact_mapping TO kiro_phase2;   -- read the lookup
GRANT SELECT, UPDATE               ON micro_artifacts        TO kiro_phase2;   -- auto-complete
GRANT SELECT                       ON governance_events      TO kiro_phase2;   -- read micro events (already granted; append-only for app)
GRANT INSERT, SELECT               ON micro_artifact_audit   TO kiro_phase2;   -- append-only audit
GRANT USAGE,  SELECT ON SEQUENCE micro_artifact_audit_id_seq TO kiro_phase2;

-- (E.3) MCP runtime role stays APPEND-ONLY — assert NO Level-2 surface is granted to it.
--       (No GRANT statements for kiro_mcp_app here. The V008 verify script asserts kiro_mcp_app has
--        NO privilege on micro_artifact_mapping / micro_artifacts / micro_artifact_audit.)
REVOKE ALL ON micro_artifact_mapping FROM kiro_mcp_app;
REVOKE ALL ON micro_artifact_audit   FROM kiro_mcp_app;
-- micro_artifacts: kiro_mcp_app must never hold UPDATE. (It was never granted; belt-and-suspenders.)
REVOKE ALL ON micro_artifacts        FROM kiro_mcp_app;
```

> **Grant reality check (verified against V005):** V005 §F.4 granted `kiro_phase2` broad `SELECT,INSERT,UPDATE,DELETE ON ALL TABLES` (snapshot) plus `ALTER DEFAULT PRIVILEGES` for future `kiro_migrator`-owned tables. So the app **already** can `SELECT micro_artifact_mapping` and `UPDATE micro_artifacts`, and (via default privileges) will get DML on the new `micro_artifact_audit`. The V008 grants above are therefore **explicit re-statements** (idempotent) that document the exact Level-2 privileges and guarantee correctness regardless of whether V008 runs before/after any default-privilege drift. `kiro_mcp_app` (MCP runtime) was never granted these and the `REVOKE`s make that explicit — **MCP stays append-only.**

### 3.6 Verify script — `migrations/verify/V008__verify.sql` (NEW)

Assert: `governance_events.event_code` exists; `micro_artifacts.manual_override` exists (default false); 16 `micro_artifact_mapping` rows seeded & active; `micro_artifact_audit` exists & owned by `kiro_migrator`; `kiro_phase2` has `SELECT` on mapping + `UPDATE` on `micro_artifacts` + `INSERT` on audit; **`kiro_mcp_app` has NO privilege** on `micro_artifact_mapping` / `micro_artifacts` / `micro_artifact_audit` (query `information_schema.role_table_grants`).

---

## 4. MCP Server — `record_progress` `event_code` passthrough (CR-14)

**`packages/mcp-server/src/tools/record-progress.ts`** — additive, backward-compatible:

- Add optional `event_code` to `RecordProgressInputSchema`:
  ```typescript
  event_code: z.string().regex(/^[a-z0-9._]{1,64}$/).optional(),
  ```
- Persist it on the `GovernanceEventRecord` (only when present): `...(input.event_code && { event_code: input.event_code })`.
- **No validation against the vocabulary at write time** — unknown/absent codes still persist (they simply never resolve in Level-2; timeline-only). Keeps `record_progress` decoupled from the mapping (the allow-list is enforced at reconcile time via the DB join).
- Idempotency key, classification, no-orphan resolve-or-reject, dedup — **all unchanged**. `event_code` does not participate in the idempotency key.

**`packages/shared/types/governance-event.ts`** — add optional `event_code?: string` to `GovernanceEventRecord`.

**`packages/mcp-server/src/services/postgres.service.ts`** — `writeGovernanceEvent` INSERT column list + params gain `event_code` (nullable). `kiro_mcp_app`'s table-level `INSERT` already covers the new column.

---

## 5. Auto-Complete Reconciliation (app-side, `kiro_phase2`)

### 5.1 Service — `packages/gates/services/micro-artifact-reconcile.service.ts` (NEW)

Mirrors `gate-sync.service.ts` (idempotent, audited, own-repo, always-resolving trigger wrapper). `micro_artifacts` is a gates-domain table, so the service lives in `packages/gates`.

```typescript
export const ARTIFACT_SYNC_ACTOR = 'system:artifact-sync';

export interface ReconcileArtifactsSummary {
  project_id: string;
  matched: number;    // mapping-resolved micro events that have a target micro_artifacts row
  completed: number;  // rows newly set to complete by this run
  skipped: number;    // already complete | manual_override | no target row | unmapped code
}

export async function reconcileMicroArtifacts(projectId: string, actor: string): Promise<ReconcileArtifactsSummary>;
export async function triggerMicroArtifactReconcile(projectId: string, actor: string): Promise<void>; // best-effort, always resolves
```

**Algorithm:**

1. Resolve the project: `SELECT jira_key, github_repo, COALESCE(project_type,'default') AS project_type FROM projects WHERE jira_key = $1`. Unknown → `NotFoundError` (endpoint maps to 404). `github_repo IS NULL` → no-op `{matched:0, completed:0, skipped:0}` (feature switch OFF).
2. Single guarded, idempotent `UPDATE … FROM` (own-repo, earliest-event-wins, allow-listed, override-respecting):

```sql
WITH candidate AS (
  SELECT DISTINCT ON (m.phase, m.artifact_name)
         m.phase, m.artifact_name, ge.actor AS event_actor, ge.created_at, ge.event_code
  FROM governance_events ge
  JOIN micro_artifact_mapping m
    ON  m.event_code   = ge.event_code
    AND m.project_type = $2            -- COALESCE(projects.project_type,'default')
    AND m.is_active    = true          -- allow-list
  WHERE ge.project_id = $3             -- projects.github_repo (repo-keyed events) — OWN REPO ONLY
    AND ge.type       = 'micro'
    AND ge.event_code IS NOT NULL
  ORDER BY m.phase, m.artifact_name, ge.created_at ASC   -- earliest event wins
)
UPDATE micro_artifacts ma
   SET status       = 'complete',
       completed_at = c.created_at,
       completed_by = 'kiro:' || c.event_actor
  FROM candidate c
 WHERE ma.project_id      = $1          -- jira_key
   AND ma.phase           = c.phase
   AND ma.artifact_name   = c.artifact_name
   AND ma.status          <> 'complete' -- IDEMPOTENT
   AND ma.manual_override = false       -- never clobber a human decision
RETURNING ma.id, ma.phase, ma.artifact_name, c.event_code, c.event_actor;
```

3. **Counts:** `completed` = `UPDATE` row count. `matched` = distinct `(phase, artifact_name)` candidates that have a `micro_artifacts` row for the project (completed + already-complete + override-skipped). `skipped` = `matched − completed` **plus** candidates whose target row is missing (a separate cheap count) — every non-completing resolved event is surfaced as `skipped` (nothing is silently swallowed).
4. **Audit (append-only, best-effort but attempted):** for each row in the `RETURNING` set, `INSERT INTO micro_artifact_audit (project_id, artifact_id, phase, artifact_name, event_code, event_actor, action, old_status, new_status, actor) VALUES (…, 'auto_complete', <prev>, 'complete', 'system:artifact-sync')`. A failed audit is logged (`ARTIFACT_SYNC_AUDIT_FAILED`) but does not roll back the completion (completion is still provenance-tagged `kiro:<actor>`).
5. **Log:** structured `ARTIFACT_SYNC` `{ projectId, actor, matched, completed, skipped }`. No secrets (there are none in this path).

`triggerMicroArtifactReconcile` wraps `reconcileMicroArtifacts` in try/catch that always resolves (logs `ARTIFACT_SYNC_RESULT` / `ARTIFACT_SYNC_FAILED`) — mirrors `triggerLinkTimeSync`.

### 5.2 Endpoint — `POST /api/projects/{projectId}/sync-artifacts` (NEW, `packages/gates/handlers/sync-artifacts.ts`)

Mirrors `sync-gates.ts` exactly:

- `withRoles(['admin', 'leadership'])` → non-privileged caller = `403 FORBIDDEN` (Cognito role, never free-text `project_manager`).
- Body-less; `projectId` from path. Calls `reconcileMicroArtifacts(projectId, context.auth.userId)`.
- `200 { project_id, matched, completed, skipped }`. Unknown project → `404 NOT_FOUND`. Unlinked project → `200` all-zero.
- No GitHub fetch (Level 2 reads DB events only) → no 503/rate-limit path. Register route in `infra/stacks/deliverpro-lambdas-stack.ts`; add `SyncArtifactsResponse` to `packages/gates/types.ts`; add to `specs/api/projects.yaml`.

### 5.3 Gate-view trigger (T3) — `packages/gates/handlers/get-gates.ts`

Before loading `micro_artifacts`, add a best-effort reconcile so the returned view reflects fresh Kiro completions:

```typescript
// CR-12 T3: opportunistic, best-effort Level-2 reconcile on gate-view load. Own-repo only
// (skipped when github_repo IS NULL). Never throws — a reconcile failure must not break the view.
try {
  const linked = await queryMany<{ github_repo: string | null }>(
    'SELECT github_repo FROM projects WHERE jira_key = $1', [projectId]);
  if (linked[0]?.github_repo) {
    await reconcileMicroArtifacts(projectId, 'system:gate-view');
  }
} catch (err) {
  log('warn', 'ARTIFACT_SYNC_ON_VIEW_FAILED', { projectId, error: String(err) });
}
// … then the existing micro_artifacts SELECT reflects any completion.
```

> **Documented GET side-effect:** like CR-16's link-time exception, this is a deliberate, idempotent, own-project system reconciliation (not a user action) recorded in the FR. It is cheap (≤16-row guarded UPDATE, ≤200 projects — negligible on `db.t3.micro`, consistent with gates-architecture §9). Teams preferring strict GET purity can disable T3 and rely on T1 (link-time) + T2 (explicit sync); the FR keeps T3 as the default convenience path.

### 5.4 Link-time trigger (T1) — `packages/projects/handlers/{create,update}-project.ts`

Alongside the existing `triggerLinkTimeSync` (macro, CR-16), add `await triggerMicroArtifactReconcile(projectId, context.auth.userId)` when `github_repo` is set/changed to a non-null value. Both always resolve, so neither can fail the create/update.

### 5.5 Manual override + reverse — `packages/gates/handlers/update-artifact.ts` (CHANGED)

The existing `PATCH /api/projects/{projectId}/artifacts/{artifactId}` (status toggle, roles `pm/sa/leadership/admin`) is the **manual override / reverse** path. Changes:

- On any human status change, set `manual_override = true` (so the reconciler stops touching this row — reversibility guarantee).
- Write a `micro_artifact_audit` row: `action = 'manual_override'` when transitioning **to** a non-complete status from a Kiro-completed row (`completed_by LIKE 'kiro:%'`), else `action = 'manual_override'` for a manual complete; use `action = 'reverse'` specifically when downgrading an auto-completed row. `actor = auth.email`.
- Keep the existing behaviour of clearing `completed_at`/`completed_by` when status leaves `complete`.
- Optional `reset_to_auto: boolean` in the body: when `true` (admin/leadership), clears `manual_override = false` so the row becomes auto-eligible again (re-sync can re-complete it). Audited (`action = 'reverse'`).

---

## 6. UI Integration (`frontend`)

**`MicroArtifact` type** (`frontend/src/types`): add `manual_override: boolean`. `completed_by` already present.

**Source badge (`frontend/src/components/gates/MicroArtifactItem.tsx`):** derive the source from `completed_by`:

```typescript
const isKiroAuto = artifact.status === 'complete' && (artifact.completed_by ?? '').startsWith('kiro:');
const kiroActor = isKiroAuto ? artifact.completed_by!.slice('kiro:'.length) : null;
```

- When `isKiroAuto`: render a distinct **`kiro` badge** next to the status badge (e.g. `bg-blue-100 text-blue-700 border-blue-300`, label `⚡ kiro`), and the completion line reads `✓ Auto-completed {date} by Kiro ({kiroActor})`. Use `<Tooltip>`: "Auto-completed by Kiro from a governance event. You can override with the status controls below."
- When complete but **not** `kiro:` prefixed → **manual** completion: existing green badge + `by {completed_by}` (no kiro badge).
- **Manual override retained:** the existing status buttons stay for `canEdit` roles. If `manual_override === true`, show a subtle `manual override` chip so users know auto-sync will not touch this row. Provide an admin/leadership-only **"Re-enable Kiro sync"** action that calls `PATCH /artifacts/{id}` with `{ reset_to_auto: true }`.
- Accessibility (WCAG 2.1 AA): the kiro badge is not color-only — it carries the text `kiro` + an icon + `aria-label="Auto-completed by Kiro"`; contrast ≥ 4.5:1.

**Sync action (`ProjectDetailPage.tsx`, gates section):** add an admin/leadership-only **"Sync from Kiro"** button that `POST`s `/api/projects/{projectId}/sync-artifacts` and, on success, toasts `Synced: {completed} artifact(s) auto-completed` and refetches the gate view. Co-locate with the CR-16 "Sync gates" action (or a single combined "Sync" that calls both). Hidden when the project is unlinked (`github_repo` null).

**RBAC (CASL/roles):** the sync button and "Re-enable Kiro sync" are admin/leadership only; the per-artifact manual toggle keeps its existing `pm/sa/leadership/admin` gate. Frontend gating is UX only — the backend `withRoles` is the enforcer.

---

## 7. Files Touched

| File | Change |
|------|--------|
| `migrations/V008__level2_micro_artifact_autocomplete.sql` | **NEW** — §3 (event_code column + index, manual_override, seed mapping, audit table, grants). |
| `migrations/verify/V008__verify.sql` | **NEW** — §3.6 assertions. |
| `migrations/__tests__/V008-*.test.js` | **NEW** — additive-scope + grant/append-only assertions (mirror V004/V005 tests). |
| `packages/shared/constants/micro-artifact-events.ts` | **NEW** — §2.4 vocabulary constant. |
| `packages/shared/types/governance-event.ts` | Add optional `event_code`. |
| `packages/shared/index.ts` | Export vocabulary + `isKnownEventCode`. |
| `packages/mcp-server/src/tools/record-progress.ts` | Optional `event_code` in schema + record. |
| `packages/mcp-server/src/services/postgres.service.ts` | `writeGovernanceEvent` persists `event_code`. |
| `packages/gates/services/micro-artifact-reconcile.service.ts` | **NEW** — §5.1 reconcile + trigger. |
| `packages/gates/handlers/sync-artifacts.ts` | **NEW** — §5.2 endpoint. |
| `packages/gates/handlers/get-gates.ts` | §5.3 gate-view trigger. |
| `packages/gates/handlers/update-artifact.ts` | §5.5 manual_override + audit + reset_to_auto. |
| `packages/gates/types.ts` / `index.ts` | `SyncArtifactsResponse`, exports. |
| `packages/projects/handlers/{create,update}-project.ts` | §5.4 link-time trigger. |
| `infra/stacks/deliverpro-lambdas-stack.ts` | Wire `POST /sync-artifacts` route + Lambda (kiro_phase2 role). |
| `specs/api/projects.yaml` | Add `POST /api/projects/{projectId}/sync-artifacts` (200 `SyncArtifactsResponse`, 403, 404); document `event_code` on record_progress. |
| `frontend/src/components/gates/MicroArtifactItem.tsx`, `frontend/src/types`, `ProjectDetailPage.tsx` | §6 UI. |
| `docs/phase2/srs.md` | Activate FR-P2-042 (§9). |
| `docs/phase2/architecture/unified-data-model.md` | V008 delta + changelog. |
| `docs/phase2/gates-architecture.md` | Level-2 reconcile section (macro path unchanged). |

---

## 8. Testing (code + tests only — no deploy)

| Test | Asserts |
|------|---------|
| `packages/shared/constants/__tests__/micro-artifact-events.test.ts` | 16 codes; each maps to a real V002 `__template__` artifact_name; `isKnownEventCode` true/false. |
| `packages/mcp-server/.../record-progress.test.ts` (extend) | `event_code` persisted when present; absent → NULL; invalid charset → validation error; unknown code still persists (not rejected); idempotency key unchanged. |
| `packages/gates/__tests__/services/micro-artifact-reconcile.test.ts` (mocked pg) | mapped micro event completes matching row (`completed_by='kiro:<actor>'`, `completed_at=event.created_at`); **re-run idempotent** (`completed:0`); unmapped code → skipped, no mutation; `is_active=false` mapping → skipped; `manual_override=true` row → skipped; unlinked project → all-zero; earliest event wins; **only own-repo** events considered; audit row written per completion. |
| `packages/gates/__tests__/handlers/sync-artifacts.test.ts` | admin/leadership → 200 summary; pm/sa/engineer → 403; unknown project → 404; unlinked → 200 all-zero. |
| `packages/gates/__tests__/handlers/get-gates.test.ts` (extend) | reconcile runs on load when linked; view reflects auto-completion; reconcile failure does NOT break the view (returns data). |
| `packages/gates/__tests__/handlers/update-artifact.test.ts` (extend) | manual status change sets `manual_override=true` + writes audit; downgrade of a `kiro:`-completed row = `reverse` audit + clears completed_*; `reset_to_auto` clears override (admin/leadership only). |
| `frontend/.../MicroArtifactItem.test.tsx` (extend) | `kiro:` prefix → kiro badge + "by Kiro (actor)"; non-prefixed complete → manual badge; override chip when `manual_override`; sync button admin/leadership only. |
| `migrations/__tests__/V008-*.test.js` | additive only; 16 mapping rows; `kiro_mcp_app` gets NO grant on mapping/artifacts/audit; `kiro_phase2` gets SELECT(mapping)+UPDATE(artifacts)+INSERT(audit). |

Pre-merge gate: `npm run format && npm run lint && npm run type-check` clean.

---

## 9. SRS FR-P2-042 (activated) — proposed replacement text

> Applied to `docs/phase2/srs.md` (see the doc edit). Priority **Deferred → Must**; OIDC precondition removed; trust model documented; build-ready machine-testable ACs.

**Priority:** Must Have
**Source:** Customer 2026-07-02 (Decision I, Level 2) + customer trust-model acceptance 2026-07-07 (GitHub OIDC no longer required). The `event_code` vocabulary, app-side placement, and provenance are Architect + security decisions.

**Description:** When a linked project (`github_repo` set) has a micro `governance_event` whose `event_code` resolves through the deterministic `micro_artifact_mapping` `(event_code, project_type, phase) → artifact_name` lookup, DeliverPro idempotently sets the matching `micro_artifacts` row `status='complete'`, `completed_at = event.created_at`, `completed_by = 'kiro:' || event.actor`, under the Phase-2 app role (`kiro_phase2`) — the MCP runtime role stays append-only. **Trust model:** auto-completion trusts the same authenticated MCP path as `record_progress` (no-orphan-resolved, append-only); GitHub OIDC is **not** a prerequisite. Reconciliation runs on gate-view load, on link, and via an admin/leadership sync endpoint.

**Acceptance Criteria (build-ready):**
- Given a linked project and a `governance_events` row with `type='micro'`, `project_id = <github_repo>`, and an `event_code` present in `micro_artifact_mapping` (`is_active=true`) for the project's `project_type` (or `'default'`), when reconciliation runs, then the mapped `micro_artifacts` row is set `status='complete'`, `completed_at = event.created_at`, `completed_by = 'kiro:' || event.actor`.
- Given the mapping key, then it is `event_code` only (`micro_artifact_mapping.UNIQUE(event_code, project_type, phase)`); text/`source_ref` matching is never used.
- Given a micro event whose `event_code` is absent or not in the mapping, then no artifact is changed and the event still surfaces on the timeline (Level 1 unaffected).
- Given reconciliation runs twice with no new events, then it is idempotent (`completed: 0`, no row changed, no duplicate audit).
- Given a `micro_artifacts` row with `manual_override = true`, then reconciliation never changes it (human decision wins).
- Given any auto-completion, then an append-only `micro_artifact_audit` row is written (`action='auto_complete'`, `event_code`, `event_actor`, `actor='system:artifact-sync'`); an admin can reverse via `PATCH /artifacts/{id}` and the reversal is audited (`action='reverse'`).
- Given `POST /api/projects/{projectId}/sync-artifacts`, then admin/leadership → `200 { project_id, matched, completed, skipped }`; other roles → `403 FORBIDDEN`; unknown project → `404`; unlinked project → `200` all-zero.
- Given the MCP runtime DB role (`kiro_mcp_app`), then it holds NO privilege on `micro_artifact_mapping`, `micro_artifacts`, or `micro_artifact_audit` (append-only posture preserved); the auto-completion `UPDATE` runs only under `kiro_phase2`.
- Given a completed artifact, then the UI shows a `kiro` source badge when `completed_by` starts with `kiro:` and a manual indicator otherwise; the manual status toggle remains available as override.

---

## 10. Definition of Done

- [ ] `event_code` vocabulary constant (16 codes) + shared type field; `record_progress` persists optional `event_code`; unknown codes still persist.
- [ ] V008 migration: `governance_events.event_code` (+index), `micro_artifacts.manual_override`, seeded `micro_artifact_mapping` (16 rows), `micro_artifact_audit`, explicit grants; `kiro_mcp_app` proven to hold NO Level-2 privilege; verify script passes.
- [ ] `reconcileMicroArtifacts` deterministic, idempotent, own-repo-scoped, override-respecting, audited; runs under `kiro_phase2`; never touches `governance_events`.
- [ ] Triggers: gate-view (best-effort, non-blocking), link-time (best-effort), explicit `POST /sync-artifacts` (admin/leadership).
- [ ] Manual override sets `manual_override` + audit; `reset_to_auto` re-enables (admin/leadership).
- [ ] UI: `kiro` badge (auto vs manual), override chip, sync button; WCAG AA; RBAC gating (UX only).
- [ ] SRS FR-P2-042 activated (Deferred→Must, OIDC removed, trust model + ACs); data-model + gates-architecture updated.
- [ ] `npm run format && npm run lint && npm run type-check` clean; all tests pass.
- [ ] **Not deployed. V008 not run against live DB.**

---

## 11. Read-Only DB Access Path (discovery — Task 1)

Verified read-only via AWS CLI profile `ceanalytics` (account `713554442614`, `us-east-1`) on 2026-07-07. **No mutations performed.**

| Item | Value |
|------|-------|
| DB instance id | `kirogovernancestack-governancedb222ac1c0-zylylm08i7to` |
| Endpoint | `kirogovernancestack-governancedb222ac1c0-zylylm08i7to.c2hys06m2tn2.us-east-1.rds.amazonaws.com:5432` |
| Engine | PostgreSQL **16.13**, `db.t3.micro`, single-AZ (`us-east-1f`) |
| Database name | `kiro_governance` |
| **Master username** | **`kiro_mcp`** (RDS master / `rds_superuser` — admin & migrations only; NOT the runtime writer per V005) |
| IAM DB auth | Enabled (`rds-db:connect` for `kiro_mcp_app`, `kiro_phase2`) |
| Publicly accessible | **true** |
| Storage encrypted | false · Deletion protection: **true** · Backups: 7-day |
| VPC / SG | `vpc-044a3d389fdef6906` / `sg-06408cd19ebeeb182` (`kiro-gov-rds-sg`) |

**Migration access path.** The instance is `PubliclyAccessible = true` and its security group `sg-06408cd19ebeeb182` allows TCP 5432 from `0.0.0.0/0` (and a dev IP `154.192.120.52/32` + the MCP/app SGs). **No bastion or SSM tunnel is required** — migrations can be applied by connecting directly to the public endpoint with `psql`, authenticating as the RDS master `kiro_mcp` (password) or via RDS IAM auth, and running V008 as / via `SET ROLE kiro_migrator` (per the V005 ownership model, DDL must be owned by `kiro_migrator`).

> ⚠️ **Security findings (read-only, flagged — not acted on):** (1) `sg-06408cd19ebeeb182` exposes port 5432 to `0.0.0.0/0` on a publicly-accessible instance — the DB is reachable from the entire internet; recommend restricting ingress to the dev IP + app/MCP SGs and setting `PubliclyAccessible=false`. (2) `StorageEncrypted=false` on a governance store. Both are pre-existing infrastructure issues outside this CR's scope; recommend a follow-up hardening ticket. Migrations for this CR do **not** depend on the open ingress — a VPC-internal or dev-IP-scoped path is sufficient and preferred.

---

*End of CR-12/14 Level-2 Spec — code + tests only; do not deploy.*
