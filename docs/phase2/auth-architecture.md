# Auth Domain Architecture — Phase 2: DeliverPro

## Changelog

| Date | Version | Author | Change |
|------|---------|--------|--------|
| 2026-06-30 | v1.1 | AWS Architect | Resolved OQ-P2-010: default CloudFront domain confirmed (no custom domain). Resolved ID-6: adminCreateUserOnly confirmed (email invite provisioning). Updated §1 and §6. |
| 2026-06-29 | v1.0 | AWS Architect | Initial auth architecture from SRS v1.3 (FR-P2-010, FR-P2-018), domain decomposition v1.0 §2.5 |

---

## 1. Cognito User Pool Design

| Property | Value | Source |
|----------|-------|--------|
| Pool name | `deliverpro-user-pool` | `Architect decision — not customer-specified` |
| Region | `us-east-1` | Confirmed: ceanalytics account 504649076991, SRS §4.3 A1 |
| Password policy | Min 8 chars, require uppercase + lowercase + number + symbol | `Architect decision — not customer-specified` (Cognito defaults) |
| MFA | Optional (TOTP only, not enforced for MVP) | `Architect decision — not customer-specified` |
| Self-registration | Disabled — admin creates users (`adminCreateUserOnly: true`) | Phase 2 Transcript: internal team tool, no self-signup. Confirmed ID-6: admin invites via Cognito console or admin API. |
| User provisioning | Admin creates user → Cognito sends temporary password email → User sets permanent password on first login | Confirmed ID-6 (2026-06-30). No SSO federation. |
| Email verification | Required (Cognito sends verification email) | `Architect decision — not customer-specified` |
| Username | Email (case-insensitive) | `Architect decision — not customer-specified` |

### 1.1 User Attributes

| Attribute | Type | Required | Notes |
|-----------|------|----------|-------|
| `email` | Standard | Yes | Login identifier |
| `name` | Standard | Yes | Display name |
| `custom:role` | Custom (mutable) | No | Informational only — actual role derived from Cognito Groups at runtime |

### 1.2 User Pool Groups

| Group | Description | Typical Members |
|-------|-------------|-----------------|
| `admin` | Full system configuration + user management | System administrators |
| `leadership` | Cross-project visibility + admin panel access | Chris Xenos, Kasim |
| `pm` | Project management — own projects + evidence + status logs | Delivery PMs |
| `sa` | Technical review — mark human_review checkpoints | Solutions Architects |
| `engineer` | Read-only project visibility | Assigned developers |

> Source: SRS §9 Role Definitions + Phase 2 Transcript — "if I'm the project manager and I wanna see where my project is"

### 1.3 App Client

| Property | Value | Rationale |
|----------|-------|-----------|
| Client name | `deliverpro-spa-client` | `Architect decision` |
| Generate client secret | No | SPA cannot securely store a client secret |
| OAuth flows | Authorization Code (PKCE) | `Architect decision` — implicit flow deprecated; PKCE is the standard for SPAs |
| Callback URL(s) | `https://{distribution.domainName}/callback`, `http://localhost:5173/callback` (dev) | FR-P2-018: CloudFront deployment (default domain — OQ-P2-010 resolved) |
| Logout URL(s) | `https://{distribution.domainName}/login`, `http://localhost:5173/login` (dev) | `Architect decision` |
| Token validity | Access: 1 hour, ID: 1 hour, Refresh: 30 days | `Architect decision — not customer-specified` |
| Scopes | `openid`, `email`, `profile` | `Architect decision` |

### 1.4 Domain / Hosted UI

| Property | Value | Source |
|----------|-------|--------|
| Domain prefix | `deliverpro-auth` (→ `deliverpro-auth.auth.us-east-1.amazoncognito.com`) | `Architect decision — not customer-specified` |
| Custom UI | MVP uses Cognito Hosted UI; custom login page deferred | `Architect decision` — reduces build scope |

> Custom login page deferred — reduces build scope for MVP. Cognito Hosted UI used.

---

## 2. JWT Claims Shape

The Cognito ID token contains these claims relevant to the application:

```json
{
  "sub": "a1b2c3d4-...",
  "email": "pm@cloudelligent.com",
  "name": "Jane Doe",
  "cognito:groups": ["pm"],
  "iss": "https://cognito-idp.us-east-1.amazonaws.com/us-east-1_XXXXXX",
  "aud": "app-client-id",
  "token_use": "id",
  "exp": 1719700000,
  "iat": 1719696400
}
```

