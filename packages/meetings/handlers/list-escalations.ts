/**
 * GET /api/projects/{id}/escalations
 * List escalations for a project with optional filters
 */

import { APIGatewayProxyHandler } from 'aws-lambda';
import { withRoles } from '@kiro-governance/shared/middleware/rbac';
import { ok, handleError, NotFoundError, ValidationError } from '@kiro-governance/shared/middleware/error-handler';
import { withLogging } from '@kiro-governance/shared/middleware/logger';
import { queryOne, queryMany } from '@kiro-governance/shared/db/pool';
import { ListEscalationsQuerySchema } from '../validation';
import { EscalationListResponse, Escalation } from '../types';

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
      const queryParams = ListEscalationsQuerySchema.parse({
        status: event.queryStringParameters?.status,
        severity: event.queryStringParameters?.severity,
        limit: parseInt(event.queryStringParameters?.limit || '20'),
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

      // Build query with filters
      let query = `SELECT id, project_id, raised_date, description, severity, raised_by, resolved_date, resolution_notes, status, created_at
         FROM escalations
         WHERE project_id = $1 AND (id < $2 OR $2 = 0)`;
      const params: (string | number)[] = [projectId, lastId];
      let paramIdx = 3;

      if (queryParams.status) {
        query += ` AND status = $${paramIdx}`;
        params.push(queryParams.status);
        paramIdx++;
      }

      if (queryParams.severity) {
        query += ` AND severity = $${paramIdx}`;
        params.push(queryParams.severity);
        paramIdx++;
      }

      query += ` ORDER BY (CASE WHEN status = 'open' THEN 0 ELSE 1 END), 
        (CASE severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END),
        raised_date DESC, id DESC LIMIT $${paramIdx}`;
      params.push(queryParams.limit + 1);

      const escalations = await queryMany<Escalation>(query, params);

      let nextCursor: string | null = null;
      let actualEscalations = escalations;

      if (escalations.length > queryParams.limit) {
        actualEscalations = escalations.slice(0, queryParams.limit);
        nextCursor = Buffer.from(escalations[queryParams.limit].id.toString()).toString('base64');
      }

      const response: EscalationListResponse = {
        escalations: actualEscalations,
        next_cursor: nextCursor,
      };

      return ok(response);
    } catch (err) {
      return handleError(err);
    }
  }),
);
