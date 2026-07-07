# Deployment / Cutover Runbook — GitHub ↔ Slack Project Linkage (CR v3, Level 1)

> **Status:** Ready to execute — **NOT yet run**. Code + migrations + docs are implemented, reviewed, and CI-green; nothing in this feature is deployed.
> **Scope:** Phase 2 DeliverPro linkage feature + Phase 1 MCP integration boundary. Migrations `V004`→`V007`, GATE 1/GATE 2, the three SSM secrets, least-privilege IAM, the timeline cutover, and post-deploy verification.
> **Audience:** Release operator (DBA/ops) + `construct-developer` (IAM) + a human approver for each gate.
> **Database:** RDS PostgreSQL 16 (standard RDS, shared Phase 1 + Phase 2 instance).
> **Do NOT deploy from this document blindly.** Every 🏁 sign-off point requires an explicit human "approve" before proceeding.

## Changelog

| Date | Version | Author | Change |
|------|---------|--------|--------|
| 2026-07-03 | v1.1 | Backend Developer | GATE 2 repoint target corrected to the dedicated non-master role **`kiro_mcp_app`** (was `kiro_mcp`, which is the RDS master/superuser — grants were bypassed; iam-review Finding 2 / SEC-H1). Updated Step 0.3, Step 1 GATE 1 review bullets, Step 2b V005 spot-checks, Step 3 GATE 2 repoint + `pg_stat_activity` check, and the rollback table accordingly. |
| 2026-07-03 | v1.0 | AWS Architect | Initial consolidated deploy/cutover runbook (CR-01…CR-17 Level-1). |

---

## Source-of-record cross-references

| Topic | Source |
|-------|--------|
| Append-only hardening (GATE 1/GATE 2) | `docs/phase2/architecture/unified-data-model.md` §4.4.4; `migrations/V005__append_only_hardening.sql` header |
| Timeline repoint | `unified-data-model.md` §4.4.6; `migrations/V006__timeline_repoint.sql` |
| Fresh-start cleanup | `specs/phase2/CR-17-fresh-start-cleanup-spec.md`; `migrations/V007__fresh_start_cleanup.sql` |
| Slack two-token split + SSM paths + IAM | `packages/projects/README.md` §CR-05; `docs/phase1/mcp-server-core-architecture.md` §0.1/§3.1 |
| GitHub read token + link-time sync | `packages/projects/services/github.service.ts`; `specs/phase2/CR-16-link-time-gate-detection-spec.md` |
| Channel-visibility decision | `docs/phase2/projects-architecture.md` §12.4 (ADR) |

---

## Sign-off legend

- 🏁 **GOVERNANCE GATE** — a human must reply `approve` (or `reject [feedback]`) before the operator proceeds. Record the approver + timestamp in the run log.
- ✅ **CHECK** — an automated/manual verification that must pass before continuing.
- ⚠️ **DESTRUCTIVE / IRREVERSIBLE** — take a backup first; requires explicit opt-in.

**Global preconditions:**

- `$LIVE_DB_URL` points at the RDS instance; the connecting identity is the **RDS master** (or a role that can `SET ROLE kiro_migrator`). It must **not** be a runtime role.
- An RDS snapshot (or `pg_dump`) has been taken immediately before Step 2.
- The workspace Slack app and the GitHub read credential exist (Step 4) — or Step 4 is completed before the app is exercised in Step 7.
- CI is green on `main` (projects + gates type-check clean; `V004`–`V007` migration guard tests + full jest suite pass).

---

## Step 0 — Freeze & backup

1. Announce a short change window. Stop new governance writes if practical (the CI trigger is idempotent, so this is best-effort).

2. ✅ **Backup (mandatory).**

   ```bash
   aws rds create-db-snapshot \
     --db-instance-identifier <kiro-governance-rds-id> \
     --db-snapshot-identifier pre-cr-linkage-$(date +%Y%m%d%H%M) \
     --region <region>
   # or: pg_dump "$LIVE_DB_URL" > pre_cr_linkage_backup.sql
   ```

