# Implementation Spec: CR-16 — Link-Time Gate Detection (repo `project-progress.md` → macro gates)

**Story:** CR-16 (replaces the cancelled CR-06 backfill)
**Feature:** F-05 governance ↔ Phase-2 projects (macro gate resolution)
**Domain:** `packages/projects` (endpoint + services) + `packages/shared` (gate→checkpoint mapping)
**Status:** Spec — code + tests only. **Do NOT deploy. Do NOT run the destructive migration (CR-17).**

**Source of design:**
- `docs/phase2/change-requests/2026-07-02-github-slack-linkage-impact.md` (v3 — Final Design of Record; this CR replaces the cancelled CR-06 backfill)
- `docs/phase2/projects-architecture.md` §12 (linkage), `docs/phase1/github-trigger-architecture.md` §0/§3 (progress-MD parsing)
- Reuses `packages/shared/constants/macro-gates.ts` (`matchGateFromText`, `MACRO_GATES`, `GATE_PHASES`)

**Related:** `specs/phase2/CR-17-fresh-start-cleanup-spec.md` (fresh-start cleanup migration V007 — separate, gated, non-auto-run).

---

## 1. Overview

Today, macro gate completion (`macro_checkpoints.reached_at`) is **app-owned** — set only by the in-app §4 state machine — and the passive `governance_events → v_timeline` join is **display-only** and never auto-completes a gate (FR-P2-041 / gates-architecture §5.3). CR-16 adds a **deliberate, explicit, admin-triggered exception**: when a project's GitHub repo is linked (or on demand), DeliverPro **fetches the repo's `docs/project-progress.md` via the GitHub REST API, parses the resolved macro gates, and idempotently sets the matching `macro_checkpoints.reached_at`** with `reviewed_by = 'system:repo-sync'`.

**Key invariant (documented design change):** the tracker MAY auto-resolve macro gates **only** through this explicit fetch-and-parse sync path (link-time or the sync endpoint). Macro gates are **still not** resolved by the passive `governance_events` timeline join. FR-P2-041 is unchanged for the passive path; CR-16 is a scoped, provenance-tagged, admin-only exception.

### Triggers

| # | Trigger | Behaviour |
|---|---------|-----------|
| T1 | A project's `github_repo` is **set or changed** (create-project / update-project — the CR-02 linkage path) | Best-effort, **non-blocking** background sync (fire-and-forget, mirrors `macro-notify.service`). A sync failure never fails the create/update. |
| T2 | `POST /api/projects/{projectId}/sync-gates` (**admin/leadership only**) | Synchronous sync; returns `{ matched, resolved, skipped }`. |

Both triggers call the same `syncGatesFromRepo(projectId)` service. Idempotent — re-running never double-completes.

---

## 2. Files Touched

| File | Change |
|------|--------|
| `packages/shared/constants/gate-checkpoint-map.ts` | **NEW** — deterministic `GATE_TO_CHECKPOINT` lookup (canonical `MacroGate` → `macro_checkpoints.checkpoint_name`). Config/lookup, not fuzzy. |
| `packages/shared/index.ts` | Export `GATE_TO_CHECKPOINT`, `resolveCheckpointForGate`. |
| `packages/projects/services/github.service.ts` | **NEW** — GitHub REST fetch of `docs/project-progress.md` via SSM read token; owner/repo resolution; 404/private/rate-limit handling; token caching; no token leak. |
| `packages/projects/services/progress-tracker.parser.ts` | **NEW** — pure function `parseResolvedGates(markdown) → Set<MacroGate>` (checked `[x]` / “approved by” markers + `matchGateFromText`). |
| `packages/projects/services/gate-sync.service.ts` | **NEW** — `syncGatesFromRepo(projectId, actor)` orchestrator: fetch → parse → map → idempotent UPDATE → `{ matched, resolved, skipped }`; `triggerLinkTimeSync(projectId, actor)` fire-and-forget wrapper. |
| `packages/projects/handlers/sync-gates.ts` | **NEW** — `POST /api/projects/{projectId}/sync-gates` handler (admin/leadership). |
| `packages/projects/handlers/create-project.ts` | Add best-effort `triggerLinkTimeSync` after create when `github_repo` is set. |
| `packages/projects/handlers/update-project.ts` | Add best-effort `triggerLinkTimeSync` after a `github_repo` set/change. |
| `packages/projects/index.ts` | Export `syncGatesHandler`, new services. |
| `packages/projects/types.ts` | Add `SyncGatesResponse`. |
| `specs/api/projects.yaml` | Add `POST /api/projects/{projectId}/sync-gates` (200 `SyncGatesResponse`, 403, 404). |
| `infra/stacks/deliverpro-lambdas-stack.ts` | Wire route + Lambda; grant `ssm:GetParameter`+`kms:Decrypt` scoped to the single read-token ARN. |
| `packages/projects/README.md` | Document env vars, SSM path, IAM. |
| `.env.example` | Add `GITHUB_READ_TOKEN_SSM_PATH`, `GITHUB_DEFAULT_OWNER` (optional). |
| **Tests** (see §9) | Parser unit tests, gate-checkpoint-map unit tests, github.service unit tests (mocked SSM + fetch), gate-sync.service unit tests (mocked pg + fetch), sync-gates handler tests. |

