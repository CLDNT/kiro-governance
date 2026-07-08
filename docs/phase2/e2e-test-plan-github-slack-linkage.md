# E2E Test Plan — GitHub/Slack Linkage + Dual-Channel Notify + Level-2 Auto-Completion

**Feature:** CR v3 GitHub↔Slack project linkage (FR-P2-033..042), dual-channel `notify_slack`, no-orphan `record_progress`, Level-2 micro-artifact auto-completion, link-time gate detection (`sync-gates`).

**Status of the system under test:** LIVE on the deployed environment as of 2026-07-07 (migrations V004/V005/V006/V008 applied; ~33 Lambdas on `kiro_phase2`; MCP on `kiro_mcp_app` with append-only enforced; MCP EC2 running the CR-08/CR-09/CR-11/`event_code` build). See the **Known Gaps** section — the three SSM secrets are pending customer provisioning, so the Slack-posting and GitHub-read legs are not yet exercisable end-to-end until those tokens exist.

**Audience:** QA / release operator with `admin` and `pm`/non-admin Cognito logins, `ceanalytics` AWS CLI profile, and (for DB checks) SSM port-forward access through the MCP EC2 host.

---

## 0. Environment Reference (real values)

| Item | Value |
|------|-------|
| App URL (CloudFront) | `https://d2s8z1ws7s6cmc.cloudfront.net` |
| API base | `https://ug1vg2f8ac.execute-api.us-east-1.amazonaws.com/prod/` |
| AWS account / region | `713554442614` / `us-east-1` |
| AWS CLI profile | `ceanalytics` |
| Cognito User Pool | `us-east-1_6qhwLw6wc` |
| Cognito App Client | `6jqmq9dc4k8pmknk1ot5883469` |
| MCP server (EC2, private) | `https://172.31.7.210:443/mcp` (health: `GET /health`) |
| MCP EC2 instance | `i-0f01f38b05385521c` (in-VPC; reach via SSM) |
| RDS endpoint | `kirogovernancestack-governancedb222ac1c0-n7kkv2ltc0oe.cxuu7do6zxik.us-east-1.rds.amazonaws.com:5432` |
| Database | `kiro_governance` (PostgreSQL 16) |
| DB roles | `kiro_migrator` (owner), `kiro_mcp_app` (MCP runtime, append-only), `kiro_phase2` (Lambda runtime), `kiro_mcp` (RDS master — admin/migrations only) |
| Slack workspace bot | `kiro_governance2` |
| Slack dev channel (shared micro+macro for the smoke project) | `C0B9X436AQ5` |

### SSM parameter names (reference names only — never read/print secret VALUES)

| SSM path | Purpose | Read by |
|----------|---------|---------|
| `/kiro-governance/slack/bot-token` | Slack **bot token**, `chat:write` only | MCP `notify_slack` |
| `/kiro-governance/slack/provisioning-token` | Slack provisioning cred, `channels:read` + `channels:manage` | `provision-slack-channels` Lambda |
| `/kiro-governance/github/read-token` | GitHub PAT / App token, `Contents: Read-only` | `sync-gates` Lambda |
| `/kiro-governance/config/db-user` | Runtime DB user (`kiro_mcp_app`) | MCP bootstrap |

CI (GitHub Actions) secrets used by `scripts/governance-trigger.js`: `MCP_SERVER_URL`, `MCP_API_KEY`, `MCP_CERT_FINGERPRINT`, plus workflow env `PROJECT_ID` (= GitHub repo name), `ACTOR`, `SOURCE_REF`, `GITHUB_REPOSITORY`, `GOVERNANCE_EVENT_MODE` (default `micro`).

### Route map exercised by this plan

| Method | Route | Handler | Auth |
|--------|-------|---------|------|
| POST | `/api/projects` | create-project | pm, leadership, admin (linkage fields: admin/leadership) |
| GET | `/api/projects/{projectId}` | get-project | all roles |
| PATCH | `/api/projects/{projectId}` | update-project | pm/leadership/admin; **linkage fields admin/leadership only** |
| GET | `/api/projects/{projectId}/timeline` | project-timeline (gates) | all roles |
| GET | `/api/projects/{projectId}/gates` | get-gates | all roles |
| PATCH | `/api/projects/{projectId}/checkpoints/{checkpointId}` | complete-checkpoint → MACRO notify | pm/sa/leadership/admin |
| PATCH | `/api/projects/{projectId}/artifacts/{artifactId}` | update-artifact (manual override / reset_to_auto) | pm/sa/leadership/admin (reset_to_auto: admin/leadership) |
| POST | `/api/projects/{projectId}/slack/provision` | provision-slack-channels | admin/leadership |
| POST | `/api/projects/{projectId}/sync-gates` | sync-gates | admin/leadership |
| POST | `/api/projects/{projectId}/sync-artifacts` | sync-artifacts (Level-2 reconcile) | admin/leadership |
| MCP tool | `record_progress` | resolve-or-reject write | X-API-Key |
| MCP tool | `notify_slack` | dual-channel post | X-API-Key |

