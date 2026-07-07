# Implementation Spec: CR-02 — Projects API Linkage Retrofit (GitHub ↔ dual-Slack)

**Story ID:** CR-02
**Feature:** GitHub–Slack Linkage (Phase 2 DeliverPro) — API half of FR-P2-033..041 (Level 1)
**Sprint:** Sprint 9 (Phase 2)
**Owner:** Backend Developer
**Story points:** 5
**Depends on:** CR-01 (`V004__github_slack_linkage.sql` — 6 nullable columns, `uq_projects_github_repo`, `project_link_audit` + BEFORE UPDATE & AFTER INSERT audit triggers) · CR-01A (`V005__append_only_hardening.sql` — `kiro_phase2` app-role DML re-grant on `projects` + `project_link_audit`)
**Blocks:** CR-03 (frontend linkage UI), CR-05 (`notify_slack` dual-channel routing consumes the stored channel ids)
**Scope:** Code + tests only. **Do not deploy.**

---

## 1. Overview

Retrofit the existing `projects` API to read and mutate the four V004 linkage fields — `github_repo`, `github_url`, `slack_micro_channel_id`, `slack_macro_channel_id` — plus surface the audit columns `updated_by` / `updated_at`.

The database half (columns, partial unique index, `project_link_audit` table, and the two audit triggers) is already delivered by CR-01. **This story is the application half only:** extend the shared types, Zod schemas, and the three projects handlers (`GET /{projectId}`, `POST /`, `PATCH /{projectId}`) so the API accepts and returns the linkage fields under the correct authorization, validation, uniqueness, and audit rules.

**What this story does NOT do:**

- No schema/migration changes (CR-01/CR-01A own the DB).
- No Slack channel provisioning at link time (FR-P2-039 / projects-architecture §12.4 — separate story; this story stores channel ids the operator supplies).
- No `notify_slack` / `record_progress` MCP changes (Phase-1 CRs).
- No `v_timeline` repoint (separate timeline-reconciliation CR).
- `ProjectSummary` (list endpoint contract, projects-architecture §2.1) is **unchanged** — linkage fields are returned on the **detail** `GET /{projectId}` only.

**Sources of truth:**

- `docs/phase2/projects-architecture.md` §2.2 (POST), §2.3 (GET detail), §2.4 (PATCH), §12.1–§12.3 (authz / validation / audit), §12.5 (re-pointing)
- `docs/phase2/architecture/unified-data-model.md` §4.4 (V004 columns, `uq_projects_github_repo`, `project_link_audit`, triggers, PII inventory)
- `migrations/V004__github_slack_linkage.sql` (deployed trigger contract — the handler relies on it for audit rows)
- `docs/code-structure.md` (monorepo layout, handler pattern, `@kiro-governance/shared/*` imports, error shape, naming)

---

## 2. Files Touched

| File | Change |
|------|--------|
| `packages/projects/types.ts` | Add linkage fields to `Project`, `CreateProjectInput`, `UpdateProjectInput`; add `LINKAGE_FIELDS` const + `LinkageField` type |
| `packages/projects/handlers/get-project.ts` | Add 6 columns to detail SELECT + response mapping |
| `packages/projects/handlers/create-project.ts` | Zod linkage fields; linkage-authz gate; validation; cross-column + uniqueness guard; INSERT linkage cols + `updated_by`; map response |
| `packages/projects/handlers/update-project.ts` | Zod linkage fields; `jira_key` immutability 422; linkage-authz gate; validation; cross-column + uniqueness guard (409); set `updated_by`/`updated_at`; map linkage cols in all SELECTs |
| `packages/projects/services/linkage.service.ts` | **New** — shared linkage helpers: `assertLinkageAuthz`, `assertNoCrossColumnCollision`, `mapPgUniqueViolation`, linkage-field detection |
| `specs/api/projects.yaml` | **New/updated** — OpenAPI: add linkage fields to schemas + new error codes (see §7) |
| `packages/projects/__tests__/handlers/update-project.test.ts` | **New** — authz 403, validation, uniqueness 409, immutable 422, audit-row assertions |
| `packages/projects/__tests__/handlers/create-project.test.ts` | **New/updated** — linkage on create: authz, validation, uniqueness, create-path audit |
| `packages/projects/__tests__/services/linkage.service.test.ts` | **New** — unit tests for each helper |

