# Implementation Spec — DP-03: Shared Middleware

**Story:** DP-03 — Shared Middleware

**Sprint:** Phase 2, Sprint 01 (Backend Infrastructure)

**Effort:** 3 story points

**Type:** Backend Infrastructure — middleware stack + auth context + error handling + database pooling

---

## Overview

Build the foundational middleware layer shared by all Phase 2 DeliverPro domains. This includes JWT validation via Cognito JWKS, role-based access control (RBAC), structured error handling, JSON logging, and PostgreSQL connection pooling with IAM authentication.

**Reference:** Auth Domain Architecture (docs/phase2/auth-architecture.md §2–4)

---

## Architecture Reference

**Auth Architecture (docs/phase2/auth-architecture.md):**
- §2: JWT Claims Shape — `sub`, `email`, `cognito:groups` extraction
- §3: API Gateway Cognito Authorizer — ID token validation, claim injection into `event.requestContext.authorizer.claims`
- §4: Shared Middleware Pattern — `extractAuthContext()`, role resolution with priority fallback
- §5: Role-Based Access Control Matrix — permission mapping per role

**Code Structure (docs/code-structure.md):**
- Domain-scoped Lambda handlers with co-located infrastructure
- One-line JSDoc on handlers referencing OpenAPI specs
- TypeScript strict mode, no `any`
- Shared types imported from `packages/shared/types/`

**Backend Standards (§4–6, §12):**
- Lambda handler pattern: `withMiddleware()` wrapper + `withTenantContext()` for RLS
- Powertools Logger + Tracer initialization outside handler for reuse
- Structured JSON logging with `method`, `path`, `userId`, `duration`
- Database: Aurora Serverless v2 (PostgreSQL), connection pooling, RLS via tenant context

---

## Deliverables

### 1. `packages/shared/middleware/auth.ts`

JWT validation, AuthContext extraction, and role resolution.

**Exports:**
- `Role` type: `'admin' | 'leadership' | 'pm' | 'sa' | 'engineer'`
- `AuthContext` interface
- `extractAuthContext(event: APIGatewayProxyEvent): AuthContext` — extracts + validates
- `requireRole(allowed: Role[]): (event: APIGatewayProxyEvent) => AuthContext` — permission check wrapper

**Implementation rules:**
- Extract `event.requestContext.authorizer?.claims` from API Gateway (Cognito authorizer injected)
- Parse `cognito:groups` claim (may be string or array; handle both)
- Role priority: `['admin', 'leadership', 'pm', 'sa', 'engineer']` — first match wins
- If no groups, default role = `'engineer'` (read-only)
- If missing claims → throw `AppError` with 401 status
- If role not in allowed list → throw `AppError` with 403 status

**TypeScript signature:**

```typescript
export type Role = 'admin' | 'leadership' | 'pm' | 'sa' | 'engineer';

export interface AuthContext {
  userId: string;
  email: string;
  role: Role;
  groups: string[];
}

export function extractAuthContext(event: APIGatewayProxyEvent): AuthContext;
export function requireRole(allowed: Role[]): (event: APIGatewayProxyEvent) => AuthContext;
```

---

### 2. `packages/shared/middleware/rbac.ts`

Higher-level role-based access control wrapper for Lambda handlers.

**Exports:**
- `withRoles(allowed: Role[]): (handler: APIGatewayProxyHandler) => APIGatewayProxyHandler` — decorator

**Implementation rules:**
- Wraps `extractAuthContext()` check
- On permission denied, short-circuits handler and returns 403 error
- On success, passes auth context to handler via AWS Lambda context object (NOT as parameter — use `event.requestContext`)
- Middleware should NOT modify event — only validate

**TypeScript signature:**

```typescript
export function withRoles(allowed: Role[]) {
  return (handler: APIGatewayProxyHandler): APIGatewayProxyHandler => {
    return async (event, context) => {
      const auth = extractAuthContext(event);
      if (!allowed.includes(auth.role)) {
        return {
          statusCode: 403,
          body: JSON.stringify({
            code: 'FORBIDDEN',
            message: 'Insufficient permissions',
          }),
        };
      }
      return handler(event, context);
    };
  };
}
```

---

### 3. `packages/shared/middleware/error-handler.ts`

Centralized error response formatting and AppError class hierarchy.

**Exports:**
- `AppError` class — base error with `code`, `message`, `statusCode`, `details`
- `NotFoundError` class — extends AppError, 404
- `ValidationError` class — extends AppError, 400
- `UnauthorizedError` class — extends AppError, 401
- `ForbiddenError` class — extends AppError, 403
- `ConflictError` class — extends AppError, 409
- `formatErrorResponse(error: unknown): { statusCode: number; body: string }` — converts error to HTTP response