---

## Conventions used in every test case

- **`$TOKEN`** — a Cognito ID token (Bearer). Obtain one as shown in TC-00 §C. Use an `admin` token unless a case says "non-admin".
- **`$API`** = `https://ug1vg2f8ac.execute-api.us-east-1.amazonaws.com/prod`
- **DB checks** run through an SSM port-forward to the RDS instance (TC-00 §D). Read-only `SELECT` only — never mutate governance data by hand.
- All `curl` calls send `Authorization: Bearer $TOKEN` and `Content-Type: application/json` unless stated.
- Replace `{projectId}` with a project's **`jira_key`** (e.g. `DP-004`), NOT its numeric id. The MCP tools take the **GitHub repo name** as `project_id`.

---

## TC-00 — Prerequisites & Environment Checklist

**Purpose:** Confirm the deployed system, identities, database state, MCP server, and secrets are in the state this plan assumes before running any functional case.

**Preconditions:** `ceanalytics` profile configured; Session Manager plugin installed for SSM; a REST client (`curl`/Postman); `psql` client for DB checks.

### A. App + API reachable

Steps:
1. Open `https://d2s8z1ws7s6cmc.cloudfront.net` — the DeliverPro login page renders.
2. `curl -i $API/api/projects` (no auth).

Expected: Step 2 returns **401** (Cognito authorizer rejects unauthenticated). Confirms the API is live and protected.

### B. Migrations applied

Steps (DB, read-only — see §D for the tunnel):
```sql
-- linkage columns present (expect 6)
SELECT count(*) FROM information_schema.columns
 WHERE table_name='projects'
   AND column_name IN ('github_repo','github_url','slack_micro_channel_id',
                       'slack_macro_channel_id','updated_by','updated_at');
-- V004 partial unique index
SELECT indexname FROM pg_indexes WHERE indexname='uq_projects_github_repo';
-- V004 audit triggers (expect 2)
SELECT tgname FROM pg_trigger
 WHERE tgname IN ('audit_project_linkage','audit_project_linkage_insert') AND NOT tgisinternal;
-- V006 timeline repoint (expect t)
SELECT pg_get_viewdef('v_timeline', true) LIKE '%p.github_repo = ge.project_id%';
-- V008 Level-2: event_code column + seeded mapping (expect >=16)
SELECT count(*) FROM information_schema.columns WHERE table_name='governance_events' AND column_name='event_code';
SELECT count(*) FROM micro_artifact_mapping WHERE is_active=true;
```

Expected: 6 columns; index present; 2 triggers; `v_timeline` joins on `github_repo`; `event_code` column present; ≥16 active mapping rows. (Migrations V004, V005, V006, V008 are applied; **V007 fresh-start is N/A** — the environment is already clean.)

### C. Cognito identities

Steps:
1. Confirm an `admin`/`leadership` user exists and a `pm` (or `engineer`) user exists:
```bash
aws cognito-idp admin-list-groups-for-user --user-pool-id us-east-1_6qhwLw6wc \
  --username <admin-user> --profile ceanalytics --region us-east-1
```
2. Obtain an ID token (repeat per identity, store as `$TOKEN` / `$PM_TOKEN`):
```bash
aws cognito-idp admin-initiate-auth --user-pool-id us-east-1_6qhwLw6wc \
  --client-id 6jqmq9dc4k8pmknk1ot5883469 --auth-flow ADMIN_USER_PASSWORD_AUTH \
  --auth-parameters USERNAME=<user>,PASSWORD=<pw> --profile ceanalytics --region us-east-1
# use the IdToken from AuthenticationResult
```

Expected: admin user is in group `admin` (or `leadership`); non-admin user is in `pm`/`engineer`. Tokens decode (jwt.io) to the expected `cognito:groups` claim.

### D. DB access path (read-only)

Steps:
```bash
# port-forward RDS:5432 → localhost:5433 through the in-VPC MCP EC2 host
aws ssm start-session --target i-0f01f38b05385521c --profile ceanalytics --region us-east-1 \
  --document-name AWS-StartPortForwardingSessionToRemoteHost \
  --parameters '{"host":["kirogovernancestack-governancedb222ac1c0-n7kkv2ltc0oe.cxuu7do6zxik.us-east-1.rds.amazonaws.com"],"portNumber":["5432"],"localPortNumber":["5433"]}'
# in another shell, generate an IAM auth token for a read role and connect
export PGPASSWORD=$(aws rds generate-db-auth-token \
  --hostname kirogovernancestack-governancedb222ac1c0-n7kkv2ltc0oe.cxuu7do6zxik.us-east-1.rds.amazonaws.com \
  --port 5432 --username kiro_phase2 --region us-east-1 --profile ceanalytics)
psql "host=localhost port=5433 dbname=kiro_governance user=kiro_phase2 sslmode=require"
```

