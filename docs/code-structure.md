# Code Structure & Development Standards — `kiro_governance`

## Changelog

| Date | Version | Author | Change |
|------|---------|--------|--------|
| 2026-06-11 | v1.0 | AWS Architect | Initial code structure doc from architecture docs v1.x, domain decomposition v1.1, feature list v1.2 |

---

## 1. Repository Structure

**Architecture:** TypeScript monorepo. EC2-hosted MCP server (not serverless). CDK for infrastructure. No frontend. No Lambda.

```
kiro-governance/
├── infra/                              # AWS CDK stack
│   ├── bin/
│   │   └── app.ts                      # CDK app entry point
│   ├── stacks/
│   │   └── governance-stack.ts         # Single stack: DynamoDB + IAM + SSM + EC2 config
│   ├── cdk.json
│   └── __tests__/                      # CDK snapshot tests
│
├── packages/
│   ├── shared/                         # Shared across all domains
│   │   ├── constants/
│   │   │   └── macro-gates.ts          # MACRO_GATES, MACRO_GATE_ALIASES, classifyEvent()
│   │   ├── types/
│   │   │   └── governance-event.ts     # GovernanceEventRecord interface
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   └── mcp-server/                     # Domain: MCP Server Core (F-01)
│       ├── src/
│       │   ├── index.ts                # MCP server entry point (HTTPS/SSE on :443)
│       │   ├── tools/
│       │   │   ├── record-progress.ts  # record_progress MCP tool handler
│       │   │   └── notify-slack.ts     # notify_slack MCP tool handler
│       │   ├── services/
│       │   │   ├── dynamodb.service.ts # DynamoDB write + dedup sentinel pattern
│       │   │   └── slack.service.ts    # Slack webhook POST + cache
│       │   └── middleware/
│       │       └── api-key.ts          # X-API-Key header validation
│       ├── __tests__/
│       │   ├── services/               # Unit tests for services
│       │   └── tools/                  # Integration tests for MCP tools
│       ├── package.json
│       └── tsconfig.json
│
├── scripts/
│   └── governance-trigger.ts           # GitHub Actions workflow script (F-03)
│
├── .github/
│   └── workflows/
│       └── governance-trigger.yml      # GitHub Actions workflow (F-03)
│
├── .env.example                        # Environment variable template (no secrets)
├── package.json                        # Root workspace config (npm workspaces)
├── tsconfig.base.json                  # Shared TypeScript compiler settings
└── jest.config.ts                      # Root Jest configuration
```

**What is NOT in this repo:**
- Agent integration files (F-02: `.kiro/steering/orchestrator.md`, sub-agent steering files, `.kiro/mcp.json`) — delivered as a separate PR into the main Kiro app-dev agents repository. Stories KG-06/07/08 produce that PR.

---

## 2. Domain Boundaries

Each domain is self-contained. There is no cross-domain service import — only shared constants/types.

### Domain Dependency Table

| Domain | Package | Owns | Depends On |
|--------|---------|------|------------|
| Shared | `packages/shared` | Constants (macro gates), Types (GovernanceEventRecord) | Nothing |
| MCP Server Core | `packages/mcp-server` | Tools, services, middleware, server entry point | `packages/shared` |
| GitHub Trigger | `scripts/` | Workflow script (diff parse + MCP call) | `packages/shared` (compiled dist) |
| Infrastructure | `infra/` | CDK stack (DynamoDB, IAM, SSM) | Nothing (standalone CDK app) |

**Rules:**
- `packages/mcp-server` imports from `packages/shared` — never the reverse
- `scripts/governance-trigger.ts` imports from `packages/shared/dist/` (compiled JS) at CI time
- `infra/` is independent — does not import application code

---

## 3. MCP Tool Handler Pattern

Every MCP tool follows this structure:

```typescript
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

// 1. Define input schema with Zod
export const RecordProgressInputSchema = z.object({
  project_id: z.string().min(1),
  update_text: z.string().min(1).max(4096),
  type: z.enum(['macro', 'micro']).optional(),
  gate: z.string().optional(),
  phase: z.string().optional(),
  source_ref: z.string().min(1),
  actor: z.string().min(1),
  flag_override: z.boolean().optional(),
});

// 2. Define output interface
export interface RecordProgressOutput {
  written: boolean;
  pk?: string;
  sk?: string;
  reason?: string;
}

// 3. Register tool on the MCP server instance
export function registerRecordProgress(server: McpServer, config: ServerConfig): void {
  server.tool(
    'record_progress',
    'Write a governance event to DynamoDB with auto-classification and deduplication',
    RecordProgressInputSchema.shape,
    async (params) => {
      const input = RecordProgressInputSchema.parse(params);
      const result = await handleRecordProgress(input, config);
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    },
  );
}

// 4. Handler logic — delegates to service layer
async function handleRecordProgress(
  input: z.infer<typeof RecordProgressInputSchema>,
  config: ServerConfig,
): Promise<RecordProgressOutput> {
  // Classification → dedup check → DynamoDB write
  // See mcp-server-core-architecture.md §3.2 for full logic
}
```

