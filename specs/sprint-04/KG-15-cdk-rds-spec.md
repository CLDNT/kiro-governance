# Implementation Spec — KG-15: CDK Replace DynamoDB with RDS PostgreSQL

**Story ID:** KG-15
**Feature:** F-04 — Data & Persistence (RDS PostgreSQL)
**Sprint:** Sprint 4
**Type:** Infrastructure / CDK

**Spec Strategy:**
See `docs/phase1/data-persistence-architecture.md` §2 (RDS config), §6 (IAM setup), §7 (CDK pattern)
See `docs/code-structure.md` §1, §8 (CDK best practices)

---

## Overview

This story migrates the governance event store from DynamoDB to RDS PostgreSQL as specified in F-04. The MCP server will write governance events to a PostgreSQL table instead of DynamoDB, using IAM-based authentication for enhanced security.

**Changes:**
- Replace DynamoDB table (`kiro-governance-tracker`) and GSIs with RDS PostgreSQL 16 instance
- Implement IAM authentication for EC2 MCP server
- Update security group rules for RDS access (TCP 5432 from EC2 only)
- Remove DynamoDB IAM permissions; add RDS IAM permissions to EC2 role
- Populate SSM parameters with RDS connection details
- Deploy PostgreSQL schema via migration file

---

## Acceptance Criteria

- [ ] CDK deploys `db.t3.micro` PostgreSQL 16, single-AZ, deletion protection ON, backup retention 7 days
- [ ] RDS instance has IAM authentication enabled
- [ ] Security group allows inbound TCP 5432 from EC2 MCP server SG only
- [ ] EC2 instance role updated: `rds-db:connect` scoped to `dbuser:<dbi-resource-id>/kiro_mcp`
- [ ] SSM parameters created: `/kiro-governance/config/db-endpoint`, `db-port`, `db-name`, `db-user`
- [ ] DynamoDB table, GSIs, DynamoDB IAM statements removed from CDK stack
- [ ] `cdk synth` succeeds without errors
- [ ] `cdk deploy` succeeds; RDS instance and EC2 role created with correct permissions

---

## Implementation Steps

### Step 1: Update `infra/stacks/governance-stack.ts` — Remove DynamoDB

**Action:** Delete all DynamoDB table creation code (lines 20–64) and GSI definitions (lines 66–92).

Keep:
- EC2 instance setup (lines 94+)
- IAM role base setup (line 28) — will be updated in Step 2
- SSM parameters (lines 180+) — will be updated in Step 3
- CloudWatch log group (lines 195–200)
- Stack outputs (lines 202–254)

### Step 2: Update IAM Role in `governance-stack.ts`

**Replace DynamoDB permissions with RDS permissions:**

```typescript
// REMOVE these statements:
// - this.mcpServerRole.addToPrincipalPolicy({ sid: 'DynamoDBWrite', ... })
// - this.mcpServerRole.addToPrincipalPolicy({ sid: 'DenyAppendOnlyViolation', ... })

// ADD new RDS IAM authentication statement:
this.mcpServerRole.addToPrincipalPolicy(
  new iam.PolicyStatement({
    sid: 'RDSIAMConnect',
    effect: iam.Effect.ALLOW,
    actions: ['rds-db:connect'],
    resources: [`arn:aws:rds-db:${region}:${accountId}:dbuser:${this.dbInstance.instanceResourceId}/kiro_mcp`],
  }),
);

// KEEP SSM and KMS permissions unchanged
```

**Note:** The `${this.dbInstance.instanceResourceId}` will be resolved from the RDS instance created in Step 3.

### Step 3: Create RDS Instance in `governance-stack.ts`

**Add after line 18 (after class declaration), before EC2 setup:**

```typescript
// ==================== RDS PostgreSQL Instance ====================
// Source: data-persistence-architecture.md §2, §7

// Security group for RDS — allow 5432 from EC2 MCP server only
const dbSg = new ec2.SecurityGroup(this, 'RdsSecurityGroup', {
  vpc,
  securityGroupName: 'kiro-governance-rds-sg',
  description: 'RDS PostgreSQL — allow 5432 from MCP server only',
  allowAllOutbound: false,
});

// Inbound: TCP 5432 from EC2 MCP server security group
// (Note: sg is created later; use a forward reference or create dbSg after sg)
// DEFER: add this rule after sg is created

// RDS Instance
this.dbInstance = new rds.DatabaseInstance(this, 'GovernanceDb', {
  engine: rds.DatabaseInstanceEngine.postgres({ version: rds.PostgresEngineVersion.VER_16 }),
  instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.MICRO),
  vpc,
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
```

**Important:** Since the EC2 security group (`sg`) is created later in the CDK code (for the EC2 instance), add the ingress rule for `dbSg` after `sg` is defined:

```typescript
// After sg is created (around line 140):
dbSg.addIngressRule(sg, ec2.Port.tcp(5432), 'MCP server access to RDS');
```

**Reordering consideration:** Move EC2 security group creation (`sg`) to BEFORE the RDS instance creation so the ingress rule can reference it directly. Refactor to:

1. Create VPC lookup
2. Create EC2 security group (`sg`)
3. Create RDS security group (`dbSg`) with ingress rule from `sg`
4. Create RDS instance with `dbSg`
5. Create EC2 instance with `sg`

### Step 4: Update IAM Role — RDS Connect Statement

**Update the IAM role to reference the RDS instance:**

After RDS instance is created, add the RDS IAM connect statement:

```typescript
this.mcpServerRole.addToPrincipalPolicy(
  new iam.PolicyStatement({
    sid: 'RDSIAMConnect',
    effect: iam.Effect.ALLOW,
    actions: ['rds-db:connect'],
    resources: [`arn:aws:rds-db:${region}:${accountId}:dbuser:${this.dbInstance.instanceResourceId}/kiro_mcp`],
  }),
);
```