> `packages/projects/handlers/list-projects.ts` is **not** changed — `ProjectSummary` does not carry linkage fields (architecture §2.1).

---

## 3. TypeScript Types (`packages/projects/types.ts`)

Add the linkage fields to the three interfaces. All fields optional/nullable (feature switch — a project with `github_repo = NULL` behaves exactly as today).

```typescript
// --- Project (detail GET response) — append after existing fields ---
export interface Project {
  // ... existing fields unchanged ...
  github_repo: string | null;
  github_url: string | null;
  slack_micro_channel_id: string | null;
  slack_macro_channel_id: string | null;
  updated_by: string | null;   // Cognito sub of last linkage mutator
  updated_at: string | null;   // ISO timestamp of last linkage mutation
}

// --- CreateProjectInput — append (all optional) ---
export interface CreateProjectInput {
  // ... existing fields unchanged ...
  github_repo?: string;
  github_url?: string;
  slack_micro_channel_id?: string;
  slack_macro_channel_id?: string;
}

// --- UpdateProjectInput — append (nullable to allow clearing/re-pointing, §12.5) ---
export interface UpdateProjectInput {
  // ... existing fields unchanged ...
  github_repo?: string | null;
  github_url?: string | null;
  slack_micro_channel_id?: string | null;
  slack_macro_channel_id?: string | null;
}

/** The four audited linkage columns. Order is stable for iteration. */
export const LINKAGE_FIELDS = [
  'github_repo',
  'github_url',
  'slack_micro_channel_id',
  'slack_macro_channel_id',
] as const;

export type LinkageField = (typeof LINKAGE_FIELDS)[number];
```

> `updated_by` / `updated_at` are **read-only** in the API — never accepted in a request body; the handler sets them from the JWT and `now()`. They are not added to `CreateProjectInput` / `UpdateProjectInput`.

---

## 4. Zod Validation

Add to **both** the create and update schemas. Regexes are copied verbatim from projects-architecture §2.2 / §12.2 and unified-data-model §4.4.1.

```typescript
const GITHUB_REPO_RE = /^[A-Za-z0-9._-]{1,100}$/;
const GITHUB_URL_RE = /^https:\/\/github\.com\/[A-Za-z0-9._/-]{1,200}$/;
const SLACK_CHANNEL_RE = /^[A-Za-z0-9]{1,64}$/; // non-secret channel id shape (e.g. C0123ABCD); never a token/webhook

// CreateProjectInputSchema — optional (feature switch OFF when omitted)
github_repo: z.string().regex(GITHUB_REPO_RE, 'github_repo must match ^[A-Za-z0-9._-]{1,100}$').optional(),
github_url: z.string().regex(GITHUB_URL_RE, 'github_url must be an https://github.com/… URL').optional(),
slack_micro_channel_id: z.string().regex(SLACK_CHANNEL_RE).optional(),
slack_macro_channel_id: z.string().regex(SLACK_CHANNEL_RE).optional(),

// UpdateProjectInputSchema — .nullable() to allow clearing / re-pointing (§12.5)
github_repo: z.string().regex(GITHUB_REPO_RE, 'github_repo must match ^[A-Za-z0-9._-]{1,100}$').nullable().optional(),
github_url: z.string().regex(GITHUB_URL_RE, 'github_url must be an https://github.com/… URL').nullable().optional(),
slack_micro_channel_id: z.string().regex(SLACK_CHANNEL_RE).nullable().optional(),
slack_macro_channel_id: z.string().regex(SLACK_CHANNEL_RE).nullable().optional(),
```

**ZodError → field-scoped 400 (mandatory improvement).** The current handlers catch `z.ZodError` and return a generic `ValidationError('Invalid request body', {})` with empty details. Replace with a helper that surfaces the offending field so validation failures return the exact field (required by the testing checklist and by the §7 error contract):

```typescript
// packages/shared/middleware/error-handler.ts (or a local helper) — reused by both handlers
export function zodToValidationError(err: z.ZodError): ValidationError {
  const details: Record<string, string[]> = {};
  for (const issue of err.issues) {
    const key = issue.path.join('.') || '_root';
    (details[key] ??= []).push(issue.message);
  }
  return new ValidationError('Invalid request body', details);
}
```

