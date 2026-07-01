# Implementation Spec: DP-04 — Cognito User Pool + Groups + App Client

**Spec ID:** DP-04  
**Feature:** Auth Domain Infrastructure  
**Sprint:** Phase 2, Sprint 01  
**Story Points:** 5  
**Complexity:** Medium

---

## Overview

This spec defines the CDK constructs and implementation details for creating an AWS Cognito User Pool with:
- Email-based user provisioning (admin-create only)
- 5 user pool groups for role-based access control
- SPA-optimized app client with PKCE (no client secret)
- Cognito domain for Hosted UI access
- SSM parameter exports for application consumption

**Architecture Reference:** `docs/phase2/auth-architecture.md` §1.1–1.4, §7

**Acceptance Criteria:**
- [ ] CDK User Pool created with email alias, password policy, MFA optional (TOTP)
- [ ] 5 user pool groups created: `admin`, `leadership`, `pm`, `sa`, `engineer`
- [ ] App client configured with PKCE, no client secret, correct callback/logout URLs
- [ ] Cognito domain prefix `deliverpro-auth` deployed
- [ ] Pool ID, Client ID, User Pool Domain URL exported to SSM Parameter Store
- [ ] CDK snapshot test passing
- [ ] All resources tagged with `Project=DeliverPro`, `Component=Auth`

---

## 1. Implementation Steps

### Step 1.1: Create Auth Infra Construct

**File:** `infra/constructs/cognito-auth.ts`

**Purpose:** Reusable L3 CDK construct for Cognito User Pool, Groups, App Client, and Domain.

**Key Design Decisions:**
- Single construct combines pool, domain, groups, and client — reduces coupling
- Exposes `userPool`, `userPoolClient`, `cognitoDomain` as public readonly properties
- Props interface accepts optional `callbackUrls` and `logoutUrls` for flexibility (dev vs prod)
- Group creation via CfnUserPoolGroup (L1) for fine-grained control

### Step 1.2: Create Stateful Stack Integration

**File:** `infra/stacks/stateful.ts` (update existing)

**Purpose:** Instantiate AuthInfra construct and export pool/client IDs to SSM.

**Changes:**
- Import `CognitoAuthInfra` from constructs
- Create instance: `new CognitoAuthInfra(this, 'AuthInfra', { ... })`
- Export to SSM: `pool ID`, `client ID`, `domain URL`
- Apply removal policy `RETAIN` (auth data must survive stack deletion)

### Step 1.3: Define TypeScript Types

**File:** `packages/shared/types/auth-context.ts` (new)

**Purpose:** Shared types for JWT claims extraction and role handling.

**Exports:**
- `AuthContext` interface (userId, email, role, groups)
- `Role` type union: `'admin' | 'leadership' | 'pm' | 'sa' | 'engineer'`

### Step 1.4: Environment Configuration

**File:** `infra/config/dev.ts` and `infra/config/prod.ts` (update)

**Purpose:** Environment-specific Cognito callbacks and logout URLs.

**Content:**
- Dev: `http://localhost:5173/callback`, `http://localhost:5173/login`
- Prod: `https://{cloudfront-domain}/callback`, `https://{cloudfront-domain}/login`

---

## 2. Cognito User Pool Configuration

### 2.1 User Pool Properties

```typescript
interface CognitoAuthInfraProps {
  // Optional: environment for environment-aware callbacks
  environment?: 'dev' | 'prod';
  
  // Optional: override default callback URLs
  callbackUrls?: string[];
  
  // Optional: override default logout URLs
  logoutUrls?: string[];
}
```

**User Pool Settings (from auth-architecture.md §1):**

| Setting | Value | Rationale |
|---------|-------|-----------|
| Pool name | `deliverpro-user-pool` | Identifier for Cognito console |
| Region | `us-east-1` | Matches all Phase 2 resources |
| Self-signup enabled | `false` | Admin creates users only (ID-6) |
| Sign-in aliases | `email` (case-insensitive) | Email is username |
| Auto-verify email | `true` | Email verification required |
| Password min length | 8 characters | Architect decision (Cognito default) |
| Password requirements | Uppercase + Lowercase + Number + Symbol | Architect decision |
| MFA | Optional (TOTP only) | No SMS; TOTP via authenticator app |
| Account recovery | Email only | No phone-based recovery for MVP |
| Removal policy | `RETAIN` | Auth data survives stack deletion |