**Key patterns:**
- Zod schema defines input validation (MCP SDK validates before handler runs)
- Handler is thin — delegates to `services/` for business logic
- Output is always JSON-serialized into MCP `text` content type
- One file per tool in `packages/mcp-server/src/tools/`

---

## 4. Shared Constants Usage

**MANDATORY:** Always import gate names from `packages/shared/constants/macro-gates`. Never hardcode gate strings.

```typescript
// ✅ CORRECT — import from shared constants
import { MACRO_GATES, MACRO_GATE_ALIASES, classifyEvent } from '@kiro-governance/shared/constants/macro-gates';

// ❌ WRONG — hardcoded gate names
const gates = ['SRS approved', 'Code approved']; // NEVER DO THIS
```

**What `macro-gates.ts` exports:**

```typescript
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

export const MACRO_GATE_ALIASES: Record<string, MacroGate> = {
  'solution architecture approved': 'Design docs approved',
  'sprint plan approved': 'Implementation plan approved',
  'documentation approved': 'Runbooks approved',
};

export function classifyEvent(input: {
  update_text: string;
  type?: 'macro' | 'micro';
  flag_override?: boolean;
}): { resolvedType: 'macro' | 'micro'; matchedGate?: string };
```

---

## 5. DynamoDB Conditional PutItem Pattern (Dedup)

The dedup sentinel write is the core idempotency mechanism. Used by `dynamodb.service.ts`:

```typescript
import { DynamoDBClient, PutItemCommand, ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import { marshall } from '@aws-sdk/util-dynamodb';

/**
 * Attempt dedup sentinel write. If sentinel already exists, returns false.
 * Pattern from F-04 §4.2.
 */
async function attemptDedupSentinel(
  client: DynamoDBClient,
  tableName: string,
  pk: string,
  idempotencyKey: string,
): Promise<boolean> {
  try {
    await client.send(new PutItemCommand({
      TableName: tableName,
      Item: marshall({
        pk,
        sk: `DEDUP#${idempotencyKey}`,
        created_at: new Date().toISOString(),
        idempotency_key: idempotencyKey,
      }),
      ConditionExpression: 'attribute_not_exists(pk)',
    }));
    return true; // Sentinel created — proceed with event write
  } catch (err) {
    if (err instanceof ConditionalCheckFailedException) {
      return false; // Duplicate — skip
    }
    throw err; // Unexpected error — propagate
  }
}
```

**Idempotency key format:**
- Macro: `<project_id>#<gate.toLowerCase().trim()>#<YYYY-MM-DD>`
- Micro: `<project_id>#micro#<ULID>` (always unique, no dedup needed)

**Rules:**
- Macro events ALWAYS write the dedup sentinel before the event record
- Micro events NEVER write a dedup sentinel (ULID guarantees uniqueness)
- If sentinel write fails → return `{ written: false, reason: 'duplicate' }` — do NOT write event record
- Dedup sentinels are never deleted (permanent audit trail)

---

## 6. API Key Middleware

All incoming MCP requests are validated via `X-API-Key` header:

```typescript
// packages/mcp-server/src/middleware/api-key.ts
import { IncomingMessage, ServerResponse } from 'node:http';

/**
 * Validate X-API-Key header against cached API key from SSM.
 * Returns true if valid, sends 401 and returns false otherwise.
 */
export function validateApiKey(
  req: IncomingMessage,
  res: ServerResponse,
  expectedKey: string,
): boolean {
  const provided = req.headers['x-api-key'];
  if (!provided || provided !== expectedKey) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Unauthorized', code: 'INVALID_API_KEY' }));
    return false;
  }
  return true;
}
```

**Rules:**
- Middleware runs before MCP protocol handling
- API key is loaded from SSM at startup and cached in memory (never re-fetched per-request)
- Missing or invalid key → HTTP 401 immediately (no MCP response)
- Health endpoint (`GET /health`) does NOT require API key

---

## 7. HTTPS/TLS Setup

The MCP server binds on port 443 with a self-signed TLS certificate:

