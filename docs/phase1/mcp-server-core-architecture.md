# MCP Server Core Architecture — F-01: Tools, Classification & Deduplication

## Changelog

| Date | Version | Author | Change |
|------|---------|--------|--------|
| 2026-06-11 | v1.2 | AWS Architect | Security Gate 1 fixes: HTTPS/TLS self-signed cert (HIGH-1), public exposure documented (MED-3), shared key accepted risk documented (MED-5), SSM path removed from error response (LOW-8). |
| 2026-06-11 | v1.1 | AWS Architect | Fixed gate normalization in dedup key (FINDING-1), added gate auto-derivation for macro events (FINDING-2), added client initialization comment (FINDING-3), aligned import paths (FINDING-4). |
| 2026-06-11 | v1.0 | AWS Architect | Initial architecture doc for F-01 from SRS v1.5, F-04 v1.1, domain decomposition v1.0 |

---

## 1. Overview

**Domain:** MCP Server Core
**Feature:** F-01 — MCP Server — Tools, Classification & Deduplication
**Purpose:** EC2-hosted MCP server exposing two tools (`notify_slack`, `record_progress`) with inline macro/micro auto-classification and idempotency-key-based deduplication.

**FRs Owned:**

| FR | Title | Summary |
|----|-------|---------|
| FR-01 | Slack Notification Tool | POST to per-project Slack webhook on macro events |
| FR-02 | DynamoDB Write Tool | Write governance event record to `kiro-governance-tracker` |
| FR-03 | Macro/Micro Auto-Classification | Classify events using 10 canonical macro-gate lingo matches |
| FR-09 | Dual Trigger Path Consistency | Deduplication via conditional PutItem sentinel pattern |

**Dependencies:**

| Dependency | Document | What F-01 Consumes |
|-----------|----------|-------------------|
| F-04 — Data & Persistence | `docs/phase1/data-persistence-architecture.md` v1.1 | `GovernanceEventRecord` type, DynamoDB table schema, conditional PutItem dedup pattern, SSM parameter paths |

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
| Outbound | TCP | HTTPS | 443 | 0.0.0.0/0 | Slack API, DynamoDB API, SSM API |

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
  event_type: z.enum(['macro', 'micro']).describe('Event classification'),
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

**Handler Logic:**

```typescript
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';

// ssm and dynamoClient initialized at server startup — see §7.3 Bootstrap Strategy

async function handleNotifySlack(input: NotifySlackInput): Promise<NotifySlackOutput> {
  // 1. If micro, skip notification
  if (input.event_type === 'micro') {
    return { notified: false, reason: 'micro_event' };
  }

  // 2. Resolve webhook URL from SSM
  const ssmPath = `/kiro-governance/slack/webhooks/${input.project_id}`;
  let webhookUrl: string;
  try {
    const param = await ssm.send(new GetParameterCommand({
      Name: ssmPath,
      WithDecryption: true,
    }));
    webhookUrl = param.Parameter!.Value!;
  } catch (err) {
    // Log full path internally for debugging; do not expose to caller
    console.error(`SSM parameter not found: ${ssmPath}`);
    return { notified: false, reason: 'webhook_not_configured' };
  }

  // 3. POST to Slack
  const slackBody = JSON.stringify({
    text: `🏁 *[${input.project_id}]* ${input.message}`,
  });

  const resp = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: slackBody,
  });

  if (!resp.ok) {
    return { notified: false, reason: `slack_error: ${resp.status}` };
  }

  return { notified: true };
}
```

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

**Output Schema:**

```typescript
export interface RecordProgressOutput {
  written: boolean;
  pk?: string;
  sk?: string;
  reason?: string;
}
```

**Handler Logic:**

```typescript
import { ulid } from 'ulid';
import { classifyEvent, MACRO_GATES } from '../../packages/shared/constants/macro-gates';
import { writeGovernanceEvent } from './dynamo-writer';

// ssm and dynamoClient initialized at server startup — see §7.3 Bootstrap Strategy

async function handleRecordProgress(input: RecordProgressInput): Promise<RecordProgressOutput> {
  // 1. Classify event (FR-03)
  const { resolvedType, matchedGate } = classifyEvent(input);

  // 2. Resolve gate (FINDING-2 — gate derivation for macro events)
  //    - If caller provides gate explicitly → use it (normalized)
  //    - If gate is absent AND event auto-classifies as macro → derive from classification match
  //    - If gate is absent AND event is micro → leave undefined (no dedup needed)
  let resolvedGate: string | undefined;
  if (input.gate) {
    resolvedGate = input.gate.toLowerCase().trim();
  } else if (resolvedType === 'macro' && matchedGate) {
    resolvedGate = matchedGate; // canonical gate name from MACRO_GATES
  }
  // Note: Architect decision — not customer-specified: gate auto-derivation from classification
  // match ensures idempotency key is always populated for macro events, even when caller omits
  // the gate parameter.

  // 3. Build write input
  const writeInput = {
    project_id: input.project_id,
    update_text: input.update_text,
    type: resolvedType,
    gate: resolvedGate,
    phase: input.phase,
    source_ref: input.source_ref,
    actor: input.actor,
    flag_override: input.flag_override,
  };

  // 4. Write with dedup check (FR-09) — uses F-04 conditional PutItem pattern
  const eventUlid = ulid();
  const result = await writeGovernanceEvent(dynamoClient, writeInput, eventUlid);

  if (!result.written) {
    return { written: false, reason: result.reason }; // 'duplicate'
  }

  return { written: true, pk: result.pk, sk: result.sk };
}
```

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
  // flag_override: trust the caller's explicit type
  if (input.flag_override && input.type) {
    return { resolvedType: input.type };
  }

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

