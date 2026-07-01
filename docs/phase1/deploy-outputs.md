# KiroGovernanceStack — Deploy Outputs

**Deployed:** 2026-06-25 | **Region:** us-east-1 | **Account:** 504649076991

| Output | Value |
|--------|-------|
| Elastic IP | `100.50.184.141` |
| EC2 Instance ID | `i-09fd97cd5e3af2df3` |
| EC2 Security Group ID | `sg-0e3d4d2d177ff810c` |
| Instance Profile ARN | `arn:aws:iam::504649076991:instance-profile/KiroGovernanceStack-McpServerInstanceProfile1F08EBDA-bUz4VMkPgoqv` |
| IAM Role Name | `kiro-gov-mcp-server-role` |
| IAM Role ARN | `arn:aws:iam::504649076991:role/kiro-gov-mcp-server-role` |
| RDS Endpoint | `kirogovernancestack-governancedb222ac1c0-zylylm08i7to.c2hys06m2tn2.us-east-1.rds.amazonaws.com` |
| EC2 IP | `44.219.249.6` (new ceanalytics deployment) |
| RDS Port | `5432` |
| RDS Database | `kiro_governance` |
| RDS User | `kiro_mcp` |
| Stack ARN | `arn:aws:cloudformation:us-east-1:504649076991:stack/KiroGovernanceStack/095356f0-65c7-11f1-9cfd-121c61bd111d` |

## Quick Connect (SSH tunnel for local GUI access)

```bash
ssh -L 5433:kirogovernancestack-governancedb222ac1c0-n7kkv2ltc0oe.cxuu7do6zxik.us-east-1.rds.amazonaws.com:5432 \
  ec2-user@100.50.184.141 -N
# Then connect GUI to localhost:5433
```

## Run Migration (from EC2)

```bash
ssh ec2-user@100.50.184.141

export PGPASSWORD=$(aws rds generate-db-auth-token \
  --hostname kirogovernancestack-governancedb222ac1c0-n7kkv2ltc0oe.cxuu7do6zxik.us-east-1.rds.amazonaws.com \
  --port 5432 --username kiro_mcp --region us-east-1)

# V001 — governance_events (run once)
psql "host=kirogovernancestack-governancedb222ac1c0-n7kkv2ltc0oe.cxuu7do6zxik.us-east-1.rds.amazonaws.com \
  port=5432 dbname=kiro_governance user=kiro_mcp sslmode=require" \
  -f /opt/kiro-governance/migrations/V001__governance_events.sql

# V002 — projects, project_gates, gate_evidence (run once)
psql "host=kirogovernancestack-governancedb222ac1c0-n7kkv2ltc0oe.cxuu7do6zxik.us-east-1.rds.amazonaws.com \
  port=5432 dbname=kiro_governance user=kiro_mcp sslmode=require" \
  -f /opt/kiro-governance/migrations/V002__projects_and_jira_sync.sql
```

## MCP Server env vars (update .env on EC2)

```
DB_ENDPOINT=kirogovernancestack-governancedb222ac1c0-n7kkv2ltc0oe.cxuu7do6zxik.us-east-1.rds.amazonaws.com
DB_PORT=5432
DB_NAME=kiro_governance
DB_USER=kiro_mcp
AWS_REGION=us-east-1
```