**Implementation rules:**

```typescript
export class AppError extends Error {
  constructor(
    readonly code: string,
    readonly message: string,
    readonly statusCode: number,
    readonly details?: unknown,
  ) {
    super(message);
    Object.setPrototypeOf(this, AppError.prototype);
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string, id: string) {
    super('NOT_FOUND', `${resource} with id ${id} not found`, 404);
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: unknown) {
    super('VALIDATION_ERROR', message, 400, details);
  }
}

export class UnauthorizedError extends AppError {
  constructor() {
    super('UNAUTHORIZED', 'Missing or invalid authorization', 401);
  }
}

export class ForbiddenError extends AppError {
  constructor() {
    super('FORBIDDEN', 'Insufficient permissions', 403);
  }
}

export class ConflictError extends AppError {
  constructor(message: string) {
    super('CONFLICT', message, 409);
  }
}

export function formatErrorResponse(error: unknown): { statusCode: number; body: string } {
  if (error instanceof AppError) {
    return {
      statusCode: error.statusCode,
      body: JSON.stringify({
        code: error.code,
        message: error.message,
        ...(error.details && { details: error.details }),
      }),
    };
  }
  if (error instanceof Error) {
    return {
      statusCode: 500,
      body: JSON.stringify({
        code: 'INTERNAL_ERROR',
        message: 'Internal server error',
      }),
    };
  }
  return {
    statusCode: 500,
    body: JSON.stringify({
      code: 'INTERNAL_ERROR',
      message: 'Unknown error',
    }),
  };
}
```

**Error response JSON shape:**

```json
{
  "code": "NOT_FOUND",
  "message": "Project with id 123 not found",
  "details": {}
}
```

---

### 4. `packages/shared/middleware/logger.ts`

Structured JSON logging using AWS Lambda Powertools Logger.

**Exports:**
- `createLogger(serviceName: string): Logger` — initialize Powertools logger
- `logRequest(logger: Logger, event: APIGatewayProxyEvent, auth?: AuthContext): void`
- `logResponse(logger: Logger, statusCode: number, duration: number): void`
- `logError(logger: Logger, error: Error): void`

**Implementation rules:**
- Use `@aws-lambda-powertools/logger`
- Initialize logger **outside** handler for reuse across warm invocations
- Log format: JSON with `method`, `path`, `userId` (from auth), `statusCode`, `duration` (milliseconds)
- Never log PII fields (`email`, phone, names) in production logs
- Error logs include stack trace and error code

**TypeScript signature:**

```typescript
import { Logger } from '@aws-lambda-powertools/logger';
import { APIGatewayProxyEvent } from 'aws-lambda';
import { AuthContext } from './auth';

export function createLogger(serviceName: string): Logger {
  return new Logger({
    serviceName,
    logLevel: process.env.LOG_LEVEL ?? 'INFO',
  });
}

export function logRequest(
  logger: Logger,
  event: APIGatewayProxyEvent,
  auth?: AuthContext,
): void;

export function logResponse(
  logger: Logger,
  statusCode: number,
  duration: number,
): void;

export function logError(logger: Logger, error: Error): void;
```

**Example log output:**

```json
{
  "level": "INFO",
  "timestamp": "2026-06-30T21:12:03.853Z",
  "service": "projects-service",
  "message": "POST /api/projects",
  "method": "POST",
  "path": "/api/projects",
  "userId": "a1b2c3d4-...",
  "duration": 127
}
```

---

### 5. `packages/shared/types/auth.ts`

TypeScript interfaces for authentication and authorization contexts.

**Exports:**
- `Role` type
- `AuthContext` interface
- `Claim` interface (if needed for JWT parsing)

**Implementation rules:**
- Must match auth-architecture.md §2.1 and §4.1
- No runtime validation here (use Zod at handler boundaries)
- Straightforward type definitions, no complex logic

**TypeScript:**

```typescript
export type Role = 'admin' | 'leadership' | 'pm' | 'sa' | 'engineer';

export interface AuthContext {
  userId: string;       // Cognito sub claim
  email: string;        // Cognito email claim
  role: Role;           // Primary role (first matching in priority order)
  groups: string[];     // All cognito:groups
}

export interface CognitoClaims {
  sub: string;
  email: string;
  'cognito:groups'?: string | string[];
  name?: string;
  aud?: string;
  iss?: string;
  exp?: number;
  iat?: number;
}
```

---

### 6. `packages/shared/db/pool.ts`

PostgreSQL connection pooling with RDS IAM authentication and tenant context.

