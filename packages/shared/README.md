# Shared Package — Types and Middleware

Shared constants, types, and middleware used across all kiro-governance domains.

## Structure

```
packages/shared/
├── types/
│   ├── auth.ts           # AuthContext interface
│   └── governance-event.ts  # GovernanceEventRecord (from Phase 1)
├── middleware/
│   ├── auth.ts           # extractAuthContext, extractAuthContextFromEvent
│   ├── error-handler.ts  # AppError, NotFoundError, ValidationError, etc.
│   ├── rbac.ts           # withRoles, withAdminOnly, withLeadership
│   └── logger.ts         # withLogging, log, LogEntry
├── db/
│   └── pool.ts           # getPool, closePool, query, queryOne, queryMany
├── constants/
│   └── macro-gates.ts    # MACRO_GATES, classifyEvent (from Phase 1)
└── index.ts              # Central export point
```

## Usage

### Auth Extraction

```typescript
import { extractAuthContextFromEvent, type AuthContext } from '@kiro-governance/shared';

// In API Gateway Lambda handler
const auth = extractAuthContextFromEvent(event); // → AuthContext | null
if (!auth) return { statusCode: 401, body: 'Unauthorized' };

console.log(auth.userId, auth.role, auth.groups);
```

### RBAC Middleware

```typescript
import { withRoles } from '@kiro-governance/shared';

export const handler = withRoles(['admin', 'leadership'], async (event, context) => {
  // context.auth is automatically populated with AuthContext
  // If user role not in allowed list, returns 403 automatically
  
  console.log(context.auth.userId);
  return { statusCode: 200, body: 'OK' };
});
```

### Error Handling

```typescript
import { 
  NotFoundError, 
  ValidationError, 
  ForbiddenError, 
  ConflictError,
  handleError 
} from '@kiro-governance/shared';

try {
  if (!resource) throw new NotFoundError('Project', projectId);
  if (invalid) throw new ValidationError('Invalid input', { field: ['Error message'] });
} catch (error) {
  return handleError(error); // → APIGatewayProxyResult
}
```

### Logging

```typescript
import { withLogging, log } from '@kiro-governance/shared';

// Wrap entire handler
export const handler = withLogging(async (event, context) => {
  log('info', 'Processing request', { projectId: event.pathParameters?.id });
  return { statusCode: 200, body: 'OK' };
});

// Or use log directly
log('warn', 'Unusual activity', { userId: 'xxx', action: 'yyy' });
```

### Database Access

```typescript
import { getPool, query, queryOne, queryMany } from '@kiro-governance/shared';

// Get connection pool with automatic token refresh
const pool = await getPool();

// Simple query execution
const results = await query('SELECT * FROM projects WHERE id = $1', [projectId]);

// Helper methods
const project = await queryOne<Project>('SELECT * FROM projects WHERE id = $1', [projectId]);
const projects = await queryMany<Project>('SELECT * FROM projects LIMIT $1', [10]);

// Manual pool access
const pool = await getPool();
const result = await pool.query('...');
```

## Environment Variables (Database)

Required for `db/pool.ts`:

```
DB_ENDPOINT=<aurora-cluster-endpoint>
DB_PORT=5432
DB_NAME=governance
DB_USER=<iam-user>
AWS_REGION=us-east-1
```

## Dependencies

- `@aws-sdk/rds-signer` — IAM database authentication
- `pg` — PostgreSQL client
- `aws-lambda` — Lambda types

## Exports

All public APIs are exported from `index.ts` and can be imported directly:

```typescript
import { 
  // Types
  type AuthContext,
  type LogEntry,
  
  // Auth middleware
  extractAuthContext,
  extractAuthContextFromEvent,
  
  // RBAC middleware
  withRoles,
  withAdminOnly,
  withLeadership,
  
  // Error handling
  AppError,
  NotFoundError,
  ValidationError,
  ForbiddenError,
  ConflictError,
  handleError,
  
  // Logging
  withLogging,
  log,
  
  // Database
  getPool,
  closePool,
  query,
  queryOne,
  queryMany,
} from '@kiro-governance/shared';
```

## Testing

```bash
npm test -w packages/shared
```

Tests are located in `__tests__/` subdirectories alongside source files.

## Build

```bash
npm run build -w packages/shared
```

Output: `packages/shared/dist/`

---

**Phase 2 Story:** DP-03 Shared Middleware Package
