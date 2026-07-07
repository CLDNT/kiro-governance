/**
 * DP-32: Config CRUD Handlers
 * GET /api/admin/config?project_type={type} — get template
 * POST /api/admin/config/items — create config item
 * PATCH /api/admin/config/items/{id} — update config item
 */
import { withRoles } from '@kiro-governance/shared/middleware/rbac';
import { ok, handleError } from '@kiro-governance/shared/middleware/error-handler';
import { CreateConfigItemSchema, UpdateConfigItemSchema } from '../validation';
import { getTemplate, createConfigItem, updateConfigItem } from '../services/config.service';

/**
 * GET /api/admin/config?project_type={type}
 * Retrieve full CASDM template for a project type (all phases, gates, artifacts)
 * Auth: leadership/admin only
 * Source: docs/phase2/config-architecture.md §6.2
 */
export const getConfigHandler = withRoles(['leadership', 'admin'], async (event, context) => {
  try {
    const auth = context.auth;

    const projectType = event.queryStringParameters?.project_type || 'default';

    const items = await getTemplate(projectType);

    // Organize by phase
    const phases = new Map<string, any>();
    for (const item of items) {
      if (!phases.has(item.phase)) {
        phases.set(item.phase, {
          phase: item.phase,
          phase_name: item.phase_name,
          phase_order: item.phase_order,
          micro_artifacts: [],
          macro_checkpoints: [],
        });
      }

      const phase = phases.get(item.phase);
      if (item.config_type === 'micro_artifact' && item.item_name) {
        phase.micro_artifacts.push({
          id: item.id,
          item_name: item.item_name,
          item_order: item.item_order,
          item_type: item.item_type,
          is_mandatory: item.is_mandatory,
          is_active: item.is_active,
        });
      } else if (item.config_type === 'macro_checkpoint' && item.item_name) {
        phase.macro_checkpoints.push({
          id: item.id,
          item_name: item.item_name,
          item_order: item.item_order,
          item_type: item.item_type,
          is_mandatory: item.is_mandatory,
          is_active: item.is_active,
        });
      }
    }

    const response = {
      project_type: projectType,
      phases: Array.from(phases.values()),
    };

    return ok(response);
  } catch (err) {
    return handleError(err);
  }
});

/**
 * POST /api/admin/config/items
 * Create a new config item (phase, artifact, or checkpoint)
 * Auth: leadership/admin only
 * Source: docs/phase2/config-architecture.md §6.3
 */
export const createConfigItemHandler = withRoles(['leadership', 'admin'], async (event, context) => {
  try {
    const auth = context.auth;

    const projectType = event.queryStringParameters?.project_type || 'default';
    const input = JSON.parse(event.body || '{}');

    // Validate input
    CreateConfigItemSchema.parse(input);

    const item = await createConfigItem(projectType, input, auth.email || auth.userId);

    return ok({ item }, 201);
  } catch (err) {
    return handleError(err);
  }
});

/**
 * PATCH /api/admin/config/items/{id}
 * Update a config item (rename, reorder, toggle active)
 * Auth: leadership/admin only
 * Source: docs/phase2/config-architecture.md §6.4
 */
export const updateConfigItemHandler = withRoles(['leadership', 'admin'], async (event, context) => {
  try {
    const auth = context.auth;

    const projectType = event.queryStringParameters?.project_type || 'default';
    const id = parseInt(event.pathParameters?.id || '0', 10);
    const input = JSON.parse(event.body || '{}');

    if (!id) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Invalid config item ID' }) };
    }

    // Validate input
    UpdateConfigItemSchema.parse(input);

    const item = await updateConfigItem(projectType, id, input, auth.email || auth.userId);

    return ok({ item });
  } catch (err) {
    return handleError(err);
  }
});
