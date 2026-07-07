# Projects Domain

Manages project lifecycle: creation, metadata management, CASDM phase progression, onboarding checklists, resource budget tracking, Jira CST import, and project closure workflows.

## API Endpoints

| Method | Path | Handler | Roles |
|--------|------|---------|-------|
| GET | `/api/projects` | `list-projects.ts` | pm, sa, engineer, leadership, admin |
| GET | `/api/projects/{projectId}` | `get-project.ts` | pm, sa, engineer, leadership, admin |
| POST | `/api/projects` | `create-project.ts` | pm, leadership, admin |
| PATCH | `/api/projects/{projectId}` | `update-project.ts` | pm, leadership, admin |
| PATCH | `/api/projects/{projectId}/hours` | `update-hours.ts` | pm, leadership, admin |
| POST | `/api/projects/import-jira` | `import-jira.ts` | admin |
| GET | `/api/projects/{projectId}/checklist` | `list-checklist.ts` | pm, sa, engineer, leadership, admin |
| PATCH | `/api/projects/{projectId}/checklist/{itemId}` | `update-checklist-item.ts` | pm, sa, leadership, admin |
| POST | `/api/projects/{projectId}/slack/provision` | `provision-slack-channels.ts` | admin, leadership |
| POST | `/api/projects/{projectId}/sync-gates` | `sync-gates.ts` | admin, leadership |

## Database Tables

| Table | Purpose | Keys |
|-------|---------|------|
| `projects` | Core project metadata | `jira_key` (PK), unique constraint on key |
| `onboarding_checklist_items` | 9 onboarding items per project | `project_id` FK to projects |
| `macro_checkpoints` | CASDM phase gates (owned by gates domain) | `project_id` FK to projects |
| `micro_artifacts` | Phase deliverables (owned by gates domain) | `project_id` FK to projects |
| `casdm_config` | Template configuration | project_type, phase, item_name |

## Environment Variables

| Variable | Purpose | Example |
|----------|---------|---------|
| `DATABASE_URL` | PostgreSQL connection | `postgresql://user:pass@host:5432/db` |
| `AWS_REGION` | AWS region for SSM/Secrets Manager | `us-east-1` |

## Features

### Project CRUD
- Create new projects with auto-generated keys (DP-001, DP-002, ...)
- Fetch project details with computed current_phase
- Update project metadata (immutable project_type)
- List projects with filters and cursor pagination

### CASDM Template Seeding
- On creation, seed micro_artifacts and macro_checkpoints from casdm_config
- Support multiple project_type templates (AppDev, App Mod/Migration, etc)
- Fallback to 'default' template if project_type not configured

### Onboarding Checklist
- 9 hardcoded items seeded on project creation
- Mark items complete/incomplete
- Auto-complete macro checkpoint when all 9 items checked
- Auto-clear checkpoint when any item is unchecked

### Hours Tracking
- Update hours_consumed (resource budget tracking)
- Compute burn_rate_pct = (hours_consumed / sow_hours) * 100
- Support null sow_hours (returns null burn_rate_pct)

### Jira CST Import
- One-time admin-only import from Jira board
- Guard via SSM Parameter to prevent re-execution
- Field mapping: Jira customfields → projects columns
- ON CONFLICT DO NOTHING for duplicates
- Returns import summary with error list

### Phase Progression
- `current_phase` computed at query time (not stored)
- Based on which CASDM macro checkpoints have reached_at set
- Phases: Phase 0, Phase 1, Phase 2, Phase 3, Phase 4

## Testing

All handlers tested via integration tests using mocked database and AWS services.

```bash
npm test -w packages/projects
```

## See Also

- [projects-architecture.md](../../docs/phase2/projects-architecture.md) — Full spec
- [types.ts](./types.ts) — TypeScript interfaces
- [migrations/V003__phase2_additions.sql](../../migrations/V003__phase2_additions.sql) — Schema

## CR-05 — Slack Channel Provisioning & Two-Token Split (SEC-M1)