3. ✅ Record the current deployed `v_timeline` join column (expected: `jira_key`) and the current MCP runtime `DB_USER` (expected: RDS master `kiro_mcp` pre-cutover; GATE 2 repoints it to the non-master `kiro_mcp_app`) for rollback reference.

---

## Step 1 — Pre-flight: GATE 1 ownership audit (must pass BEFORE V005)

`V005` moves table ownership off the runtime role. It is unsafe/ineffective if a runtime role already inherits the owner role, or if `kiro_migrator` exists as `INHERIT`. GATE 1 is a **read-only** audit that RAISES on those conditions.

1. Run the audit against the LIVE DB:

   ```bash
   psql "$LIVE_DB_URL" -v ON_ERROR_STOP=1 -f migrations/verify/V005__preflight_audit.sql
   ```

2. ✅ Review the printed report:
   - Current object ownership (every `public` table/sequence/view — all will be reassigned to `kiro_migrator`).
   - Migration-runner identity = master or a `kiro_migrator` member (never a runtime role).
   - `kiro_migrator` (if present) is `NOLOGIN NOINHERIT`; the runtime roles `kiro_mcp_app`/`kiro_phase2` are `rolsuper=false` (the audit **hard-fails** if `kiro_mcp_app` is a superuser). NB: `kiro_mcp` is the RDS master and IS expectedly a superuser — it is admin/migrations only, NOT the runtime writer.
   - `pg_auth_members`: runtime roles are **not** members of `kiro_migrator`.
   - Confirm the runtime target role `kiro_mcp_app` exists as `LOGIN NOSUPERUSER NOINHERIT` (GATE 2 will repoint the MCP `DB_USER`/IAM ARN onto it, off the master `kiro_mcp`).

3. ✅ The script must exit **0** with `V005 pre-implementation audit: no BLOCKING conditions detected in-DB.` Any `AUDIT FAIL (SEC-H1)` must be resolved (remove the membership / set `kiro_migrator` `NOINHERIT`) and the audit re-run until clean.

🏁 **GOVERNANCE GATE — "GATE 1: V005 ownership audit passed"**
Present the audit output. A human confirms the ownership inventory is expected and there are no blocking conditions. On `approve`, proceed to Step 2. On `reject`, resolve findings and re-run Step 1.

---

## Step 2 — Apply migrations in order (V004 → V005 → V006 → V007)

> **Pre-deploy CI gate (ephemeral Postgres — NOT RDS):** `V004__verify.sql` and `V005__verify.sql` are designed to run against a throwaway Postgres 16 in CI (their headers carry the exact `docker run` + `psql` recipes, including running each migration **twice** to prove idempotency). Confirm both printed `V004 verification PASSED` / `V005 verification PASSED` in CI before touching RDS. Do **not** run those two verify scripts against RDS.

Apply on RDS, one migration at a time, each in its own transaction where the file is not already wrapped, as the migrator identity:

### 2a. V004 — additive schema (zero blast radius)

```bash
psql "$LIVE_DB_URL" -v ON_ERROR_STOP=1 -f migrations/V004__github_slack_linkage.sql
```

✅ **Live spot-check** (safe, read-only) — columns, partial unique index, audit table + triggers, inert mapping table:

```sql
SELECT column_name FROM information_schema.columns
 WHERE table_name='projects'
   AND column_name IN ('github_repo','github_url','slack_micro_channel_id',
                       'slack_macro_channel_id','updated_by','updated_at');          -- expect 6
SELECT indexdef FROM pg_indexes WHERE indexname='uq_projects_github_repo';           -- partial UNIQUE … WHERE github_repo IS NOT NULL
SELECT tgname FROM pg_trigger
 WHERE tgname IN ('audit_project_linkage','audit_project_linkage_insert')
   AND NOT tgisinternal;                                                             -- expect 2
SELECT count(*) FROM micro_artifact_mapping;                                         -- expect 0 (inert)
```