```typescript
// packages/mcp-server/src/index.ts (server bootstrap excerpt)
import { createServer } from 'node:https';
import { readFileSync } from 'node:fs';

const server = createServer({
  cert: readFileSync(process.env.TLS_CERT_PATH!),
  key: readFileSync(process.env.TLS_KEY_PATH!),
});
```

**Deployment:**
- Process manager: `systemd` (`kiro-mcp-server.service`)
- `AmbientCapabilities=CAP_NET_BIND_SERVICE` allows binding to port 443 without root
- `Restart=on-failure`, `RestartSec=5` for auto-recovery
- Cert at `/opt/kiro-governance/cert.pem`, key at `/opt/kiro-governance/key.pem`

**Clients verify via pinned SHA-256 fingerprint** (not system CA trust):
- Kiro agent: `MCP_CERT_FINGERPRINT` env var → `tlsCertFingerprint` in `.kiro/mcp.json`
- GitHub Actions: `MCP_CERT_FINGERPRINT` GitHub Secret → `checkServerIdentity` in https.request()

---

## 8. Environment Variables

All configuration via environment variables. No hardcoded values.

### MCP Server (EC2 — systemd environment)

| Variable | Example | Purpose | Source |
|----------|---------|---------|--------|
| `PORT` | `443` | HTTPS listen port | F-01 §2.4 |
| `TLS_CERT_PATH` | `/opt/kiro-governance/cert.pem` | TLS certificate path | F-01 §7.2 |
| `TLS_KEY_PATH` | `/opt/kiro-governance/key.pem` | TLS private key path | F-01 §7.2 |
| `NODE_ENV` | `production` | Runtime mode | F-01 §7.2 |
| `LOG_LEVEL` | `info` | CloudWatch log verbosity | F-01 §7.2 |
| `AWS_REGION` | `us-east-1` | SDK default region | F-01 §7.2 |

**Note:** The MCP server reads secrets (API key, webhook URLs) from SSM Parameter Store at runtime — they are NOT passed as env vars.

### Kiro Agent (developer machine — `.env` file)

| Variable | Example | Purpose |
|----------|---------|---------|
| `KIRO_GOV_MCP_URL` | `https://1.2.3.4:443/mcp` | MCP server endpoint |
| `KIRO_GOV_MCP_API_KEY` | `<secret>` | API key for MCP auth |
| `MCP_CERT_FINGERPRINT` | `AA:BB:CC:...` | TLS cert fingerprint |
| `KIRO_PROJECT_ID` | `rainn` | Project identifier (optional — derived from git remote if absent) |

### GitHub Actions (workflow — GitHub Encrypted Secrets)

| Secret Name | Purpose |
|-------------|---------|
| `MCP_SERVER_URL` | MCP server HTTPS endpoint |
| `MCP_API_KEY` | API key matching SSM value |
| `MCP_CERT_FINGERPRINT` | SHA-256 cert fingerprint |

---

## 9. Error Response Shape

All HTTP errors from the MCP server use a consistent JSON shape:

```typescript
interface ErrorResponse {
  error: string;  // Human-readable message
  code: string;   // Machine-readable code
}
```

| Status | Code | When |
|--------|------|------|
| 401 | `INVALID_API_KEY` | Missing or invalid `X-API-Key` header |
| 404 | `NOT_FOUND` | Unknown endpoint (not `/mcp` or `/health`) |
| 500 | `INTERNAL_ERROR` | Unexpected server error (details logged, not exposed) |

**MCP tool errors** (classification failure, DynamoDB error) are returned as MCP tool results with error content — they do NOT produce HTTP error status codes. The MCP protocol handles error propagation to the caller.

---

## 10. CDK Stack Pattern

Single stack (`GovernanceStack`) for this POC — not split into stateful/stateless.

```typescript
// infra/stacks/governance-stack.ts
import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';

export class GovernanceStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // DynamoDB table: kiro-governance-tracker
    // GSIs: gsi-type-created, gsi-gate-created
    // IAM role: kiro-gov-mcp-server-role (PutItem, Query, SSM read, DENY Delete/Update)
    // SSM parameters: /kiro-governance/config/table-name, /kiro-governance/config/region
  }
}
```

**CDK Rules for this project:**
- `deletionProtection: true` on DynamoDB table
- `pointInTimeRecovery: true` on DynamoDB table
- `removalPolicy: cdk.RemovalPolicy.RETAIN` on DynamoDB table
- Explicit `iam.Effect.DENY` on `DeleteItem` and `UpdateItem` (append-only enforcement)
- Do NOT hardcode physical names on stateful resources except the DynamoDB table (explicitly named `kiro-governance-tracker` per SRS §6)
- `cdk.context.json` committed to version control