The `POST /api/projects/{projectId}/slack/provision` endpoint (admin/leadership only) resolves or
creates the project's micro + macro Slack channels and persists the resulting channel ids via the
CR-02 audited linkage path. Source: `docs/phase2/projects-architecture.md` §12.4 (FR-P2-039);
`docs/phase1/mcp-server-core-architecture.md` §0 overlay + §7.1.

### Two SSM SecureString parameters (never in code / logs / PG / responses)

| SSM Path | Scope | Held by | Read by (IAM) |
|----------|-------|---------|---------------|
| `/kiro-governance/slack/provisioning-token` | `channels:read` + `channels:manage` (NO `admin.*`) | **This link/onboarding provisioning Lambda only** | `provision-slack-channels` Lambda role |
| `/kiro-governance/slack/bot-token` | `chat:write` only (NO channel management) | MCP server runtime `notify_slack` | MCP server role only |

The two credentials are distinct secrets at distinct paths. A compromise of the always-loaded
runtime `chat:write` token cannot create/rename channels; the higher-privilege provisioning
credential is read only by this endpoint. Neither carries any `admin.*` scope. Only the
(non-secret) paths are committed — the token values live only in SSM SecureString (default
`aws/ssm` KMS key) and are provisioned out-of-band (`ssm:PutParameter`, admin).

### IAM (documentation only — infra not edited here; do NOT deploy)

The provisioning Lambda's execution role must be granted, scoped to the **single provisioning-token
parameter ARN only** (never a `/kiro-governance/*` wildcard):

```jsonc
// packages/projects/infra.ts (or the DeliverPro stateless stack) — to be wired by construct-developer
{
  "Effect": "Allow",
  "Action": ["ssm:GetParameter"],
  "Resource": "arn:aws:ssm:<region>:<account>:parameter/kiro-governance/slack/provisioning-token"
},
{
  "Effect": "Allow",
  "Action": ["kms:Decrypt"],
  "Resource": "<KMS key ARN backing the SecureString>",  // aws/ssm default, or the optional CMK
  "Condition": { "StringEquals": { "kms:ViaService": "ssm.<region>.amazonaws.com" } }
}
```

- The provisioning Lambda MUST NOT be granted read on `/kiro-governance/slack/bot-token`.
- The MCP `notify_slack` runtime role MUST NOT be granted read on the provisioning-token ARN
  (it keeps its existing bot-token-only, single-ARN `ssm:GetParameter` + `kms:Decrypt`).
- No `ssm:PutParameter` on either role — token rotation is admin/out-of-band.

### Route wiring (documentation only)

Wire `provisionSlackChannelsHandler` (exported from `packages/projects/index.ts`) to
`POST /api/projects/{projectId}/slack/provision` with the Cognito authorizer, matching the existing
project routes. Not added to a live stack in this change (do-not-deploy).

### Idempotency

Provisioning is idempotent: `conversations.list` resolves any existing channel by its deterministic
name (`{jira_key}-micro` / `{jira_key}-macro`), so a re-run never creates a duplicate. When the
resolved ids already equal the stored ids, the endpoint performs no `UPDATE` (`persisted: false`),
so no redundant `project_link_audit` row is written.

### Provisioning UI

The admin/leadership provisioning trigger UI is **CR-15** (frontend). This change delivers only the
backend endpoint + service it calls.

## CR-16 — Link-Time Gate Detection (repo `docs/project-progress.md` → macro gates)

`POST /api/projects/{projectId}/sync-gates` (admin/leadership only) and a best-effort link-time
trigger (on create/update when `github_repo` is set/changed) fetch the project's linked repo
`docs/project-progress.md`, parse the RESOLVED macro gates, map them to CASDM `macro_checkpoints`,
and idempotently set `reached_at` with `reviewed_by = 'system:repo-sync'`. Returns
`{ project_id, matched, resolved, skipped }`. Source: `specs/phase2/CR-16-link-time-gate-detection-spec.md`.

This is the **only** sanctioned macro-gate auto-resolution path, and only when explicitly invoked.
The passive `governance_events → v_timeline` join stays display-only (FR-P2-041 unchanged).

