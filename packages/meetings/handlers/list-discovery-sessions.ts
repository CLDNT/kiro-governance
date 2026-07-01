/**
 * GET /api/projects/{id}/discovery-sessions
 * List all discovery sessions for a project in session_number order
 */

import { APIGatewayProxyHandler } from 'aws-lambda';
import { withRoles } from '@kiro-governance/shared/middleware/rbac';
import { ok, handleError, NotFoundError, ValidationError } from '@kiro-governance/shared/middleware/error-handler';
import { withLogging } from '@kiro-governance/shared/middleware/logger';
import { queryOne, queryMany } from '@kiro-governance/shared/db/pool';
import { ListDiscoverySessionsQuerySchema } from '../validation';
import { DiscoverySessionListResponse, DiscoverySession } from '../types';

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
      const queryParams = ListDiscoverySessionsQuerySchema.parse({
        limit: parseInt(event.queryStringParameters?.limit || '50'),
        cursor: event.queryStringParameters?.cursor,
      });

      // Keyset pagination
      let lastId = 0;
      if (queryParams.cursor) {
        try {
          lastId = parseInt(Buffer.from(queryParams.cursor, 'base64').toString());
        } catch {
          throw new ValidationError('Invalid cursor format');
        }
      }

      const sessions = await queryMany<DiscoverySession>(
        `SELECT id, project_id, session_number, session_date, meeting_link, participants, notes, created_at
         FROM discovery_sessions
         WHERE project_id = $1 AND (id < $2 OR $2 = 0)
         ORDER BY session_number DESC, id DESC
         LIMIT $3`,
        [projectId, lastId, queryParams.limit + 1],
      );

      let nextCursor: string | null = null;
      let actualSessions = sessions;

      if (sessions.length > queryParams.limit) {
        actualSessions = sessions.slice(0, queryParams.limit);
        nextCursor = Buffer.from(sessions[queryParams.limit].id.toString()).toString('base64');
      }

      const response: DiscoverySessionListResponse = {
        sessions: actualSessions,
        next_cursor: nextCursor,
      };

      return ok(response);
    } catch (err) {
      return handleError(err);
    }
  }),
);
