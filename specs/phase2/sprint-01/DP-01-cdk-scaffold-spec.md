# Implementation Spec: DP-01 — CDK Stack Scaffold (DeliverProStack)

**Story ID:** DP-01  
**Sprint:** Phase 2 Sprint 01  
**Story Title:** CDK Project Scaffolding — Create DeliverProStack with Stateful & Stateless Stacks  
**Feature:** F-06: Infrastructure as Code (Phase 2 Enabler)  
**Assigned to:** Construct Developer  
**Estimated Points:** 5  

---

## Overview

This story creates a new CDK stack `DeliverProStack` separate from the existing Phase 1 `GovernanceStack`. The new stack splits infrastructure into two NestedStacks:

- **StatefulStack**: Cognito User Pool, S3 evidence bucket, S3 frontend bucket (removalPolicy: DESTROY for dev/POC)
- **StatelessStack**: API Gateway REST, Cognito Authorizer, CloudFront distribution

Output parameters are written to SSM Parameter Store for runtime consumption by Phase 2 application code.

**Architecture References:**
- `docs/phase2/auth-architecture.md` §1, §6, §7
- `docs/phase2/files-architecture.md` §2, §5
- `docs/code-structure.md` §10 (CDK stack pattern)

---

## 1. Requirements

### 1.1 Stack Structure

Create two separate NestedStacks:

1. **StatefulStack** (`infra/stacks/stateful-stack.ts`)
   - Cognito User Pool + App Client
   - S3 Evidence Bucket
   - S3 Frontend Bucket

2. **StatelessStack** (`infra/stacks/stateless-stack.ts`)
   - API Gateway REST API
   - Cognito Authorizer
   - CloudFront Distribution (OAC to frontend S3)
   - Lambda execution role template

3. **Main Stack** (`infra/stacks/deliverpro-stack.ts`)
   - Orchestrates both nested stacks
   - Outputs SSM parameters

### 1.2 Cognito User Pool Configuration

| Property | Value | Source |
|----------|-------|--------|
| Pool Name | `deliverpro-user-pool` | auth-architecture.md §1 |
| Username Attribute | Email (case-insensitive) | auth-architecture.md §1.1 |
| Admin Create User Only | `true` | auth-architecture.md §1 (ID-6 resolved) |
| Password Policy | Min 8, require: uppercase, lowercase, number, symbol | auth-architecture.md §1 |
| Email Verification | Required | auth-architecture.md §1.1 |
| MFA | Optional (TOTP only, not enforced) | auth-architecture.md §1 |
| User Attributes | `email` (required), `name` (required), `custom:role` (optional) | auth-architecture.md §1.1 |

**User Pool Groups** (created post-deployment via console/API):
- `admin`, `leadership`, `pm`, `sa`, `engineer`

**App Client Configuration:**

| Property | Value | Source |
|----------|-------|--------|
| Client Name | `deliverpro-spa-client` | auth-architecture.md §1.3 |
| Generate Client Secret | `false` | auth-architecture.md §1.3 (SPA cannot store secret) |
| OAuth Flows | Authorization Code (PKCE) | auth-architecture.md §1.3 |
| Callback URLs | `https://{distribution.domainName}/callback` + `http://localhost:5173/callback` (dev) | auth-architecture.md §1.3 |
| Logout URLs | `https://{distribution.domainName}/login` + `http://localhost:5173/login` (dev) | auth-architecture.md §1.3 |
| Token Validity | Access: 1h, ID: 1h, Refresh: 30 days | auth-architecture.md §1.3 |
| Scopes | `openid`, `email`, `profile` | auth-architecture.md §1.3 |

### 1.3 S3 Evidence Bucket

| Property | Value | Source |
|----------|-------|--------|
| Bucket Name | `deliverpro-evidence-{accountId}` | files-architecture.md §2 |
| Block Public Access | All 4 settings enabled | files-architecture.md §2 |
| Encryption | SSE-S3 (AES-256, AWS-managed) | files-architecture.md §2 |
| Versioning | Disabled | files-architecture.md §2 |
| CORS | Enabled for CloudFront origins | files-architecture.md §2.1 |
| Removal Policy (Dev) | DESTROY | Task spec |
| Removal Policy (Prod) | RETAIN | Task spec |