### 2b. V005 — append-only hardening (security-sensitive; GATE 1 must have passed)

```bash
psql "$LIVE_DB_URL" -v ON_ERROR_STOP=1 -f migrations/V005__append_only_hardening.sql
```

✅ **Live spot-check** — ownership + least-privilege grants (mirrors `V005__verify.sql` assertions; safe on RDS as read-only queries):

```sql
-- All public objects owned by kiro_migrator (expect 0 rows):
SELECT tablename, tableowner FROM pg_tables
 WHERE schemaname='public' AND tableowner <> 'kiro_migrator';
-- kiro_mcp_app (non-master runtime role) = append-only writer on governance_events, NO write on projects:
SELECT rolsuper FROM pg_roles WHERE rolname='kiro_mcp_app';                          -- f (NOSUPERUSER — crux of the fix)
SELECT has_table_privilege('kiro_mcp_app','governance_events','INSERT') AS ins_ok,      -- t
       has_table_privilege('kiro_mcp_app','governance_events','SELECT') AS sel_ok,      -- t
       has_table_privilege('kiro_mcp_app','governance_events','UPDATE') AS upd_bad,     -- f
       has_table_privilege('kiro_mcp_app','governance_events','DELETE') AS del_bad,     -- f
       has_table_privilege('kiro_mcp_app','projects','SELECT')          AS tbl_sel_bad, -- f (column-scoped only)
       has_column_privilege('kiro_mcp_app','projects','github_repo','SELECT') AS col_ok,-- t
       has_table_privilege('kiro_mcp_app','micro_artifact_mapping','SELECT') AS l2_bad; -- f (PLAN-L2)
-- kiro_phase2 = DeliverPro DML, READ-ONLY on governance_events:
SELECT has_table_privilege('kiro_phase2','macro_checkpoints','UPDATE') AS reached_ok, -- t
       has_table_privilege('kiro_phase2','governance_events','INSERT') AS ev_bad;     -- f
```

> **Note:** After V005, append-only is **not yet enforced** while the MCP server still connects as the RDS master `kiro_mcp` (a superuser bypasses ownership + grants). That is closed by **GATE 2 (Step 3)** — repointing the runtime onto the non-master `kiro_mcp_app`. Until Step 3 completes, treat append-only as best-effort.

### 2c. V006 — timeline repoint (behavioural view change)

```bash
psql "$LIVE_DB_URL" -v ON_ERROR_STOP=1 -f migrations/V006__timeline_repoint.sql
```

✅ **Live spot-check** — `v_timeline` recreated, source-1 joins on `github_repo` with the interim `jira_key` fallback, 11-column contract preserved:

```sql
SELECT count(*) FROM information_schema.columns WHERE table_name='v_timeline';       -- expect 11
SELECT pg_get_viewdef('v_timeline', true) LIKE '%p.github_repo = ge.project_id%';    -- expect t
```

### 2d. V007 — fresh-start cleanup ⚠️ OPTIONAL / DESTRUCTIVE / EXPLICIT OPT-IN

> `V007` is **NOT** part of the ordered migration set and the default migration runner MUST SKIP it. Run only intentionally, to remove legacy `CST-*` imports for the fresh start. It preserves `__template__`, all `DP-*`, and append-only `governance_events`. **There is no down-migration** (recovery = restore the Step 0 backup).

1. ✅ Pre-flight (read-only) — review what would be deleted vs preserved:

   ```bash
   psql "$LIVE_DB_URL" -v ON_ERROR_STOP=1 -f migrations/verify/V007__preflight.sql
   ```

   Record `to_delete_projects`, `preserved_template` (=1), `preserved_dp`, `governance_events`.