So an invalid `github_url` yields:

```json
{ "code": "VALIDATION_ERROR", "message": "Invalid request body",
  "details": { "github_url": ["github_url must be an https://github.com/… URL"] } }
```

> **`slack_*` regex rationale (Architect decision — not customer-specified):** §12.2 only says "non-secret Slack channel id … never a token or webhook URL." `^[A-Za-z0-9]{1,64}$` enforces the channel-id shape and structurally rejects webhook URLs (which contain `/` and `:`) and `xoxb-`/`xapp-` tokens (which contain `-`). If the reviewer prefers no format constraint, drop the regex to `z.string().min(1).max(64)` — behaviour is otherwise identical.

---

## 5. Authorization — Linkage Fields Are Admin/Leadership Only (§12.1)

**Rule (projects-architecture §12.1):** changing any of `github_repo`, `github_url`, `slack_micro_channel_id`, `slack_macro_channel_id` is restricted to `admin` or `leadership`, verified on the **Cognito role/group claim** (`AuthContext.role`, which `rbac.ts` derives from `cognito:groups`) — **NOT** the free-text `project_manager` field.

The handler-level `withRoles(['pm','leadership','admin'], …)` wrapper stays as-is (it governs the non-linkage metadata edits). Linkage authz is a **finer-grained in-handler check** applied only when the request actually touches a linkage field:

```typescript
// packages/projects/services/linkage.service.ts
import { AuthContext } from '@kiro-governance/shared/types/auth';
import { ForbiddenError } from '@kiro-governance/shared/middleware/error-handler';
import { LINKAGE_FIELDS } from '../types';

const LINKAGE_ROLES: ReadonlyArray<AuthContext['role']> = ['admin', 'leadership'];

/** True if the request body contains at least one linkage key (even if the value is null). */
export function touchesLinkage(input: Record<string, unknown>): boolean {
  return LINKAGE_FIELDS.some((f) => f in input);
}

/**
 * Enforce §12.1: only admin/leadership may set/clear a linkage field.
 * Uses the Cognito-derived role, never project_manager.
 */
export function assertLinkageAuthz(input: Record<string, unknown>, auth: AuthContext): void {
  if (touchesLinkage(input) && !LINKAGE_ROLES.includes(auth.role)) {
    throw new ForbiddenError('Only admin or leadership may change project linkage');
  }
}
```

- The 403 must carry `{ "code": "FORBIDDEN", "message": "Only admin or leadership may change project linkage" }` (verbatim from §12.1). `ForbiddenError` already sets `code: 'FORBIDDEN'`.
- `touchesLinkage` keys on **presence** (`f in input`), so a `pm` sending `{"github_repo": null}` (attempting to *clear*) is also a 403 — clearing is a linkage mutation.
- The check runs **after** Zod parse and **before** any DB write. Because Zod strips unknown keys, `input` here is the parsed object; presence of a linkage key means the client sent it.
- On PATCH, run `assertLinkageAuthz` **before** the existing PM-ownership check so a non-admin/leadership linkage attempt is rejected regardless of project ownership.

---

## 6. Handler Changes

### 6.1 `GET /api/projects/{projectId}` (get-project.ts)

Add the six columns to the detail SELECT and to the response mapping. No authz change (all read roles keep access; channel ids are non-secret and the Slack **token** is never in this table).

```sql
-- add to the SELECT list in getProject()
      p.github_repo,
      p.github_url,
      p.slack_micro_channel_id,
      p.slack_macro_channel_id,
      p.updated_by,
      p.updated_at,
```

```typescript
// add to the returned object
    github_repo: row.github_repo,
    github_url: row.github_url,
    slack_micro_channel_id: row.slack_micro_channel_id,
    slack_macro_channel_id: row.slack_macro_channel_id,
    updated_by: row.updated_by,
    updated_at: row.updated_at,
```

> `github_url` is rendered by the frontend with `rel="noopener noreferrer"` (SEC-M3, projects-architecture §12.2) — that is a CR-03 concern; the API returns the raw validated value.

### 6.2 `POST /api/projects` (create-project.ts)

