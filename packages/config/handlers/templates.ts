/**
 * DP-34: Project Type Template Handlers
 * GET /api/admin/config/project-types — list all project types
 * POST /api/admin/config/copy-template — copy template from source to target
 */
import { APIGatewayProxyHandler } from 'aws-lambda';
import { requireRole } from '@kiro-governance/shared/middleware/auth';
import { ok, handleError } from '@kiro-governance/shared/middleware/error-handler';
import { CopyTemplateSchema } from '../validation';
import { listProjectTypes, copyTemplate } from '../services/config.service';

/**
 * GET /api/admin/config/project-types
 * List all project types in the system
 * Auth: all roles can read
 * Source: docs/phase2/config-architecture.md §6 (per task)
 */
export const listProjectTypesHandler: APIGatewayProxyHandler = async (event) => {
  try {
    // All roles can read project types
    const auth = requireRole(['pm', 'sa', 'engineer', 'leadership', 'admin'], event);

    const projectTypes = await listProjectTypes();

    return ok({ project_types: projectTypes });
  } catch (err) {
    return handleError(err);
  }
};

/**
 * POST /api/admin/config/copy-template
 * Copy all casdm_config rows from source to target project type
 * Returns 409 if target already has rows
 * Auth: leadership/admin only
 * Source: docs/phase2/config-architecture.md §6 (per task)
 */
export const copyTemplateHandler: APIGatewayProxyHandler = async (event) => {
  try {
    const auth = requireRole(['leadership', 'admin'], event);

    const input = JSON.parse(event.body || '{}');

    // Validate input
    CopyTemplateSchema.parse(input);

    const rowsCopied = await copyTemplate(input, auth.email || auth.sub);

    return ok(
      {
        rows_copied: rowsCopied,
        target_project_type: input.target_project_type,
      },
      201,
    );
  } catch (err) {
    return handleError(err);
  }
};