🏁 **GOVERNANCE GATE — "V007 fresh-start cleanup approved (DESTRUCTIVE)"**
Present the pre-flight counts + confirm the Step 0 backup exists. On `approve`, proceed. If the environment has **no** legacy imports (true fresh start), the operator may record "N/A — no CST-* projects" and skip 2d.2.

2. ⚠️ Apply, in a single session, with the guard flag set:

   ```bash
   psql "$LIVE_DB_URL" -v ON_ERROR_STOP=1 <<'SQL'
   SET kiro.confirm_fresh_start = 'yes';
   \i migrations/V007__fresh_start_cleanup.sql
   SQL
   ```

3. ✅ Verify:

   ```bash
   psql "$LIVE_DB_URL" -v ON_ERROR_STOP=1 -f migrations/verify/V007__verify.sql
   ```

   Expect `to_delete_remaining=0` (PASS), `preserved_template=1` (PASS), and `preserved_dp` / `governance_events` unchanged vs the pre-flight run.

🏁 **GOVERNANCE GATE — "Migrations V004–V006 applied and verified"**
Present the 2a–2c spot-check output (and 2d verify if run). On `approve`, proceed to GATE 2.

---

## Step 3 — GATE 2 (ops): repoint runtimes off the RDS master

Append-only becomes a **real** DB guarantee only when the MCP server authenticates as the dedicated non-master role **`kiro_mcp_app`** (`NOSUPERUSER`) — NOT the RDS master `kiro_mcp` (a superuser bypasses ownership + grants; this was the iam-review Finding 2 collision). Separately, the Phase-2 Lambdas must authenticate as `kiro_phase2` (their DML was re-granted in V005 §F.4). This step is an **operational change to running services**, not SQL — `V005` cannot perform it (D-v3-3 / D-v3-11).

1. **Repoint MCP runtime → `kiro_mcp_app` (non-master).**
   - Set the MCP server process env `DB_USER=kiro_mcp_app` (systemd unit / EC2 config; the CDK `.env.example` and `/kiro-governance/config/db-user` SSM param already emit `kiro_mcp_app`).
   - Repoint the IAM `rds-db:connect` `dbuser` resource ARN for the MCP server role to `.../dbuser:*/kiro_mcp_app` (the `KiroGovernanceStack` `RDSIAMConnect` statement already targets `kiro_mcp_app`).
   - Reserve the RDS master `kiro_mcp` strictly for admin / break-glass / running migrations (as/`SET ROLE` `kiro_migrator`).
   - Restart the MCP server; confirm it connects and `record_progress` still writes.

2. **Repoint Phase-2 Lambda `DB_USER` → `kiro_phase2`** (D-v3-3/D-v3-11).
   - Confirm/adjust the DeliverPro Lambda env `DB_USER=kiro_phase2` and the Lambda role's `rds-db:connect` `dbuser` ARN to `.../dbuser:*/kiro_phase2`.
   - (Per DP-01 this may already be `kiro_phase2`; verify — do not leave any Phase-2 Lambda on `kiro_mcp`/`kiro_mcp_app` or the master.)

3. ✅ **Positive cutover check (`pg_stat_activity`).** With the MCP server and Lambdas running, query the LIVE DB and confirm the session identities — GATE 1's audit only checks role attributes, not live sessions:

   ```sql
   SELECT usename, count(*)
     FROM pg_stat_activity
    WHERE datname = current_database() AND usename IS NOT NULL
    GROUP BY usename;
   ```

   ✅ GATE 2 is complete **only** when:
   - the MCP server's session `usename` = `kiro_mcp_app` (the non-master runtime role), **not** the master `kiro_mcp`; and
   - Phase-2 Lambda sessions appear as `kiro_phase2`; and
   - no application session authenticates as the RDS master `kiro_mcp`.

   If the MCP runtime is (by explicit risk-acceptance) left on the master for the POC, append-only is **best-effort, not enforced** — do not label it "enforced". Record the risk-acceptance.