A project may be **created already linked**. Steps, in order, inside the existing transaction:

1. Zod parse (now includes linkage fields).
2. `assertLinkageAuthz(input, auth)` — a `pm` supplying any linkage field → **403** (before any DB work).
3. If `github_repo` present: `assertNoCrossColumnCollision(client, github_repo)` (SEC-M4, §6.4) then rely on the partial unique index for repo↔repo collisions.
4. Extend the `INSERT INTO projects (…)` column list + values with the four linkage columns **and** `updated_by` — set `updated_by = auth.userId` **iff** any linkage field is non-null (so the AFTER INSERT trigger `audit_project_linkage_insert` attributes `actor_sub` to the Cognito sub, not `'db_direct'`). Leave `updated_by` NULL when no linkage is set.
5. Wrap the INSERT in the PG-unique-violation mapper (§6.4) → **409 `DUPLICATE_GITHUB_REPO`**.
6. Map the four linkage columns + `updated_by`/`updated_at` from `projectResult.rows[0]` into the returned `Project` (the current handler hand-builds the object — add the fields).

```typescript
// INSERT column list additions (positional params appended after existing ones)
//   github_repo, github_url, slack_micro_channel_id, slack_macro_channel_id, updated_by
const linkagePresent =
  input.github_repo != null || input.github_url != null ||
  input.slack_micro_channel_id != null || input.slack_macro_channel_id != null;

// values:
//   input.github_repo ?? null, input.github_url ?? null,
//   input.slack_micro_channel_id ?? null, input.slack_macro_channel_id ?? null,
//   linkagePresent ? auth.userId : null   // updated_by
```

> The AFTER INSERT trigger writes one `project_link_audit` row per non-NULL linkage field at creation (`old_value = NULL`). The handler does **not** insert audit rows itself.

> `create-project.ts` currently passes `_auth` (unused). Change to `auth` and thread it into `createProject(input, auth)` for the authz check and `updated_by`.

### 6.3 `PATCH /api/projects/{projectId}` (update-project.ts)

Ordered logic (additions in **bold**):

1. Zod parse (now includes nullable linkage fields).
2. **`jira_key` immutability:** if the raw body contains a `jira_key` key → **422 `IMMUTABLE_FIELD`** with `{ "code": "IMMUTABLE_FIELD", "field": "jira_key" }` (FR-P2-033, §2.4). Check the **raw** parsed body before Zod strips it — add `jira_key` to the schema as `z.never().optional()` **or** inspect `body.jira_key` directly prior to `.parse()`. Recommended: inspect `body` (pre-parse) so the error fires even though Zod would otherwise drop the unknown key.
3. Existing `project_type` immutability check (422) — unchanged.
4. **`assertLinkageAuthz(input, auth)`** — non-admin/leadership touching any linkage field → **403 FORBIDDEN** (message per §12.1). Runs **before** the PM-ownership check.
5. Existing PM-ownership check (403) — unchanged.
6. Existing closure-reopen leadership gate — unchanged.
7. **If `github_repo` is being set to a non-null value:** `assertNoCrossColumnCollision(pool, input.github_repo, projectId)` (SEC-M4) → **409 `DUPLICATE_GITHUB_REPO`**.
8. Append linkage columns to the dynamic `updates[]`/`params[]` builder (they follow the exact same `if (input.field !== undefined) { updates.push(...) }` pattern; nullable values pass through so clearing works).
9. **When `touchesLinkage(input)` is true**, also append `updated_by = $n` (value `auth.userId`) and `updated_at = now()` to the `updates[]`. This is what lets the BEFORE UPDATE trigger `audit_project_linkage` derive `actor_sub` from `NEW.updated_by`. Do **not** set `updated_by`/`updated_at` for non-linkage-only edits.
10. Wrap the `UPDATE … RETURNING *` in the PG-unique-violation mapper (§6.4) → **409 `DUPLICATE_GITHUB_REPO`**.
11. Add the six columns to both post-update SELECTs (the "no updates" early-return SELECT **and** the final SELECT) and to the response mapping — same columns as §6.1.