Expected: `psql` connects; `SELECT jira_key FROM projects LIMIT 5;` returns rows (e.g. `DP-002`, `DP-003`, `kiro-governance`, `__template__`).

### E. Lambda runtime role

Steps:
```bash
aws lambda get-function-configuration --function-name <ProjectsUpdate fn name> \
  --query 'Environment.Variables.DB_USER' --profile ceanalytics --region us-east-1
```
Expected: `kiro_phase2` (Phase-2 Lambdas were repointed at cutover).

### F. MCP server reachable + append-only + correct build

Steps (from a host with network path to the MCP EC2, or on the instance via SSM):
1. `curl -k https://172.31.7.210:443/health` → **200**.
2. Confirm the MCP session identity is the non-master runtime role:
```sql
SELECT usename, count(*) FROM pg_stat_activity
 WHERE datname='kiro_governance' GROUP BY usename;   -- MCP sessions = kiro_mcp_app
```
3. Confirm append-only grants for the MCP role:
```sql
SELECT
  has_table_privilege('kiro_mcp_app','governance_events','INSERT') AS ins,   -- t
  has_table_privilege('kiro_mcp_app','governance_events','UPDATE') AS upd,   -- f
  has_table_privilege('kiro_mcp_app','governance_events','DELETE') AS del,   -- f
  has_table_privilege('kiro_mcp_app','projects','SELECT')          AS proj;  -- f (column-scoped only)
```
4. Confirm the MCP `gates` Lambda / server has MCP env + SSM reachability: the MCP EC2 process has `DB_USER=kiro_mcp_app`, `DB_ENDPOINT`, `AWS_REGION` set, and the instance role can `ssm:GetParameter` on `/kiro-governance/slack/bot-token` (deferred until the token exists — see Known Gaps).

Expected: health 200; MCP sessions authenticate as `kiro_mcp_app`; INSERT=t, UPDATE=f, DELETE=f, `projects` table-level SELECT=f (column-scoped grant only). This is the live proof used again in TC-09.

### G. Secrets (SSM) presence check — **records the current known gap**

Steps:
```bash
for p in /kiro-governance/slack/bot-token /kiro-governance/slack/provisioning-token /kiro-governance/github/read-token; do
  aws ssm get-parameter --name "$p" --with-decryption --query 'Parameter.Name' \
    --profile ceanalytics --region us-east-1 2>&1 | tail -1  # print NAME only, never the value
done
```
Expected / current state: **all three are expected to be ParameterNotFound until the customer provisions them.** Record which exist. Tests TC-03 (Slack leg), TC-04 (Slack leg), TC-06 (all), and TC-08 depend on these:
- `bot-token` absent → `notify_slack` returns `{notified:false, reason:'bot_token_not_found'}`.
- `provisioning-token` absent → `slack/provision` returns 502.
- `github/read-token` absent → `sync-gates` returns 503 `REPO_SYNC_UNAVAILABLE` (GitHub PAT still pending).

### H. Slack bot membership + scopes (do before TC-03/04 Slack legs)

Steps: In Slack, confirm bot `kiro_governance2` is **invited to the target channel** `C0B9X436AQ5` (and any real per-project micro/macro channels) and the app has scopes `chat:write`, `channels:read`, `groups:read`. `/invite @kiro_governance2` in the channel if missing.

Expected: bot is a member of the channel it must post to (Slack `not_in_channel` otherwise surfaces as `notify_slack` reason `slack_api_error`).

**How to Verify (TC-00 overall):** All of A–H recorded. Any pending SSM token is logged in the run sheet and the dependent TCs are marked "Slack/GitHub leg deferred" rather than failed.

---

## TC-01 — Create a Project (frontend) + verify

**Purpose:** Baseline project creation works and seeds the CASDM templates.

**Preconditions:** TC-00 passed; logged into the app as `admin`.

**Steps:**
1. App → **Projects** → **New project**.
2. Fill: Title `E2E Linkage Smoke`, Project type `AppDev`, PM = your name, SA = your name, SOW hours `100`. Leave GitHub/Slack fields blank (feature switch OFF for now).
3. Submit.

**Expected Result:** 201; a new project appears in the list with a generated `jira_key` like `DP-00N`, status `Active`, phase `Phase 0`. Response `seeded` reports non-zero `micro_artifacts`, `macro_checkpoints`, and `onboarding_items = 9`.

**How to Verify:**
- API cross-check:
```bash
curl -s -H "Authorization: Bearer $TOKEN" $API/api/projects/DP-00N | jq '{jira_key,status,current_phase,github_repo}'
```
  Expect `github_repo: null`.