**CDK entry point:**

```typescript
// infra/bin/app.ts
import * as cdk from 'aws-cdk-lib';
import { GovernanceStack } from '../stacks/governance-stack';

const app = new cdk.App();
new GovernanceStack(app, 'KiroGovernanceStack', {
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: 'us-east-1' },
});
```

---

## 11. Testing Structure

**Framework:** Jest

```
packages/
├── shared/
│   └── __tests__/
│       └── classify-event.test.ts      # Unit: classifyEvent() — all 10 gates + aliases + micro
│
└── mcp-server/
    └── __tests__/
        ├── services/
        │   ├── dynamodb.service.test.ts # Unit: dedup sentinel, event write, error paths
        │   └── slack.service.test.ts    # Unit: webhook POST, cache TTL, error responses
        └── tools/
            ├── record-progress.test.ts  # Integration: full tool flow with mocked DynamoDB
            └── notify-slack.test.ts     # Integration: full tool flow with mocked SSM + fetch

infra/
└── __tests__/
    └── governance-stack.test.ts        # CDK snapshot test
```

**Testing rules:**
- Unit tests for `services/` — mock AWS SDK clients
- Integration tests for `tools/` — test full tool handler with mocked external dependencies
- CDK snapshot tests for infrastructure — detect unintended drift
- KG-13 (Sprint 3) runs true end-to-end from Kiro CLI → MCP server → DynamoDB → Slack

**Run commands:**
```bash
npm test                    # Run all tests across workspaces
npm test -w packages/shared # Run shared package tests only
npm test -w packages/mcp-server # Run MCP server tests only
npm test -w infra           # Run CDK snapshot tests
```

---

## 12. Naming Conventions

| Item | Convention | Example |
|------|-----------|---------|
| MCP tool handlers | `kebab-case.ts` | `record-progress.ts`, `notify-slack.ts` |
| Service files | `kebab-case.service.ts` | `dynamodb.service.ts`, `slack.service.ts` |
| Middleware files | `kebab-case.ts` | `api-key.ts` |
| Shared constants | `kebab-case.ts` | `macro-gates.ts` |
| Shared types | `kebab-case.ts` | `governance-event.ts` |
| CDK stacks | `PascalCase` | `GovernanceStack` |
| CDK construct IDs | `PascalCase` | `GovernanceTracker`, `McpServerRole` |
| DynamoDB table | Explicit name | `kiro-governance-tracker` |
| SSM parameter paths | `/kiro-governance/{category}/{name}` | `/kiro-governance/config/table-name` |
| Environment variables | `UPPER_SNAKE_CASE` | `TLS_CERT_PATH`, `AWS_REGION` |
| GitHub Actions secrets | `UPPER_SNAKE_CASE` | `MCP_API_KEY`, `MCP_SERVER_URL` |
| Workflow files | `kebab-case.yml` | `governance-trigger.yml` |
| Scripts | `kebab-case.ts` | `governance-trigger.ts` |
| Test files | `{source-file}.test.ts` | `dynamodb.service.test.ts` |
| TypeScript interfaces | `PascalCase` | `GovernanceEventRecord`, `ServerConfig` |
| TypeScript constants | `UPPER_SNAKE_CASE` | `MACRO_GATES`, `MACRO_GATE_ALIASES` |
| Function names | `camelCase` | `classifyEvent`, `buildIdempotencyKey` |

---

## 13. Documentation Standards

Three-tier approach — minimal JSDoc:

| Tier | What | Where |
|------|------|-------|
| Architecture docs | Feature design, data flows, edge cases, API contracts | `docs/phase1/` |
| TypeScript types | Data structures, function signatures | `packages/shared/types/` |
| Inline JSDoc | WHY for complex logic only (classification algorithm, dedup flow) | Inline in source |

**Rules:**
- No `@param`, `@returns` JSDoc on functions — TypeScript types handle this
- One-line JSDoc on tool handlers referencing the architecture doc section
- Complex business logic (classifyEvent, dedup sentinel) gets a WHY comment
- Architecture docs are the single source of truth for API contracts and behavior

---

## 14. Workspace & Package Configuration

**Root `package.json`:**
```json
{
  "name": "kiro-governance",
  "private": true,
  "workspaces": ["packages/*", "infra"],
  "scripts": {
    "build": "npm run build -ws",
    "test": "jest --passWithNoTests",
    "lint": "eslint . --ext .ts"
  }
}
```