**Standard Attributes:**

| Attribute | Required | Mutable | Notes |
|-----------|----------|--------|-------|
| `email` | Yes | No | Login identifier, verified on signup |
| `name` (fullname) | Yes | Yes | Display name for audit logs |

**No Custom Attributes** for MVP (can be added later if needed for custom:role or custom:department).

---

## 3. User Pool Groups

### 3.1 Group Definitions

Create 5 CfnUserPoolGroup resources with the following spec:

| Group Name | Description | Typical Members | Priority |
|------------|-------------|-----------------|----------|
| `admin` | Full system configuration + user management | System administrators | 1 (highest) |
| `leadership` | Cross-project visibility + admin panel access | Chris Xenos, Kasim | 2 |
| `pm` | Project management — own projects + evidence + status logs | Delivery PMs | 3 |
| `sa` | Technical review — mark human_review checkpoints | Solutions Architects | 4 |
| `engineer` | Read-only project visibility | Assigned developers | 5 (lowest) |

**Source:** auth-architecture.md §1.2, SRS §9

### 3.2 Role Priority Resolution

The Lambda middleware (`extractAuthContext()`) resolves a user's **primary role** (for RBAC) by selecting the highest-priority group from `cognito:groups` array:

```
Priority order: admin > leadership > pm > sa > engineer
Default (no groups): engineer (read-only)
```

**Example:**
- User in both `pm` and `sa` groups → primary role is `pm` (higher priority)
- User in no groups → primary role defaults to `engineer`

---

## 4. App Client Configuration

### 4.1 App Client Properties

**Client Name:** `deliverpro-spa-client`

**OAuth Configuration (from auth-architecture.md §1.3):**

| Property | Value | Rationale |
|----------|-------|-----------|
| Generate client secret | `false` | SPA cannot securely store secret |
| Auth flows | `USER_SRP_AUTH` | Secure password flow |
| OAuth flows | Authorization Code (PKCE) | Deprecated implicit flow — PKCE is SPA standard |
| Scopes | `openid`, `email`, `profile` | Minimum needed for ID token + claims |
| Callback URLs | Dev: `http://localhost:5173/callback` | SPA redirect after login |
| | Prod: `https://{cloudfront-domain}/callback` | CloudFront distribution domain |
| Logout URLs | Dev: `http://localhost:5173/login` | Redirect after logout |
| | Prod: `https://{cloudfront-domain}/login` | CloudFront distribution |

**Token Validity:**

| Token | Lifetime | Notes |
|-------|----------|-------|
| Access token | 1 hour | Expires after 1 hour of use |
| ID token | 1 hour | Expires with access token; used for auth context |
| Refresh token | 30 days | Allows silent refresh for 30 days, then re-login required |

**Implementation:**
```typescript
this.userPoolClient = this.userPool.addClient('SpaClient', {
  userPoolClientName: 'deliverpro-spa-client',
  generateSecret: false,
  authFlows: { userSrp: true },
  oAuth: {
    flows: { authorizationCodeGrant: true },
    scopes: [
      cognito.OAuthScope.OPENID,
      cognito.OAuthScope.EMAIL,
      cognito.OAuthScope.PROFILE,
    ],
    callbackUrls: props.callbackUrls || ['http://localhost:5173/callback'],
    logoutUrls: props.logoutUrls || ['http://localhost:5173/login'],
  },
  accessTokenValidity: cdk.Duration.hours(1),
  idTokenValidity: cdk.Duration.hours(1),
  refreshTokenValidity: cdk.Duration.days(30),
});
```

---

## 5. Cognito Domain & Hosted UI

### 5.1 Domain Configuration

**Domain Prefix:** `deliverpro-auth`

**Full Domain URL:** `https://deliverpro-auth.auth.us-east-1.amazoncognito.com`

**Purpose:** Hosts Cognito Hosted UI for login/MFA enrollment.

**Implementation:**
```typescript
this.userPool.addDomain('CognitoDomain', {
  cognitoDomain: { domainPrefix: 'deliverpro-auth' },
});
```

**Note:** Custom UI (branded login page) is deferred to Phase 3. MVP uses Cognito Hosted UI as-is.

---

## 6. SSM Parameter Exports

After stack deployment, export the following to AWS Systems Manager Parameter Store for application consumption:

