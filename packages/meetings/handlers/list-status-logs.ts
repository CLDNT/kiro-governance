/**
 * GET /api/projects/{id}/status-logs
 * List weekly status logs for a project
 */

import { APIGatewayProxyHandler } from 'aws-lambda';
import { withRoles } from '@kiro-governance/shared/middleware/rbac';
import { ok, handleError, NotFoundError, ValidationError } from '@kiro-governance/shared/middleware/error-handler';
import { withLogging } from '@kiro-governance/shared/middleware/logger';
import { queryOne, queryMany } from '@kiro-governance/shared/db/pool';
import { ListStatusLogsQuerySchema } from '../validation';
import { StatusLogListResponse, WeeklyStatusLog } from '../types';

export const handler: APIGatewayProxyHandler = withRoles(
  ['pm', 'sa', 'engineer', 'leadership', 'admin'],
  withLogging(async (event) => {
    try {
      const projectId = event.pathParameters?.id;

      if (!projectId) {
        throw new ValidationError('Project ID is required');
      }

      // Verify project exists
      const project = await queryOne<{ jira_key: string }>(
        `SELECT jira_key FROM projects WHERE jira_key = $1`,
        [projectId],
      );

      if (!project) {
        throw new NotFoundError('Project', projectId);
      }

      // Parse query params
      const queryParams = ListStatusLogsQuerySchema.parse({
        limit: parseInt(event.queryStringParameters?.limit || '20'),
        cursor: event.queryStringParameters?.cursor,
      });

      // Keyset pagination: cursor is base64-encoded last ID
      let lastId = 0;
      if (queryParams.cursor) {
        try {
          lastId = parseInt(Buffer.from(queryParams.cursor, 'base64').toString());
        } catch {
          throw new ValidationError('Invalid cursor format');
        }
      }

      const logs = await queryMany<WeeklyStatusLog>(
        `SELECT id, project_id, log_date, meeting_link, topics_covered, demo_items, blockers, logged_by, created_at
         FROM weekly_status_logs
         WHERE project_id = $1 AND (id < $2 OR $2 = 0)
         ORDER BY log_date DESC, id DESC
         LIMIT $3`,
        [projectId, lastId, queryParams.limit + 1],
      );

      let nextCursor: string | null = null;
      let actualLogs = logs;

      if (logs.length > queryParams.limit) {
        actualLogs = logs.slice(0, queryParams.limit);
        nextCursor = Buffer.from(logs[queryParams.limit].id.toString()).toString('base64');
      }

      const response: StatusLogListResponse = {
        status_logs: actualLogs,
        next_cursor: nextCursor,
      };

      return ok(response);
    } catch (err) {
      return handleError(err);
    }
  }),
);