**Package references:**
- `packages/mcp-server` depends on `@kiro-governance/shared` (workspace reference)
- `scripts/governance-trigger.ts` requires `../packages/shared/dist/constants/macro-gates` (compiled output)

**Key dependencies:**

| Package | Used By | Purpose |
|---------|---------|---------|
| `@modelcontextprotocol/sdk` | `packages/mcp-server` | MCP server framework |
| `zod` | `packages/mcp-server` | Input schema validation |
| `@aws-sdk/client-dynamodb` | `packages/mcp-server` | DynamoDB PutItem/Query |
| `@aws-sdk/util-dynamodb` | `packages/mcp-server` | Marshall/unmarshall |
| `@aws-sdk/client-ssm` | `packages/mcp-server` | SSM GetParameter |
| `ulid` | `packages/mcp-server` | ULID generation for sort keys |
| `aws-cdk-lib` | `infra` | CDK constructs |
| `jest` | root | Test framework |
| `typescript` | root | Compiler |

---

## 15. Server Bootstrap Sequence

The MCP server starts in this order (see F-01 §7.3):

```
1. Read TLS cert/key from filesystem
2. Load static config from SSM (table-name, region, api-key) — cache in memory
3. Initialize DynamoDB client
4. Create HTTPS server with TLS config
5. Register MCP tools (record_progress, notify_slack)
6. Attach API key middleware (runs before MCP protocol)
7. Start listening on PORT (443)
8. Log: "MCP server ready on :443"
```

**Lazy-loaded per request:**
- Slack webhook URLs — cached with 5-minute TTL (new projects can be added without restart)

**Never changes at runtime:**
- API key, table name, region — loaded once at startup

---

## 16. Traceability — Story → Architecture Doc

| Story ID | Feature | Architecture Doc | Section |
|----------|---------|-----------------|---------|
| KG-01 | F-04 | `docs/phase1/data-persistence-architecture.md` | §7.1 (CDK stack) |
| KG-02 | F-01 | `docs/phase1/mcp-server-core-architecture.md` | §2, §8 (EC2 + TLS) |
| KG-03 | F-01 | `docs/phase1/mcp-server-core-architecture.md` | §2, §7, §8 (scaffold) |
| KG-04 | F-01 | `docs/phase1/mcp-server-core-architecture.md` | §3.2, §4, §5 (record_progress) |
| KG-05 | F-01 | `docs/phase1/mcp-server-core-architecture.md` | §3.1, §6 (notify_slack) |
| KG-06 | F-02 | `docs/phase1/agent-integration-architecture.md` | §2, §5 (gate + steering) |
| KG-07 | F-02 | `docs/phase1/agent-integration-architecture.md` | §3 (orchestrator hook) |
| KG-08 | F-02 | `docs/phase1/agent-integration-architecture.md` | §4, §5.2 (micro events) |
| KG-09 | F-03 | `docs/phase1/github-trigger-architecture.md` | §2, §3, §4 (workflow) |
| KG-13 | All | All architecture docs | End-to-end integration |
| KG-14 | Ops | `docs/phase1/mcp-server-core-architecture.md` | §8.2 (runbooks) |

---

## 17. Build & Deploy

### Local Development

```bash
# Install all workspace dependencies
npm ci

# Build shared package (required before mcp-server or scripts)
npm run build -w packages/shared

# Build MCP server
npm run build -w packages/mcp-server

# Run tests
npm test

# CDK synth (validate stack)
cd infra && npx cdk synth
```

### EC2 Deployment

```bash
# On EC2 instance
cd /opt/kiro-governance
git pull origin main
npm ci
npm run build
sudo systemctl restart kiro-mcp-server
```

### CDK Deploy

```bash
cd infra
npx cdk deploy KiroGovernanceStack --require-approval broadening
```

---

## 18. Security Invariants

These are non-negotiable rules enforced across all code:

1. **No secrets in code or env vars on EC2** — all secrets read from SSM Parameter Store (SecureString)
2. **API key required on every request** — except `GET /health`
3. **Append-only DynamoDB** — IAM policy DENY on `DeleteItem`/`UpdateItem`; no code path attempts these operations
4. **No SSM paths in error responses** — internal paths logged to CloudWatch only
5. **TLS always** — server binds HTTPS only; no HTTP fallback
6. **Cert fingerprint pinning** — clients verify cert via SHA-256 fingerprint, not CA trust
7. **`.env` is gitignored** — only `.env.example` (with placeholders) is committed

---

*End of Code Structure v1.0*