🏁 **GOVERNANCE GATE — "GATE 2: runtimes repointed off master (append-only enforced)"**
Present the `pg_stat_activity` output. On `approve`, proceed. On `reject`/unresolved, either fix the repoint or explicitly record the POC risk-acceptance before continuing.

---

## Step 4 — Secrets: one Slack app + three SSM SecureString parameters

Create a **single workspace Slack app**. Split its scopes across two credentials (SEC-M1 two-token split) and add the GitHub read token. All three are **SSM SecureString** (default `aws/ssm` KMS key, or an optional CMK). Only the **non-secret SSM paths** are committed; token values are set out-of-band via `ssm:PutParameter` (admin).

| # | SSM path (SecureString) | Credential / scope | Read by (runtime) |
|---|-------------------------|--------------------|-------------------|
| 1 | `/kiro-governance/slack/bot-token` | Slack **bot token**, `chat:write` **only** (no channel management) | MCP server `notify_slack` |
| 2 | `/kiro-governance/slack/provisioning-token` | Slack **provisioning** credential, `channels:read` + `channels:manage` (**no** `admin.*`) | `provision-slack-channels` Lambda only |
| 3 | `/kiro-governance/github/read-token` | GitHub **read** token, **Contents: Read-only** (no write/admin) | gate-sync (`sync-gates`) Lambda only |

```bash
aws ssm put-parameter --name /kiro-governance/slack/bot-token \
  --type SecureString --value "xoxb-…" --region <region>            # chat:write only
aws ssm put-parameter --name /kiro-governance/slack/provisioning-token \
  --type SecureString --value "xoxb-…" --region <region>            # channels:read + channels:manage
aws ssm put-parameter --name /kiro-governance/github/read-token \
  --type SecureString --value "github_pat_… or App installation token" --region <region>  # contents:read
```

✅ **Checks:**
- The `chat:write` runtime token and the `channels:manage` provisioning token are **two different secrets at two different paths** — a compromise of the always-loaded runtime token cannot create/rename channels.
- Neither Slack credential carries any `admin.*` scope.
- The GitHub token is scoped to `Contents: Read-only` on the org's repos (prefer a repo-scoped GitHub App installation token; a broad PAT must be paired with the `GITHUB_ALLOWED_OWNERS` allowlist — see Step 5/§CR-16).
- No token value appears in code, PG, logs, or an API response (verified by the secret-rejecting validators).

> **Channel visibility (decision, `projects-architecture.md` §12.4):** provisioned channels are **PUBLIC by default** (`is_private:false`); `isPrivate:true` is opt-in per project for sensitive work. **Anti-squatting:** provisioning resolves an existing channel by exact deterministic name (`<jira_key>-micro`/`-macro`) before creating, so a pre-existing (possibly squatted) channel is *adopted*. On provision, confirm each channel was `created` (not unexpectedly `resolved`) before the first post; the endpoint returns `created` vs resolved and every id is written to `project_link_audit`.

🏁 **GOVERNANCE GATE — "Slack app + 3 SSM secrets provisioned"**
Confirm the three parameters exist as SecureString with correct scopes. On `approve`, proceed to IAM.

---

## Step 5 — IAM least-privilege (construct-developer) — MANDATORY pre-deploy gate

`construct-developer` applies **single-ARN** least-privilege IAM so each credential is readable by exactly one role. This gate is **mandatory before the app/MCP are exercised** in Step 7.

Per credential, grant exactly `ssm:GetParameter` on the **single parameter ARN** (never a `/kiro-governance/*` wildcard) + `kms:Decrypt` on the backing key, conditioned on `kms:ViaService = ssm.<region>.amazonaws.com`:

