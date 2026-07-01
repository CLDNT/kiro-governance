# DeliverPro Phase 2 — Deploy Outputs

**Deployed:** 2026-06-30 | **Account:** 713554442614 | **Region:** us-east-1

## App URL
**https://d2s8z1ws7s6cmc.cloudfront.net**

## Stack Outputs

| Resource | Value |
|----------|-------|
| App URL (CloudFront) | `https://d2s8z1ws7s6cmc.cloudfront.net` |
| API Gateway URL | `https://ug1vg2f8ac.execute-api.us-east-1.amazonaws.com/prod` |
| CloudFront Distribution ID | `E15R0HZJK1KNPA` |
| S3 Frontend Bucket | `deliverpro-frontend-713554442614` |
| Cognito User Pool ID | `us-east-1_6qhwLw6wc` |
| Cognito Client ID | `6jqmq9dc4k8pmknk1ot5883469` |

## Database
| Item | Value |
|------|-------|
| RDS Endpoint | `kirogovernancestack-governancedb222ac1c0-n7kkv2ltc0oe.cxuu7do6zxik.us-east-1.rds.amazonaws.com` |
| Database | `kiro_governance` |
| V003 Migration | Applied |

## Frontend .env (on file)
```
VITE_API_BASE_URL=https://ug1vg2f8ac.execute-api.us-east-1.amazonaws.com/prod
VITE_COGNITO_USER_POOL_ID=us-east-1_6qhwLw6wc
VITE_COGNITO_CLIENT_ID=6jqmq9dc4k8pmknk1ot5883469
```

## First Steps After Deploy

### Create your first admin user
```bash
aws cognito-idp admin-create-user \
  --user-pool-id us-east-1_6qhwLw6wc \
  --username faraz@cloudelligent.com \
  --user-attributes Name=email,Value=faraz@cloudelligent.com Name=email_verified,Value=true \
  --temporary-password TempPass123! \
  --profile ceanalytics --region us-east-1

# Add to admin group
aws cognito-idp admin-add-user-to-group \
  --user-pool-id us-east-1_6qhwLw6wc \
  --username faraz@cloudelligent.com \
  --group-name admin \
  --profile ceanalytics --region us-east-1
```

### Run Jira import (one-time, after logging in as admin)
POST `https://ug1vg2f8ac.execute-api.us-east-1.amazonaws.com/prod/api/projects/import-jira`
Auth: Bearer token from Cognito login

### SSH tunnel for DB access (optional, for GUI tools)
```bash
ssh -L 5433:kirogovernancestack-governancedb222ac1c0-n7kkv2ltc0oe.cxuu7do6zxik.us-east-1.rds.amazonaws.com:5432 \
  ec2-user@100.50.184.141 -N
# Connect GUI to localhost:5433, database kiro_governance, user kiro_mcp
# Password: aws rds generate-db-auth-token ...
```

## Build Fixes Applied During Deployment
| Fix | Issue |
|-----|-------|
| Added `jwt-decode@^4.0.0` | Missing dependency |
| Created `src/vite-env.d.ts` | `import.meta.env` type errors |
| Added `resolve.alias` to `vite.config.ts` | `@/` path alias |
| Renamed `postcss.config.js` → `.cjs` | ESM incompatibility |
| Fixed `jwt-decode` import (v4 named export) | Breaking API change |
| Fixed Axios `.data` access in hooks | Response unwrapping |
| Removed unused imports/vars | `noUnusedLocals: true` |