| Claim | Maps To | Usage |
|-------|---------|-------|
| `sub` | `AuthContext.userId` | Unique user identifier across the system |
| `email` | `AuthContext.email` | Display + audit logging |
| `cognito:groups` | `AuthContext.groups` | Full group membership array |
| `cognito:groups[0]` | `AuthContext.role` | Primary role (first group in the array) |

### 2.1 Token Expiry & Refresh Strategy

| Token | Lifetime | Refresh |
|-------|----------|---------|
| Access token | 1 hour | Frontend uses refresh token silently via Cognito SDK |
| ID token | 1 hour | Same refresh cycle as access token |
| Refresh token | 30 days | Forces re-login after 30 days of inactivity |

The **frontend** (React SPA) handles token refresh using the Amplify Auth library or `amazon-cognito-identity-js`. The backend never refreshes tokens — it only validates them.

---

## 3. API Gateway Cognito Authorizer

| Property | Value | Source |
|----------|-------|--------|
| Authorizer type | `COGNITO_USER_POOLS` | `Architect decision` |
| Token source | `Authorization` header (`Bearer <token>`) | `Architect decision` — standard pattern |
| Token type | ID token (contains `cognito:groups` claim) | `Architect decision` — groups not in access token |
| Cache TTL | 300 seconds (5 minutes) | `Architect decision — not customer-specified` |
| Public routes | None — all API routes require valid JWT | SRS §6 NFR-P2-003 |

### 3.1 Authorization Flow

```
Browser → CloudFront (SPA) → User logs in via Cognito Hosted UI
                           → Receives ID token + Access token + Refresh token
                           → Stores tokens in memory (not localStorage)

Browser → API Gateway → Cognito Authorizer validates ID token
                     → Claims injected into Lambda event.requestContext.authorizer.claims
                     → Lambda middleware extracts AuthContext
                     → Handler executes with role context
```

---

## 4. Shared Middleware (`packages/shared/middleware/auth.ts`)

### 4.1 AuthContext Interface

```typescript
export type Role = 'pm' | 'sa' | 'engineer' | 'leadership' | 'admin';

export interface AuthContext {
  userId: string;       // Cognito sub
  email: string;
  role: Role;           // Primary role (first group)
  groups: string[];     // All Cognito groups
}
```

### 4.2 Middleware Implementation

```typescript
import { APIGatewayProxyEvent } from 'aws-lambda';

const ROLE_PRIORITY: Role[] = ['admin', 'leadership', 'pm', 'sa', 'engineer'];

export function extractAuthContext(event: APIGatewayProxyEvent): AuthContext {
  const claims = event.requestContext.authorizer?.claims;
  if (!claims) {
    throw new AppError('UNAUTHORIZED', 'Missing authorization claims', 401);
  }

  const groups: string[] = claims['cognito:groups']
    ? (typeof claims['cognito:groups'] === 'string'
        ? claims['cognito:groups'].split(',')
        : claims['cognito:groups'])
    : [];

  // Resolve primary role: highest-priority group, or default to 'engineer'
  const role = ROLE_PRIORITY.find((r) => groups.includes(r)) ?? 'engineer';

  return {
    userId: claims.sub,
    email: claims.email,
    role,
    groups,
  };
}

export function requireRole(allowed: Role[]) {
  return (event: APIGatewayProxyEvent): AuthContext => {
    const ctx = extractAuthContext(event);
    if (!allowed.includes(ctx.role)) {
      throw new AppError('FORBIDDEN', 'Insufficient permissions', 403);
    }
    return ctx;
  };
}
```

### 4.3 Handler Usage Pattern

```typescript
import { APIGatewayProxyHandler } from 'aws-lambda';
import { requireRole } from '@deliverpro/shared/middleware/auth';

export const handler: APIGatewayProxyHandler = async (event) => {
  const auth = requireRole(['pm', 'sa', 'leadership', 'admin'])(event);
  // auth.userId, auth.role, auth.email available
  const result = await someService(auth.userId);
  return { statusCode: 200, body: JSON.stringify(result) };
};
```

---

## 5. Role-Based Access Control Rules

Source: SRS §9 + FR-P2-010