```jsonc
// Example — provisioning Lambda role (mirror for MCP bot-token + sync-gates github/read-token):
{ "Effect": "Allow", "Action": ["ssm:GetParameter"],
  "Resource": "arn:aws:ssm:<region>:<account>:parameter/kiro-governance/slack/provisioning-token" },
{ "Effect": "Allow", "Action": ["kms:Decrypt"],
  "Resource": "<KMS key ARN backing the SecureString>",
  "Condition": { "StringEquals": { "kms:ViaService": "ssm.<region>.amazonaws.com" } } }
```

✅ **Role ↔ ARN matrix (each role reads ONLY its own credential):**

| Role | May read | Must NOT read |
|------|----------|---------------|
| MCP server (`notify_slack`) | `/kiro-governance/slack/bot-token` | provisioning-token, github/read-token |
| `provision-slack-channels` Lambda | `/kiro-governance/slack/provisioning-token` | bot-token, github/read-token |
| gate-sync (`sync-gates`) Lambda | `/kiro-governance/github/read-token` | bot-token, provisioning-token |

✅ Also: no `ssm:PutParameter` on any runtime role (rotation is admin/out-of-band); the `sync-gates` Lambda has `GITHUB_ALLOWED_OWNERS`/`GITHUB_DEFAULT_OWNER` configured (CR16-H1 fail-closed) if using a broad PAT.

🏁 **GOVERNANCE GATE — "Least-privilege IAM applied (single-ARN per credential)"**
`construct-developer` presents the applied statements + the role↔ARN matrix. This gate MUST pass before Step 7. On `approve`, proceed.

---

## Step 6 — Timeline cutover: drop the interim `jira_key` fallback branch

`V006` shipped `v_timeline` with a collision-safe interim predicate so any imported-but-not-yet-linked project kept showing events:

```sql
JOIN projects p
  ON p.github_repo = ge.project_id
  OR (p.github_repo IS NULL AND p.jira_key = ge.project_id)   -- interim fallback
```

The fallback was only needed while legacy imported projects existed for a CR-06 backfill. **CR-06 is cancelled (fresh start).**

- **If V007 fresh-start was run (or the environment has no legacy `CST-*` projects):** the fallback is dead weight — **drop it immediately**. Recreate `v_timeline` with the strict `github_repo`-only join (source-1), leaving sources 2 & 3 unchanged, preserving the 11-column contract. (Deliver as a small follow-on migration, e.g. `V008__timeline_drop_interim_branch.sql`, authored by the backend/construct agent through its review gate — do not hand-edit the view on RDS.)
- **If any legacy project is intentionally retained unlinked:** keep the fallback until those projects are linked or removed, then drop it.

✅ **Pre-drop collision guard** (must hold before dropping — keeps the strict join injective):

```sql
-- Expect 0 rows: no project's github_repo equals another project's jira_key.
SELECT a.jira_key, a.github_repo
  FROM projects a JOIN projects b ON a.github_repo = b.jira_key AND a.jira_key <> b.jira_key;
```

✅ **Post-drop check:** `pg_get_viewdef('v_timeline', true)` no longer contains the `OR (p.github_repo IS NULL …)` branch.

🏁 **GOVERNANCE GATE — "Timeline interim fallback dropped (strict github_repo join)"**
On `approve`, proceed to verification. (May be recorded as "deferred — legacy projects retained" with justification.)

---

## Step 7 — Post-deploy verification (end-to-end)

Exercise the full linkage path on a **fresh** project. Requires Steps 4 & 5 complete.

1. **Link a fresh project's `github_repo`** (admin/leadership) — via `POST /api/projects` (created already linked) or `PATCH /api/projects/{id}` linkage fields.
   - ✅ `github_repo` accepted (matches `^[A-Za-z0-9._-]{1,100}$`), unique (409 on collision), `github_url` is `https://github.com/…`.
   - ✅ `project_link_audit` has one row per linkage field set (create → `AFTER INSERT` trigger; update → `BEFORE UPDATE` trigger); `actor_sub` = the Cognito `sub`.