| Parameter Path | Value | Type | Retention |
|----------------|-------|------|-----------|
| `/deliverpro/auth/user-pool-id` | User Pool ID (e.g., `us-east-1_XXXXXX`) | String | Permanent |
| `/deliverpro/auth/client-id` | App Client ID (e.g., `1a2b3c4d5e...`) | String | Permanent |
| `/deliverpro/auth/domain-url` | Full domain URL (e.g., `https://deliverpro-auth.auth.us-east-1.amazoncognito.com`) | String | Permanent |
| `/deliverpro/auth/region` | AWS region (e.g., `us-east-1`) | String | Permanent |

**Implementation in Stateful Stack:**
```typescript
new ssm.StringParameter(this, 'UserPoolIdParam', {
  parameterName: '/deliverpro/auth/user-pool-id',
  stringValue: authInfra.userPool.userPoolId,
  description: 'Cognito User Pool ID for DeliverPro',
});

new ssm.StringParameter(this, 'ClientIdParam', {
  parameterName: '/deliverpro/auth/client-id',
  stringValue: authInfra.userPoolClient.userPoolClientId,
  description: 'Cognito App Client ID for DeliverPro SPA',
});

// Domain URL requires zone lookup or manual construction
const domainUrl = `https://deliverpro-auth.auth.us-east-1.amazoncognito.com`;
new ssm.StringParameter(this, 'DomainUrlParam', {
  parameterName: '/deliverpro/auth/domain-url',
  stringValue: domainUrl,
  description: 'Cognito Hosted UI domain for DeliverPro',
});
```

---

## 7. CDK Implementation Details

### 7.1 Construct File Structure

**File:** `infra/constructs/cognito-auth.ts`

**Class:** `CognitoAuthInfra extends Construct`

**Public Properties:**
```typescript
public readonly userPool: cognito.UserPool;
public readonly userPoolClient: cognito.UserPoolClient;
public readonly cognitoDomain: cognito.UserPoolDomain;
```

**Private Properties:**
```typescript
private readonly groups: string[] = ['admin', 'leadership', 'pm', 'sa', 'engineer'];
```

### 7.2 Constructor Logic

1. Create UserPool with password policy, MFA (optional), email alias
2. Add Cognito domain prefix
3. Create 5 CfnUserPoolGroup resources
4. Add SPA client with PKCE, no secret, correct URLs
5. Export pool and client IDs (via props.stack or manual export)
6. Tag all resources with `Project=DeliverPro`, `Component=Auth`

### 7.3 Dependencies

**Imports:**
```typescript
import * as cdk from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import { Construct } from 'constructs';
```

**No runtime dependencies** — pure CDK/AWS SDK.

---

## 8. Removal Policies & Stack Protection

### 8.1 Removal Policy

User Pool removal policy: **`RETAIN`**

**Rationale:** Auth data (users, groups, credentials) must not be destroyed when the stack is deleted. This prevents accidental data loss during stack updates or decommissioning.

```typescript
new cognito.UserPool(this, 'UserPool', {
  // ...
  removalPolicy: cdk.RemovalPolicy.RETAIN,
});
```

### 8.2 Stack Termination Protection

The **StatefulStack** containing auth infrastructure MUST have termination protection enabled in production:

```typescript
new cdk.Stack(app, 'StatefulStack', {
  terminationProtection: config.environment === 'prod',
});
```

---

## 9. CDK Nag Compliance

### 9.1 Expected CDK Nag Rules

Run `cdk synth` and verify no violations on:

- **AwsSolutions-IAM4** — No AWS managed policies (constructs use none)
- **AwsSolutions-IAM5** — No wildcard actions (not applicable to Cognito)
- **AwsSolutions-COGNITO1** — User pool password policy enforced ✅

### 9.2 Suppressions (if needed)

If CDK Nag flags a rule, document it:

```typescript
cdk.Aspects.of(this.userPool).add(new cdk.Suppression({
  id: 'AwsSolutions-COGNITO1',
  reason: 'Password policy configured in constructor',
}));
```

---

## 10. Testing Strategy

### 10.1 Unit Tests

**File:** `infra/__tests__/cognito-auth.test.ts`

**Test Scenarios:**

1. **Construct instantiation**
   - Verifies UserPool, Client, Domain resources created
   - Checks pool ID and client ID are exportable

2. **User Pool configuration**
   - Password policy: min 8 chars, uppercase, lowercase, digit, symbol ✓
   - MFA: Optional with TOTP ✓
   - Email alias enabled ✓
   - Auto-verify email ✓

3. **Groups created**
   - 5 groups exist: admin, leadership, pm, sa, engineer
   - Each group has correct description
   - No duplicate groups

4. **App Client configuration**
   - No client secret generated
   - PKCE enabled (AuthFlows.USER_SRP_AUTH)
   - OAuth Authorization Code flow enabled
   - Scopes: openid, email, profile
   - Token validity: 1h access, 1h ID, 30d refresh

5. **Cognito Domain**
   - Domain prefix: `deliverpro-auth`
   - Region: `us-east-1`

### 10.2 Snapshot Test

```typescript
test('matches snapshot', () => {
  const app = new cdk.App();
  const stack = new cdk.Stack(app, 'TestStack');
  new CognitoAuthInfra(stack, 'Auth', {
    environment: 'dev',
    callbackUrls: ['http://localhost:5173/callback'],
    logoutUrls: ['http://localhost:5173/login'],
  });
  
  const template = Template.fromStack(stack);
  expect(template.toJSON()).toMatchSnapshot();
});
```

### 10.3 Manual Validation (Post-Deployment)

After `cdk deploy`:

1. **Cognito Console** → Verify pool name, groups, client exist
2. **Hosted UI** → Navigate to `https://deliverpro-auth.auth.us-east-1.amazoncognito.com/oauth2/authorize?client_id=...&response_type=code&redirect_uri=...` → Verify login page loads
3. **SSM Parameters** → Verify 4 parameters created and values are correct
4. **IAM Roles** → Verify no unexpected permissions granted