> **Audit is DB-enforced.** The handler never writes `project_link_audit` directly. It sets `updated_by`/`updated_at`; the CR-01 `BEFORE UPDATE` trigger emits exactly one audit row per field where `NEW.<col> IS DISTINCT FROM OLD.<col>`. A PATCH that changes two linkage fields ⇒ two audit rows (FR-P2-034/035).

> **Re-pointing / clearing (§12.5):** setting `github_repo` to a new value or to `null` is a normal linkage mutation — audited, `updated_by`/`updated_at` set. No reprocessing; the timeline join is read-side on the current `github_repo` (out of scope here).

### 6.4 Uniqueness + cross-column collision (`linkage.service.ts`)

```typescript
import { AppError } from '@kiro-governance/shared/middleware/error-handler';

/** Map a Postgres unique-violation on uq_projects_github_repo to 409 DUPLICATE_GITHUB_REPO. */
export function mapPgUniqueViolation(err: unknown): never {
  const e = err as { code?: string; constraint?: string };
  if (e?.code === '23505' && e.constraint === 'uq_projects_github_repo') {
    throw new AppError('DUPLICATE_GITHUB_REPO',
      'github_repo is already linked to another project', 409);
  }
  throw err;
}

/**
 * SEC-M4 cross-column guard: reject a github_repo that equals ANY project's jira_key
 * (keeps the interim collision-safe v_timeline branch injective during the CR-06 window).
 * `selfJiraKey` excludes the row being updated (a project may legitimately share nothing).
 */
export async function assertNoCrossColumnCollision(
  db: { query: (sql: string, params: unknown[]) => Promise<{ rows: unknown[] }> },
  githubRepo: string,
  selfJiraKey?: string,
): Promise<void> {
  const res = await db.query(
    `SELECT 1 FROM projects WHERE jira_key = $1 AND ($2::text IS NULL OR jira_key <> $2) LIMIT 1`,
    [githubRepo, selfJiraKey ?? null],
  );
  if (res.rows.length > 0) {
    throw new AppError('DUPLICATE_GITHUB_REPO',
      'github_repo collides with an existing project key', 409);
  }
}
```

Usage: wrap the INSERT (create) and UPDATE (patch) executions:

```typescript
try {
  // await client.query(INSERT ...) / await pool.query(UPDATE ...)
} catch (err) {
  mapPgUniqueViolation(err); // re-throws non-unique errors unchanged
}
```

> Primary enforcement is the DB partial unique index (`uq_projects_github_repo`) — the mapper turns its `23505` into the domain 409. The `assertNoCrossColumnCollision` pre-check covers the repo==other-jira_key case the unique index cannot (different columns). Both paths return `DUPLICATE_GITHUB_REPO`.

---

## 7. Error Codes (API contract)

| Status | Code | Condition | Endpoint(s) |
|--------|------|-----------|-------------|
| 400 | `VALIDATION_ERROR` | `github_repo` fails `^[A-Za-z0-9._-]{1,100}$`, or `github_url` fails `^https://github\.com/…$`, or `slack_*` fails channel-id shape. `details` names the field. | POST, PATCH |
| 403 | `FORBIDDEN` | Non-admin/leadership user sets/clears any linkage field → `{ "code":"FORBIDDEN", "message":"Only admin or leadership may change project linkage" }` | POST, PATCH |
| 409 | `DUPLICATE_GITHUB_REPO` | `github_repo` already linked to another project (partial unique index) **or** equals another project's `jira_key` (SEC-M4) | POST, PATCH |
| 422 | `IMMUTABLE_FIELD` | Body contains `jira_key` → `{ "code":"IMMUTABLE_FIELD", "field":"jira_key" }` (FR-P2-033). (`project_type` immutability 422 already exists.) | PATCH |
| 404 | `PROJECT_NOT_FOUND`/`NOT_FOUND` | No project with that `jira_key` (existing) | GET, PATCH |

All error bodies follow the existing shape from `error-handler.ts`: `{ code, message, details? }`. New codes use `new AppError(code, message, status, details?)`; `FORBIDDEN` uses the existing `ForbiddenError`.

---

## 8. OpenAPI (`specs/api/projects.yaml`)

Add to the shared `Project` response schema (detail GET) and to the `CreateProjectInput` / `UpdateProjectInput` request schemas:

```yaml
components:
  schemas:
    Project:
      properties:
        # ... existing ...
        github_repo:            { type: string, nullable: true, pattern: '^[A-Za-z0-9._-]{1,100}$' }
        github_url:             { type: string, nullable: true, pattern: '^https://github\.com/[A-Za-z0-9._/-]{1,200}$' }
        slack_micro_channel_id: { type: string, nullable: true }
        slack_macro_channel_id: { type: string, nullable: true }
        updated_by:             { type: string, nullable: true, description: 'Cognito sub of last linkage mutator (read-only)' }
        updated_at:             { type: string, format: date-time, nullable: true, description: 'Read-only' }
    CreateProjectInput:
      properties:
        # ... existing ...
        github_repo:            { type: string, pattern: '^[A-Za-z0-9._-]{1,100}$' }
        github_url:             { type: string, pattern: '^https://github\.com/[A-Za-z0-9._/-]{1,200}$' }
        slack_micro_channel_id: { type: string }
        slack_macro_channel_id: { type: string }
    UpdateProjectInput:
      properties:
        # ... existing ...
        github_repo:            { type: string, nullable: true, pattern: '^[A-Za-z0-9._-]{1,100}$' }
        github_url:             { type: string, nullable: true, pattern: '^https://github\.com/[A-Za-z0-9._/-]{1,200}$' }
        slack_micro_channel_id: { type: string, nullable: true }
        slack_macro_channel_id: { type: string, nullable: true }
```

Document the new responses on POST and PATCH: `403 FORBIDDEN` (linkage), `409 DUPLICATE_GITHUB_REPO`, and (PATCH) `422 IMMUTABLE_FIELD`. `updated_by`/`updated_at` are `readOnly: true` and must not appear in request schemas.

---

## 9. Security & Standards Notes

- **No secret ever stored/returned:** only non-secret channel **ids** are persisted; the Slack **bot token** lives in SSM SecureString (FR-P2-035) and is never a column, response field, or log line. Do not log linkage values beyond field names.
- **Least privilege:** the app authenticates as `kiro_phase2` (DP-01), which holds `INSERT/UPDATE` on `projects` and `INSERT` on `project_link_audit` via the trigger (re-granted in CR-01A/V005). No handler code targets `kiro_mcp`.
- **Parameterized queries only** — all linkage values bound as params (existing pattern). No string interpolation of user input.
- **Authz on Cognito claim, not free-text** — `assertLinkageAuthz` reads `auth.role` (from `cognito:groups`), never `project_manager` (§12.1).
- **TypeScript strict, no `any`** for the new service; the handlers' existing `any` row-mapping pattern is retained locally but new helpers are fully typed.

---

## 10. Testing Checklist

Framework: Jest + `aws-sdk-client-mock` style with a mocked `getPool()` (match `packages/projects/__tests__` conventions). Mock `extractAuthContextFromEvent` / build `context.auth` directly.

**Authorization (403 path) — mandatory**

- [ ] PATCH with `{ github_repo: 'my-repo' }` as `role: 'pm'` → 403 `FORBIDDEN`, message `Only admin or leadership may change project linkage`; **no** UPDATE issued.
- [ ] PATCH with `{ github_repo: null }` (clear attempt) as `pm` → 403 (presence-keyed, not value-keyed).
- [ ] PATCH with `{ slack_micro_channel_id: 'C1' }` as `sa`/`engineer` → 403.
- [ ] PATCH with `{ github_repo: 'r' }` as `admin` and as `leadership` → allowed (no 403).
- [ ] POST with a linkage field as `pm` → 403; as `admin`/`leadership` → allowed.
- [ ] PATCH with only non-linkage fields (`{ title }`) as `pm` who owns the project → 200 (linkage gate not triggered).

**Validation (400)**

- [ ] `github_url: 'http://github.com/x'` (http) → 400, `details.github_url` present.
- [ ] `github_url: 'https://evil.com/github.com'` → 400.
- [ ] `github_repo: 'has space'` / 101-char repo → 400, `details.github_repo`.
- [ ] `slack_micro_channel_id` containing `-`/`/` (token/webhook-shaped) → 400.
- [ ] Valid `github_url: 'https://github.com/org/repo'` + `github_repo: 'repo'` → passes validation.

