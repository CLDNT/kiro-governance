# Unified Data Model — `kiro_governance`

## Changelog

| Date | Version | Author | Change |
|------|---------|--------|--------|
| 2026-06-23 | v1.4 | AWS Architect | CR 2026-06-23: Replaced DynamoDB with RDS PostgreSQL. Removed pk/sk fields. Added phase_name column. Tariq Khan. |
| 2026-06-11 | v1.3 | AWS Architect | CR 2026-06-11: Removed S3 Athena buckets. Data stores: DynamoDB + SSM only. |
| 2026-06-11 | v1.2 | AWS Architect | Fixed DENY statement DynamoDB ARN: kiro-governance-events → kiro-governance-tracker (Security Gate 1.5 final pass) |
| 2026-06-11 | v1.1 | AWS Architect | Security Gate 1.5 fixes: AWS-owned CMK rationale (MED-1), SSM KMS Decrypt scope (MED-2), IAM append-only DENY (LOW-4), S3 SSE-S3 rationale (LOW-5) |
| 2026-06-11 | v1.0 | AWS Architect | Initial unified data model consolidating SRS §7, F-04 v1.3, F-01 v1.2, F-05 v1.0 |

---

## 1. Overview

The `kiro_governance` system uses two data stores:

| Store | Service | Purpose | Owner Domain |
|-------|---------|---------|--------------|
| Governance Event Store | RDS PostgreSQL (`db.t3.micro`, database `kiro_governance`) | Append-only audit log of macro/micro governance events per project | F-04 (Data & Persistence) |
| Configuration Store | AWS SSM Parameter Store | Runtime config and secrets (webhook URLs, API key, DB connection params) | F-01 (MCP Server Core) |

No DynamoDB. No cache layer. Single RDS PostgreSQL instance with IAM authentication.

---

## 2. RDS PostgreSQL — `governance_events` Table

### 2.1 Instance Configuration

| Property | Value |
|----------|-------|
| Engine | PostgreSQL 16 |
| Instance class | `db.t3.micro` |
| Storage | 20 GB gp2 |
| Multi-AZ | No (single-AZ) |
| Database name | `kiro_governance` |
| DB user | `kiro_mcp` (IAM authenticated) |
| Region | `us-east-1` |
| Encryption at rest | AWS-managed key (aws/rds) |
| Deletion protection | Enabled |
| Backup retention | 7 days |

### 2.2 Schema DDL

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

### 2.3 Column Reference

| Column | Type | Required | Description | Populated By |
|--------|------|----------|-------------|-------------|
| `id` | BIGSERIAL | Yes (auto) | Auto-incrementing primary key | PostgreSQL |
| `project_id` | TEXT | Yes | GitHub repository name | FR-02 (MCP write tool) |
| `update_text` | TEXT | Yes | Human-readable governance event description (max 4096 chars) | FR-02, FR-04 (GitHub Actions) |
| `type` | TEXT | Yes | Event classification: `macro` or `micro` | FR-03 (auto-classification) |
| `flag_override` | BOOLEAN | No | `true` if `type` was manually set; NULL if auto-classified | FR-03 (manual override) |
| `gate` | TEXT | No | Canonical macro gate name. Present for macro events, NULL for micro. | FR-02, FR-03 (auto-derived) |
| `phase` | TEXT | No | Phase grouping (e.g., `"Phase 1"`) | FR-02 (caller-supplied) |
| `phase_name` | TEXT | No | Human-readable phase name (e.g., `"Internal Preparation"`) | FR-02 (caller-supplied) |
| `source_ref` | TEXT | Yes | Provenance — commit SHA or file line reference | FR-02 |
| `actor` | TEXT | Yes | Who emitted/approved (agent name or human name) | FR-02 |
| `created_at` | TIMESTAMPTZ | Yes | Record creation timestamp (server-generated) | PostgreSQL `DEFAULT now()` |
| `idempotency_key` | TEXT | Yes | Dedup key: `<project_id>#<gate>#<YYYY-MM-DD>` for macro; `<project_id>#micro#<ULID>` for micro | FR-09 (computed) |

