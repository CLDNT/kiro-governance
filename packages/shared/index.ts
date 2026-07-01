// Governance types and constants
export { GovernanceEventRecord } from './types/governance-event';
export { MACRO_GATES, MACRO_GATE_ALIASES, GATE_PHASES, GATE_PHASE_NAMES, classifyEvent } from './constants/macro-gates';
export type { MacroGate } from './constants/macro-gates';

// Auth types and middleware
export type { AuthContext } from './types/auth';
export { extractAuthContext, extractAuthContextFromEvent } from './middleware/auth';

// Error handling middleware
export {
  AppError,
  NotFoundError,
  ValidationError,
  ForbiddenError,
  ConflictError,
  handleError,
} from './middleware/error-handler';

// RBAC middleware
export { withRoles, withAdminOnly, withLeadership } from './middleware/rbac';

// Logger middleware
export { withLogging, log } from './middleware/logger';
export type { LogEntry } from './middleware/logger';

// Database pool
export { getPool, closePool, query, queryOne, queryMany } from './db/pool';