**CORS Configuration:**
```json
[
  {
    "AllowedOrigins": ["https://*.cloudfront.net", "http://localhost:5173"],
    "AllowedMethods": ["PUT", "GET"],
    "AllowedHeaders": ["Content-Type", "Content-Length", "x-amz-content-sha256"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

**Bucket Policy:**
- Deny unencrypted uploads (require SSE-S3)
- Allow Lambda execution role: s3:PutObject, s3:GetObject on `evidence/*` prefix

### 1.4 S3 Frontend Bucket

| Property | Value |
|----------|-------|
| Bucket Name | `deliverpro-frontend-{accountId}` |
| Block Public Access | All 4 settings enabled |
| Encryption | SSE-S3 |
| Versioning | Enabled (CloudFront cache invalidation only) |
| Static Website Hosting | Disabled (CloudFront serves via OAC) |
| Removal Policy (Dev) | DESTROY |
| Removal Policy (Prod) | RETAIN |

### 1.5 API Gateway REST API

| Property | Value |
|----------|-------|
| Name | `deliverpro-api` |
| Stage Name | `prod` (dev environment) |
| Logging | CloudWatch (optional in MVP, required in production) |
| WAF | Not attached in MVP (add in production) |

### 1.6 Cognito Authorizer

| Property | Value | Source |
|----------|-------|--------|
| Authorizer Type | COGNITO_USER_POOLS | auth-architecture.md §3 |
| Token Source | `Authorization` header (Bearer token) | auth-architecture.md §3 |
| Token Type | ID token (contains `cognito:groups`) | auth-architecture.md §3 |
| Cache TTL | 300 seconds | auth-architecture.md §3 |

### 1.7 CloudFront Distribution

| Property | Value |
|----------|-------|
| Distribution Name | `deliverpro-distribution` |
| Origin Access Control | Enabled (OAC to frontend S3) |
| Default Behavior | Serve frontend S3 via OAC |
| Custom Error Pages | 403/404 → `/index.html` (SPA fallback) |
| Compression | Enabled (gzip, brotli) |
| TTL | Default (24 hours) |
| Viewer Protocol Policy | Redirect HTTP to HTTPS |
| Price Class | PriceClass_100 (standard) |

---

## 2. Lambda Execution Role Configuration

A template IAM role is created in StatelessStack for backends to attach to their Lambdas. This base role includes permissions needed by Phase 2 backends:

**Base Permissions (inherited by all Phase 2 Lambdas):**

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "RDSConnect",
      "Effect": "Allow",
      "Action": ["rds-db:connect"],
      "Resource": "arn:aws:rds-db:REGION:ACCOUNT:dbuser:*/kiro_phase2"
    },
    {
      "Sid": "S3EvidenceBucket",
      "Effect": "Allow",
      "Action": ["s3:PutObject", "s3:GetObject"],
      "Resource": "arn:aws:s3:::deliverpro-evidence-ACCOUNT/evidence/*"
    },
    {
      "Sid": "SecretsManager",
      "Effect": "Allow",
      "Action": ["secretsmanager:GetSecretValue"],
      "Resource": "arn:aws:secretsmanager:REGION:ACCOUNT:secret:/deliverpro/*"
    },
    {
      "Sid": "SSMGetParameter",
      "Effect": "Allow",
      "Action": ["ssm:GetParameter"],
      "Resource": "arn:aws:ssm:REGION:ACCOUNT:parameter/deliverpro/*"
    }
  ]
}
```

---

## 3. SSM Parameter Outputs

After deployment, write these parameters to SSM for retrieval by Phase 2 application code:

| Parameter Name | Value | Type |
|----------------|-------|------|
| `/deliverpro/config/api-gateway-url` | API Gateway REST endpoint | String |
| `/deliverpro/config/cloudfront-domain` | CloudFront distribution domain | String |
| `/deliverpro/config/cognito-user-pool-id` | Cognito User Pool ID | String |
| `/deliverpro/config/cognito-client-id` | App Client ID | String |
| `/deliverpro/config/evidence-bucket-name` | S3 evidence bucket name | String |
| `/deliverpro/config/frontend-bucket-name` | S3 frontend bucket name | String |

---

## 4. CDK App Entry Point Update

Update `infra/bin/app.ts` to instantiate DeliverProStack in addition to GovernanceStack:

**Current (Phase 1 only):**
```typescript
const app = new cdk.App();
new GovernanceStack(app, 'KiroGovernanceStack', { /* */ });
app.synth();
```

**After DP-01 (Phase 1 + Phase 2):**
```typescript
const app = new cdk.App();
new GovernanceStack(app, 'KiroGovernanceStack', { /* */ });
new DeliverProStack(app, 'DeliverProStack', { /* */ });
app.synth();
```

---

## 5. Acceptance Criteria

- [ ] `infra/stacks/stateful-stack.ts` created with Cognito User Pool (adminCreateUserOnly, email username, password policy)
- [ ] `infra/stacks/stateful-stack.ts` includes S3 evidence bucket (Block Public Access, CORS, SSE-S3)
- [ ] `infra/stacks/stateful-stack.ts` includes S3 frontend bucket (Block Public Access, versioning enabled)
- [ ] `infra/stacks/stateless-stack.ts` created with API Gateway REST API
- [ ] `infra/stacks/stateless-stack.ts` includes Cognito Authorizer (ID token, Bearer token)
- [ ] `infra/stacks/stateless-stack.ts` includes CloudFront distribution (OAC to frontend S3, custom error 403/404→/index.html)
- [ ] Base Lambda execution role template created in StatelessStack with permissions: rds-db:connect, s3:PutObject+GetObject (evidence prefix), secretsmanager:GetSecretValue, ssm:GetParameter
- [ ] `infra/stacks/deliverpro-stack.ts` created orchestrating both nested stacks
- [ ] All Phase 2 resources have `removalPolicy: DESTROY` (dev/POC)
- [ ] SSM parameters written: api-gateway-url, cloudfront-domain, cognito-user-pool-id, cognito-client-id, evidence-bucket-name, frontend-bucket-name
- [ ] `infra/bin/app.ts` updated to instantiate both GovernanceStack and DeliverProStack
- [ ] CDK snapshot tests pass (proof of infrastructure structure)
- [ ] `npm run build -w infra` succeeds without errors
- [ ] `cdk synth` in infra/ succeeds without errors or CDK Nag violations
- [ ] Code formatted with Prettier, passes ESLint

---

## 6. Implementation Steps

### Step 1: Create StatefulStack
1. Create `infra/stacks/stateful-stack.ts`
2. Define StatefulStack interface extending NestedStack
3. Instantiate Cognito User Pool with all properties from §1.2
4. Create App Client with PKCE + OIDC scopes from §1.3
5. Create S3 evidence bucket with CORS and bucket policy from §1.3 & §1.4
6. Create S3 frontend bucket with versioning from §1.5
7. Export bucket names and Cognito IDs

### Step 2: Create StatelessStack
1. Create `infra/stacks/stateless-stack.ts`
2. Define StatelessStack interface extending NestedStack
3. Accept StatefulStack exports as props (bucket names, Cognito IDs)
4. Instantiate API Gateway REST API (stage: prod)
5. Create Cognito Authorizer (ID token, Bearer token)
6. Create CloudFront distribution with OAC to frontend S3
7. Create Lambda execution role template with base permissions
8. Export API endpoint URL and CloudFront domain

### Step 3: Create DeliverProStack (Main Orchestrator)
1. Create `infra/stacks/deliverpro-stack.ts`
2. Define DeliverProStack extending Stack
3. Instantiate StatefulStack as nested stack
4. Instantiate StatelessStack as nested stack (pass StatefulStack outputs)
5. Write all 6 SSM parameters from §3
6. Define stack outputs for console visibility

### Step 4: Update App Entry Point
1. Open `infra/bin/app.ts`
2. Import DeliverProStack
3. Add DeliverProStack instantiation after GovernanceStack
4. Ensure CDK synth runs without errors

### Step 5: Testing & Validation
1. Run `npm run build -w infra` to compile TypeScript
2. Run `cdk synth` to validate CloudFormation template
3. Write CDK snapshot tests in `infra/__tests__/deliverpro-stack.test.ts`
4. Run `npm test -w infra` to pass tests
5. Run `npm run format` and `npm run lint` to validate code quality

---

## 7. Key Design Decisions

### NestedStack vs Construct

**Decision:** Use NestedStack (not L3 Construct) for Stateful & Stateless.

**Rationale:**
- Each NestedStack gets its own 500-resource CloudFormation limit
- Stateful and Stateless have different lifecycle policies (RETAIN vs DESTROY)
- Clearer separation of concerns and rollback scope
- Standard CDK pattern per `code-structure.md` §10

### Removal Policies (Dev/POC)

**Decision:** All Phase 2 resources use `removalPolicy: DESTROY`.

**Rationale:**
- Phase 2 is MVP/POC in dev account
- Data is not production-critical
- Easier iteration and testing
- Will change to `removalPolicy: RETAIN` in production

### Cognito Hosted UI vs Custom Login

**Decision:** Use Cognito Hosted UI (custom login page deferred).

**Rationale:**
- auth-architecture.md §1.4: "MVP uses Cognito Hosted UI; custom login page deferred"
- Reduces build scope
- Standard OAuth flow via PKCE

### App Client without Secret

**Decision:** App Client has no client secret (SPA mode).

**Rationale:**
- auth-architecture.md §1.3: "SPA cannot securely store a client secret"
- Authorization Code + PKCE is the standard for browser-based SPAs

### S3 Frontend Bucket via CloudFront OAC

**Decision:** Frontend S3 bucket accessed only via CloudFront with OAC.

**Rationale:**
- Prevents direct S3 access
- CDN caching reduces latency
- SPA single-page routing: 403/404 errors redirect to `/index.html`

### Lambda Base Role in StatelessStack

**Decision:** Template base role created in StatelessStack, not a reusable Construct.

**Rationale:**
- Simplifies MVP
- Can be extracted to L3 Construct in future sprints
- Backends call `.addToPrincipalPolicy()` to add domain-specific permissions

---

## 8. References

| Reference | Section | Purpose |
|-----------|---------|---------|
| auth-architecture.md | §1, §6, §7 | Cognito User Pool, App Client, Authorizer design |
| files-architecture.md | §2, §5 | S3 evidence bucket configuration and CORS |
| code-structure.md | §10 | CDK stack pattern, NestedStack usage |
| cdk-constructs-standards.md | §8 | Removal policies, CDK best practices |

---

## 9. Testing Strategy

### Unit Tests

**File:** `infra/__tests__/deliverpro-stack.test.ts`

**Test cases:**

1. Cognito User Pool properties match spec
2. S3 evidence bucket has Block Public Access enabled
3. S3 evidence bucket has SSE-S3 enabled
4. S3 frontend bucket has versioning enabled
5. API Gateway created with Cognito Authorizer
6. CloudFront distribution has OAC to frontend S3
7. Lambda base role has rds-db:connect permission
8. Lambda base role has s3:*Object permissions on evidence/* prefix
9. SSM parameters are created with correct names and values
10. Stack outputs include API endpoint URL and CloudFront domain

### Snapshot Tests

Generate CDK snapshot after `cdk synth` to verify CloudFormation structure remains stable across deploys.

### Manual Verification (Post-Deploy)

1. Cognito User Pool created and accessible
2. S3 buckets created with correct settings
3. CloudFront distribution live (no 403 errors on `/`)
4. API Gateway endpoint accessible
5. SSM parameters readable via `aws ssm get-parameter` CLI

---

## 10. Rollback Strategy

**If deployment fails:**

1. Run `cdk destroy DeliverProStack --force`
2. All Phase 2 resources are destroyed (removalPolicy: DESTROY in dev)
3. Phase 1 GovernanceStack remains untouched (separate stack)
4. Fix issues and re-run `cdk deploy`

**If a specific NestedStack fails:**

Use CloudFormation console to rollback the failed NestedStack without affecting the other.

---

## 11. Definition of Done

- [ ] All AC met (verified checklist in §5)
- [ ] CDK snapshot tests passing
- [ ] `npm run format`, `npm run lint` passing
- [ ] `cdk synth` produces valid CloudFormation
- [ ] Code reviewed by plan-reviewer
- [ ] Spec-ready for backend implementation (no gaps)