### 2.4 Indexes

| Index | Columns | Condition | Purpose |
|-------|---------|-----------|---------|
| `idx_project_created` | `(project_id, created_at DESC)` | — | Per-project timeline queries |
| `idx_type_created` | `(type, created_at DESC)` | — | Cross-project queries by event type |
| `idx_gate_created` | `(gate, created_at DESC)` | `WHERE gate IS NOT NULL` | Cross-project queries by gate (excludes micro events) |
| `uq_idempotency` | `(idempotency_key)` | — | Deduplication (UNIQUE constraint) |

### 2.5 Access Patterns

| # | Pattern | SQL | Used By |
|---|---------|-----|---------|
| 1 | Write governance event (with dedup) | `INSERT ... ON CONFLICT (idempotency_key) DO NOTHING` | FR-02 (MCP write tool) |
| 2 | All events for a project (timeline) | `SELECT ... WHERE project_id = $1 ORDER BY created_at DESC` | FR-08 |
| 3 | All macro events across projects | `SELECT ... WHERE type = 'macro' ORDER BY created_at DESC` | FR-08 |
| 4 | Events by gate across projects | `SELECT ... WHERE gate = $1 ORDER BY created_at DESC` | FR-08 |
| 5 | Project events filtered by type | `SELECT ... WHERE project_id = $1 AND type = $2 ORDER BY created_at DESC` | FR-08 |
| 6 | Project events in time range | `SELECT ... WHERE project_id = $1 AND created_at BETWEEN $2 AND $3 ORDER BY created_at DESC` | FR-08 |

### 2.6 Canonical TypeScript Type — `GovernanceEventRecord`

This is the **single source of truth**. F-01 and F-04 must import from this definition.

**Location:** `packages/shared/types/governance-event.ts`

```typescript
/**
 * PostgreSQL record shape for governance_events table.
 * Canonical definition — unified data model v1.4.
 */
export interface GovernanceEventRecord {
  /** Auto-incrementing primary key (populated by Postgres) */
  id?: number;
  /** GitHub repository name */
  project_id: string;
  /** Human-readable event description (max 4096 chars) */
  update_text: string;
  /** Event classification */
  type: 'macro' | 'micro';
  /** True if type was manually overridden; null/undefined if auto-classified */
  flag_override?: boolean;
  /** Canonical macro gate name. Present for macro events, absent for micro. */
  gate?: string;
  /** Phase grouping (e.g., "Phase 1") */
  phase?: string;
  /** Human-readable phase name (e.g., "Internal Preparation") */
  phase_name?: string;
  /** Provenance — commit SHA or file line reference */
  source_ref: string;
  /** Who emitted/approved (agent name or human name) */
  actor: string;
  /** ISO-8601 creation timestamp */
  created_at: string;
  /** Deduplication key */
  idempotency_key: string;
}

/** Valid macro gate names (from SRS §16) */
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
```

---

## 3. SSM Parameter Store

| Path | Type | Owner Domain | Description | Example Value |
|------|------|-------------|-------------|---------------|
| `/kiro-governance/slack/webhooks/{project_id}` | SecureString | F-01 (MCP Server) | Slack incoming webhook URL per project | `https://hooks.slack.com/services/T.../B.../xxx` |
| `/kiro-governance/config/mcp-api-key` | SecureString | F-01 (MCP Server) | Shared API key for GitHub Actions → MCP auth | `sk-gov-xxxxxxxxxxxx` |
| `/kiro-governance/config/db-endpoint` | String | F-04 (Data) | RDS instance endpoint | `kiro-gov.xxxx.us-east-1.rds.amazonaws.com` |
| `/kiro-governance/config/db-port` | String | F-04 (Data) | PostgreSQL port | `5432` |
| `/kiro-governance/config/db-name` | String | F-04 (Data) | Database name | `kiro_governance` |
| `/kiro-governance/config/db-user` | String | F-04 (Data) | IAM-authenticated DB user | `kiro_mcp` |
| `/kiro-governance/config/region` | String | F-04 (Data) | AWS region for SDK clients | `us-east-1` |