### 4.3 `flag_override` Handling

> Source: SRS FR-03 — "A manual `flag_override` shall allow correction of the auto-classification."

- When `flag_override: true` is present in the tool call, the `type` field provided by the caller is stored verbatim — no auto-classification runs.
- The `flag_override` attribute is persisted in DynamoDB as an audit marker (per F-04 §2.3).
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

### 5.1 Idempotency Key Construction

> Source: SRS FR-09 — "Deduplication uses an idempotency key composed of: PK (PROJECT#<project_id>) + gate name + day-granularity date (YYYY-MM-DD)."

Uses the **conditional PutItem sentinel pattern** from F-04 §4.2 exactly:

```
Macro events:  <project_id>#<gate.toLowerCase().trim()>#<YYYY-MM-DD>
Micro events:  <project_id>#micro#<ULID>   (always unique — no dedup needed)
```

> `Architect decision — not customer-specified:` gate names are normalized to lowercase+trimmed before building the idempotency key to prevent case-sensitivity bypass. Callers should use values from the MACRO_GATES constant but normalization provides a safety net.

### 5.2 Dedup Sentinel Record

Per F-04 §4.4:

| Attribute | Value |
|-----------|-------|
| `pk` | `PROJECT#<project_id>` |
| `sk` | `DEDUP#<idempotency_key>` |
| `created_at` | ISO timestamp (when first trigger wrote it) |
| `idempotency_key` | Same as the key value |

### 5.3 Dedup Flow

```
record_progress called
  │
  ├─ type == micro?  ──YES──▶  Skip dedup, write directly (ULID guarantees uniqueness)
  │
  └─ type == macro?  ──YES──▶  Attempt PutItem for DEDUP sentinel
                                  │
                                  ├─ Succeeds ──▶ Write event record (Pattern 1)
                                  │
                                  └─ ConditionalCheckFailedException ──▶ Return { written: false, reason: 'duplicate' }
```

### 5.4 Duplicate Detected Behavior

When a duplicate is detected:
1. **Return** `{ written: false, reason: 'duplicate' }` to the caller
2. **Log** at INFO level: `Dedup hit: idempotency_key=<key>`
3. **No Slack re-fire** — the `notify_slack` tool is only called by the orchestrator/workflow *after* a successful `record_progress` write. If `record_progress` returns duplicate, the caller must not proceed with `notify_slack`.

> `Architect decision — not customer-specified:` Dedup enforcement is in `record_progress` only. The caller (Agent Integration / GitHub Trigger) is responsible for checking the return value and skipping `notify_slack` on duplicate. This keeps dedup logic centralized in F-01.

---

## 6. Slack Integration

### 6.1 Webhook POST Format

> Source: Slack Incoming Webhooks API

```json
{
  "text": "🏁 *[rainn]* SRS approved by human — gate: SRS approved"
}
```

**Content-Type:** `application/json`
**Method:** `POST`

### 6.2 Message Format Template

```
🏁 *[{project_id}]* {message}
```

Where:
- `{project_id}` = GitHub repository name (e.g., `rainn`)
- `{message}` = the `message` parameter from the `notify_slack` tool call

> `Architect decision — not customer-specified:` Minimal message format for POC. Emoji prefix for visual scanning in Slack channel. Bold project name for at-a-glance identification.

### 6.3 SSM Lookup Pattern

```
Path: /kiro-governance/slack/webhooks/{project_id}
Type: SecureString
Example: /kiro-governance/slack/webhooks/rainn → https://hooks.slack.com/services/T.../B.../xxx
```

> Source: SRS FR-01, OQ-01 + OQ-04 resolutions

### 6.4 Error Handling

| Scenario | Behavior | Source |
|----------|----------|--------|
| Slack returns non-200 | Return `{ notified: false, reason: 'slack_error: <status>' }`. DB write is unaffected (independent job). | SRS NFR-02: "Failed Slack notifications shall not block DynamoDB writes" |
| Slack timeout (>5s) | Abort fetch, return `{ notified: false, reason: 'slack_timeout' }` | `Architect decision — not customer-specified` |
| Network unreachable | Return `{ notified: false, reason: 'slack_network_error' }` | `Architect decision — not customer-specified` |

