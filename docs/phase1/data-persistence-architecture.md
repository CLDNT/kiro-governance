# Data & Persistence Architecture — F-04: RDS PostgreSQL

## Changelog

| Date | Version | Author | Change |
|------|---------|--------|--------|
| 2026-06-23 | v2.0 | AWS Architect | CR 2026-06-23: Replaced DynamoDB with RDS PostgreSQL (db.t3.micro, IAM auth, no proxy). Tariq Khan. |
| 2026-06-11 | v1.7 | AWS Architect | CR 2026-06-11: Removed Athena connector, S3 Athena buckets. F-04 scope is now DynamoDB table + IAM + SSM only. |
| 2026-06-11 | v1.0 | AWS Architect | Initial architecture doc for F-04 from SRS v1.5 |

---

## 1. Overview

**Domain:** Data & Persistence
**Feature:** F-04 — RDS PostgreSQL
**Purpose:** Provide the append-only governance event store that FR-02 writes to.

**SRS References:**
- **FR-02** (write target) — MCP Server writes governance event records here
- **FR-09** (idempotency) — deduplication via `UNIQUE` constraint on `idempotency_key`
- **SRS §7** — Data model schema definition

**This domain owns no FR directly** — it is shared infrastructure. F-01 (MCP Server Core) owns FR-02 write logic. This domain owns the RDS instance, schema, and IAM roles.

---

## 2. RDS Instance Configuration

| Property | Value | Source |
|----------|-------|--------|
| Engine | PostgreSQL 16 | `Architect decision — not customer-specified` |
| Instance class | `db.t3.micro` | Tariq Khan, 2026-06-23 |
| Storage | 20 GB gp2 | `Architect decision — not customer-specified` (minimum allocation) |
| Multi-AZ | No (single-AZ) | Tariq Khan, 2026-06-23 |
| Aurora | No — standard RDS | Tariq Khan, 2026-06-23 |
| RDS Proxy | No — direct connection | Tariq Khan, 2026-06-23 |
| Region | `us-east-1` | `Architect decision — not customer-specified` |
| Deletion protection | Enabled | `Architect decision — not customer-specified` |
| Backup retention | 7 days | `Architect decision — not customer-specified` |
| Encryption at rest | AWS-managed key (aws/rds) | `Architect decision — not customer-specified` |
| IAM authentication | Enabled | Tariq Khan, 2026-06-23 |
| Database name | `kiro_governance` | `Architect decision — not customer-specified` |
| Master username | `kiro_mcp` | `Architect decision — not customer-specified` |
| VPC placement | Same VPC as EC2 MCP server, private subnet | `Architect decision — not customer-specified` |

---

## 3. Schema

Single table replacing the previous DynamoDB single-table design:

```sql
CREATE TABLE governance_events (
  id              BIGSERIAL PRIMARY KEY,
  project_id      TEXT        NOT NULL,
  update_text     TEXT        NOT NULL CHECK (char_length(update_text) <= 4096),
  type            TEXT        NOT NULL CHECK (type IN ('macro', 'micro')),
  flag_override   BOOLEAN,
  gate            TEXT,
  phase           TEXT,
  phase_name      TEXT,
  source_ref      TEXT        NOT NULL,
  actor           TEXT        NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  idempotency_key TEXT        NOT NULL,

  CONSTRAINT uq_idempotency UNIQUE (idempotency_key)
);

CREATE INDEX idx_project_created  ON governance_events (project_id, created_at DESC);
CREATE INDEX idx_type_created     ON governance_events (type, created_at DESC);
CREATE INDEX idx_gate_created     ON governance_events (gate, created_at DESC) WHERE gate IS NOT NULL;
```

**Migration file:** `migrations/V001__governance_events.sql`

---

## 4. Access Patterns

| # | Pattern | SQL | Used By |
|---|---------|-----|---------|
| 1 | Write a governance event | `INSERT INTO governance_events (...) VALUES (...) ON CONFLICT (idempotency_key) DO NOTHING` | FR-02 (MCP Server write tool) |
| 2 | All events for a project (timeline) | `SELECT * FROM governance_events WHERE project_id = $1 ORDER BY created_at DESC` | FR-08 (per-project timeline) |
| 3 | All macro events across projects | `SELECT * FROM governance_events WHERE type = 'macro' ORDER BY created_at DESC` | FR-08 (cross-project rollup) |
| 4 | Events by gate across projects | `SELECT * FROM governance_events WHERE gate = $1 ORDER BY created_at DESC` | FR-08 (filter by gate) |
| 5 | Project events filtered by type | `SELECT * FROM governance_events WHERE project_id = $1 AND type = $2 ORDER BY created_at DESC` | FR-08 (per-project + type filter) |
| 6 | Project events in time range | `SELECT * FROM governance_events WHERE project_id = $1 AND created_at BETWEEN $2 AND $3 ORDER BY created_at DESC` | FR-08 (date range filter) |