---

## 3. GitHub READ Token (new SSM credential)

- **SSM SecureString path:** `/kiro-governance/github/read-token` (single value; **secret**).
- **Least privilege:** a GitHub **fine-grained PAT / GitHub App installation token** scoped to **Contents: Read-only** on the org's repositories. No write, no admin. (This is the only new credential.)
- **Never** stored in PG, returned by an API, or written to a log line — mirrors `slack-provisioning.service.ts` and the runtime bot token.
- Loaded once, **cached in memory with a 5-minute TTL** (single-slot cache, `__resetGithubTokenCache()` test helper).
- IAM: the sync Lambda role gets `ssm:GetParameter` + `kms:Decrypt` scoped to the **single token parameter ARN only** (not a `/kiro-governance/*` wildcard).

```typescript
// packages/projects/services/github.service.ts (shape)
export const GITHUB_READ_TOKEN_SSM_PATH = '/kiro-governance/github/read-token';

export class GithubFetchError extends Error {
  constructor(public readonly code: string, message: string) { super(message); this.name = 'GithubFetchError'; }
}

/** Non-secret result. `content` is null for a graceful no-op (missing file / unlinked). */
export interface ProgressFileResult { content: string | null; reason?: string; }
```

---

## 4. FETCH — GitHub REST API

**Endpoint:** `GET https://api.github.com/repos/{owner}/{repo}/contents/docs/project-progress.md`
Headers: `Authorization: Bearer <token>`, `Accept: application/vnd.github.raw+json` (returns the raw file body directly), `X-GitHub-Api-Version: 2022-11-28`, `User-Agent: deliverpro-gate-sync`.

**Owner/repo resolution (deterministic):**
1. `repo` = `projects.github_repo`.
2. `owner` = parsed from `projects.github_url` (`^https://github\.com/([A-Za-z0-9._-]+)/...`), else fall back to `GITHUB_DEFAULT_OWNER` env var. If neither yields an owner → `{ content: null, reason: 'owner_unresolved' }` (no-op).

**Response handling (all non-throwing → graceful no-op unless noted):**

| Condition | Behaviour |
|-----------|-----------|
| `200` | Return `{ content: <raw markdown> }`. |
| `404` (file or repo not found / no access) | `{ content: null, reason: 'file_not_found' }` — **no-op** (per task). |
| `401` / `403` **without** rate-limit headers (auth/permission) | throw `GithubFetchError('GITHUB_FORBIDDEN', ...)` — secret-free message. |
| `403`/`429` with `X-RateLimit-Remaining: 0` or `Retry-After` | throw `GithubFetchError('GITHUB_RATE_LIMITED', ...)` — surfaced as a retriable error; endpoint returns 503-style reason, link-time trigger just logs+continues. |
| network error / timeout (5s) | throw `GithubFetchError('GITHUB_NETWORK_ERROR' | 'GITHUB_TIMEOUT', ...)`. |
| unlinked project (`github_repo IS NULL`) | short-circuit before any fetch → `{ content: null, reason: 'not_linked' }`. |

Private repos are supported transparently — the token grants Contents:Read access. **No token, owner path, or URL is ever echoed into an error `code`/message or a log.**

---

## 5. PARSE — resolved macro gates (pure, deterministic)

`parseResolvedGates(markdown: string): Set<MacroGate>` — a **pure** function (no I/O), fully unit-testable.

Algorithm (line by line):
1. A line is a **resolution marker** if it matches **either**:
   - a completed task-list item: `/^\s*[-*]\s*\[x\]\s+/i` (checked `[x]`), **or**
   - it contains the phrase `approved by` (case-insensitive).
2. For each resolution-marker line, run `matchGateFromText(line)` (shared). If it returns a canonical `MacroGate`, add it to the result set.
3. Non-marker lines and marker lines with no gate match are ignored.

> Rationale: the tracker records resolved gates as `- [x] 1.4 SRS approved …`, `- [x] Design docs approved by Faraz`, `- [x] Implementation plan approved by Faraz` (verified in `docs/project-progress.md`). Only **resolved** lines count — an unchecked `- [ ] … SRS approved` line is ignored. This keeps the parse deterministic and avoids resolving gates that are merely mentioned.

**Result:** a de-duplicated `Set<MacroGate>` of resolved canonical gates.