**Exports:**
- `Pool` class — singleton instance
- `getPool(): Pool` — getter
- `withTenantContext(tenantId: string, fn: () => Promise<T>): Promise<T>` — context wrapper for RLS
- `query(sql: string, params: unknown[]): Promise<QueryResult<any>>` — execute parameterized query
- Configuration interface for pool setup

**Implementation rules:**
- Use `pg` library (node-postgres)
- Support RDS IAM authentication via `aws-sdk-rds-signer` (temporary credentials)
- Connection pool: min=2, max=10 for Lambda environment
- Execute queries with parameterized statements (no string interpolation)
- `withTenantContext()` sets `_tenant_id` session variable (used by PostgreSQL RLS policies)
- Thread-local/async-local storage: use `AsyncLocalStorage<string>` to track tenant per request

**TypeScript signature:**

```typescript
import { Pool as PgPool, QueryResult } from 'pg';
import { AsyncLocalStorage } from 'async_hooks';

const tenantContext = new AsyncLocalStorage<string>();

export async function withTenantContext<T>(
  tenantId: string,
  fn: () => Promise<T>,
): Promise<T> {
  return tenantContext.run(tenantId, fn);
}

export async function query<T = any>(
  sql: string,
  params: unknown[] = [],
): Promise<QueryResult<T>> {
  const pool = getPool();
  const tenantId = tenantContext.getStore();
  
  const client = await pool.connect();
  try {
    if (tenantId) {
      await client.query('SET _tenant_id = $1', [tenantId]);
    }
    return await client.query(sql, params);
  } finally {
    client.release();
  }
}

export function getPool(): PgPool;
```

**Pool configuration:**

```typescript
const pool = new PgPool({
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,  // from Secrets Manager or IAM auth token
  host: process.env.DB_HOST,
  port: 5432,
  database: process.env.DB_NAME,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});
```

**RDS IAM Authentication (optional pattern):**

If using IAM auth instead of secrets:

```typescript
import { Signer } from 'aws-sdk-rds-signer';

const signer = new Signer({
  region: process.env.AWS_REGION,
  hostname: process.env.DB_HOST,
  port: 5432,
  username: process.env.DB_USER,
});

const token = signer.getAuthToken({ username: process.env.DB_USER });
const pool = new PgPool({
  host: process.env.DB_HOST,
  port: 5432,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: token,
  ssl: 'require',
  max: 10,
});
```

---

### 7. `packages/shared/index.ts`

Central export file for all shared middleware, types, and utilities.

**Exports:**

```typescript
// Auth types
export type { Role, AuthContext } from './types/auth';
export { extractAuthContext, requireRole } from './middleware/auth';

// RBAC
export { withRoles } from './middleware/rbac';

// Error handling
export {
  AppError,
  NotFoundError,
  ValidationError,
  UnauthorizedError,
  ForbiddenError,
  ConflictError,
  formatErrorResponse,
} from './middleware/error-handler';

// Logging
export { createLogger, logRequest, logResponse, logError } from './middleware/logger';

// Database
export { getPool, withTenantContext, query } from './db/pool';
export type { Pool } from 'pg';

// Phase 1 re-exports (maintain backward compatibility)
export { GovernanceEventRecord } from './types/governance-event';
export { MACRO_GATES, MACRO_GATE_ALIASES, GATE_PHASES, GATE_PHASE_NAMES, classifyEvent } from './constants/macro-gates';
export type { MacroGate } from './constants/macro-gates';
```

---

## Handler Integration Pattern

All Phase 2 Lambda handlers will follow this pattern:

```typescript
import { APIGatewayProxyHandler } from 'aws-lambda';
import { requireRole } from '@deliverpro/shared/middleware/auth';
import { formatErrorResponse } from '@deliverpro/shared/middleware/error-handler';
import { createLogger, logRequest, logResponse, logError } from '@deliverpro/shared/middleware/logger';
import { withTenantContext, query } from '@deliverpro/shared/db/pool';

const logger = createLogger('projects-service');

/**
 * Get project by ID.
 * See specs/api/projects.yaml for API documentation.
 */
export const handler: APIGatewayProxyHandler = async (event, context) => {
  const startTime = Date.now();
  
  try {
    const auth = requireRole(['pm', 'sa', 'leadership', 'admin'])(event);
    logRequest(logger, event, auth);

    const projectId = event.pathParameters?.id;
    const result = await withTenantContext(auth.userId, async () => {
      const res = await query('SELECT * FROM projects WHERE id = $1', [projectId]);
      return res.rows[0];
    });

    if (!result) {
      return formatErrorResponse(new NotFoundError('Project', projectId));
    }

    const duration = Date.now() - startTime;
    logResponse(logger, 200, duration);

    return {
      statusCode: 200,
      body: JSON.stringify(result),
    };
  } catch (error) {
    logError(logger, error as Error);
    return formatErrorResponse(error);
  }
};
```