> SRS NFR-02: "the two jobs are independent" — `notify_slack` and `record_progress` are separate tool calls. A Slack failure in `notify_slack` never blocks or rolls back a `record_progress` DynamoDB write.

---

## 7. Configuration & Secrets

### 7.1 SSM Parameter Store Paths

| Path | Type | Used By | Source |
|------|------|---------|--------|
| `/kiro-governance/slack/webhooks/{project_id}` | SecureString | `notify_slack` — webhook URL per project | SRS FR-01, OQ-01 |
| `/kiro-governance/config/mcp-api-key` | SecureString | Request auth validation (GitHub Actions → MCP) | SRS NFR-03, OQ-04 |
| `/kiro-governance/config/table-name` | String | `record_progress` — DynamoDB table name | F-04 §6.2 |
| `/kiro-governance/config/region` | String | AWS region for SDK clients | F-04 §6.2 |

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
| Table name, region, API key | Load on startup (cache in memory) | Static values that never change during runtime |
| Slack webhook URLs | Load per-request (with 5-min TTL cache) | New projects may be added without server restart |

```typescript
// Startup config (loaded once)
interface ServerConfig {
  tableName: string;
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
| Success (macro) | `{ notified: true }` | — |
| Micro event (skip) | `{ notified: false, reason: 'micro_event' }` | — |
| SSM param missing | `{ notified: false, reason: 'webhook_not_configured' }` | — |
| Slack non-200 | `{ notified: false, reason: 'slack_error: <status>' }` | — |
| Slack timeout | `{ notified: false, reason: 'slack_timeout' }` | — |

**`record_progress` errors:**

| Scenario | Response |
|----------|----------|
| Success | `{ written: true, pk: '...', sk: '...' }` |
| Duplicate detected | `{ written: false, reason: 'duplicate' }` |
| DynamoDB error | Throws — MCP SDK returns error to caller |
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
| `DynamoDBWriteLatency` | `KiroGovernance/MCP` | `project_id` | Duration of PutItem call |
| `DedupHitCount` | `KiroGovernance/MCP` | `project_id`, `gate` | On ConditionalCheckFailedException |

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
  pk?: string;
  sk?: string;
  reason?: string;
}

// ─── Internal Types ───

/** Server startup config (from SSM, cached on boot) */
export interface ServerConfig {
  tableName: string;
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
| 3 | DynamoDB conditional write fails (race condition) | `ConditionalCheckFailedException` on dedup sentinel → return `{ written: false, reason: 'duplicate' }`. This is expected behavior, not an error. Both dual-trigger paths may race; exactly one wins. | SRS FR-09, F-04 §4.2 |
| 4 | Invalid `event_type` in `notify_slack` tool call | Zod schema validation rejects before handler runs. MCP SDK returns a schema validation error to the caller. | `Architect decision — not customer-specified` |
| 5 | MCP server restart mid-request | `systemd` `Restart=on-failure` brings server back in ~5s. In-flight request is lost (no persistence of request state). Caller receives connection error and should retry. Idempotency sentinel ensures no double-write on retry. | `Architect decision — not customer-specified` |
| 6 | `update_text` exceeds 4 KB | Zod schema `.max(4096)` rejects at input validation. Returns schema error. | F-04 §8.1: "Validate `update_text` ≤ 4 KB" |
| 7 | `gate` value not in canonical list | Accepted — `gate` is a free-text field in DynamoDB. Classification uses `update_text` content, not the `gate` parameter. Non-canonical gates are stored as-is. | `Architect decision — not customer-specified` |
| 8 | Both trigger paths fire within same second | Dedup sentinel atomic write ensures exactly one succeeds. DynamoDB strongly consistent writes on same PK/SK guarantee no corruption. | F-04 §8.2 |
| 9 | API key header missing/invalid | Return HTTP 401 before MCP protocol handling. Log as `auth_failure`. | SRS NFR-03 |

---

## 12. Hallucination Gate H2 — Self-Check

| Item | Value | Source |
|------|-------|--------|
| Table name | `kiro-governance-tracker` | SRS §6, F-04 §2.1 |
| PK format | `PROJECT#<project_id>` | SRS §7, F-04 §2.2 |
| SK format | `UPDATE#<ISO-timestamp>#<ULID>` | SRS §7, F-04 §2.2 |
| Dedup sentinel SK | `DEDUP#<idempotency_key>` | F-04 §4.4 |
| Idempotency key (macro) | `<project_id>#<gate>#<YYYY-MM-DD>` | SRS FR-09, F-04 §4.1 |
| Idempotency key (micro) | `<project_id>#micro#<ULID>` | F-04 §4.1 |
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

*End of MCP Server Core Architecture v1.2*