---

## 5. Idempotency

The `UNIQUE` constraint on `idempotency_key` replaces the DynamoDB conditional PutItem sentinel pattern. An `INSERT ... ON CONFLICT DO NOTHING` is atomic and simpler.

### 5.1 Key Format

```
Macro events:  <project_id>#<gate>#<YYYY-MM-DD>
Micro events:  <project_id>#micro#<ULID>
```

### 5.2 TypeScript Implementation

```typescript
import { Pool } from 'pg';

interface WriteEventInput {
  project_id: string;
  update_text: string;
  type: 'macro' | 'micro';
  gate?: string;
  phase?: string;
  phase_name?: string;
  source_ref: string;
  actor: string;
  flag_override?: boolean;
}

function buildIdempotencyKey(input: WriteEventInput, ulid: string): string {
  if (input.type === 'macro' && input.gate) {
    const today = new Date().toISOString().slice(0, 10);
    return `${input.project_id}#${input.gate}#${today}`;
  }
  return `${input.project_id}#micro#${ulid}`;
}

async function writeGovernanceEvent(
  pool: Pool,
  input: WriteEventInput,
  ulid: string,
): Promise<{ written: boolean; reason?: string }> {
  const idempotencyKey = buildIdempotencyKey(input, ulid);

  const result = await pool.query(
    `INSERT INTO governance_events
       (project_id, update_text, type, flag_override, gate, phase, phase_name, source_ref, actor, idempotency_key)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT (idempotency_key) DO NOTHING`,
    [
      input.project_id,
      input.update_text,
      input.type,
      input.flag_override ?? null,
      input.gate ?? null,
      input.phase ?? null,
      input.phase_name ?? null,
      input.source_ref,
      input.actor,
      idempotencyKey,
    ],
  );

  if (result.rowCount === 0) {
    return { written: false, reason: 'duplicate' };
  }
  return { written: true };
}
```

---

## 6. IAM & Security

### 6.1 IAM Policy — MCP Server EC2 Instance Role

**Role:** `kiro-gov-mcp-server-role`
**Trust:** EC2 service (`ec2.amazonaws.com`)

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "RDSIAMConnect",
      "Effect": "Allow",
      "Action": "rds-db:connect",
      "Resource": "arn:aws:rds-db:us-east-1:<account_id>:dbuser:<dbi-resource-id>/kiro_mcp"
    },
    {
      "Sid": "SSMReadConfig",
      "Effect": "Allow",
      "Action": "ssm:GetParameter",
      "Resource": "arn:aws:ssm:us-east-1:<account_id>:parameter/kiro-governance/*"
    },
    {
      "Sid": "SSMKmsDecrypt",
      "Effect": "Allow",
      "Action": "kms:Decrypt",
      "Resource": "arn:aws:kms:us-east-1:<account_id>:key/alias/aws/ssm"
    }
  ]
}
```

### 6.2 Security Group

| Rule | Protocol | Port | Source | Purpose |
|------|----------|------|--------|---------|
| Inbound | TCP | 5432 | EC2 MCP Server security group | Only EC2 can reach RDS |

No public access. RDS is in a private subnet with no internet gateway route.

### 6.3 SSM Parameter Store Paths

| Path | Type | Purpose |
|------|------|---------|
| `/kiro-governance/slack/webhooks/{project_id}` | SecureString | Slack webhook URL per project |
| `/kiro-governance/config/mcp-api-key` | SecureString | API key for MCP auth |
| `/kiro-governance/config/db-endpoint` | String | RDS instance endpoint |
| `/kiro-governance/config/db-port` | String | `5432` |
| `/kiro-governance/config/db-name` | String | `kiro_governance` |
| `/kiro-governance/config/db-user` | String | `kiro_mcp` |
| `/kiro-governance/config/region` | String | AWS region |

---

## 7. CDK Infrastructure

