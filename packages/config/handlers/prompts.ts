/**
 * DP-33: Analysis Prompt Handlers
 * GET /api/admin/prompts — list all prompts (all roles read)
 * PATCH /api/admin/prompts/{checkpointName} — update prompt (leadership/admin only)
 */
import { APIGatewayProxyHandler } from 'aws-lambda';
import { requireRole } from '@kiro-governance/shared/middleware/auth';
import { ok, handleError } from '@kiro-governance/shared/middleware/error-handler';
import { UpdatePromptSchema } from '../validation';
import { listPrompts, updatePrompt } from '../services/config.service';

/**
 * GET /api/admin/prompts
 * List all analysis prompts
 * Auth: all roles can read
 * Source: docs/phase2/config-architecture.md §6.5
 */
export const listPromptsHandler: APIGatewayProxyHandler = async (event) => {
  try {
    // All roles can read prompts
    const auth = requireRole(['pm', 'sa', 'engineer', 'leadership', 'admin'], event);

    const prompts = await listPrompts();

    return ok({ prompts });
  } catch (err) {
    return handleError(err);
  }
};

/**
 * PATCH /api/admin/prompts/{checkpointName}
 * Update or create an analysis prompt
 * Uses INSERT ON CONFLICT DO UPDATE (upsert)
 * Auth: leadership/admin only
 * Source: docs/phase2/config-architecture.md §6.6
 */
export const updatePromptHandler: APIGatewayProxyHandler = async (event) => {
  try {
    const auth = requireRole(['leadership', 'admin'], event);

    const checkpointName = decodeURIComponent(event.pathParameters?.checkpointName || '');
    if (!checkpointName) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Checkpoint name is required' }) };
    }

    const input = JSON.parse(event.body || '{}');

    // Validate input
    UpdatePromptSchema.parse(input);

    const prompt = await updatePrompt(checkpointName, input, auth.email || auth.sub);

    return ok({ prompt });
  } catch (err) {
    return handleError(err);
  }
};