---

## 6. MAP + APPLY — idempotent `macro_checkpoints` completion

### 6.1 Gate → checkpoint mapping (`packages/shared/constants/gate-checkpoint-map.ts`)

`macro_checkpoints` rows are CASDM checkpoints (e.g. `Working SRS reviewed by SA`), whose vocabulary differs from the 10 canonical `MACRO_GATES`. CR-16 uses an **explicit, deterministic config lookup** (NOT fuzzy matching):

```typescript
import { MacroGate } from './macro-gates';

/**
 * Canonical macro gate → macro_checkpoints.checkpoint_name (CASDM template).
 * Config/lookup only. A gate with no confident checkpoint is intentionally
 * OMITTED — such a resolved gate is counted as `skipped` (never guessed).
 * Architect decision — not customer-specified; product to confirm completeness.
 */
export const GATE_TO_CHECKPOINT: Partial<Record<MacroGate, string>> = {
  'Discovery outputs validated':  '5 outputs reviewed by SA',
  'SRS approved':                 'Working SRS reviewed by SA',
  'Design docs approved':         'Technically validate 6 design docs with spec strategy by SA',
  'Implementation plan approved': 'Implementation Plan Review (Transcript Analysis)',
  'Code approved':                'Review 3 generated outputs by Tech Lead',
  'UAT report approved':          'Validate performance, security, compliance by Tech Lead',
  'Runbooks approved':            'Validate customer documentation by Tech Lead',
  // Intentionally unmapped (no confident 1:1 CASDM checkpoint) → counted as `skipped`:
  //   'Preliminary SRS validated', 'Spec strategy approved', 'Project documentation approved'
};

export function resolveCheckpointForGate(gate: MacroGate): string | undefined {
  return GATE_TO_CHECKPOINT[gate];
}
```

> Unmapped gates are surfaced in the `skipped` count so the mapping's incompleteness is observable rather than silently swallowed. Extending the map (or moving it to `casdm_config`) is a follow-up; keeping it a typed constant makes it deterministic and unit-testable now.

### 6.2 Apply (idempotent, provenance-tagged)

For each resolved gate that maps to a checkpoint name, run one guarded UPDATE per project:

```sql
UPDATE macro_checkpoints
   SET reached_at   = now(),
       reviewed_by  = 'system:repo-sync',
       result_detail = COALESCE(result_detail,
                        'Auto-resolved from repo docs/project-progress.md by repo-sync')
 WHERE project_id      = $1            -- projects.jira_key
   AND checkpoint_name = $2            -- GATE_TO_CHECKPOINT[gate]
   AND reached_at IS NULL              -- IDEMPOTENT: only complete not-already-resolved gates
RETURNING id;
```

**Idempotency & counting** — one pass over the resolved-gate set:

| Bucket | Definition |
|--------|-----------|
| `matched` | resolved gates that both (a) map via `GATE_TO_CHECKPOINT` and (b) have a corresponding `macro_checkpoints` row for the project. |
| `resolved` | of `matched`, those whose row was `reached_at IS NULL` and is now set by this run (UPDATE affected 1 row). |
| `skipped` | resolved gates that are unmapped, OR mapped but the checkpoint row is missing for the project, OR already resolved (`reached_at` already set — re-sync no-op). |

Re-running the sync produces the same end state with `resolved = 0` (all already set) — proving idempotency.

**Provenance / append-only note:** `reviewed_by = 'system:repo-sync'` is the completion provenance (distinguishable from human/`system` app completions). This UPDATE runs under the Phase-2 app DB role (`kiro_phase2`), never `kiro_mcp` (which is append-only, SEC-H1). It does **not** touch `governance_events`.

### 6.3 Relationship to FR-P2-041 (must document)

- The passive `governance_events → v_timeline` join remains **display-only** and still never sets `reached_at`. FR-P2-041 is unchanged for that path.
- CR-16 is the **only** sanctioned path by which the tracker auto-resolves macro checkpoints, and only when **explicitly** invoked (link-time or the admin endpoint). This is a deliberate design change recorded in the SRS delta (FR-P2-043).

---

## 7. Endpoint & Authorization

`POST /api/projects/{projectId}/sync-gates` — **admin / leadership only**.

```typescript
// packages/projects/handlers/sync-gates.ts (shape)
export const handler = withRoles(['admin', 'leadership'], async (event, context) => {
  const projectId = event.pathParameters?.projectId;
  if (!projectId) throw new ValidationError('projectId is required');
  const summary = await syncGatesFromRepo(projectId, context.auth.userId); // { matched, resolved, skipped }
  return ok(summary);
});
```

