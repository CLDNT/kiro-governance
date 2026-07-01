/**
 * POST /api/projects/{id}/status-logs
 * Log a weekly client status call
 */

import { APIGatewayProxyHandler } from 'aws-lambda';
import { withRoles } from '@kiro-governance/shared/middleware/rbac';
import { ok, handleError, NotFoundError, ValidationError, AppError } from '@kiro-governance/shared/middleware/error-handler';
import { withLogging, log } from '@kiro-governance/shared/middleware/logger';
import { queryOne } from '@kiro-governance/shared/db/pool';
import { CreateStatusLogInputSchema } from '../validation';
import { WeeklyStatusLog } from '../types';

interface ProjectRow {
  status: string;
}

export const handler: APIGatewayProxyHandler = withRoles(
  ['pm', 'leadership', 'admin'],
  withLogging(async (event) => {
    try {
      const projectId = event.pathParameters?.id;
      const userEmail = event.requestContext?.authorizer?.claims?.['email'] || 'unknown';

      if (!projectId) {
        throw new ValidationError('Project ID is required');
      }

      const input = CreateStatusLogInputSchema.parse(JSON.parse(event.body || '{}'));

      // Verify project exists and is not closed
      const project = await queryOne<ProjectRow>(
        `SELECT status FROM projects WHERE jira_key = $1`,
        [projectId],
      );

      if (!project) {
        throw new NotFoundError('Project', projectId);
      }

      if (project.status === 'Closed') {
        throw new AppError('PROJECT_CLOSED', 'Cannot add status logs to a closed project', 409);
      }

      // Insert status log
      const result = await queryOne<WeeklyStatusLog>(
        `INSERT INTO weekly_status_logs (project_id, log_date, meeting_link, topics_covered, demo_items, blockers, logged_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id, project_id, log_date, meeting_link, topics_covered, demo_items, blockers, logged_by, created_at`,
        [projectId, input.log_date, input.meeting_link || null, input.topics_covered, input.demo_items || null, input.blockers || null, userEmail],
      );

      if (!result) {
        throw new Error('Failed to create status log');
      }

      log('STATUS_LOG_CREATED', {
        projectId,
        logDate: input.log_date,
        loggedBy: userEmail,
      });

      return ok(result, 201);
    } catch (err) {
      return handleError(err);
    }
  }),
);
