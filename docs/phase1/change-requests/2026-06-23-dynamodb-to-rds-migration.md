# Change Request: Replace DynamoDB with RDS PostgreSQL

## Doc Control

| Field | Value |
|-------|-------|
| Date | 2026-06-23 |
| Author | Orchestrator |
| Requested by | Tariq Khan |
| Status | Pending architect review |
| Affects | F-04 (Data & Persistence), F-01 (MCP Server Core), KG-01 (CDK Stack) |

---

## 1. Summary

Replace DynamoDB (`kiro-governance-tracker`) with an **RDS PostgreSQL** instance as the governance event store. The MCP Server EC2 instance connects directly to RDS using its **IAM role** (IAM authentication — no password, no proxy). SSM Parameter Store is retained for Slack webhooks and API key only.

**Constraints from Tariq Khan (2026-06-23):**
- Simple RDS instance — no Aurora, no Multi-AZ for POC
- IAM authentication on the EC2 instance role — no stored password
- No RDS Proxy
- Simple, flat schema — no over-engineering

---

## 2. What Changes

### 2.1 Infrastructure (CDK — KG-01)

| Component | Current | After |
|-----------|---------|-------|
| Database | DynamoDB table `kiro-governance-tracker` | RDS PostgreSQL `db.t3.micro`, single-AZ |
| GSIs | 2 (`gsi-type-created`, `gsi-gate-created`) | Native SQL indexes |
| Dedup sentinel records | Separate `DEDUP#` items in same table | Unique constraint on `idempotency_key` column |
| Billing model | PAY_PER_REQUEST | ~$15/mo (t3.micro on-demand, see §6) |
| Auth | IAM role → DynamoDB endpoint (no password) | IAM role → RDS IAM auth token (no password) |
| VPC placement | DynamoDB VPC endpoint | RDS must be in same VPC as EC2 |

**CDK changes:**
- Remove: `aws-cdk-lib/aws-dynamodb` table, GSIs, deletion protection, PITR
- Remove: `dynamodb:PutItem`, `dynamodb:Query`, `dynamodb:DeleteItem`, `dynamodb:UpdateItem` IAM statements
- Add: `aws-cdk-lib/aws-rds` — `DatabaseInstance` (`db.t3.micro`, PostgreSQL 16, single-AZ)
- Add: IAM `rds-db:connect` permission on the EC2 instance role scoped to the DB resource ARN
- Add: Security Group allowing port 5432 from EC2 instance SG only
- Remove from SSM: `/kiro-governance/config/table-name` (DynamoDB-specific)
- Add to SSM: `/kiro-governance/config/db-endpoint`, `/kiro-governance/config/db-port`, `/kiro-governance/config/db-name`

### 2.2 Database Schema (new)

Single table replacing the DynamoDB single-table design:

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

**Deduplication:** The `UNIQUE` constraint on `idempotency_key` replaces the DynamoDB `ConditionalCheckFailedException` pattern. An `INSERT ... ON CONFLICT DO NOTHING` is the new dedup write pattern — simpler and atomic.

### 2.3 MCP Server — `record_progress` tool (F-01)

| Aspect | Current (DynamoDB) | After (RDS) |
|--------|-------------------|-------------|
| AWS SDK | `@aws-sdk/client-dynamodb` | `@aws-sdk/rds-signer` (IAM token) + `pg` (node-postgres) |
| Dedup | Conditional PutItem sentinel | `INSERT ... ON CONFLICT (idempotency_key) DO NOTHING` |
| Write | `PutItemCommand` with `marshall()` | `INSERT INTO governance_events (...)` |
| Read (FR-08) | `QueryCommand` on base table / GSIs | Standard SQL `SELECT` with `WHERE` / `ORDER BY` |
| Connection | Stateless per-invocation | Connection pool (single EC2 process — pool of 2–5) |
| Auth | SDK uses EC2 instance role automatically | `rds-db:connect` IAM token, refreshed every 15 min |

**IAM auth flow (no password):**
1. EC2 instance role has `rds-db:connect` permission
2. MCP server calls `RDSSigner.getAuthToken()` to get a short-lived token (15-min TTL)
3. Token is used as the PostgreSQL password — the DB user (`kiro_mcp`) has `rds_iam` attribute
4. No password stored anywhere — no SSM secret needed for DB credentials

### 2.4 Removed SSM Parameters

| Path | Action |
|------|--------|
| `/kiro-governance/config/table-name` | **Remove** — DynamoDB-specific |
| `/kiro-governance/config/region` | **Retain** — still needed for RDS signer |

### 2.5 New SSM Parameters

