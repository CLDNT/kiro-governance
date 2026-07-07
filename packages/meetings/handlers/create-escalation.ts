/**
 * POST /api/projects/{id}/escalations
 * Raise an escalation against a project
 */

import { APIGatewayProxyHandler } from 'aws-lambda';
import { withRoles } from '@kiro-governance/shared/middleware/rbac';
import { ok, handleError, NotFoundError, ValidationError } from '@kiro-governance/shared/middleware/error-handler';
import { withLogging, log } from '@kiro-governance/shared/middleware/logger';
import { queryOne } from '@kiro-governance/shared/db/pool';
import { CreateEscalationInputSchema } from '../validation';
import { Escalation } from '../types';

export const handler: APIGatewayProxyHandler = withRoles(
  ['pm', 'leadership', 'admin'],
  withLogging(async (event) => {
    try {
      const projectId = event.pathParameters?.projectId;

      if (!projectId) {
        throw new ValidationError('Project ID is required');
      }

      const input = CreateEscalationInputSchema.parse(JSON.parse(event.body || '{}'));

      // Verify project exists
      const project = await queryOne<{ jira_key: string }>(
        `SELECT jira_key FROM projects WHERE jira_key = $1`,
        [projectId],
      );

      if (!project) {
        throw new NotFoundError('Project', projectId);
      }

      // Insert escalation
      const result = await queryOne<Escalation>(
        `INSERT INTO escalations (project_id, raised_date, description, severity, raised_by, status)
         VALUES ($1, $2, $3, $4, $5, 'open')
         RETURNING id, project_id, raised_date, description, severity, raised_by, resolved_date, resolution_notes, status, created_at`,
        [projectId, input.raised_date, input.description, input.severity, input.raised_by],
      );

      if (!result) {
        throw new Error('Failed to create escalation');
      }

      log('info', 'ESCALATION_RAISED', {
        projectId,
        escalationId: result.id,
        severity: input.severity,
        raisedBy: input.raised_by,
      });

      return ok(result, 201);
    } catch (err) {
      return handleError(err);
    }
  }),
);
