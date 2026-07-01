/**
 * Leadership reporting summary.
 * GET /api/reporting/summary
 *
 * See specs/api/reporting.yaml for complete API documentation.
 */

import { APIGatewayProxyHandler } from 'aws-lambda';
import { withLeadership } from '@kiro-governance/shared/middleware/rbac';
import { ok, handleError } from '@kiro-governance/shared/middleware/error-handler';
import { getReportingSummary } from '../services/reporting.service';

/**
 * GET /api/reporting/summary — Leadership view with cross-project summary.
 * See specs/api/reporting.yaml for API documentation.
 */
export const handler: APIGatewayProxyHandler = withLeadership(
  async (event, context) => {
    try {
      const summary = await getReportingSummary();

      return ok(summary);
    } catch (error) {
      return handleError(error);
    }
  },
);