- DB:
```sql
SELECT jira_key, status, github_repo FROM projects WHERE jira_key='DP-00N';
SELECT count(*) FROM micro_artifacts   WHERE project_id='DP-00N';   -- >0
SELECT count(*) FROM macro_checkpoints WHERE project_id='DP-00N';   -- >0
SELECT count(*) FROM onboarding_checklist_items WHERE project_id='DP-00N'; -- 9
```
- Record `DP-00N` as **`$PID`** for the following cases.

---

## TC-02 — Link `github_repo` + Slack channel ids (admin/leadership only) + 403 negative + audit

**Purpose:** Verify linkage fields are admin/leadership-gated, validated, uniqueness-enforced, and audited per changed field.

**Preconditions:** TC-01 done (`$PID`); `$TOKEN` (admin), `$PM_TOKEN` (non-admin pm). Choose a repo name that matches an actual repo the CI will push from, e.g. `kiro-governance` is already taken by another project — use a fresh unique name such as `e2e-linkage-smoke`.

**Steps:**

**2a. Non-admin 403 negative.**
```bash
curl -s -o /dev/null -w "%{http_code}\n" -X PATCH \
  -H "Authorization: Bearer $PM_TOKEN" -H "Content-Type: application/json" \
  -d '{"github_repo":"e2e-linkage-smoke"}' $API/api/projects/$PID
```

**2b. Admin link (repo + url + both Slack channels).** Use `C0B9X436AQ5` for both micro and macro for the smoke run (dev channel), or the project's real channel ids.
```bash
curl -s -X PATCH -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"github_repo":"e2e-linkage-smoke",
       "github_url":"https://github.com/CODEZAX-CE/e2e-linkage-smoke",
       "slack_micro_channel_id":"C0B9X436AQ5",
       "slack_macro_channel_id":"C0B9X436AQ5"}' \
  $API/api/projects/$PID | jq '{github_repo,github_url,slack_micro_channel_id,slack_macro_channel_id,updated_by,updated_at}'
```

**2c. Frontend equivalent (optional):** Project detail → **GitHub & Slack linkage** card → **Edit linkage** (the button is only visible to admin/leadership) → fill the fields → **Save linkage**. Confirm a non-admin login does NOT see the Edit button.

**2d. Duplicate-repo 409.** PATCH a *different* project with the same `github_repo`:
```bash
curl -s -o /dev/null -w "%{http_code}\n" -X PATCH -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" -d '{"github_repo":"e2e-linkage-smoke"}' $API/api/projects/DP-002
```

**2e. Validation 400.** Bad repo charset:
```bash
curl -s -X PATCH -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"github_repo":"bad repo!!"}' $API/api/projects/$PID | jq .
```

**2f. Secret rejection 400.** Attempt to store a token-shaped channel id:
```bash
curl -s -X PATCH -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"slack_micro_channel_id":"xoxb-1234-secret"}' $API/api/projects/$PID | jq .
```

**Expected Result:**
- 2a → **403** `{ "code": "FORBIDDEN", "message": "Only admin or leadership may change project linkage" }`.
- 2b → **200**; response echoes the four linkage fields, `updated_by` = admin Cognito sub, `updated_at` set. No token/secret anywhere in the response.
- 2d → **409** `DUPLICATE_GITHUB_REPO`.
- 2e → **400** `VALIDATION_ERROR` (field `github_repo`).
- 2f → **400** `VALIDATION_ERROR` (channel id must match `^[A-Za-z0-9]{1,64}$`).

**How to Verify (audit rows):**
```sql
SELECT field, old_value, new_value, actor_sub, changed_at
  FROM project_link_audit WHERE project_id='$PID' ORDER BY changed_at;
```
Expect **one row per changed field** from 2b (`github_repo`, `github_url`, `slack_micro_channel_id`, `slack_macro_channel_id`), `actor_sub` = the admin's Cognito `sub`. No rows written for the rejected 2a/2d/2e/2f attempts.

---

## TC-03 — Kiro/CI MICRO flow (commit → GitHub Actions → MCP → DB → micro Slack → timeline)

**Purpose:** A commit to the linked repo's `docs/project-progress.md` produces a `type='micro'` governance event that resolves to the project (no-orphan), stores, posts to the micro channel, and surfaces on the project timeline.

**Preconditions:** TC-02 done (`$PID` linked to `e2e-linkage-smoke`); the GitHub repo `CODEZAX-CE/e2e-linkage-smoke` exists with the `governance-trigger` workflow and CI secrets (`MCP_SERVER_URL`, `MCP_API_KEY`, `MCP_CERT_FINGERPRINT`). For the Slack leg, `/kiro-governance/slack/bot-token` must exist and the bot must be in the channel (TC-00 §G/§H).