---

## TypeScript Configuration

All shared middleware must compile with TypeScript strict mode:

```json
{
  "compilerOptions": {
    "strict": true,
    "noImplicitAny": true,
    "strictNullChecks": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noImplicitReturns": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true
  }
}
```

---

## Testing Strategy

### Unit Tests: `packages/shared/__tests__/`

**Test file:** `middleware/auth.test.ts`
- ✅ `extractAuthContext()` with valid claims
- ✅ `extractAuthContext()` with missing claims → 401
- ✅ Role resolution: admin in groups → admin role
- ✅ Role resolution: pm + engineer in groups → pm role (priority)
- ✅ Role resolution: no groups → engineer (default)
- ✅ `requireRole()` with allowed role → passes
- ✅ `requireRole()` with disallowed role → 403

**Test file:** `middleware/error-handler.test.ts`
- ✅ `AppError` with code/message/status
- ✅ `NotFoundError` format
- ✅ `ValidationError` with details
- ✅ `formatErrorResponse()` with AppError → correct JSON shape
- ✅ `formatErrorResponse()` with generic Error → 500

**Test file:** `middleware/logger.test.ts`
- ✅ `createLogger()` initializes with serviceName
- ✅ `logRequest()` outputs method/path/userId
- ✅ `logResponse()` outputs duration in ms
- ✅ `logError()` captures error code and stack

**Test file:** `db/pool.test.ts`
- ✅ `getPool()` returns singleton instance
- ✅ `withTenantContext()` runs async function in context
- ✅ `query()` executes parameterized SQL
- ✅ `query()` sets tenant context before executing
- ✅ Pool connection cleanup on error

### Integration Tests

**E2E handler flow** (full stack):
1. Mock API Gateway event with Cognito claims
2. Call handler with requireRole check
3. Verify auth extraction
4. Verify error response format on permission denied
5. Verify logging output

---

## Acceptance Criteria

- [ ] `packages/shared/middleware/auth.ts` — JWT extraction + role resolution with priority fallback
- [ ] `packages/shared/middleware/rbac.ts` — role-based decorator wrapper
- [ ] `packages/shared/middleware/error-handler.ts` — AppError classes + response formatter
- [ ] `packages/shared/middleware/logger.ts` — Powertools Logger + structured JSON output
- [ ] `packages/shared/types/auth.ts` — Role type + AuthContext interface
- [ ] `packages/shared/db/pool.ts` — PostgreSQL connection pooling + tenant context
- [ ] `packages/shared/index.ts` — all exports defined, no unused re-exports
- [ ] TypeScript strict mode: zero errors on `npm run type-check`
- [ ] Unit tests passing: >85% coverage on all middleware modules
- [ ] Integration tests: handler with full middleware stack passes
- [ ] Formatted with Prettier, passes ESLint
- [ ] Documentation: JSDoc on all exported functions
- [ ] No `any` types — all parameters and returns explicitly typed
- [ ] No hardcoded secrets or environment values
- [ ] Ready for domain handlers (projects, analysis, reporting, gates) to import and use

---

## Definition of Done

- [ ] All middleware modules implemented per spec
- [ ] Shared types exported from root `index.ts`
- [ ] Unit tests passing (>85% coverage)
- [ ] Integration tests passing (handler + middleware)
- [ ] TypeScript strict mode passing
- [ ] Code formatted with Prettier
- [ ] ESLint passing
- [ ] No console.log statements (use Logger)
- [ ] Error handling tested for happy path + failures
- [ ] Tenant context isolation tested
- [ ] Ready for DP-04 (Projects Domain) to consume

---

## Implementation Notes

1. **Cognito Claims Extraction:** API Gateway injects claims into `event.requestContext.authorizer?.claims`. If missing, throw 401. See auth-architecture.md §3.

2. **Role Priority:** Cognito groups can include multiple roles. Use priority order to select primary role: `['admin', 'leadership', 'pm', 'sa', 'engineer']`. This ensures PMs with an `admin` group still see PM-specific UI.

3. **Tenant Context:** Used for PostgreSQL RLS. Set via `SET _tenant_id` in the session before executing queries. Use `AsyncLocalStorage` to track per-request context.

4. **Error Responses:** All errors must return machine-readable `code` + human-readable `message`. Never expose stack traces to clients.

5. **Logging:** Use Powertools Logger outside handler for reuse. Log request entry + response exit with duration. Never log PII (email, phone, names).

6. **Pool Initialization:** Create pool **once** at module load (not per-request). Reuse across warm invocations.

---

*End of Spec v1.0*