**Uniqueness conflict (409)**

- [ ] PATCH/POST `github_repo` that another project already holds → PG `23505` on `uq_projects_github_repo` mapped to 409 `DUPLICATE_GITHUB_REPO`.
- [ ] `github_repo` equal to a different project's `jira_key` → 409 `DUPLICATE_GITHUB_REPO` (SEC-M4 pre-check), no INSERT/UPDATE issued.
- [ ] Re-setting a project's `github_repo` to its **own** current value → no false 409 (self excluded).

**Immutability (422)**

- [ ] PATCH body containing `jira_key` → 422 `{ code: 'IMMUTABLE_FIELD', field: 'jira_key' }`.

**Audit row written (integration)**

- [ ] PATCH changing one linkage field → UPDATE sets `updated_by = auth.userId` and `updated_at = now()`; assert exactly **one** `project_link_audit` row (`field`, `old_value`, `new_value`, `actor_sub = auth.userId`).
- [ ] PATCH changing two linkage fields in one call → **two** audit rows, both `actor_sub = auth.userId`.
- [ ] PATCH re-sending an unchanged linkage value (`IS NOT DISTINCT`) → **zero** audit rows for that field.
- [ ] POST creating an already-linked project → AFTER INSERT trigger writes one row per non-NULL linkage field (`old_value = NULL`, `actor_sub = auth.userId`).
- [ ] POST with no linkage → `updated_by` NULL, zero audit rows.

**GET returns fields**

- [ ] `GET /{projectId}` returns all four linkage fields + `updated_by`/`updated_at`; unlinked project returns them as `null`.
- [ ] Response never contains any Slack token/secret (only channel ids).

**Regression**

- [ ] Existing project CRUD, `current_phase`, burn-rate, closure/reopen tests still pass unchanged.
- [ ] `list-projects` `ProjectSummary` shape unchanged (no linkage keys leaked).

**Quality gate**

- [ ] `npm run type-check`, `npm run lint`, `npm run format:check` pass; new helper has no `any`.

---

## 11. Definition of Done

- [ ] Shared `Project`/`CreateProjectInput`/`UpdateProjectInput` types carry the linkage fields; `updated_by`/`updated_at` are read-only (response only).
- [ ] `GET /{projectId}` returns the six columns.
- [ ] `POST` / `PATCH` accept linkage fields with: Zod validation (field-scoped 400), admin/leadership-only authz (403), uniqueness (409 via index + SEC-M4 pre-check), `jira_key` immutability (422 on PATCH).
- [ ] Handlers set `updated_by`/`updated_at` when linkage changes; audit rows are produced by the CR-01 triggers (handler writes none directly).
- [ ] OpenAPI `specs/api/projects.yaml` updated (schemas + new error responses).
- [ ] Tests cover the four mandated cases (authz 403, validation, uniqueness conflict, audit row written) plus regression; coverage ≥80% on changed handlers, 100% on the linkage authz path (auth-sensitive).
- [ ] `type-check` / `lint` / `format:check` green. **Not deployed.**

---

## 12. Traceability

| Requirement | Source | Implemented by |
|-------------|--------|----------------|
| Return linkage fields on GET | projects-architecture §2.3 | §6.1 |
| Accept linkage on POST/PATCH | §2.2, §2.4 | §6.2, §6.3 |
| Admin/leadership-only mutation → 403 | §12.1 | §5 `assertLinkageAuthz` |
| `github_repo`/`github_url` validation → 400 | §12.2 | §4 Zod |
| `github_repo` uniqueness → 409 | §12.1, §12.2, unified-data-model §4.4.2 | §6.4 |
| SEC-M4 cross-column collision | §12.2 | §6.4 `assertNoCrossColumnCollision` |
| Per-field audit + `updated_by`/`updated_at` | §12.3, V004 §D/§D.2 triggers | §6.2, §6.3 (set cols; triggers write rows) |
| `jira_key` immutable → 422 | §2.4 (FR-P2-033) | §6.3 step 2 |
| All fields optional (feature switch) | §12 intro, FR-P2-040 | §3 (optional/nullable), §5 |

---

*End of CR-02 Implementation Spec — code + tests only; do not deploy.*