**Naming convention:** `/kiro-governance/{category}/{key}`

- `/kiro-governance/slack/webhooks/*` — per-project webhook URLs (dynamic, one per project)
- `/kiro-governance/config/*` — static server configuration

**Access pattern:** F-01 reads all paths at startup (config) and per-request with 5-min TTL cache (webhooks). No other domain writes to SSM at runtime.

**KMS Decrypt scope for SSM SecureString parameters:**

```json
{
  "Action": "kms:Decrypt",
  "Resource": "arn:aws:kms:<region>:<account>:key/alias/aws/ssm"
}
```

---

## 4. PII & Sensitive Data Inventory

| Field | Contains PII? | Contains Secrets? | Sensitivity | Notes |
|-------|--------------|-------------------|-------------|-------|
| `project_id` | No | No | Low | GitHub repo name |
| `update_text` | **Possible** | No | Low–Medium | Free-text. May contain project names, feature names. No customer PII. |
| `type` | No | No | Low | Enum: `macro`/`micro` |
| `flag_override` | No | No | Low | Boolean |
| `gate` | No | No | Low | Canonical gate name |
| `phase` | No | No | Low | Phase label |
| `phase_name` | No | No | Low | Phase name |
| `source_ref` | No | No | Low | Commit SHA / file reference |
| `actor` | **Possible** | No | Low–Medium | May contain internal team member names/usernames. No external customer PII. |
| `created_at` | No | No | Low | Timestamp |
| `idempotency_key` | No | No | Low | Composite of project + gate + date |

### Classification

| Category | Assessment |
|----------|-----------|
| PII | Minimal — `actor` may contain internal team member names. No customer/end-user PII. |
| PHI | None |
| Secrets | None stored in RDS. Secrets live in SSM SecureString only. DB auth via IAM token. |
| Compliance framework | None required — internal developer tooling POC |
| Data residency | `us-east-1` only. No cross-region replication. |
| Encryption at rest | AWS-managed key (aws/rds). Acceptable for non-PII/non-PHI internal data. |

---

## 5. Data Retention

| Store | Retention Policy | Mechanism | Justification |
|-------|-----------------|-----------|---------------|
| RDS PostgreSQL (`governance_events`) | **Indefinite** — no row expiry | Append-only writes; deletion protection enabled; 7-day backup retention | Governance events are an audit log. At POC volume (<1000 rows/month), storage is negligible. |
| SSM Parameter Store | **Indefinite** | Manual management | Config/secrets persist until explicitly rotated or deleted by admin. |

---

## 6. Cross-Document Consistency Check (H2)

### Field Names

| Field | SRS §7 | F-04 §3 | This doc §2.3 | Status |
|-------|--------|---------|---------------|--------|
| `project_id` | `project_id` | `project_id` | `project_id` | ✅ Consistent |
| `update_text` | `update_text` | `update_text` | `update_text` | ✅ Consistent |
| `type` | `type` | `type` | `type` | ✅ Consistent |
| `flag_override` | `flag_override` | `flag_override` | `flag_override` | ✅ Consistent |
| `gate` | `gate` | `gate` | `gate` | ✅ Consistent |
| `phase` | `phase` | `phase` | `phase` | ✅ Consistent |
| `phase_name` | — | `phase_name` | `phase_name` | ✅ New field from CR 2026-06-23 |
| `source_ref` | `source_ref` | `source_ref` | `source_ref` | ✅ Consistent |
| `actor` | `actor` | `actor` | `actor` | ✅ Consistent |
| `created_at` | `created_at` | `created_at` | `created_at` | ✅ Consistent |
| `idempotency_key` | FR-09 | `idempotency_key` | `idempotency_key` | ✅ Consistent |

### TypeScript Type

| Document | Type Name | Match |
|----------|-----------|-------|
| F-04 §5.2 | `GovernanceEventRecord` (used in code) | ✅ |
| This doc §2.6 | `GovernanceEventRecord` | ✅ Authoritative |

**Result: All field names, types, and constraints are consistent across F-01 and F-04. No discrepancies.**

---

*End of Unified Data Model v1.4*
