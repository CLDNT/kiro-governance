// Governance types and constants
export { GovernanceEventRecord } from './types/governance-event';
export { MACRO_GATES, MACRO_GATE_ALIASES, GATE_PHASES, GATE_PHASE_NAMES, classifyEvent, matchGateFromText } from './constants/macro-gates';
export type { MacroGate } from './constants/macro-gates';
export { GATE_TO_CHECKPOINT, resolveCheckpointForGate } from './constants/gate-checkpoint-map';
export { MICRO_ARTIFACT_EVENT_CODES, EVENT_CODE_PATTERN, isKnownEventCode } from './constants/micro-artifact-events';
export type { MicroArtifactEventCode } from './constants/micro-artifact-events';

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

// MCP client (app → centralized MCP server; app builds no Slack client of its own)
export {
  callMcpTool,
  notifySlack,
  resolveMcpConfigFromEnv,
} from './mcp/mcp-client';
export type {
  McpClientConfig,
  NotifySlackParams,
  NotifySlackResult,
} from './mcp/mcp-client';