| Action | admin | leadership | pm | sa | engineer |
|--------|:-----:|:----------:|:--:|:--:|:--------:|
| View all projects | ✅ | ✅ | ✅ (browse) | ✅ (assigned) | ✅ (read-only) |
| Create project | ✅ | ✅ | ✅ | ❌ | ❌ |
| Mark meeting checkpoint | ✅ | ✅ | ✅ (own projects) | ❌ | ❌ |
| Mark human_review checkpoint | ✅ | ✅ | ❌ | ✅ (assigned) | ❌ |
| Upload evidence | ✅ | ✅ | ✅ | ✅ | ❌ |
| Add checkpoint notes | ✅ | ✅ | ✅ | ✅ | ❌ |
| Log status call | ✅ | ✅ | ✅ | ❌ | ❌ |
| Log/resolve escalation | ✅ | ✅ | ✅ | ❌ | ❌ |
| Update hours consumed | ✅ | ✅ | ✅ | ❌ | ❌ |
| Close project | ✅ | ✅ | ✅ | ❌ | ❌ |
| Reopen closed project | ✅ | ✅ | ❌ | ❌ | ❌ |
| Trigger Jira import | ✅ | ❌ | ❌ | ❌ | ❌ |
| Admin panel (config, prompts) | ✅ | ✅ | ❌ | ❌ | ❌ |
| Manage users/roles | ✅ | ❌ | ❌ | ❌ | ❌ |

> `Architect decision — not customer-specified`: The exact per-action matrix is inferred from SRS §9 descriptions. PM can "browse all" but primarily sees own projects. SA sees assigned projects. Engineer is read-only.

---

## 6. CloudFront + S3 SPA Deployment

Source: FR-P2-018 — Phase 2 Transcript: "they can be embedded into a URL... they don't need to actually own that AWS account"

### 6.1 S3 Bucket

| Property | Value | Source |
|----------|-------|--------|
| Bucket name | `deliverpro-frontend-504649076991` | `Architect decision` — includes account ID for uniqueness |
| Region | `us-east-1` | Same as all Phase 2 resources |
| Block Public Access | All 4 settings enabled | `Architect decision` — security best practice |
| Static website hosting | Disabled | OAC pattern doesn't use website hosting |
| Versioning | Enabled | `Architect decision` — enables rollback |
| Lifecycle | None (build artifacts are small) | `Architect decision` |

### 6.2 CloudFront Distribution

| Property | Value | Source |
|----------|-------|--------|
| Origin | S3 bucket via OAC (Origin Access Control) | `Architect decision` — OAC replaces deprecated OAI |
| Protocol policy | HTTPS only (redirect HTTP → HTTPS) | SRS §6 NFR-P2-003 |
| Default root object | `index.html` | `Architect decision` |
| Custom error pages | 403 → `/index.html` (200), 404 → `/index.html` (200) | `Architect decision` — required for SPA client-side routing |
| Price class | PriceClass_100 (US, Canada, Europe) | `Architect decision` — internal team, no global audience |
| Certificate | Default CloudFront cert (`*.cloudfront.net`) — no custom domain | Confirmed OQ-P2-010 (2026-06-30): use default CloudFront domain |
| WAF | None for MVP (internal tool, behind Cognito auth) | `Architect decision — not customer-specified` |

### 6.3 Cache-Control Strategy

| Asset | Cache-Control Header | Rationale |
|-------|---------------------|-----------|
| `index.html` | `no-cache, no-store, must-revalidate` | Always fetch latest to pick up new deploys |
| `assets/*.js`, `assets/*.css` (hashed) | `public, max-age=31536000, immutable` | Content-addressed — hash changes on new deploy |
| `favicon.ico`, images | `public, max-age=86400` | Rarely changes |

### 6.4 OAC Configuration

CloudFront uses Origin Access Control to access the private S3 bucket. The S3 bucket policy grants read to the CloudFront distribution:

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": { "Service": "cloudfront.amazonaws.com" },
    "Action": "s3:GetObject",
    "Resource": "arn:aws:s3:::deliverpro-frontend-504649076991/*",
    "Condition": {
      "StringEquals": {
        "AWS:SourceArn": "arn:aws:cloudfront::504649076991:distribution/{distribution-id}"
      }
    }
  }]
}
```

---

## 7. CDK Constructs

```typescript
import * as cdk from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import { Construct } from 'constructs';

export class AuthInfra extends Construct {
  public readonly userPool: cognito.UserPool;
  public readonly userPoolClient: cognito.UserPoolClient;
  public readonly distribution: cloudfront.Distribution;

