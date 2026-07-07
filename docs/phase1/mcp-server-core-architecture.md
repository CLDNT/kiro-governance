# MCP Server Core Architecture — F-01: Tools, Classification & Deduplication

## Changelog

| Date | Version | Author | Change |
|------|---------|--------|--------|
| 2026-07-03 | v1.5 | AWS Architect | Doc-drift reconciliation (deploy-finalization). §3.2 `record_progress` **`RecordProgressOutput` documented as the complete two-reason-code model**: when `written:false`, `reason` is exactly one of `'no_matching_project'` (no-orphan reject, FR-P2-038) or `'duplicate'` (idempotency-key dedup, FR-09); typed as a union and annotated with caller-branching guidance. No code change. |
| 2026-07-02 | v1.4 | AWS Architect | **CR-P0 — persistence doc-drift correction (DynamoDB → RDS PostgreSQL).** The system migrated from DynamoDB to RDS PostgreSQL (2026-06-23 CR); the DynamoDB code/stub was removed in CR-11. This revision replaces all remaining stale DynamoDB wording with the deployed RDS reality: §1 FRs-owned + dependency table (RDS `governance_events`, `ON CONFLICT` dedup), §2.5 egress (RDS API, not DynamoDB), §4.3 (`flag_override` persisted in PostgreSQL), §5 rewritten (INSERT … `ON CONFLICT (idempotency_key)` DO NOTHING — no sentinel/pk/sk), §6.4/NFR-02 (append-only PostgreSQL write), §7.3 + §10 `ServerConfig` (drop `tableName`), §9.1/§9.3 (`database_write_failed`, `PostgresWriteLatency`), §11 edge cases (unique-constraint conflict, not conditional PutItem), §12 Hallucination Gate (RDS table + idempotency-key self-check). Persistence is **RDS PostgreSQL 16** with **RDS IAM auth** (`postgres.service.ts`, `Signer`, 14-min token refresh) and the **append-only role model** (V005: `kiro_migrator` owns tables, runtime `kiro_mcp` holds INSERT+SELECT only). Documentation only — no application code changed. Source: `docs/phase2/change-requests/2026-07-02-github-slack-linkage-impact.md` §v3-1 (F7/P0), `docs/phase1/change-requests/2026-06-23-dynamodb-to-rds-migration.md`. |
| 2026-07-02 | v1.3 | AWS Architect | GitHub↔Slack linkage CR (v3 Final Design of Record). `notify_slack` rewritten: dual-channel routing by `event_type` (micro→`slack_micro_channel_id`, macro→`slack_macro_channel_id`), resolve project by `github_repo`, workspace **bot token** `chat.postMessage` (replaces per-project webhook, with transition fallback), project-labelled (`[jira_key]`) messages, Slack-mention sanitization (SEC-L1), two-token split (SEC-M1); **the micro-skip guard is removed** (micro now notifies its channel). `record_progress`: **resolve-or-reject** (`no_matching_project`, dimensionless `GovernanceEventRejected`); persistence is RDS PostgreSQL (not DynamoDB — 2026-06-23 CR). `classifyEvent`: **explicit `type` is authoritative** (PLAN-H1 fix). SSM inventory: add bot-token param, remove `table-name`, deprecate per-repo webhook params. Append-only hardened via ownership reassignment (SEC-H1); V001's invalid `CREATE USER IF NOT EXISTS` superseded (SEC-L4). Shared-key cross-project residual risk recorded (SEC-H2, POC risk-accept). See §0 overlay. |
| 2026-06-11 | v1.2 | AWS Architect | Security Gate 1 fixes: HTTPS/TLS self-signed cert (HIGH-1), public exposure documented (MED-3), shared key accepted risk documented (MED-5), SSM path removed from error response (LOW-8). |
| 2026-06-11 | v1.1 | AWS Architect | Fixed gate normalization in dedup key (FINDING-1), added gate auto-derivation for macro events (FINDING-2), added client initialization comment (FINDING-3), aligned import paths (FINDING-4). |
| 2026-06-11 | v1.0 | AWS Architect | Initial architecture doc for F-01 from SRS v1.5, F-04 v1.1, domain decomposition v1.0 |

---

## 0. v3 GitHub/Slack Linkage CR — Authoritative Behavior Overlay

> **AUTHORITATIVE (2026-07-02).** This section states the locked behaviour for the two MCP tools under
> the GitHub↔Slack linkage change request (`docs/phase2/change-requests/2026-07-02-github-slack-linkage-impact.md`
> §v3-5, v3 Final Design of Record). Where the older §3–§9 prose below conflicts, **this section wins**;
> the specific §3.1 (`notify_slack`), §3.2 (`record_progress`), §4.2 (`classifyEvent`) code blocks have
> been updated in place to match. Persistence is **RDS PostgreSQL** (the DynamoDB→RDS migration,
> `docs/phase1/change-requests/2026-06-23-dynamodb-to-rds-migration.md`, is already implemented in
> `postgres.service.ts`); the "DynamoDB" wording that previously survived in §1/§4.3/§5/§6/§7/§9/§10/§11/§12
> was stale doc-drift and has been corrected to RDS PostgreSQL by story P0/CR-11 (this v1.4 revision).

### 0.1 `notify_slack` — dual-channel, bot-token (Decisions D, E)

- **No micro-skip.** The `event_type === 'micro'` early-return is **removed**. Both micro and macro events notify — routed to different channels.
- **Resolve by `github_repo`:** `SELECT jira_key, slack_micro_channel_id, slack_macro_channel_id FROM projects WHERE github_repo = $1`. No matching project → `{ notified: false, reason: 'channel_not_configured' }` (graceful; no repo/SSM path/secret leaked).
- **Route by `event_type`:** `event_type==='macro'` → `slack_macro_channel_id`; else `slack_micro_channel_id`. A NULL resolved channel id → `{ notified: false, reason: 'channel_not_configured' }`.
- **Bot token, not webhook:** post via `POST https://slack.com/api/chat.postMessage` with `Authorization: Bearer <token>`, `{ channel, text }`. The token is a single workspace-level SSM SecureString (`/kiro-governance/slack/bot-token`, 5-min cache). Treat HTTP-200 with `{ ok:false }` as an error → `{ notified:false, reason:'slack_error:<error>' }`.
- **Project-labelled + sanitized:** message is `[${jira_key}] ${message}` (jira_key, not repo). Before posting, strip/escape Slack broadcast tokens (`<!here>`, `<!channel>`, `<!everyone>`) and `<@…>`/`<#…>` link syntax (SEC-L1) so a crafted `update_text` cannot trigger mass mentions.
- **Two-token split (SEC-M1):** the runtime token used here is `chat:write`-only (cannot create/rename channels). Channel provisioning scopes (`channels:read` + `channels:manage`) live on a separate credential held only by the DeliverPro app's link/onboarding path. No `admin.*` scope on either. The `notify_slack` role reads only the runtime token ARN.
- **Transition fallback (PLAN-H2b):** do NOT delete the legacy webhook path at cutover. If a project has no channel ids configured yet BUT a legacy webhook param exists for its repo, fall back to the webhook post and log a deprecation warning — prevents currently-notifying repos going dark. Retire the webhook path + per-repo params only after CR-06 backfill + channel configuration validate for every notifying repo.