### Step 5: Update SSM Parameters

**Replace DynamoDB table references with RDS connection details:**

```typescript
// Remove:
// new ssm.StringParameter(this, 'TableNameParam', { parameterName: '/kiro-governance/config/table-name', ... })

// Add RDS parameters:
new ssm.StringParameter(this, 'DbEndpointParam', {
  parameterName: '/kiro-governance/config/db-endpoint',
  stringValue: this.dbInstance.dbInstanceEndpointAddress,
  description: 'RDS instance endpoint',
});

new ssm.StringParameter(this, 'DbPortParam', {
  parameterName: '/kiro-governance/config/db-port',
  stringValue: this.dbInstance.dbInstanceEndpointPort,
  description: 'RDS instance port',
});

new ssm.StringParameter(this, 'DbNameParam', {
  parameterName: '/kiro-governance/config/db-name',
  stringValue: 'kiro_governance',
  description: 'PostgreSQL database name',
});

new ssm.StringParameter(this, 'DbUserParam', {
  parameterName: '/kiro-governance/config/db-user',
  stringValue: 'kiro_mcp',
  description: 'PostgreSQL IAM user for MCP server',
});
```

Keep `/kiro-governance/config/region` parameter unchanged.

### Step 6: Create PostgreSQL Schema Migration

**Create file:** `migrations/V001__governance_events.sql`

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

-- Setup IAM authentication for kiro_mcp user
CREATE USER kiro_mcp;
GRANT rds_iam TO kiro_mcp;
GRANT ALL PRIVILEGES ON DATABASE kiro_governance TO kiro_mcp;
```

### Step 7: Verify Stack Outputs

**Update CDK outputs to reflect RDS instead of DynamoDB:**

```typescript
// Remove:
// new cdk.CfnOutput(this, 'TableName', { value: this.table.tableName, ... })
// new cdk.CfnOutput(this, 'TableArn', { value: this.table.tableArn, ... })

// Add:
new cdk.CfnOutput(this, 'RdsEndpoint', {
  value: this.dbInstance.dbInstanceEndpointAddress,
  description: 'RDS instance endpoint',
  exportName: 'KiroGovernanceRdsEndpoint',
});

new cdk.CfnOutput(this, 'RdsPort', {
  value: this.dbInstance.dbInstanceEndpointPort,
  description: 'RDS instance port',
});
```

### Step 8: Run CDK Synth and Deploy

```bash
cd infra
npx cdk synth
npx cdk deploy KiroGovernanceStack --require-approval broadening
```

**Expected output:**
- RDS instance created: `kiro-governance` database, `db.t3.micro`, IAM auth enabled, single-AZ, deletion protection ON, 7-day backup retention
- EC2 security group updated to reference RDS security group
- IAM role: `kiro-gov-mcp-server-role` updated with `rds-db:connect` permission
- SSM parameters: `/kiro-governance/config/db-*` populated
- Stack outputs showing RDS endpoint, EC2 elastic IP, security groups

---

## Testing Checklist

- [ ] `cdk synth` produces valid CloudFormation
- [ ] `cdk deploy` completes without errors
- [ ] RDS instance is running (check AWS Console or `aws rds describe-db-instances`)
- [ ] Security group allows inbound 5432 from EC2 only
- [ ] IAM role has `rds-db:connect` permission scoped to `/kiro_mcp` database user
- [ ] SSM parameters exist and contain correct RDS endpoint, port, name, user
- [ ] SSH into EC2 instance and verify EC2 has network access to RDS (TCP 5432)
- [ ] Database user `kiro_mcp` exists and has `rds_iam` attribute
- [ ] `governance_events` table created with correct schema and indexes
- [ ] MCP server can connect to RDS via IAM auth and write/query records

---

## Code Structure References

- **CDK Stack:** `infra/stacks/governance-stack.ts`
- **CDK Best Practices:** `docs/code-structure.md` §8 (removal policies, log retention, naming)
- **RDS Config Details:** `docs/phase1/data-persistence-architecture.md` §2, §6, §7
- **IAM Setup:** `docs/phase1/data-persistence-architecture.md` §6.1

---

## Edge Cases & Considerations

| Case | Action |
|------|--------|
| RDS instance creation fails due to VPC issues | Verify VPC has private subnet with NAT gateway for RDS to reach KMS |
| IAM authentication token expired | MCP server code handles token refresh; see data-persistence-architecture.md §8 |
| Security group ingress rule missing | Verify `dbSg.addIngressRule(sg, ...)` is called after both `sg` and `dbSg` are created |
| DynamoDB table still referenced elsewhere | Search codebase for `kiro-governance-tracker`; remove all references |
| Stack outputs show old DynamoDB values | Ensure DynamoDB output statements are deleted before deploy |

---

## Definition of Done

- [ ] DynamoDB table and GSIs removed from CDK code
- [ ] RDS PostgreSQL instance configured (t3.micro, IAM auth, single-AZ, deletion protection, 7-day backups)
- [ ] Security group restricts inbound 5432 to EC2 MCP server only
- [ ] EC2 role has `rds-db:connect` permission (scoped to `/kiro_mcp` user)
- [ ] SSM parameters created for RDS endpoint, port, name, user
- [ ] PostgreSQL schema migration created (`V001__governance_events.sql`)
- [ ] Stack outputs updated to reference RDS
- [ ] `cdk synth` succeeds
- [ ] `cdk deploy` succeeds
- [ ] All acceptance criteria met

---

*End of Implementation Spec v1.0*
