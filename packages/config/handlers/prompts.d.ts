/**
 * DP-33: Analysis Prompt Handlers
 * GET /api/admin/prompts — list all prompts (all roles read)
 * PATCH /api/admin/prompts/{checkpointName} — update prompt (leadership/admin only)
 */
import { APIGatewayProxyHandler } from 'aws-lambda';
/**
 * GET /api/admin/prompts
 * List all analysis prompts
 * Auth: all roles can read
 * Source: docs/phase2/config-architecture.md §6.5
 */
export declare const listPromptsHandler: APIGatewayProxyHandler;
/**
 * PATCH /api/admin/prompts/{checkpointName}
 * Update or create an analysis prompt
 * Uses INSERT ON CONFLICT DO UPDATE (upsert)
 * Auth: leadership/admin only
 * Source: docs/phase2/config-architecture.md §6.6
 */
export declare const updatePromptHandler: APIGatewayProxyHandler;