### 0.2 `record_progress` — resolve-or-reject (Decision G)

- After classification, **resolve the project before writing**: `SELECT jira_key FROM projects WHERE github_repo = $1 LIMIT 1` (via `resolveProject()` in `postgres.service.ts`). Applies to BOTH macro and micro events.
- 0 rows → **hard reject**: `{ written: false, reason: 'no_matching_project' }`; increment a **dimensionless** `GovernanceEventRejected` CloudWatch counter (NO repo dimension — SEC-M/denial-of-wallet); log the repo name to the structured log only. Nothing is stored.
- 1 row → existing classify → dedup → RDS `writeGovernanceEvent` (unchanged). The tool input contract is unchanged (`project_id` remains the repo name).

### 0.3 `classifyEvent` — explicit `type` is authoritative (PLAN-H1)

- The current guard `if (input.flag_override && input.type) return input.type` only honours an explicit `type` when `flag_override` is also true, so a CI `type:'micro'` call whose `update_text` contains a gate-name substring is silently re-classified and stored as `type='macro'` — breaking the CI=micro/app=macro split, the no-double-notify contract, and (future) Level-2.
- **Fix:** a caller-supplied `type` always wins; substring gate-matching applies **only when `type` is absent**. See the corrected §4.2 implementation. Unit test: `classifyEvent({update_text:'SRS approved', type:'micro'}).resolvedType === 'micro'`.

### 0.4 CI = micro / app = macro (Decisions F, H)

- The CI/Kiro path (`scripts/governance-trigger.js`) owns **micro** notifications; the DeliverPro app owns **macro** notifications (on in-app gate approval). No single event produces both — no double-notify. See `github-trigger-architecture.md` and `gates-architecture.md` §5.3.
- **App→macro trigger:** on in-app macro-gate approval the app calls THIS `notify_slack` with `event_type:'macro'`, `project_id = <project.github_repo>`. If the project is unlinked (`github_repo IS NULL`) the app **skips the call entirely** — it does NOT call with a null `project_id` (the input is `z.string().min(1)`; a null fails validation, not a graceful reason). This is PLAN-L3.

### 0.5 Append-only DB hardening (SEC-H1)

The runtime MCP role — the dedicated non-master **`kiro_mcp_app`** (`NOSUPERUSER`) — is append-only on `governance_events` (INSERT, SELECT) and column-scoped read-only on `projects` — enforced by **reassigning table ownership** to a non-runtime `kiro_migrator` role (a plain `REVOKE` is cosmetic because the tables were previously owned by the connecting role). `kiro_migrator` is `NOINHERIT` and the runtime role is not a member of it. **Blocking pre-implementation caveat (iam-review Finding 2):** the RDS **master user is `kiro_mcp`** (rds_superuser), and reusing that same name for the runtime role caused its grants to be bypassed — the runtime role is therefore a DISTINCT `kiro_mcp_app`, and the master is admin/migrations only. Append-only is only a real DB guarantee once the MCP runtime authenticates as the non-master `kiro_mcp_app` (GATE 2 — `DB_USER=kiro_mcp_app` + IAM `rds-db:connect` ARN). See `migrations/V005__append_only_hardening.sql` (CR-01A) and `docs/phase2/architecture/unified-data-model.md` §4.4.4. V001's invalid `CREATE USER IF NOT EXISTS kiro_mcp` is superseded by the V005 DO-block role guards (SEC-L4).

### 0.6 Cross-project isolation — shared-key residual risk (SEC-H2, recorded)

Under the shared MCP API key, a key holder can assert **another linked project's** repo name and post to that project's channel / mis-attribute governance events. No-orphan (§0.2) blocks only *unlinked* repos; a valid other-project repo still resolves. **Human decision recorded (2026-07-02 go-ahead, D-v3-8):** Level 1 ships under **POC risk-accept**; GitHub OIDC per-repo identity (which structurally closes this) and Level 2 are **deferred** from this build. Compensating controls in force: no-orphan + append-only bound tampering to *insert-with-wrong-attribution* (never edit/delete); Slack posts limited to app-provisioned channels; dimensionless rejection metric + structured logs. This risk-accept is recorded in `docs/phase2/srs.md` (§NFR security) and must be revisited before Level 2.

### 0.7 App→MCP macro-call identity (SEC-M3, recorded)

The DeliverPro app's macro `notify_slack` call currently uses the **same shared API key** as the CI path. Recommended hardening (deferred with OIDC): a distinct app service identity for the app→MCP calls. For the POC this is accepted under the same SEC-H2 risk-accept; noted here so it is not lost.

---

**Domain:** MCP Server Core
**Feature:** F-01 — MCP Server — Tools, Classification & Deduplication
**Purpose:** EC2-hosted MCP server exposing two tools (`notify_slack`, `record_progress`) with inline macro/micro auto-classification and idempotency-key-based deduplication.

**FRs Owned:**

| FR | Title | Summary |
|----|-------|---------|
| FR-01 | Slack Notification Tool | POST to per-project Slack channel on governance events |
| FR-02 | Governance Event Write Tool | Write governance event record to the RDS PostgreSQL `governance_events` table |
| FR-03 | Macro/Micro Auto-Classification | Classify events using 10 canonical macro-gate lingo matches |
| FR-09 | Dual Trigger Path Consistency | Deduplication via `INSERT … ON CONFLICT (idempotency_key) DO NOTHING` |

**Dependencies:**

| Dependency | Document | What F-01 Consumes |
|-----------|----------|-------------------|
| F-04 — Data & Persistence | `docs/phase1/data-persistence-architecture.md` v1.1 | `GovernanceEventRecord` type, RDS PostgreSQL `governance_events` schema (V001), `ON CONFLICT (idempotency_key)` dedup pattern, RDS IAM auth, SSM parameter paths |

---

## 2. MCP Server — Technology & Hosting

### 2.1 Runtime

| Property | Value | Source |
|----------|-------|--------|
| Language | TypeScript (Node.js 20 LTS) | `Architect decision — not customer-specified` |
| MCP SDK | `@modelcontextprotocol/sdk` (official TypeScript SDK) | `Architect decision — not customer-specified` |
| Hosting | EC2 instance, `us-east-1` | SRS §6, Project Brief §6 |

### 2.2 EC2 Instance Type

| Option | Instance | vCPU | Memory | On-Demand Cost | Monthly |
|--------|----------|------|--------|----------------|---------|
| **Recommended** | t3.micro | 2 | 1 GiB | $0.0104/hr | ~$7.49/mo |
| Alternative | t3.small | 2 | 2 GiB | $0.0208/hr | ~$14.98/mo |

> `Architect decision — not customer-specified:` **t3.micro** selected. Rationale: (1) SRS NFR-05 states ~$8/mo budget for EC2; (2) MCP server is a lightweight HTTP server with negligible memory footprint — no heavy computation; (3) POC volume is <100 requests/day; (4) 1 GiB RAM is sufficient for Node.js process + AWS SDK overhead. Upgrade to t3.small if memory pressure observed.

