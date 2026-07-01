/**
 * GET /api/projects/{id}/checkpoints/{checkpointId}/evidence
 * List evidence attached to a checkpoint
 */

import { APIGatewayProxyHandler } from 'aws-lambda';
import { withRoles } from '@kiro-governance/shared/middleware/rbac';
import { ok, handleError, NotFoundError, ValidationError } from '@kiro-governance/shared/middleware/error-handler';
import { withLogging } from '@kiro-governance/shared/middleware/logger';
import { queryOne, queryMany } from '@kiro-governance/shared/db/pool';
import { ListEvidenceResponse, EvidenceItem } from '../types';

interface CheckpointRow {
  checkpoint_name: string;
}

export const handler: APIGatewayProxyHandler = withRoles(
  ['pm', 'sa', 'engineer', 'leadership', 'admin'],
  withLogging(async (event) => {
    try {
      const projectId = event.pathParameters?.id;
      const checkpointId = event.pathParameters?.checkpointId;

      if (!projectId || !checkpointId) {
        throw new ValidationError('Project ID and checkpoint ID are required');
      }

      // Verify checkpoint exists
      const checkpoint = await queryOne<CheckpointRow>(
        `SELECT checkpoint_name FROM macro_checkpoints WHERE id = $1 AND project_id = $2`,
        [checkpointId, projectId],
      );

      if (!checkpoint) {
        throw new NotFoundError('Checkpoint', checkpointId);
      }

      // List evidence for this checkpoint
      const evidence = await queryMany<EvidenceItem>(
        `SELECT id, project_id, checkpoint_name, evidence_type, label, value, link_metadata, uploaded_by, created_at
         FROM gate_evidence
         WHERE project_id = $1 AND checkpoint_name = $2
         ORDER BY created_at DESC`,
        [projectId, checkpoint.checkpoint_name],
      );

      const response: ListEvidenceResponse = {
        evidence,
        total_count: evidence.length,
      };

      return ok(response);
    } catch (err) {
      return handleError(err);
    }
  }),
);
