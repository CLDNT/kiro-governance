/**
 * POST /api/projects/{projectId}/reopen
 * Reopen a closed project (leadership/admin only).
 * See specs/api/projects.yaml for API documentation.
 */

import { APIGatewayProxyHandler } from 'aws-lambda';
import { withRoles } from '@kiro-governance/shared/middleware/rbac';
import { ok, handleError, NotFoundError, ValidationError } from '@kiro-governance/shared/middleware/error-handler';
import { log } from '@kiro-governance/shared/middleware/logger';
import { queryOne } from '@kiro-governance/shared/db/pool';

interface ProjectRow {
  status: string;
}

interface ReopenResponse {
  status: string;
}

export const handler: APIGatewayProxyHandler = withRoles(
  ['leadership', 'admin'],
  async (event) => {
    try {
      const projectId = event.pathParameters?.projectId;

      if (!projectId) {
        throw new ValidationError('Project ID is required');
      }

      // Verify project exists
      const project = await queryOne<ProjectRow>(
        `SELECT status FROM projects WHERE jira_key = $1`,
        [projectId],
      );

      if (!project) {
        throw new NotFoundError('Project', projectId);
      }

      if (project.status !== 'Closed') {
        throw new ValidationError('Only closed projects can be reopened');
      }

      // Reopen the project
      const result = await queryOne<ReopenResponse>(
        `UPDATE projects
         SET status = 'Active'
         WHERE jira_key = $1
         RETURNING status`,
        [projectId],
      );

      if (!result) {
        throw new Error('Failed to reopen project');
      }

      log('info', 'PROJECT_REOPENED', {
        projectId,
        newStatus: result.status,
      });

      return ok({
        status: result.status,
      });
    } catch (err) {
      return handleError(err);
    }
  },
);