### 2.3 Process Management

| Property | Value | Source |
|----------|-------|--------|
| Process manager | `systemd` | `Architect decision — not customer-specified` |
| Service name | `kiro-mcp-server.service` | `Architect decision — not customer-specified` |
| Auto-restart | `Restart=on-failure` | `Architect decision — not customer-specified` |

> `Architect decision — not customer-specified:` `systemd` over PM2 because: (1) zero additional dependency; (2) native to Amazon Linux 2023; (3) automatic restart on crash; (4) journal logging integrates with CloudWatch agent.

### 2.4 Transport & Port

| Property | Value | Source |
|----------|-------|--------|
| Transport | HTTPS + SSE (Streamable HTTP over TLS) | SRS §4.3 Assumption A-02: "Kiro has native MCP support, including remote servers" |
| Port | `443` | `Architect decision — not customer-specified` |
| TLS | Self-signed certificate (RSA 4096-bit, 365-day validity) generated on EC2 at startup | `Architect decision — not customer-specified` |
| Cert fingerprint | Stored as GitHub Encrypted Secret `MCP_CERT_FINGERPRINT` and in agent config | `Architect decision — not customer-specified` |
| MCP endpoint | `POST /mcp` | MCP Streamable HTTP spec |
| Health check | `GET /health` | `Architect decision — not customer-specified` |

> `Architect decision — not customer-specified:` HTTPS/SSE transport chosen over stdio because: (1) Kiro supports remote MCP servers (A-02); (2) GitHub Actions must reach the server over the network; (3) stdio requires co-location which defeats the purpose of a shared EC2 server.

> `Architect decision — not customer-specified:` Self-signed cert (Option B) chosen for POC to eliminate plaintext key transmission at zero additional cost. Upgrade to ACM+ALB for production.

### 2.5 Security Group Rules

**Security Group Name:** `kiro-gov-mcp-server-sg`

| Rule | Type | Protocol | Port | Source | Purpose |
|------|------|----------|------|--------|---------|
| Inbound | TCP | HTTPS | 443 | 0.0.0.0/0 | GitHub Actions (dynamic IPs) + Kiro agent tool calls |
| Inbound | TCP | SSH | 22 | Admin CIDR (specific IP) | Maintenance only |
| Outbound | TCP | HTTPS | 443 | 0.0.0.0/0 | Slack API, SSM API |
| Outbound | TCP | PostgreSQL | 5432 | RDS security group | RDS PostgreSQL (`governance_events` writes via IAM auth) |

> `Architect decision — not customer-specified:` The EC2 instance has a **public Elastic IP**. Inbound port 443 is open to `0.0.0.0/0` because GitHub Actions runners use dynamic IPs (published at `https://api.github.com/meta` under the `actions` key) making CIDR allowlisting impractical, and developer machines running the Kiro agent may also have dynamic IPs.

> `Architect decision — not customer-specified:` For POC, port 443 is open to 0.0.0.0/0. API key + TLS provides adequate protection for internal tooling. Restrict to specific CIDRs in production.

---

## 3. Tool Definitions (MCP Tools)

### 3.1 Tool: `notify_slack` (FR-01)

**Tool name (exact string):** `notify_slack`

**Input Schema:**

```typescript
import { z } from 'zod';

export const NotifySlackInputSchema = z.object({
  project_id: z.string().min(1).describe('GitHub repository name'),
  message: z.string().min(1).describe('Notification message text'),
  event_type: z.enum(['macro', 'micro']).describe('Event classification — routes to micro vs macro channel'),
});

export type NotifySlackInput = z.infer<typeof NotifySlackInputSchema>;
```

**Output Schema:**

```typescript
export interface NotifySlackOutput {
  notified: boolean;
  reason?: string;
}
```

**Handler Logic (v3 — dual-channel bot token; see §0.1):**

```typescript
import { resolveProjectChannels } from '../services/postgres.service';
import { getBotToken, postMessage } from '../services/slack.service';

// Strip/escape Slack broadcast + link syntax so a crafted update_text cannot mass-mention (SEC-L1).
function sanitizeForSlack(text: string): string {
  return text
    .replace(/<!(here|channel|everyone)>/gi, '')
    .replace(/<([@#][^>]*)>/g, '$1'); // neutralize <@U…>/<#C…> link syntax
}

async function handleNotifySlack(input: NotifySlackInput): Promise<NotifySlackOutput> {
  // 1. Resolve the project + its dual channel ids by GitHub repo (NO micro-skip — v3).
  const project = await resolveProjectChannels(input.project_id); // SELECT jira_key, slack_micro_channel_id, slack_macro_channel_id FROM projects WHERE github_repo = $1
  if (!project) {
    return { notified: false, reason: 'channel_not_configured' }; // no repo/SSM path/secret leaked
  }

  // 2. Route by event_type.
  const channelId =
    input.event_type === 'macro' ? project.slack_macro_channel_id : project.slack_micro_channel_id;
  if (!channelId) {
    return { notified: false, reason: 'channel_not_configured' }; // graceful skip when unconfigured
  }

  // 3. Post via bot token + chat.postMessage. Project-labelled with jira_key (not repo).
  const token = await getBotToken(); // SSM SecureString, single workspace param, 5-min cache
  const text = `[${project.jira_key}] ${sanitizeForSlack(input.message)}`;
  const result = await postMessage(token, channelId, text); // Slack returns HTTP 200 even on {ok:false}
  if (!result.ok) {
    return { notified: false, reason: `slack_error: ${result.error}` };
  }
  return { notified: true };
}
```

> **Transition fallback (PLAN-H2b):** if `project` has no channel ids yet but a legacy webhook param
> exists for its repo, fall back to the webhook post and log a deprecation warning (see §0.1) — retire
> only after CR-06 backfill + channel config validate for every notifying repo.

---

### 3.2 Tool: `record_progress` (FR-02, FR-03, FR-09)

**Tool name (exact string):** `record_progress`

**Input Schema:**

```typescript
import { z } from 'zod';

export const RecordProgressInputSchema = z.object({
  project_id: z.string().min(1).describe('GitHub repository name'),
  update_text: z.string().min(1).max(4096).describe('Human-readable event description'),
  type: z.enum(['macro', 'micro']).optional().describe('Event type — if omitted, auto-classified'),
  gate: z.string().optional().describe('Canonical macro gate name'),
  phase: z.string().optional().describe('Phase grouping (e.g., "Phase 1")'),
  source_ref: z.string().min(1).describe('Commit SHA or file line reference'),
  actor: z.string().min(1).describe('Who emitted/approved'),
  flag_override: z.boolean().optional().describe('True if type was manually set'),
});

export type RecordProgressInput = z.infer<typeof RecordProgressInputSchema>;
```

**Output Schema (two-reason-code model):**

