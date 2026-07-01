/**
 * Per-project reporting timeline.
 * GET /api/reporting/projects/{projectId}/timeline
 *
 * See specs/api/reporting.yaml for complete API documentation.
 */

import { APIGatewayProxyHandler } from 'aws-lambda';
import { withLeadership } from '@kiro-governance/shared/middleware/rbac';
import { ok, handleError, NotFoundError } from '@kiro-governance/shared/middleware/error-handler';
import { getReportingTimeline } from '../services/reporting.service';

/**
 * GET /api/reporting/projects/{projectId}/timeline — Per-project event timeline.
 * See specs/api/reporting.yaml for API documentation.
 */
export const handler: APIGatewayProxyHandler = withLeadership(
  async (event, context) => {
    try {
      const projectId = event.pathParameters?.projectId;
      if (!projectId) {
        return handleError(new Error('Missing path parameter: projectId'));
      }

      const limit = parseInt(event.queryStringParameters?.limit ?? '100', 10);
      const cursor = event.queryStringParameters?.cursor ?? null;

      try {
        const timeline = await getReportingTimeline(projectId, limit, cursor);

        return ok(timeline);
      } catch (err) {
        if (err instanceof Error && err.message.includes('Project not found')) {
          return handleError(new NotFoundError('project', projectId));
        }
        throw err;
      }
    } catch (error) {
      return handleError(error);
    }
  },
);
