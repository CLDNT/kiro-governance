/**
 * DP-33: Analysis Prompt Handlers
 * GET /api/admin/prompts — list all prompts (all roles read)
 * PATCH /api/admin/prompts/{checkpointName} — update prompt (leadership/admin only)
 */
import { withRoles } from '@kiro-governance/shared/middleware/rbac';
import { ok, handleError } from '@kiro-governance/shared/middleware/error-handler';
import { UpdatePromptSchema } from '../validation';
import { listPrompts, updatePrompt } from '../services/config.service';

/**
 * GET /api/admin/prompts
 * List all analysis prompts
 * Auth: all roles can read
 * Source: docs/phase2/config-architecture.md §6.5
 */
export const listPromptsHandler = withRoles(['pm', 'sa', 'engineer', 'leadership', 'admin'], async (event, context) => {
  try {
    // All roles can read prompts
    const auth = context.auth;

    const prompts = await listPrompts();

    return ok({ prompts });
  } catch (err) {
    return handleError(err);
  }
});

/**
 * PATCH /api/admin/prompts/{checkpointName}
 * Update or create an analysis prompt
 * Uses INSERT ON CONFLICT DO UPDATE (upsert)
 * Auth: leadership/admin only
 * Source: docs/phase2/config-architecture.md §6.6
 */
export const updatePromptHandler = withRoles(['leadership', 'admin'], async (event, context) => {
  try {
    const auth = context.auth;

    const checkpointName = decodeURIComponent(event.pathParameters?.checkpointName || '');
    if (!checkpointName) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Checkpoint name is required' }) };
    }

    const input = JSON.parse(event.body || '{}');

    // Validate input
    UpdatePromptSchema.parse(input);

    const prompt = await updatePrompt(checkpointName, input, auth.email || auth.userId);

    return ok({ prompt });
  } catch (err) {
    return handleError(err);
  }
});