```typescript
export interface RecordProgressOutput {
  written: boolean;
  // Present ONLY when written === false. Exactly two values are possible — this is the
  // complete "two-reason-code" model for a non-write:
  //   'no_matching_project' — no-orphan reject (FR-P2-038): no projects row has
  //                           github_repo = project_id, so nothing is stored. A
  //                           dimensionless GovernanceEventRejected metric increments
  //                           and the repo name is logged (structured log only).
  //   'duplicate'           — dedup hit (FR-09): an event with the same
  //                           idempotency_key already exists (ON CONFLICT), so the
  //                           insert is a no-op. Not an error — safe to ignore.
  // When written === true, reason is omitted. Callers (CI trigger, orchestrator) branch on
  // these two codes only; any other value is unexpected.
  reason?: 'no_matching_project' | 'duplicate';
}
```

> **Two-reason-code model (reconciled):** `written:false` carries exactly one of
> `no_matching_project` (no-orphan resolve-or-reject, §3.2 step 2 / §4.4.5 of the data model) or
> `duplicate` (idempotency-key dedup, §3.2 step 4). Both are non-fatal to the caller: the CI
> trigger logs and continues on `no_matching_project` (unlinked repo = feature switch off) and
> skips the follow-on `notify_slack` on either code (nothing new was written).

**Handler Logic (v3 — resolve-or-reject + RDS persistence; see §0.2):**

```typescript
import { ulid } from 'ulid';
import { classifyEvent, MACRO_GATES } from '../../packages/shared/constants/macro-gates';
import { resolveProject, writeGovernanceEvent } from '../services/postgres.service';
import { metrics } from '../observability'; // Powertools Metrics

async function handleRecordProgress(input: RecordProgressInput): Promise<RecordProgressOutput> {
  // 1. Classify event (FR-03). Explicit `type` is authoritative — see §0.3 / §4.2.
  const { resolvedType, matchedGate } = classifyEvent(input);

  // 2. NO-ORPHAN resolve-or-reject (FR-P2-038). Applies to BOTH macro and micro.
  const project = await resolveProject(input.project_id); // SELECT jira_key FROM projects WHERE github_repo = $1 LIMIT 1
  if (!project) {
    metrics.addMetric('GovernanceEventRejected', MetricUnit.Count, 1); // dimensionless — no repo dimension
    logger.warn('Governance event rejected — no matching project', { repo: input.project_id }); // repo in log only
    return { written: false, reason: 'no_matching_project' };
  }

  // 3. Resolve gate for macro events (gate auto-derivation, unchanged).
  let resolvedGate: string | undefined;
  if (input.gate) {
    resolvedGate = input.gate.toLowerCase().trim();
  } else if (resolvedType === 'macro' && matchedGate) {
    resolvedGate = matchedGate;
  }

  // 4. Write to RDS PostgreSQL with dedup (FR-09). Persistence is PostgreSQL — NOT DynamoDB
  //    (DynamoDB→RDS migration 2026-06-23 is already implemented in postgres.service.ts).
  const eventUlid = ulid();
  const result = await writeGovernanceEvent({
    project_id: input.project_id, // repo name — stored as-is; timeline joins via projects.github_repo
    update_text: input.update_text,
    type: resolvedType,
    gate: resolvedGate,
    phase: input.phase,
    source_ref: input.source_ref,
    actor: input.actor,
    flag_override: input.flag_override,
  }, eventUlid);

  if (!result.written) {
    return { written: false, reason: result.reason }; // 'duplicate'
  }
  return { written: true };
}
```

> **Note (P0/CR-11 — resolved):** `record_progress` persists to **RDS PostgreSQL** via
> `postgres.service.ts` (`writeGovernanceEvent`, dedup via `ON CONFLICT (idempotency_key)`), not
> DynamoDB. All "DynamoDB" references elsewhere in this doc were stale and have been corrected to RDS PostgreSQL in this v1.4 revision.

---

## 4. Macro/Micro Classification Logic (FR-03)

### 4.1 Canonical 10-Gate List

> Source: SRS §16 — "Canonical macro gates (from the methodology diagram)"

```typescript
/**
 * Canonical macro gates from SRS §16.
 * Shared constant — imported by MCP Server (F-01) and GitHub Trigger (F-03).
 * Location: packages/shared/constants/macro-gates.ts
 */
export const MACRO_GATES = [
  'Discovery outputs validated',
  'Preliminary SRS validated',
  'SRS approved',
  'Design docs approved',
  'Implementation plan approved',
  'Spec strategy approved',
  'Code approved',
  'UAT report approved',
  'Runbooks approved',
  'Project documentation approved',
] as const;

export type MacroGate = typeof MACRO_GATES[number];

/**
 * Alternative phrasings that map to canonical gates.
 * Source: SRS §16 — "Design docs / solution architecture approved",
 * "Implementation / sprint plan approved", "Runbooks / documentation approved"
 */
export const MACRO_GATE_ALIASES: Record<string, MacroGate> = {
  'solution architecture approved': 'Design docs approved',
  'sprint plan approved': 'Implementation plan approved',
  'documentation approved': 'Runbooks approved',
};
```

### 4.2 Matching Algorithm

> `Architect decision — not customer-specified:` **Case-insensitive substring matching** chosen over regex or exact match.

**Justification:**

| Option | Pros | Cons | Verdict |
|--------|------|------|---------|
| Exact match | Zero false positives | Too brittle — "SRS Approved" ≠ "SRS approved"; fails on slight wording variation | ❌ Rejected |
| Regex | Flexible pattern matching | Over-engineering for 10 static strings; regex maintenance overhead | ❌ Rejected |
| **Substring (case-insensitive)** | Tolerant of natural language variation; simple to implement and debug | Slight false-positive risk (mitigated by `flag_override`) | ✅ Selected |

**Implementation:**

```typescript
import { MACRO_GATES, MACRO_GATE_ALIASES } from '../../packages/shared/constants/macro-gates';

/**
 * Classify an event as macro or micro based on update_text content.
 * If flag_override is true, the caller-provided type is used as-is.
 * Returns resolvedType and (if macro) the matchedGate canonical name.
 */
export function classifyEvent(input: {
  update_text: string;
  type?: 'macro' | 'micro';
  flag_override?: boolean;
}): { resolvedType: 'macro' | 'micro'; matchedGate?: string } {
  // PLAN-H1 FIX: an explicit caller-supplied `type` is AUTHORITATIVE — it always wins, whether or
  // not flag_override is set. Substring gate-matching runs ONLY when `type` is absent. This prevents
  // a CI `type:'micro'` call whose update_text contains a gate-name substring (e.g. "SRS approved")
  // from being silently re-classified and stored as macro (which would break the CI=micro/app=macro
  // split, the no-double-notify contract, and future Level-2). flag_override remains persisted as an
  // audit marker but is no longer required for the explicit type to be honoured.
  if (input.type) {
    if (input.type === 'macro') {
      // Derive the canonical gate label for a caller-asserted macro (best-effort, for dedup/label).
      const text = input.update_text.toLowerCase();
      for (const gate of MACRO_GATES) {
        if (text.includes(gate.toLowerCase())) return { resolvedType: 'macro', matchedGate: gate };
      }
      for (const alias of Object.keys(MACRO_GATE_ALIASES)) {
        if (text.includes(alias.toLowerCase())) {
          return { resolvedType: 'macro', matchedGate: MACRO_GATE_ALIASES[alias] };
        }
      }
      return { resolvedType: 'macro' };
    }
    return { resolvedType: 'micro' }; // explicit micro — never re-derive to macro
  }

  // No explicit type → auto-classify from update_text content.
  const text = input.update_text.toLowerCase();

  // Check canonical gates
  for (const gate of MACRO_GATES) {
    if (text.includes(gate.toLowerCase())) {
      return { resolvedType: 'macro', matchedGate: gate };
    }
  }

  // Check aliases
  for (const alias of Object.keys(MACRO_GATE_ALIASES)) {
    if (text.includes(alias.toLowerCase())) {
      return { resolvedType: 'macro', matchedGate: MACRO_GATE_ALIASES[alias] };
    }
  }

  return { resolvedType: 'micro' };
}
```

