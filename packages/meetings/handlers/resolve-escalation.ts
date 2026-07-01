/**
 * PATCH /api/projects/{id}/escalations/{id}
 * Resolve an open escalation
 */

import { APIGatewayProxyHandler } from 'aws-lambda';
import { withRoles } from '@kiro-governance/shared/middleware/rbac';
import { ok, handleError, NotFoundError, ValidationError, ConflictError } from '@kiro-governance/shared/middleware/error-handler';
import { withLogging, log } from '@kiro-governance/shared/middleware/logger';
import { queryOne } from '@kiro-governance/shared/db/pool';
import { ResolveEscalationInputSchema } from '../validation';
import { EscalationResolutionResponse } from '../types';

interface EscalationRow {
  status: string;
}

export const handler: APIGatewayProxyHandler = withRoles(
  ['pm', 'leadership', 'admin'],
  withLogging(async (event) => {
    try {
      const projectId = event.pathParameters?.id;
      const escalationId = event.pathParameters?.escalationId;

      if (!projectId || !escalationId) {
        throw new ValidationError('Project ID and escalation ID are required');
      }

      const input = ResolveEscalationInputSchema.parse(JSON.parse(event.body || '{}'));

      // Load escalation
      const escalation = await queryOne<EscalationRow>(
        `SELECT status FROM escalations WHERE id = $1 AND project_id = $2`,
        [escalationId, projectId],
      );

      if (!escalation) {
        throw new NotFoundError('Escalation', escalationId);
      }

      if (escalation.status === 'resolved') {
        throw new ConflictError('ALREADY_RESOLVED', 'This escalation is already resolved');
      }

      // Update escalation
      const result = await queryOne<EscalationResolutionResponse>(
        `UPDATE escalations
         SET resolved_date = $1, resolution_notes = $2, status = 'resolved'
         WHERE id = $3
         RETURNING id, project_id, raised_date, description, severity, raised_by, resolved_date, resolution_notes, status, created_at`,
        [input.resolved_date, input.resolution_notes || null, escalationId],
      );

      if (!result) {
        throw new Error('Failed to resolve escalation');
      }

      // Add warning if no resolution_notes provided
      if (!input.resolution_notes) {
        result.warning = 'Escalation resolved without notes. Consider adding resolution context.';
      }

      log('ESCALATION_RESOLVED', {
        projectId,
        escalationId,
        resolvedDate: input.resolved_date,
        hasNotes: !!input.resolution_notes,
      });

      return ok(result);
    } catch (err) {
      return handleError(err);
    }
  }),
);