```typescript
import * as cdk from 'aws-cdk-lib';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';

export class DataPersistenceStack extends cdk.Stack {
  public readonly dbInstance: rds.DatabaseInstance;

  constructor(scope: Construct, id: string, props: { vpc: ec2.IVpc; mcpServerSg: ec2.ISecurityGroup } & cdk.StackProps) {
    super(scope, id, props);

    const dbSg = new ec2.SecurityGroup(this, 'DbSg', {
      vpc: props.vpc,
      description: 'RDS PostgreSQL - allow 5432 from MCP server only',
      allowAllOutbound: false,
    });
    dbSg.addIngressRule(props.mcpServerSg, ec2.Port.tcp(5432), 'MCP server access');

    this.dbInstance = new rds.DatabaseInstance(this, 'GovernanceDb', {
      engine: rds.DatabaseInstanceEngine.postgres({ version: rds.PostgresEngineVersion.VER_16 }),
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.MICRO),
      vpc: props.vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      securityGroups: [dbSg],
      databaseName: 'kiro_governance',
      credentials: rds.Credentials.fromUsername('kiro_mcp'),
      allocatedStorage: 20,
      storageType: rds.StorageType.GP2,
      multiAz: false,
      deletionProtection: true,
      backupRetention: cdk.Duration.days(7),
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      iamAuthentication: true,
    });

    // SSM Parameters
    new ssm.StringParameter(this, 'DbEndpointParam', {
      parameterName: '/kiro-governance/config/db-endpoint',
      stringValue: this.dbInstance.dbInstanceEndpointAddress,
    });
    new ssm.StringParameter(this, 'DbPortParam', {
      parameterName: '/kiro-governance/config/db-port',
      stringValue: this.dbInstance.dbInstanceEndpointPort,
    });
    new ssm.StringParameter(this, 'DbNameParam', {
      parameterName: '/kiro-governance/config/db-name',
      stringValue: 'kiro_governance',
    });
    new ssm.StringParameter(this, 'DbUserParam', {
      parameterName: '/kiro-governance/config/db-user',
      stringValue: 'kiro_mcp',
    });
  }
}
```

---

## 8. Connection & Auth Pattern

IAM authentication flow — no password stored anywhere:

1. EC2 instance role has `rds-db:connect` permission
2. MCP server calls `RDSSigner.getAuthToken()` to get a short-lived token (15-min TTL)
3. Token is used as the PostgreSQL password
4. The DB user (`kiro_mcp`) has the `rds_iam` attribute granted

```typescript
import { Signer } from '@aws-sdk/rds-signer';
import { Pool } from 'pg';

const signer = new Signer({
  hostname: process.env.DB_ENDPOINT!,
  port: Number(process.env.DB_PORT!),
  username: process.env.DB_USER!,
  region: process.env.AWS_REGION!,
});

let pool: Pool | null = null;
let tokenExpiry = 0;

async function getPool(): Promise<Pool> {
  const now = Date.now();
  if (pool && now < tokenExpiry) return pool;

  const token = await signer.getAuthToken();
  tokenExpiry = now + 14 * 60 * 1000; // refresh 1 min before 15-min expiry

  if (pool) await pool.end();

  pool = new Pool({
    host: process.env.DB_ENDPOINT!,
    port: Number(process.env.DB_PORT!),
    database: process.env.DB_NAME!,
    user: process.env.DB_USER!,
    password: token,
    ssl: { rejectUnauthorized: true },
    max: 5,
    idleTimeoutMillis: 60_000,
  });

  return pool;
}
```

**DB user setup (run once after RDS creation):**

```sql
CREATE USER kiro_mcp;
GRANT rds_iam TO kiro_mcp;
GRANT ALL PRIVILEGES ON DATABASE kiro_governance TO kiro_mcp;
```

---

## 9. Edge Cases

| Scenario | Handling |
|----------|----------|
| RDS instance unavailable | MCP server returns HTTP 500 to caller. Caller retries. Pool will reconnect on next healthy attempt. |
| IAM token expired mid-request | `pg` pool returns auth error. `getPool()` detects expiry, generates new token, recreates pool. Caller retries once. |
| Pool exhaustion (all 5 connections busy) | `pg` queues the request (default). If queue exceeds timeout, returns 503 to caller. At POC scale (<10 writes/day), this is unreachable. |
| Network timeout to RDS | `pg` connection timeout (default 30s). MCP server returns 500. Caller retries. |
| `idempotency_key` conflict (duplicate event) | `ON CONFLICT DO NOTHING` — returns `rowCount = 0`. MCP server returns `{ written: false, reason: 'duplicate' }`. No error thrown. |
| `update_text` exceeds 4096 chars | CHECK constraint rejects the INSERT. MCP server catches the Postgres error and returns 400. |

---

## 10. Cost Estimate

| Component | Monthly Cost | Notes |
|-----------|-------------|-------|
| RDS db.t3.micro (on-demand, single-AZ) | ~$12.41 | 2 vCPU, 1 GiB RAM, us-east-1 |
| 20 GB gp2 storage | ~$2.30 | $0.115/GB-month |
| Backup storage (7 days, ≤20 GB) | ~$0.62 | $0.095/GB-month beyond free allocation |
| **Total F-04 infrastructure** | **~$15.33/mo** | |

> `Architect decision — not customer-specified:` Switch to 1-year Reserved Instance (~$9/mo) if the system runs long-term.

---

*End of Data & Persistence Architecture v2.0*