**Steps (real CI path):**
1. On the linked repo, add a resolved macro-gate line to `docs/project-progress.md`, e.g. `- [x] 1.1 SRS approved` and commit + push to the default branch.
2. GitHub Actions runs `scripts/governance-trigger.js` with `PROJECT_ID=e2e-linkage-smoke`, `GOVERNANCE_EVENT_MODE=micro` (default). The script diffs `docs/project-progress.md`, matches the gate, and calls `record_progress` (`type:'micro'`, `flag_override:true`, non-gate `update_text`) then `notify_slack` (`event_type:'micro'`).

**Steps (direct MCP alternative — when CI is not wired):** from a host with a path to the MCP EC2 (SSM port-forward `172.31.7.210:443` or run on the instance):
```bash
curl -sk https://172.31.7.210:443/mcp \
  -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" \
  -H "X-API-Key: <MCP_API_KEY>" \
  -d '{"jsonrpc":"2.0","id":"t1","method":"tools/call","params":{"name":"record_progress",
       "arguments":{"project_id":"e2e-linkage-smoke",
         "update_text":"Progress update: docs/project-progress.md changed",
         "type":"micro","flag_override":true,"gate":"srs approved",
         "source_ref":"e2e-commit-sha","actor":"e2e-runner"}}}'
# then, for the Slack leg:
curl -sk https://172.31.7.210:443/mcp -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" -H "X-API-Key: <MCP_API_KEY>" \
  -d '{"jsonrpc":"2.0","id":"t2","method":"tools/call","params":{"name":"notify_slack",
       "arguments":{"project_id":"e2e-linkage-smoke","message":"SRS approved — committed by e2e","event_type":"micro"}}}'
```

**Expected Result:**
- `record_progress` returns `{"written":true}`.
- `notify_slack` returns `{"notified":true}` (once the bot token exists and the bot is in the channel); otherwise `{"notified":false,"reason":"bot_token_not_found"}` (record this as the current known-gap state).

**How to Verify:**
- DB — the event stored as **micro**:
```sql
SELECT project_id, type, gate, actor, event_code, source_ref, created_at
  FROM governance_events WHERE project_id='e2e-linkage-smoke' ORDER BY created_at DESC LIMIT 3;
```
  Expect a row with `type='micro'` (NOT `macro`) and `project_id` = the repo name.
- Slack — a message posted to `C0B9X436AQ5` labelled `[$PID] SRS approved — committed by …` (project-labelled with the `jira_key`, not the repo name; broadcast tokens sanitized).
- Timeline (frontend) — Project `$PID` → **Timeline** tab shows the event with `source: kiro_mcp`. API cross-check:
```bash
curl -s -H "Authorization: Bearer $TOKEN" "$API/api/projects/$PID/timeline?limit=50" \
  | jq '.events[] | select(.source=="kiro_mcp") | {event_type,title,source,timestamp}'
```
  Expect at least one `governance_event` entry (join resolves via `github_repo`).

---

## TC-04 — MACRO flow (app) → macro channel, no double-notify

**Purpose:** Completing a macro checkpoint in the app sets `reached_at`, fires `notify_slack(event_type='macro')` to the macro channel, surfaces on the timeline, and the CI path does NOT also emit a macro notification (no double-notify).

**Preconditions:** `$PID` linked; `slack_macro_channel_id` set (TC-02); bot token present + bot in channel for the Slack leg.

**Steps:**
1. App → Project `$PID` → **Gates**. Pick a macro checkpoint. Get its `checkpointId`:
```bash
curl -s -H "Authorization: Bearer $TOKEN" $API/api/projects/$PID/gates \
  | jq '.phases[].macro_checkpoints[] | {id,checkpoint_name,checkpoint_type,reached_at}'
```
2. Complete it per its type:
   - `human_review`: `-d '{"reviewed_by":"QA Reviewer"}'`
   - `meeting`: `-d '{"occurred":true,"meeting_date":"2026-07-08"}'`
```bash
curl -s -X PATCH -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"reviewed_by":"QA Reviewer"}' $API/api/projects/$PID/checkpoints/<checkpointId> | jq '{reached_at,reviewed_by}'
```

**Expected Result:** 200; `reached_at` now set. The app backend calls MCP `notify_slack` with `event_type='macro'` and `project_id = github_repo` (see `macro-notify.service.ts`). Best-effort: the approval succeeds even if Slack fails.

**How to Verify:**
- DB — completion is app-owned:
```sql
SELECT checkpoint_name, reached_at, reviewed_by FROM macro_checkpoints
  WHERE project_id='$PID' AND id=<checkpointId>;   -- reached_at set, reviewed_by='QA Reviewer'
```
- Slack — one message in the **macro** channel `[$PID] Macro gate reached: <name> — approved by QA Reviewer` (or `notified:false / bot_token_not_found` in the current pending state — logged as gap).
- **No double-notify:** confirm the CI/micro path did NOT also post a macro message. The macro notification originates ONLY from the app; micro ONLY from CI. Check CloudWatch logs for `MACRO_NOTIFY_RESULT` (app) and confirm no `governance-trigger` macro run fired for this checkpoint.
- Timeline: the checkpoint completion appears with `source: deliverpro` (`checkpoint_completed`), distinct from the `kiro_mcp` micro events.