- Reuses `withRoles(['admin','leadership'])` (same role set as linkage mutation in `linkage.service.ts`). A `pm`/`sa`/`engineer` caller → `403 FORBIDDEN`.
- `404 NOT_FOUND` if the project does not exist.
- If the project is unlinked → `200 { matched: 0, resolved: 0, skipped: 0 }` (graceful; `reason` in the structured log only).
- Rate-limit / GitHub errors → `503 { code: 'REPO_SYNC_UNAVAILABLE' }` (secret-free); the actor can retry.

`SyncGatesResponse`:

```typescript
export interface SyncGatesResponse {
  project_id: string;
  matched: number;
  resolved: number;
  skipped: number;
}
```

### Link-time trigger (T1)

`triggerLinkTimeSync(projectId, actor)` wraps `syncGatesFromRepo` in a try/catch that **always resolves** (mirrors `notifyMacroGateApproved`): logs `GATE_SYNC_RESULT` / `GATE_SYNC_FAILED` and never throws. Called from `create-project.ts` / `update-project.ts` **after commit**, only when `github_repo` is set/changed. A sync failure never fails the create/update.

---

## 8. Security

- **Token isolation:** GitHub read token only in SSM SecureString; IAM scoped to the single ARN; 5-min cache; never logged/returned. `GithubFetchError.code` values are secret-free machine codes.
- **AuthZ:** sync endpoint is admin/leadership-only (Cognito-derived `auth.role`, never the free-text `project_manager`).
- **Own repo only:** sync always targets the requested project's own `github_repo`/`github_url` — the caller cannot pass an arbitrary repo; the repo is read from the project row, never from request input.
- **Audit:** every sync writes a structured CloudWatch log `GATE_SYNC` with `{ projectId, actor, matched, resolved, skipped }` (no token, no URL secrets). Completion provenance is additionally captured in `macro_checkpoints.reviewed_by = 'system:repo-sync'`.
- **No new public surface**; no change to append-only `governance_events` or the `kiro_mcp` role.
- **SSRF guard:** owner/repo are validated against `^[A-Za-z0-9._-]+$` before URL construction; the host is hard-pinned to `api.github.com` (never built from `github_url`).

---

## 9. Testing (code + tests only — no deploy)

| Test file | Asserts |
|-----------|---------|
| `packages/shared/constants/__tests__/gate-checkpoint-map.test.ts` | mapping is stable; every mapped value is a real CASDM checkpoint name; `resolveCheckpointForGate` returns undefined for unmapped gates. |
| `packages/projects/__tests__/services/progress-tracker.parser.test.ts` | `- [x] SRS approved` → `{SRS approved}`; `- [ ] SRS approved` (unchecked) → `∅`; `Design docs approved by Faraz` → `{Design docs approved}`; multiple gates de-duplicated; non-gate lines ignored; alias lines (`spec file approved`) map via shared aliases. |
| `packages/projects/__tests__/services/github.service.test.ts` | 200 returns content; 404 → `{content:null, reason:'file_not_found'}`; rate-limit → `GITHUB_RATE_LIMITED`; token never in error/log (spy on logger); token cached (one SSM call for two fetches); owner parsed from `github_url`. |
| `packages/projects/__tests__/services/gate-sync.service.test.ts` | end-to-end with mocked fetch+pg: `{matched,resolved,skipped}` correct; **re-run is idempotent** (`resolved:0`); unmapped gate → `skipped`; already-resolved checkpoint → `skipped`; unlinked project → all zero; UPDATE uses `reached_at IS NULL` guard and `reviewed_by='system:repo-sync'`. |
| `packages/projects/__tests__/handlers/sync-gates.test.ts` | admin/leadership → 200 summary; pm/sa → 403; unknown project → 404; GitHub rate-limit → 503 `REPO_SYNC_UNAVAILABLE`; response contains no secret. |

Pre-merge quality gate: `npm run format && npm run lint && npm run type-check` all pass.

---

## 10. Definition of Done

- [ ] `GATE_TO_CHECKPOINT` shared constant + `resolveCheckpointForGate` exported; reuses `MacroGate`.
- [ ] `parseResolvedGates` pure, reuses `matchGateFromText`, only counts resolved (`[x]` / "approved by") lines.
- [ ] `github.service` fetches via SSM token, handles 404 (no-op) / private / rate-limit; token cached; never leaked.
- [ ] `syncGatesFromRepo` idempotent; sets `reached_at` + `reviewed_by='system:repo-sync'` only where `reached_at IS NULL`; returns `{matched,resolved,skipped}`.
- [ ] Link-time trigger is best-effort/non-blocking; sync endpoint admin/leadership-only; own-repo-only.
- [ ] FR-P2-041 unchanged for the passive path; CR-16 exception documented in SRS delta (FR-P2-043).
- [ ] OpenAPI + IAM (single-ARN token grant) updated; tests pass; format/lint/type-check clean.
- [ ] **Not deployed.**