> **Unit test (PLAN-H1):** `classifyEvent({ update_text: 'SRS approved', type: 'micro' }).resolvedType === 'micro'` — an explicit `type` must win over a gate-name substring.

### 4.3 `flag_override` Handling

> Source: SRS FR-03 — "A manual `flag_override` shall allow correction of the auto-classification."

- When `flag_override: true` is present in the tool call, the `type` field provided by the caller is stored verbatim — no auto-classification runs.
- The `flag_override` attribute is persisted in the PostgreSQL `governance_events.flag_override` column as an audit marker (per F-04 §2.3).
- When `flag_override` is absent or `false`, auto-classification determines `type`.

### 4.4 Shared Module Location

> Source: Domain Decomposition §6 Note 5 — "The source-of-truth gate list must be shared"

```
packages/
└── shared/
    └── constants/
        └── macro-gates.ts    ← MACRO_GATES, MACRO_GATE_ALIASES, classifyEvent()
```

- **F-01 (MCP Server)** imports `classifyEvent` for inline classification during `record_progress`.
- **F-03 (GitHub Trigger)** imports `MACRO_GATES` + `MACRO_GATE_ALIASES` for diff-line matching in the workflow script.
- Single source of truth — no duplication.

---

## 5. Deduplication Logic (FR-09)

Deduplication is enforced in **RDS PostgreSQL** by a single atomic upsert — `INSERT … ON CONFLICT (idempotency_key) DO NOTHING` — against the `UNIQUE (idempotency_key)` constraint on `governance_events` (V001). There is no separate sentinel record and no `pk`/`sk` — the DynamoDB conditional-PutItem sentinel pattern was replaced by the migration to RDS (2026-06-23 CR; DynamoDB code removed in CR-11).

### 5.1 Idempotency Key Construction

> Source: SRS FR-09 — "Deduplication uses an idempotency key composed of: `PROJECT#<project_id>` + gate name + day-granularity date (YYYY-MM-DD)." Implemented by `buildIdempotencyKey()` in `tools/record-progress.ts`.

```
Macro events:  <project_id>#<gate.toLowerCase().trim()>#<YYYY-MM-DD>
Micro events:  <project_id>#micro#<ULID>   (always unique — no dedup needed)
```

The composed string is stored in the `governance_events.idempotency_key` column (`TEXT NOT NULL`, `CONSTRAINT uq_idempotency UNIQUE`).

> `Architect decision — not customer-specified:` gate names are normalized to lowercase+trimmed before building the idempotency key to prevent case-sensitivity bypass. Callers should use values from the MACRO_GATES constant but normalization provides a safety net.

### 5.2 Unique Constraint (dedup mechanism)

Per V001 / F-04 §5.1, dedup is a table-level constraint — no sentinel row:

| Object | Definition |
|--------|-----------|
| Column | `idempotency_key TEXT NOT NULL` on `governance_events` |
| Constraint | `CONSTRAINT uq_idempotency UNIQUE (idempotency_key)` |
| Write pattern | `INSERT INTO governance_events (…) VALUES (…) ON CONFLICT (idempotency_key) DO NOTHING` |
| Duplicate signal | `result.rowCount === 0` → the row already existed → `{ written: false, reason: 'duplicate' }` |

The event row itself carries all governance fields (`project_id`, `update_text`, `type`, `flag_override`, `gate`, `phase`, `phase_name`, `source_ref`, `actor`, `created_at`, `idempotency_key`). Writes use RDS IAM auth (`postgres.service.ts`, `Signer`, 14-min token refresh) and run under the append-only runtime role `kiro_mcp` (INSERT + SELECT only; V005).

### 5.3 Dedup Flow

```
record_progress called
  │
  ├─ classify (macro/micro) → build idempotency_key
  │       macro: <project_id>#<gate>#<YYYY-MM-DD>   micro: <project_id>#micro#<ULID>
  │
  └─ INSERT … ON CONFLICT (idempotency_key) DO NOTHING
        │
        ├─ rowCount == 1 ──▶ new row written → { written: true }
        │
        └─ rowCount == 0 ──▶ idempotency_key already present → { written: false, reason: 'duplicate' }
```

Micro events use a ULID in the key so they are always unique — the `ON CONFLICT` clause never fires for them; macro events collapse to one row per `project_id`+gate+day.

### 5.4 Duplicate Detected Behavior

When a duplicate is detected (`rowCount === 0`):
1. **Return** `{ written: false, reason: 'duplicate' }` to the caller
2. **Log** at INFO level: `Dedup hit: idempotency_key=<key>`
3. **No Slack re-fire** — the `notify_slack` tool is only called by the orchestrator/workflow *after* a successful `record_progress` write. If `record_progress` returns duplicate, the caller must not proceed with `notify_slack`.

> `Architect decision — not customer-specified:` Dedup enforcement is in `record_progress` only, delegated to the PostgreSQL unique constraint (single atomic statement — no read-then-write race). The caller (Agent Integration / GitHub Trigger) is responsible for checking the return value and skipping `notify_slack` on duplicate. This keeps dedup logic centralized in F-01.

---

## 6. Slack Integration

### 6.1 `chat.postMessage` Request Format

> Source: Slack Web API `chat.postMessage` (bot-token model — CR-05/CR-09). Replaces the retired per-project Incoming Webhook.

`notify_slack` posts via the Slack Web API using the workspace bot token:

```
POST https://slack.com/api/chat.postMessage
Authorization: Bearer <workspace bot token from SSM>
Content-Type: application/json; charset=utf-8

{
  "channel": "C0123ABCD",                 // resolved per event_type (see §6.3)
  "text": "[DP-001] SRS approved by human — gate: SRS approved"
}
```

**Note:** Slack returns HTTP 200 even on logical failure — the response body
`{ ok: false, error }` MUST be inspected. `error` is a Slack error code (e.g.
`channel_not_found`, `not_in_channel`) and never contains the token.

### 6.2 Message Format Template

```
[{jira_key}] {sanitized message}
```