---

## TC-05 — Level-2 auto-completion (mapped micro event → micro_artifact complete, kiro badge) + manual override

**Purpose:** A micro event carrying a mapped `event_code` auto-completes the matching `micro_artifacts` row (idempotent, audited, reversible), the UI shows a `kiro` badge, and a human can override.

**Preconditions:** `$PID` linked to `e2e-linkage-smoke`, project type `AppDev`; V008 mapping seeded (TC-00 §B). Event-code vocabulary source: `packages/shared/constants/micro-artifact-events.ts` (mirrored into `micro_artifact_mapping` by V008). Example code: `casdm.p0.preliminary_srs` → artifact `Preliminary SRS` (Phase 0).

**Steps:**
1. Emit a micro event carrying the mapped `event_code` (direct MCP, or via a CI run that sets `event_code`):
```bash
curl -sk https://172.31.7.210:443/mcp -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" -H "X-API-Key: <MCP_API_KEY>" \
  -d '{"jsonrpc":"2.0","id":"t3","method":"tools/call","params":{"name":"record_progress",
       "arguments":{"project_id":"e2e-linkage-smoke",
         "update_text":"artifact produced: Preliminary SRS","type":"micro","flag_override":true,
         "event_code":"casdm.p0.preliminary_srs","source_ref":"e2e","actor":"aws-architect"}}}'
```
2. Trigger the app-side reconcile (admin/leadership):
```bash
curl -s -X POST -H "Authorization: Bearer $TOKEN" $API/api/projects/$PID/sync-artifacts \
  | jq '{project_id,matched,completed,skipped}'
```
   (Reconcile also fires automatically on link set/change via `PATCH /projects` — TC-02 2b would have triggered it too.)

**Expected Result:** `sync-artifacts` returns `matched≥1, completed≥1` on first run. The `Preliminary SRS` artifact flips to `status='complete'`, `completed_by='kiro:aws-architect'`, `completed_at` = the event time.

**How to Verify:**
- DB:
```sql
SELECT artifact_name, status, completed_by, manual_override FROM micro_artifacts
  WHERE project_id='$PID' AND artifact_name='Preliminary SRS';
-- expect complete / kiro:aws-architect / manual_override=false
SELECT action, old_status, new_status, event_code, actor FROM micro_artifact_audit
  WHERE project_id='$PID' AND artifact_name='Preliminary SRS' ORDER BY id;  -- 'auto_complete' row present
```
- UI — Project `$PID` → **Gates** → the `Preliminary SRS` row shows the blue **kiro** badge (`data-testid="kiro-badge"`) and "Completed … by Kiro (aws-architect)".
- **Idempotency:** re-run `sync-artifacts` → `completed:0` (nothing re-completed), no new `auto_complete` audit row.
- **Manual-override path:** downgrade the row via the artifact endpoint:
```bash
# find artifactId from GET /gates, then:
curl -s -X PATCH -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"status":"in_progress"}' $API/api/projects/$PID/artifacts/<artifactId> | jq '{status,manual_override,completed_by}'
```
  Expect `status=in_progress`, `manual_override=true`, `completed_by=null`; a `reverse` row in `micro_artifact_audit`. A subsequent `sync-artifacts` must NOT re-complete it (respects `manual_override`). Re-enable with `{"status":"complete","reset_to_auto":true}` (admin/leadership only) → `manual_override=false`.

---

## TC-06 — sync-gates (link-time gate detection) — **GitHub PAT dependent**

**Purpose:** On link/refresh of `github_repo`, resolved macro gates in the repo's `docs/project-progress.md` mark matching `macro_checkpoints.reached_at` (provenance `system:repo-sync`), idempotent and audited.

**Preconditions:** `$PID` linked; the repo's `docs/project-progress.md` contains resolved gate lines (e.g. `- [x] 1.4 SRS approved`); **`/kiro-governance/github/read-token` must exist** (Contents:Read-only) and `GITHUB_ALLOWED_OWNERS`/`GITHUB_DEFAULT_OWNER` set for the sync Lambda. **This token is currently pending (see Known Gaps) — until then this case returns 503 and only the negative path is testable.**

**Steps:**
1. Admin invokes sync-gates:
```bash
curl -s -X POST -H "Authorization: Bearer $TOKEN" $API/api/projects/$PID/sync-gates \
  | jq '{project_id,matched,resolved,skipped}'
```
2. Non-admin negative:
```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST -H "Authorization: Bearer $PM_TOKEN" \
  $API/api/projects/$PID/sync-gates
```

