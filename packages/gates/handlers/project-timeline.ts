/**
 * GET /api/projects/{projectId}/timeline
 * Chronological project timeline: Phase 1 governance events (source `kiro_mcp`, joined via
 * projects.github_repo — CR-03) merged with DeliverPro macro checkpoint completions and evidence
 * attachments (source `deliverpro`). Macro governance events are display-only — this endpoint
 * never completes a checkpoint (macro completion is app-owned; see gates-architecture.md §5.3).
 * See specs/api/gates.yaml / docs/phase2/gates-architecture.md §2.8 for API documentation.
 */

import { APIGatewayProxyHandler } from 'aws-lambda';
import { withRoles } from '@kiro-governance/shared/middleware/rbac';
import {
  ok,
  handleError,
  NotFoundError,
  ValidationError,
  zodToValidationError,
} from '@kiro-governance/shared/middleware/error-handler';
import { withLogging } from '@kiro-governance/shared/middleware/logger';
import { TimelineQuerySchema } from '../validation';
import { getProjectTimeline, projectExists } from '../services/timeline.service';

export const handler: APIGatewayProxyHandler = withRoles(
  ['pm', 'sa', 'engineer', 'leadership', 'admin'],
  withLogging(async (event) => {
    try {
      const projectId = event.pathParameters?.projectId;
      if (!projectId) {
        throw new ValidationError('Project ID is required');
      }

      const parsed = TimelineQuerySchema.safeParse({
        limit: event.queryStringParameters?.limit
          ? Number(event.queryStringParameters.limit)
          : undefined,
        cursor: event.queryStringParameters?.cursor ?? undefined,
      });
      if (!parsed.success) {
        throw zodToValidationError(parsed.error);
      }

      // 404 if the project (jira_key) does not exist. An UNLINKED project (github_repo IS NULL)
      // is NOT an error — it simply surfaces only DeliverPro-native events.
      if (!(await projectExists(projectId))) {
        throw new NotFoundError('Project', projectId);
      }

      const timeline = await getProjectTimeline(
        projectId,
        parsed.data.limit,
        parsed.data.cursor ?? null,
      );

      return ok(timeline);
    } catch (err) {
      return handleError(err);
    }
  }),
);