Where:
- `{jira_key}` = the linked project's business key (e.g. `DP-001`) — **project-labelled, NOT the raw GitHub repo name** (CR-09 / FR-P2-039).
- `{sanitized message}` = the `message` parameter, with Slack control characters (`&`, `<`, `>`) escaped so a crafted message cannot inject `<!channel>` / `<!here>` / `<@…>` / `<#…>` broadcast or mention tokens (SEC-L1). The body is length-capped to 3000 chars (truncated with an ellipsis, never silently dropped — CR-05 LOW #2).

> `Architect decision — not customer-specified:` project-key label enables at-a-glance identification and decouples the display from the repo name.

### 6.3 Project + Channel Resolution (dual-channel routing)

`notify_slack` resolves the destination from RDS `projects` by `github_repo` (= the
`project_id` = repo name), then routes by `event_type`:

```
resolveProject(project_id) →
  { jira_key, slack_micro_channel_id, slack_macro_channel_id } | null

  null                          → { notified:false, reason:'no_matching_project' }   (graceful skip)
  event_type = 'micro'          → channel = slack_micro_channel_id
  event_type = 'macro'          → channel = slack_macro_channel_id
  channel IS NULL               → { notified:false, reason:'channel_not_configured' } (graceful skip)
```

The channel ids are non-secret and live in PostgreSQL (CR-01A column-scoped grant:
`SELECT (jira_key, github_repo, slack_micro_channel_id, slack_macro_channel_id)`).
The **bot token** is the only secret and is read from SSM SecureString
(`/kiro-governance/slack/bot-token`, single workspace param), cached 5 min — never a
PG column, API response, or log line.

> Source: v3 CR §v3-5.2 (Decisions D, E). The legacy per-repo webhook path
> (`/kiro-governance/slack/webhooks/{repo}`) is retired from the runtime routing;
> `getWebhookUrl`/`postToSlack` remain `@deprecated` only as the CR-06 transition
> fallback (PLAN-H2b) and are no longer called by `notify_slack`.

### 6.4 Error Handling

| Scenario | Behavior | Source |
|----------|----------|--------|
| No project matches the repo | Return `{ notified: false, reason: 'no_matching_project' }` (graceful skip) | v3 CR §v3-5.2 |
| Channel for the event_type is unconfigured (NULL) | Return `{ notified: false, reason: 'channel_not_configured' }` (graceful skip) | v3 CR §v3-5.2 |
| Malformed channel id | Return `{ notified: false, reason: 'invalid_channel' }` (never posts) | CR-05 LOW #2 |
| Bot token missing/SSM error | Return `{ notified: false, reason: 'bot_token_not_found' \| 'ssm_error' }` (no SSM path leaked) | SEC-M1 |
| Slack `{ ok:false }` / non-2xx | Return `{ notified: false, reason: '<slack error code>' }` (e.g. `slack_api_error`). DB write is unaffected (independent job). | SRS NFR-02 |
| Slack timeout (>3s) | Abort fetch, return `{ notified: false, reason: 'slack_timeout' }` | `Architect decision — not customer-specified` |
| Network unreachable | Return `{ notified: false, reason: 'slack_network_error' }` | `Architect decision — not customer-specified` |

> SRS NFR-02: "the two jobs are independent" — `notify_slack` and `record_progress` are separate tool calls. A Slack failure in `notify_slack` never blocks or rolls back a `record_progress` RDS PostgreSQL write. No reason string ever contains the bot token, an SSM path, or the raw repo name.

---

## 7. Configuration & Secrets

### 7.1 SSM Parameter Store Paths

| Path | Type | Used By | Source |
|------|------|---------|--------|
| `/kiro-governance/slack/bot-token` | SecureString | `notify_slack` — workspace **bot token** (`chat:write`-only runtime scope) for `chat.postMessage` | v3 CR §v3-5.2 (Decisions D, E), SEC-M1 |
| `/kiro-governance/slack/webhooks/{project_id}` | SecureString | **DEPRECATED (transition fallback only)** — legacy per-project webhook; retire after CR-06 backfill + channel config validate for every notifying repo | v3 CR §v3-5.3 (PLAN-H2b) |
| `/kiro-governance/config/mcp-api-key` | SecureString | Request auth validation (GitHub Actions → MCP) | SRS NFR-03, OQ-04 |
| ~~`/kiro-governance/config/table-name`~~ | ~~String~~ | **REMOVED** — DynamoDB table name; unused by the RDS path (dropped from `loadServerConfig()` + `ServerConfig`, story CR-11) | v3 CR §v3-5.6 |
| `/kiro-governance/config/region` | String | AWS region for SDK clients | F-04 §6.2 |
| `/kiro-governance/config/db-endpoint`, `db-port`, `db-name`, `db-user` | String | RDS IAM connection (`postgres.service.ts`) | 2026-06-23 DynamoDB→RDS CR |

> **Two-token split (SEC-M1):** the runtime bot token above is `chat:write`-only. The channel
> **provisioning** credential (`channels:read` + `channels:manage` for `conversations.list`/`create`)
> is a SEPARATE secret held only by the DeliverPro app's link/onboarding path — the `notify_slack`
> role can read only the runtime token ARN. Neither credential carries any `admin.*` scope.

> **Bot token is a SECRET** — SSM SecureString (default `aws/ssm` KMS key) or Secrets Manager. Never a
> `projects` column, an API response field, or a log line. IAM `ssm:GetParameter` + `kms:Decrypt`
> scoped to the single token ARN only (not `/kiro-governance/*`). CMK for tight decrypt-scoping is
> optional (~$1/mo, OQ-CR-18).

> `Architect decision — not customer-specified:` The shared API key provides no per-caller identity. Any process with the key and network access can call the MCP server. The `actor` field in `record_progress` is caller-supplied and unverified — it is an audit annotation, not an authenticated identity. Accepted risk for POC — all callers are internal (Kiro agents, GitHub Actions). Upgrade to per-client JWTs or mTLS for production.

### 7.2 Environment Variables (Non-Secret)

| Variable | Value | Purpose |
|----------|-------|---------|
| `PORT` | `443` | HTTPS listen port |
| `TLS_CERT_PATH` | `/opt/kiro-governance/cert.pem` | Self-signed TLS certificate |
| `TLS_KEY_PATH` | `/opt/kiro-governance/key.pem` | TLS private key |
| `NODE_ENV` | `production` | Runtime mode |
| `LOG_LEVEL` | `info` | CloudWatch log verbosity |
| `AWS_REGION` | `us-east-1` | SDK default region (also from instance metadata) |

### 7.3 Bootstrap Strategy

> `Architect decision — not customer-specified:` **Eager load on startup** for non-secret config; **lazy load per-request** for webhook URLs.

| Config Type | Load Strategy | Rationale |
|-------------|---------------|-----------|
| Region, API key | Load on startup (cache in memory) | Static values that never change during runtime |
| Slack webhook URLs | Load per-request (with 5-min TTL cache) | New projects may be added without server restart |

```typescript
// Startup config (loaded once from SSM: /kiro-governance/config/region + /mcp-api-key)
interface ServerConfig {
  region: string;
  apiKey: string;
}

// Webhook cache (TTL-based)
const webhookCache = new Map<string, { url: string; expiresAt: number }>();
const WEBHOOK_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
```

---

## 8. EC2 Deployment

### 8.1 User Data / Startup Script Outline

```bash
#!/bin/bash
set -euo pipefail

# Install Node.js 20 LTS
curl -fsSL https://rpm.nodesource.com/setup_20.x | bash -
yum install -y nodejs git

# Install CloudWatch agent
yum install -y amazon-cloudwatch-agent
/opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl \
  -a fetch-config -m ec2 -s -c ssm:/kiro-governance/config/cloudwatch-agent

# Clone and build
cd /opt
git clone <repo-url> kiro-governance
cd kiro-governance
npm ci --production
npm run build

# Generate self-signed TLS certificate (if not already present)
if [ ! -f /opt/kiro-governance/cert.pem ]; then
  openssl req -x509 -newkey rsa:4096 \
    -keyout /opt/kiro-governance/key.pem \
    -out /opt/kiro-governance/cert.pem \
    -days 365 -nodes -subj "/CN=kiro-gov-mcp"
  # Log fingerprint for manual retrieval
  openssl x509 -in /opt/kiro-governance/cert.pem -noout -fingerprint -sha256
fi

# Create systemd service
cat > /etc/systemd/system/kiro-mcp-server.service << 'EOF'
[Unit]
Description=Kiro Governance MCP Server
After=network.target

[Service]
Type=simple
User=ec2-user
WorkingDirectory=/opt/kiro-governance
ExecStart=/usr/bin/node dist/server.js
Restart=on-failure
RestartSec=5
Environment=NODE_ENV=production
Environment=PORT=443
Environment=TLS_CERT_PATH=/opt/kiro-governance/cert.pem
Environment=TLS_KEY_PATH=/opt/kiro-governance/key.pem
Environment=LOG_LEVEL=info
AmbientCapabilities=CAP_NET_BIND_SERVICE

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable kiro-mcp-server
systemctl start kiro-mcp-server
```

### 8.2 Network Reachability

> `Architect decision — not customer-specified:` For POC, the EC2 instance has a **public Elastic IP** with security group restricting inbound to port 443 open to 0.0.0.0/0 (GitHub Actions dynamic IPs make allowlisting impractical). API key + TLS provides adequate protection for internal tooling. Restrict to specific CIDRs in production.

| Client | Access Method |
|--------|-------------|
| GitHub Actions | HTTPS to `https://<elastic-ip>:443/mcp` with `X-API-Key` header; TLS verification via pinned cert fingerprint |
| Kiro agent | MCP remote server connection to `https://<elastic-ip>:443/mcp`; TLS verification via pinned cert fingerprint |

**Authentication:** All clients include `X-API-Key: <secret>` header. MCP server validates against the value in SSM `/kiro-governance/config/mcp-api-key`.

> `Architect decision — not customer-specified:` For production, replace public IP with ALB + ACM certificate + WAF. For POC, self-signed cert + API key + security group is sufficient per NFR-03.

**Self-Signed Certificate Generation (run on EC2 at first boot / annual rotation):**

```bash
# Generate self-signed cert (RSA 4096-bit, 365-day validity)
openssl req -x509 -newkey rsa:4096 -keyout /opt/kiro-governance/key.pem -out /opt/kiro-governance/cert.pem -days 365 -nodes -subj "/CN=kiro-gov-mcp"

# Extract cert fingerprint (SHA-256) for pinning
openssl x509 -in /opt/kiro-governance/cert.pem -noout -fingerprint -sha256 | sed 's/sha256 Fingerprint=//;s/://g'
```

The extracted fingerprint must be stored as:
- GitHub Encrypted Secret `MCP_CERT_FINGERPRINT` (for GitHub Actions workflow)
- Environment variable `MCP_CERT_FINGERPRINT` on developer machines (for Kiro agent config)

**Certificate rotation:** Cert expires after 365 days. Rotation requires: (1) regenerate cert on EC2, (2) restart MCP server, (3) update `MCP_CERT_FINGERPRINT` in GitHub Secrets and on developer machines.

> `Architect decision — not customer-specified:` Self-signed cert (Option B) chosen for POC to eliminate plaintext key transmission at zero additional cost. Upgrade to ACM+ALB for production.

### 8.3 Health Check Endpoint

```
GET /health → 200 OK { "status": "ok", "uptime": <seconds> }
```

Used by:
- EC2 auto-recovery (optional CloudWatch alarm on StatusCheckFailed)
- GitHub Actions pre-flight check before tool call

---

## 9. Error Handling & Observability

### 9.1 Per-Tool Error Responses

**`notify_slack` errors:**

| Scenario | Response | HTTP Status (if applicable) |
|----------|----------|----------------------------|
| Success (micro → micro channel, macro → macro channel) | `{ notified: true }` | — |
| No project matches the repo | `{ notified: false, reason: 'no_matching_project' }` | — |
| Channel for the event_type unconfigured (NULL) | `{ notified: false, reason: 'channel_not_configured' }` | — |
| Malformed channel id | `{ notified: false, reason: 'invalid_channel' }` | — |
| Bot token missing / SSM error | `{ notified: false, reason: 'bot_token_not_found' \| 'ssm_error' }` | — |
| Slack `{ ok:false }` / non-2xx | `{ notified: false, reason: '<slack error code>' }` (e.g. `slack_api_error`) | — |
| Slack timeout | `{ notified: false, reason: 'slack_timeout' }` | — |

> Micro events are **no longer skipped** (CR-09) — they route to the project's micro channel. No reason string contains the bot token, an SSM path, or the raw repo name.

**`record_progress` errors:**

| Scenario | Response |
|----------|----------|
| Success | `{ written: true }` |
| Duplicate detected | `{ written: false, reason: 'duplicate' }` |
| PostgreSQL write error | `{ written: false, reason: 'database_write_failed' }` (error logged, not exposed) |
| Invalid input (schema validation) | MCP SDK returns validation error before handler runs |

### 9.2 CloudWatch Log Group

| Property | Value |
|----------|-------|
| Log group | `/kiro-governance/mcp-server` |
| Retention | 30 days |
| Log format | JSON structured (timestamp, level, tool, project_id, duration_ms) |

> `Architect decision — not customer-specified:` 30-day retention balances debuggability with cost for a POC.

### 9.3 Key Metrics

| Metric | Namespace | Dimensions | Source |
|--------|-----------|-----------|--------|
| `ToolInvocationCount` | `KiroGovernance/MCP` | `tool_name`, `project_id` | Emitted per tool call |
| `SlackFailureCount` | `KiroGovernance/MCP` | `project_id`, `error_type` | On non-200 or timeout |
| `PostgresWriteLatency` | `KiroGovernance/MCP` | `project_id` | Duration of the `INSERT … ON CONFLICT` call |
| `DedupHitCount` | `KiroGovernance/MCP` | `project_id`, `gate` | On `ON CONFLICT` no-op (`rowCount === 0`) |

> `Architect decision — not customer-specified:` Custom CloudWatch metrics via `PutMetricData`. At POC volume (<100 events/day), cost is negligible (first 10 custom metrics free).

---

## 10. TypeScript Interfaces

All types consistent with F-04 `GovernanceEventRecord` (§2.5):

```typescript
// ─── Re-export from F-04 shared types ───

export { GovernanceEventRecord, MACRO_GATES, MacroGate } from '../shared/types/governance-event';

// ─── MCP Tool Input/Output Types ───

/** notify_slack input */
export interface NotifySlackInput {
  project_id: string;
  message: string;
  event_type: 'macro' | 'micro';
}

/** notify_slack output */
export interface NotifySlackOutput {
  notified: boolean;
  reason?: string;
}

/** record_progress input */
export interface RecordProgressInput {
  project_id: string;
  update_text: string;
  type?: 'macro' | 'micro';
  gate?: string;
  phase?: string;
  source_ref: string;
  actor: string;
  flag_override?: boolean;
}

/** record_progress output */
export interface RecordProgressOutput {
  written: boolean;
  reason?: string;
}

// ─── Internal Types ───

/** Server startup config (from SSM, cached on boot) */
export interface ServerConfig {
  region: string;
  apiKey: string;
}

/** Webhook cache entry */
export interface WebhookCacheEntry {
  url: string;
  expiresAt: number;
}
```

---

## 11. Edge Cases

| # | Scenario | Handling | Source |
|---|----------|----------|--------|
| 1 | SSM param missing for a `project_id` | `notify_slack` returns `{ notified: false, reason: 'webhook_not_configured' }`. Full SSM path logged internally to CloudWatch for debugging but NOT returned to the MCP caller. Caller (orchestrator/workflow) logs the warning. | `Architect decision — not customer-specified` |
| 2 | Slack API returns non-200 | Return `{ notified: false, reason: 'slack_error: <status>' }`. No retry — caller may retry the entire tool call. DB write (separate tool call) is unaffected. | SRS NFR-02 |
| 3 | Concurrent write with the same idempotency_key (race condition) | `INSERT … ON CONFLICT (idempotency_key) DO NOTHING` returns `rowCount === 0` → return `{ written: false, reason: 'duplicate' }`. This is expected behavior, not an error. Both dual-trigger paths may race; the `UNIQUE (idempotency_key)` constraint guarantees exactly one wins. | SRS FR-09, F-04 §5.1 |
| 4 | Invalid `event_type` in `notify_slack` tool call | Zod schema validation rejects before handler runs. MCP SDK returns a schema validation error to the caller. | `Architect decision — not customer-specified` |
| 5 | MCP server restart mid-request | `systemd` `Restart=on-failure` brings server back in ~5s. In-flight request is lost (no persistence of request state). Caller receives connection error and should retry. Idempotency sentinel ensures no double-write on retry. | `Architect decision — not customer-specified` |
| 6 | `update_text` exceeds 4 KB | Zod schema `.max(4096)` rejects at input validation. Returns schema error. | F-04 §8.1: "Validate `update_text` ≤ 4 KB" |
| 7 | `gate` value not in canonical list | Accepted — `gate` is a free-text column in the `governance_events` table. Classification uses `update_text` content, not the `gate` parameter. Non-canonical gates are stored as-is. | `Architect decision — not customer-specified` |
| 8 | Both trigger paths fire within same second | The `UNIQUE (idempotency_key)` constraint + single atomic `ON CONFLICT` upsert ensures exactly one insert succeeds. PostgreSQL guarantees no duplicate or corrupt row on the same key. | F-04 §5.1 |
| 9 | API key header missing/invalid | Return HTTP 401 before MCP protocol handling. Log as `auth_failure`. | SRS NFR-03 |

---

## 12. Hallucination Gate H2 — Self-Check

| Item | Value | Source |
|------|-------|--------|
| Persistence | RDS PostgreSQL 16 (`governance_events` table, V001) | F-04 §5, 2026-06-23 DynamoDB→RDS CR |
| Table | `governance_events` (single table) | SRS §6, F-04 §5, migration V001 |
| Primary key | `id BIGSERIAL PRIMARY KEY` (surrogate) | migration V001 |
| Dedup mechanism | `idempotency_key TEXT NOT NULL`, `CONSTRAINT uq_idempotency UNIQUE`; `INSERT … ON CONFLICT (idempotency_key) DO NOTHING` | migration V001, F-04 §5.1 |
| Idempotency key (macro) | `<project_id>#<gate>#<YYYY-MM-DD>` | SRS FR-09, F-04 §5.1 |
| Idempotency key (micro) | `<project_id>#micro#<ULID>` | F-04 §5.1 |
| Auth | RDS IAM auth (`postgres.service.ts`, `Signer`, 14-min token refresh) | F-04 §8, 2026-06-23 CR |
| Append-only role model | `kiro_migrator` owns tables; runtime `kiro_mcp` = INSERT+SELECT only | migration V005 (CR-01A) |
| EC2 cost: ~$7.49/mo (t3.micro) | $0.0104/hr × 720hr | AWS Pricing API (validated 2026-06-11) |
| Port: 443 | — | `Architect decision — not customer-specified` |
| Transport: HTTPS/SSE (self-signed TLS) | — | `Architect decision — not customer-specified` (Kiro remote MCP support) |
| Process manager: systemd | — | `Architect decision — not customer-specified` |
| 10 canonical macro gates | Listed in §4.1 | SRS §16 |
| Matching algorithm: case-insensitive substring | — | `Architect decision — not customer-specified` |
| Webhook cache TTL: 5 minutes | — | `Architect decision — not customer-specified` |
| CloudWatch log retention: 30 days | — | `Architect decision — not customer-specified` |
| update_text max: 4096 chars | — | F-04 §8.1 (`Architect decision`) |
| Slack timeout: 5 seconds | — | `Architect decision — not customer-specified` |
| Health endpoint: GET /health | — | `Architect decision — not customer-specified` |
| SSM path: `/kiro-governance/slack/webhooks/{project_id}` | — | SRS FR-01, OQ-01 + OQ-04 |
| SSM path: `/kiro-governance/config/mcp-api-key` | — | SRS NFR-03, OQ-04 |
| project_id = GitHub repository name | — | SRS OQ-02 resolution, Customer (Tariq Khan) 2026-06-11 |
| Gate aliases (3 alternates) | SRS §16 slash-separated variants | SRS §16 |
| Auto-restart: on-failure, 5s delay | — | `Architect decision — not customer-specified` |

---

## 13. Cost Estimate (F-01 Share)

| Component | Monthly Cost | Calculation |
|-----------|-------------|-------------|
| EC2 t3.micro (on-demand, 24/7) | $7.49 | $0.0104/hr × 720 hr |
| Elastic IP (attached) | $0.00 | No charge while attached to running instance |
| CloudWatch Logs (1 GB) | $0.50 | $0.50/GB ingestion |
| CloudWatch custom metrics (4) | $0.00 | First 10 free |
| SSM Parameter Store (Standard) | $0.00 | Free tier |
| **Total F-01** | **~$8.00/mo** | Aligns with SRS NFR-05 |

> Source: SRS NFR-05 — "EC2 hosting: ~$8/mo base config". Validated with AWS Pricing API 2026-06-11.

---

*End of MCP Server Core Architecture v1.4*