**Expected Result:**
- **Token present:** 200 `{matched,resolved,skipped}` with `resolved≥1` on first run; matching checkpoints set `reached_at`, `reviewed_by='system:repo-sync'`.
- **Token pending (current state):** 503 `{ "code": "REPO_SYNC_UNAVAILABLE" }` (the `GITHUB_TOKEN_NOT_FOUND` GitHub fetch failure maps to a retriable 503, secret-free). Record as expected-under-gap.
- Non-admin → **403 FORBIDDEN**.

**How to Verify:**
```sql
SELECT checkpoint_name, reached_at, reviewed_by FROM macro_checkpoints
  WHERE project_id='$PID' AND reviewed_by='system:repo-sync';
SELECT field, new_value, actor_sub FROM project_link_audit
  WHERE project_id='$PID' AND field='gate_sync' ORDER BY changed_at DESC LIMIT 1;  -- resolved_gates listed
```
Idempotency: re-run → `resolved:0`, no new `gate_sync` audit row. Note macro **completion via governance events remains display-only** — only the explicit `sync-gates`/link-time trigger sets `reached_at` (provenance-tagged), never the passive timeline join.

---

## TC-07 — Negative / no-orphan (`record_progress` for an unlinked repo)

**Purpose:** A governance event whose repo maps to no project is hard-rejected and never stored.

**Preconditions:** MCP reachable; pick a repo name linked to NO project, e.g. `not-a-real-repo-xyz`.

**Steps:**
```bash
curl -sk https://172.31.7.210:443/mcp -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" -H "X-API-Key: <MCP_API_KEY>" \
  -d '{"jsonrpc":"2.0","id":"t4","method":"tools/call","params":{"name":"record_progress",
       "arguments":{"project_id":"not-a-real-repo-xyz","update_text":"orphan test",
         "type":"micro","flag_override":true,"source_ref":"e2e","actor":"e2e"}}}'
```

**Expected Result:** `{"written":false,"reason":"no_matching_project"}`.

**How to Verify:**
```sql
SELECT count(*) FROM governance_events WHERE project_id='not-a-real-repo-xyz';  -- expect 0
```
Nothing stored. A dimensionless `GovernanceEventRejected` metric (namespace `KiroGovernance`, no repo dimension) is emitted; the repo name appears only in the MCP structured log (`[record_progress] Rejected — no matching project`). The CI script treats this reason as non-blocking (logs "feature switch off" and continues).

---

## TC-08 — Unconfigured channel (linked project, NULL channel slot → graceful skip)

**Purpose:** `notify_slack` for a linked project whose relevant channel id is NULL skips gracefully — no error, no throw.

**Preconditions:** Create/choose a project linked with `github_repo` set but at least one channel slot NULL. Quick setup:
```bash
curl -s -X PATCH -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"slack_micro_channel_id":null}' $API/api/projects/$PID   # clear the micro slot
```

**Steps:**
```bash
curl -sk https://172.31.7.210:443/mcp -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" -H "X-API-Key: <MCP_API_KEY>" \
  -d '{"jsonrpc":"2.0","id":"t5","method":"tools/call","params":{"name":"notify_slack",
       "arguments":{"project_id":"e2e-linkage-smoke","message":"micro test","event_type":"micro"}}}'
```

**Expected Result:** `{"notified":false,"reason":"channel_not_configured"}` — no exception, no secret/SSM path/repo name leaked in the reason.

**How to Verify:** Response reason is exactly `channel_not_configured`. Repeat for a repo that resolves to no project → reason `no_matching_project`. Restore the channel id afterward (re-run TC-02 2b) so later cases still have a micro channel. (When the bot token is absent entirely, the reason is instead `bot_token_not_found` — distinguish the two.)

---

## TC-09 — Append-only proof (`kiro_mcp_app` cannot UPDATE/DELETE governance_events)

**Purpose:** Prove the MCP runtime role is append-only at the database layer.

**Preconditions:** DB tunnel (TC-00 §D); ability to connect as `kiro_mcp_app` (IAM auth token for that user).

**Steps:**
```bash
export PGPASSWORD=$(aws rds generate-db-auth-token \
  --hostname kirogovernancestack-governancedb222ac1c0-n7kkv2ltc0oe.cxuu7do6zxik.us-east-1.rds.amazonaws.com \
  --port 5432 --username kiro_mcp_app --region us-east-1 --profile ceanalytics)
psql "host=localhost port=5433 dbname=kiro_governance user=kiro_mcp_app sslmode=require"
```
Then in psql:
```sql
-- INSERT allowed (append-only writer) — use a linked repo so it is a valid event
INSERT INTO governance_events (project_id, update_text, type, source_ref, actor, idempotency_key, created_at)
VALUES ('e2e-linkage-smoke','append-only probe','micro','e2e','e2e','e2e#micro#probe-'||gen_random_uuid(), now());   -- succeeds
-- UPDATE must fail
UPDATE governance_events SET update_text='tamper' WHERE project_id='e2e-linkage-smoke';   -- expect permission denied
-- DELETE must fail
DELETE FROM governance_events WHERE project_id='e2e-linkage-smoke';                        -- expect permission denied
-- table-level SELECT on projects must fail (column-scoped only)
SELECT * FROM projects LIMIT 1;                                                            -- expect permission denied
-- column-scoped SELECT on projects must succeed
SELECT jira_key, github_repo, slack_micro_channel_id, slack_macro_channel_id FROM projects LIMIT 1;  -- succeeds
```