  constructor(scope: Construct, id: string) {
    super(scope, id);

    // Cognito User Pool
    this.userPool = new cognito.UserPool(this, 'DeliverProPool', {
      userPoolName: 'deliverpro-user-pool',
      selfSignUpEnabled: false,
      signInAliases: { email: true },
      autoVerify: { email: true },
      standardAttributes: {
        email: { required: true, mutable: false },
        fullname: { required: true, mutable: true },
      },
      passwordPolicy: {
        minLength: 8,
        requireUppercase: true,
        requireLowercase: true,
        requireDigits: true,
        requireSymbols: true,
      },
      mfa: cognito.Mfa.OPTIONAL,
      mfaSecondFactor: { sms: false, otp: true },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // Cognito Domain (Hosted UI)
    this.userPool.addDomain('CognitoDomain', {
      cognitoDomain: { domainPrefix: 'deliverpro-auth' },
    });

    // User Pool Groups
    const groups = [
      { name: 'admin', description: 'System administrators' },
      { name: 'leadership', description: 'Cross-project visibility + admin panel' },
      { name: 'pm', description: 'Project Managers' },
      { name: 'sa', description: 'Solutions Architects' },
      { name: 'engineer', description: 'Engineers — read-only' },
    ];
    for (const g of groups) {
      new cognito.CfnUserPoolGroup(this, `Group-${g.name}`, {
        userPoolId: this.userPool.userPoolId,
        groupName: g.name,
        description: g.description,
      });
    }

    // App Client (SPA — no secret, PKCE)
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
        callbackUrls: ['https://{distribution.domainName}/callback', 'http://localhost:5173/callback'],
        logoutUrls: ['https://{distribution.domainName}/login', 'http://localhost:5173/login'],
      },
      accessTokenValidity: cdk.Duration.hours(1),
      idTokenValidity: cdk.Duration.hours(1),
      refreshTokenValidity: cdk.Duration.days(30),
    });

    // S3 Bucket for SPA
    const spaBucket = new s3.Bucket(this, 'SpaBucket', {
      bucketName: `deliverpro-frontend-504649076991`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      versioned: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    // CloudFront Distribution with OAC
    this.distribution = new cloudfront.Distribution(this, 'SpaDistribution', {
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(spaBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
      },
      defaultRootObject: 'index.html',
      errorResponses: [
        { httpStatus: 403, responseHttpStatus: 200, responsePagePath: '/index.html' },
        { httpStatus: 404, responseHttpStatus: 200, responsePagePath: '/index.html' },
      ],
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
    });
  }
}
```

---

## 8. Edge Cases

| Scenario | Handling | Source |
|----------|----------|--------|
| Token expired | API Gateway returns 401. Frontend intercepts, attempts silent refresh via refresh token. If refresh fails, redirects to Cognito login. | `Architect decision` |
| User not in any Cognito group | `extractAuthContext()` defaults role to `'engineer'` (read-only). User sees project data but cannot write. | `Architect decision — not customer-specified` |
| User in multiple groups | Role resolved by priority order: `admin > leadership > pm > sa > engineer`. First match wins. | `Architect decision — not customer-specified` |
| New user created but no group assigned | User authenticates successfully but gets `'engineer'` (read-only) until admin assigns a group. | `Architect decision — not customer-specified` |
| Cognito Hosted UI unavailable | Regional outage — no mitigation for MVP (single-region). Users cannot log in. | `Architect decision` |
| Refresh token expired (30 days inactivity) | User must re-authenticate via Cognito login flow. No data loss — all state is server-side. | `Architect decision` |
| Admin removes user from all groups mid-session | Current token remains valid until expiry (up to 1 hour). Next token refresh reflects new group membership. 5-min authorizer cache may delay enforcement. | `Architect decision` |

---

## 9. Cost Estimate

| Component | Monthly Cost | Notes |
|-----------|-------------|-------|
| Cognito User Pool | $0.00 | Free tier: first 50,000 MAUs. DeliverPro has <50 users. |
| CloudFront | ~$1–2 | Internal tool, low traffic. $0.085/GB (first 10 TB) + $0.01/10K requests. |
| S3 (SPA assets) | ~$0.03 | <1 GB storage, minimal requests. |
| ACM certificate | $0.00 | Free for CloudFront-associated certs. |
| **Total auth infrastructure** | **~$2/mo** | |

> All pricing: `Architect decision — not customer-specified`. Cognito free tier verified via AWS pricing page (50,000 MAUs free for User Pools without advanced security).

---

*End of Auth Architecture v1.0*