2. **Provision Slack channels** (admin/leadership) — `POST /api/projects/{id}/slack/provision`.
   - ✅ `slack_micro_channel_id` / `slack_macro_channel_id` persisted (non-secret ids); response reports `created` vs `resolved`; no token in the response/logs.

3. **Run `sync-gates`** — `POST /api/projects/{id}/sync-gates` (admin/leadership, own-repo-only).
   - ✅ The GitHub read token fetches the repo's `docs/project-progress.md`; resolved macro gates set matching `macro_checkpoints.reached_at` with `reviewed_by='system:repo-sync'` and an audit row; idempotent on re-run.
   - ✅ Gate parse is anchored to the `- [x] N.N <Gate>` form; `Project documentation approved` resolves to itself (no `documentation approved`→`Runbooks approved` bleed).

4. **Confirm micro events surface** — commit a change to the linked repo's `docs/project-progress.md` (CI `governance-trigger`, default `micro` mode).
   - ✅ `record_progress` resolves the project by `github_repo` and writes a `type='micro'` event (no-orphan: an unlinked repo returns `{written:false, reason:'no_matching_project'}` and is skipped — non-blocking).
   - ✅ The event appears on `v_timeline` (source-1, `github_repo` join) keyed to `jira_key`.

5. **Confirm macro sync (app-owned)** — complete a macro checkpoint in the app.
   - ✅ `macro_checkpoints.reached_at` is set by the in-app state machine (never by a governance event); the display-only macro governance event surfaces on the timeline without setting `reached_at`.

6. **Confirm dual-channel Slack posts** — `notify_slack` routes by `event_type`.
   - ✅ Micro events post to `slack_micro_channel_id`; macro to `slack_macro_channel_id`; messages are project-labelled (`[jira_key] title …`); no double-notify across the CI/app paths; graceful skip (no throw) when a channel id is absent.

🏁 **GOVERNANCE GATE — "GitHub/Slack linkage post-deploy verification passed"**
Present the Step 7 evidence. On `approve`, the cutover is complete — record it in `docs/project-progress.md`.

---

## Rollback

| Step | Rollback |
|------|----------|
| V004 (additive) | Additive + idempotent — normally left in place. If required, drop the added columns/index/table/triggers (no data dependency until linkage is used). |
| V005 (privileges/ownership) | **Roll-forward preferred.** Manual reverse documented (commented) in `V005__append_only_hardening.sql` — reassign ownership back to the pre-hardening owner and restore the V001 database grant. Requires master/`SET ROLE kiro_migrator`; if GATE 2 already repointed runtimes, also revert `DB_USER` + IAM ARNs or the MCP loses DB access. |
| V006 (view repoint) | `DROP VIEW v_timeline; CREATE VIEW …` from the V003 definition (restores the `jira_key` join). Idempotent DROP+CREATE. |
| V007 (fresh-start) | **IRREVERSIBLE** — no down-migration. Restore the Step 0 snapshot/`pg_dump`. |
| GATE 2 (repoint) | Revert MCP `DB_USER` (`kiro_mcp_app` → previous value) + IAM `rds-db:connect` ARN; restart. |
| Secrets/IAM | Remove the SSM parameters / detach the IAM statements. |

---

## Ordering & dependency notes

- **GATE 1 (Step 1) strictly precedes V005 (Step 2b).**
- **GATE 2 (Step 3) is what makes append-only enforced** — until it completes, V005's guarantee is best-effort.
- **Steps 4 (secrets) + 5 (IAM) are prerequisites for Step 7** — the app/MCP cannot read tokens without them; Step 5 is a mandatory pre-deploy gate.
- **Step 6 (drop interim branch)** can run immediately with a fresh start (no legacy projects); otherwise defer until legacy projects are linked/removed.
- **Level 2** (micro→artifact auto-completion, `event_code`, GitHub OIDC — FR-P2-042) is **deferred/iceboxed** and out of scope for this cutover.