**Expected Result:** INSERT succeeds; UPDATE and DELETE both fail with `ERROR: permission denied for table governance_events`; `SELECT *` on `projects` fails (`permission denied`); the four-column scoped SELECT succeeds.

**How to Verify:** Capture the psql errors. This mirrors the GATE-2 cutover proof (append-only enforced once MCP runs as `kiro_mcp_app`, verified live in TC-00 §F). The RDS master `kiro_mcp` is NOT the runtime writer.

---

## Known Gaps / Not-Yet-Enabled

These are live, accepted gaps in the deployed environment (2026-07-07). Tests above call out where each one changes the expected result.

1. **GitHub PAT pending → `sync-gates` (TC-06) not live.** `/kiro-governance/github/read-token` has not been provisioned by the customer. Until it exists, `POST /sync-gates` (and the best-effort link-time trigger) return/log `GITHUB_TOKEN_NOT_FOUND` → **503 `REPO_SYNC_UNAVAILABLE`**. Only the negative (403 non-admin) and the "returns 503" behaviour are testable now.

2. **Slack tokens pending → notify + provisioning Slack legs deferred.** `/kiro-governance/slack/bot-token` and `/kiro-governance/slack/provisioning-token` are pending. Until then: `notify_slack` returns `{notified:false, reason:'bot_token_not_found'}` (TC-03/TC-04 Slack legs) and `POST /slack/provision` returns 502. The DB/timeline/no-orphan/Level-2 legs of those tests are fully exercisable regardless. Channel ids are therefore **set manually** via the linkage PATCH (TC-02) rather than auto-provisioned.

3. **CR-05 auto-provisioning needs Lambda egress.** The `provision-slack-channels` path (`conversations.list`/`create`) additionally requires the provisioning Lambda to have network egress to `slack.com`. Until egress + the provisioning token are in place, channel ids are captured manually (TC-02 2b / onboarding soft-capture), not auto-created. Anti-squatting note: provisioning resolves an existing channel by exact deterministic name (`<jira_key>-micro`/`-macro`) before creating — verify `created` vs `resolved` in the response before first post.

4. **RDS public-exposure lockdown deferred (🔴 open, customer-accepted).** The governance RDS instance is currently `PubliclyAccessible=true` with SG `0.0.0.0/0` on 5432 and `StorageEncrypted=false`. This is a known critical item deferred by the customer "for later." It does not block functional testing but MUST be remediated before any production/customer-data use. Do not treat the open ingress as an intended test path — always tunnel via SSM (TC-00 §D).

5. **V007 fresh-start cleanup = N/A.** The environment already had zero legacy `CST-*` projects, so V007 was a no-op. The timeline view retains its collision-safe interim `jira_key` fallback branch alongside the strict `github_repo` join; both resolve correctly. No action required for testing.

---

## Run Sheet (fill during execution)

| TC | Result (pass/fail/deferred) | Evidence ref (DB row / Slack ts / screenshot) | Notes |
|----|------------------------------|-----------------------------------------------|-------|
| TC-00 | | | secrets present? migrations? MCP build? |
| TC-01 | | | `$PID` = |
| TC-02 | | | 403 / 409 / audit rows |
| TC-03 | | | micro row `type=micro`; Slack ts / deferred |
| TC-04 | | | reached_at; macro Slack ts / deferred; no double-notify |
| TC-05 | | | kiro badge; idempotent; override |
| TC-06 | | | 503 (PAT pending) / resolved count |
| TC-07 | | | written:false, 0 rows |
| TC-08 | | | channel_not_configured |
| TC-09 | | | UPDATE/DELETE denied |

---

*Grounded against the deployed system and source as of 2026-07-08: `docs/phase2/projects-architecture.md` v1.5, `gates-architecture.md` v1.1, the CR v3.1 impact analysis, `packages/mcp-server` (`record-progress.ts`, `notify-slack.ts`, `postgres.service.ts`, `slack.service.ts`), `packages/projects` (`sync-gates.ts`, `provision-slack-channels.ts`, `update-project.ts`, `linkage`/`github`/`gate-sync` services), `packages/gates` (`complete-checkpoint.ts`, `sync-artifacts.ts`, `micro-artifact-reconcile.service.ts`, `macro-notify.service.ts`), `packages/shared/constants/micro-artifact-events.ts`, `scripts/governance-trigger.js`, `docs/phase2/deploy-outputs.md`, the deploy runbook, and `docs/project-progress.md` deploy log.*