### GitHub READ token (new SSM SecureString)

| SSM Path | Scope | Read by (IAM) |
|----------|-------|---------------|
| `/kiro-governance/github/read-token` | **Contents: Read-only** fine-grained PAT, or (preferred) a repo-scoped **GitHub App installation token** | shared DeliverPro Lambda role — single-ARN grant |

- The token is never in code, an env var, a PG column, an API response, or a log line — only the
  non-secret SSM path is committed. Loaded once, cached in-memory (5-min TTL).
- IAM: `ssm:GetParameter` on the **single token ARN only** (never `/kiro-governance/*`) plus
  `kms:Decrypt` gated by `kms:ViaService = ssm.<region>.amazonaws.com` (wired in
  `infra/stacks/deliverpro-lambdas-stack.ts`).

### Security — resolution of the two blocking review findings

- **CR16-H1 (owner allowlist, fail-closed):** `GITHUB_ALLOWED_OWNERS` (comma-separated, seeded from
  `GITHUB_DEFAULT_OWNER`) is a runtime allowlist. When configured, a resolved owner not on the list
  makes the sync a no-op (`reason: owner_not_allowed`) — a mis-scoped broad PAT still cannot resolve
  gates from a repo the org does not control. **Operators MUST configure the allowlist and/or use a
  repo-scoped GitHub App installation token** (which also resolves CR16-M2 — a fine-grained
  Contents:Read PAT otherwise exposes every readable org repo's files to the Lambda). An unset
  allowlist logs `GATE_SYNC_OWNER_ALLOWLIST_UNSET` and relies solely on token scope.
- **CR16-H2 (immutable audit of the gate-bypass):** every sync run that resolves ≥1 gate writes an
  APPEND-ONLY `project_link_audit` row (`field='gate_sync'`) capturing the actor, source owner/repo
  (+ non-secret content ETag), and the exact gates resolved — beyond the mutable
  `macro_checkpoints.reviewed_by` column and the CloudWatch `GATE_SYNC` log.
- Own-repo-only: owner/repo come from the project row, never request input. SSRF-guarded
  (`^[A-Za-z0-9._-]+$` + host hard-pinned to `api.github.com`). 404/missing file → graceful no-op;
  rate-limit/auth/network → secret-free `503 REPO_SYNC_UNAVAILABLE`.
- **CR16-L1:** the link-time trigger is `await`ed (it always resolves) rather than fire-and-forget,
  so a post-response Lambda freeze cannot silently drop the sync.

### Config env vars (non-secret)

| Variable | Purpose |
|----------|---------|
| `GITHUB_DEFAULT_OWNER` | Fallback owner when a project's `github_url` has none; seeds the allowlist. |
| `GITHUB_ALLOWED_OWNERS` | Comma-separated approved owners (CR16-H1). Strongly recommended in every env. |

## CR-17 — Fresh-Start Cleanup Migration (V007) — ⚠️ DESTRUCTIVE, NON-AUTO-RUN

`migrations/V007__fresh_start_cleanup.sql` permanently deletes imported `CST-%` (non-template)
projects (children removed via `ON DELETE CASCADE`), preserving `__template__`, all `DP-%` projects,
and the append-only `governance_events` table. Source: `specs/phase2/CR-17-fresh-start-cleanup-spec.md`.

**The default migration runner MUST SKIP V007** — it is NOT part of the ordered set (`V001..V006`)
and must never run in CI/CD or on deploy. It is inert without an explicit session guard:

```sql
-- Operator-run only, in one session, AFTER a backup / RDS snapshot:
--   1. \i migrations/verify/V007__preflight.sql      -- review counts
SET kiro.confirm_fresh_start = 'yes';
\i migrations/V007__fresh_start_cleanup.sql
--   3. \i migrations/verify/V007__verify.sql          -- assert end state
```

Without `SET kiro.confirm_fresh_start = 'yes'` the migration is a no-op (defense in depth).
The deletion is **IRREVERSIBLE** — there is no down-migration; recovery depends on the pre-run
backup/snapshot. **Not run and not deployed as part of this change.**