---

## 11. Deployment Checklist

- [ ] Code review passed (syntax, CDK best practices, security)
- [ ] Unit tests passing (>90% coverage)
- [ ] CDK snapshot test passing
- [ ] `cdk synth` succeeds with no CDK Nag violations
- [ ] SSM parameters correctly named and exported
- [ ] Removal policy set to RETAIN
- [ ] Tags applied: `Project=DeliverPro`, `Component=Auth`
- [ ] Post-deployment manual validation completed
- [ ] Documentation updated: SSM parameter list, Cognito domain URL, group definitions

---

## 12. Edge Cases & Error Handling

| Scenario | Handling | Status |
|----------|----------|--------|
| User pool already exists (re-deployment) | CDK detects logical ID conflict; stack update updates the pool | Handled by CDK |
| Group already exists | CfnUserPoolGroup creation idempotent — succeeds if group exists | Handled by Cognito |
| Invalid callback URL in SPA client | Cognito rejects OAuth callback; user gets redirect mismatch error | User must update config |
| MFA disabled but user enrolled in TOTP | Cognito forces MFA challenge; user must complete TOTP | Handled by Cognito |
| Region mismatch (SPA in us-west-2, pool in us-east-1) | CORS errors; auth fails | Must match regions (SPA + pool both us-east-1) |

---

## 13. Dependencies & Integration Points

### 13.1 Upstream Dependencies

- **DP-03**: CloudFront distribution (provides callback/logout URLs) — **must deploy before DP-04 if prod URLs needed**
- Dev environment: hardcoded localhost URLs

### 13.2 Downstream Dependencies

- **API Gateway**: Requires pool ID + client ID for Cognito authorizer (DP-05)
- **Frontend SPA**: Requires pool ID, client ID, domain URL from SSM (DP-06)
- **Lambda middleware**: Requires `cognito:groups` claim extraction (shared/middleware/auth.ts)

---

## 14. Definition of Done

- [ ] TypeScript compiles with no errors (strict mode)
- [ ] All Cognito resources created via CDK constructs (no manual console actions)
- [ ] 5 groups created and verified in Cognito console
- [ ] App client configured with PKCE, no secret, correct URLs
- [ ] SSM parameters exported (pool ID, client ID, domain URL, region)
- [ ] Unit tests passing (≥90% coverage)
- [ ] CDK snapshot test capturing all resources
- [ ] Code formatted with Prettier, passes ESLint
- [ ] `cdk synth` succeeds with zero CDK Nag violations
- [ ] Post-deployment validation completed (console + Hosted UI + SSM)
- [ ] Documentation: SSM parameter paths, Cognito domain, group definitions
- [ ] Ready for DP-05 (API Gateway Cognito authorizer) and DP-06 (Frontend integration)

---

*End of DP-04 Implementation Spec*