| Path | Type | Value |
|------|------|-------|
| `/kiro-governance/config/db-endpoint` | String | RDS instance endpoint (e.g. `kiro-gov.xxxx.us-east-1.rds.amazonaws.com`) |
| `/kiro-governance/config/db-port` | String | `5432` |
| `/kiro-governance/config/db-name` | String | `kiro_governance` |
| `/kiro-governance/config/db-user` | String | `kiro_mcp` |

No SecureString needed — credentials come from IAM token, not a stored password.

---

## 3. Affected Files

| File | Change |
|------|--------|
| `infra/stacks/stateful.ts` (or equivalent CDK stack) | Remove DynamoDB; add RDS instance + security group |
| `packages/mcp-server/src/tools/record-progress.ts` | Replace DynamoDB SDK calls with `pg` + IAM token |
| `packages/shared/types/governance-event.ts` | Remove DynamoDB-specific `pk`/`sk` fields; keep flat record shape |
| `packages/shared/constants/macro-gates.ts` | No change |
| `docs/phase1/data-persistence-architecture.md` | Full rewrite for RDS |
| `docs/phase1/architecture/unified-data-model.md` | Update §1–§3 for RDS schema |
| `migrations/V001__governance_events.sql` | New file — initial schema |
| `.kiro/governance/governance-trigger.js` | No change — calls MCP tool only |

---

## 4. What Does NOT Change

- The 10 canonical macro gate names
- `GATE_PHASES` and `GATE_PHASE_NAMES` constants
- GitHub Actions workflow (`governance-trigger.yml`)
- `notify_slack` tool
- SSM paths for Slack webhooks and API key
- MCP server transport (HTTPS + API key auth)
- The `record_progress` tool's external interface (`project_id`, `update_text`, `type`, `gate`, `phase`, `phase_name`, `source_ref`, `actor`, `flag_override`)

---

## 5. Impact on In-Progress / Built Stories

All 11 stories are complete. This change requires new stories:

| Story ID | Title | Points | Sprint |
|----------|-------|--------|--------|
| KG-15 | CDK: Replace DynamoDB with RDS PostgreSQL (t3.micro, IAM auth, SG) | 5 | Sprint 4 |
| KG-16 | DB migration script: `V001__governance_events.sql` | 2 | Sprint 4 |
| KG-17 | MCP Server: replace DynamoDB SDK with `pg` + RDS IAM auth token | 5 | Sprint 4 |
| KG-18 | Update shared types: flatten `GovernanceEventRecord` (remove pk/sk) | 1 | Sprint 4 |

**Total: 13 points, 1 sprint (Sprint 4)**

No in-progress stories are affected — all prior work is complete and merged.

---

## 6. Cost Impact

| Component | Current | After | Delta |
|-----------|---------|-------|-------|
| DynamoDB | ~$0.00/mo (free tier) | Removed | — |
| RDS PostgreSQL db.t3.micro | Not present | ~$15.33/mo (on-demand, single-AZ, 20 GB gp2) | +$15.33 |
| RDS storage (20 GB gp2) | — | Included above | — |
| **Total** | ~$8.47/mo | ~$23.80/mo | **+$15.33/mo** |

> `Architect decision — not customer-specified:` db.t3.micro is the smallest available RDS instance. 20 GB gp2 storage is the minimum. At POC governance volume (<1000 rows/month), this is more than sufficient. Switch to Reserved Instance (1-year) to reduce to ~$9/mo if the system runs long-term.

---

## 7. Risks

| Risk | Severity | Mitigation |
|------|----------|-----------|
| RDS in VPC requires EC2 and RDS in same VPC | Low | EC2 is already in a VPC; deploy RDS to the same VPC private subnet |
| IAM token refresh (15-min TTL) requires connection pool to handle re-auth | Low | `pg` connection pool re-generates token on new connection; keep pool small (2–5) |
| Cold-start connection latency vs DynamoDB | Info | Single EC2 process with persistent pool — no cold start concern |
| Loss of existing DynamoDB records | Low | All records are POC test data; no production data exists. Snapshot DynamoDB before removing CDK resource. |
| db.t3.micro CPU burst credits | Info | Governance event writes are infrequent (<10/day at POC scale). No CPU pressure expected. |

---

## 8. Action Items Before Implementation

- [ ] Architect updates `data-persistence-architecture.md` for RDS design
- [ ] Architect updates `unified-data-model.md` §1–§3 for RDS schema
- [ ] Security reviewer validates IAM auth approach (no stored credentials)
- [ ] Technical PM adds KG-15 through KG-18 to backlog
- [ ] Plan reviewer validates sprint 4 stories

---

*End of Change Request — 2026-06-23*
