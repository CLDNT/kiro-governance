/**
 * POST /api/projects/{id}/checkpoints/{checkpointId}/evidence
 * Attach evidence to a checkpoint
 */

import { APIGatewayProxyHandler } from 'aws-lambda';
import { withRoles } from '@kiro-governance/shared/middleware/rbac';
import { ok, handleError, NotFoundError, ValidationError } from '@kiro-governance/shared/middleware/error-handler';
import { withLogging, log } from '@kiro-governance/shared/middleware/logger';
import { queryOne, queryMany } from '@kiro-governance/shared/db/pool';
import { AttachEvidenceInputSchema } from '../validation';
import { EvidenceItem } from '../types';

interface CheckpointRow {
  checkpoint_name: string;
}

export const handler: APIGatewayProxyHandler = withRoles(
  ['pm', 'sa', 'leadership', 'admin'],
  withLogging(async (event) => {
    try {
      const projectId = event.pathParameters?.projectId;
      const checkpointId = event.pathParameters?.checkpointId;
      const userEmail = event.requestContext?.authorizer?.claims?.['email'] || 'unknown';

      if (!projectId || !checkpointId) {
        throw new ValidationError('Project ID and checkpoint ID are required');
      }

      const input = AttachEvidenceInputSchema.parse(JSON.parse(event.body || '{}'));

      // Verify checkpoint exists
      const checkpoint = await queryOne<CheckpointRow>(
        `SELECT checkpoint_name FROM macro_checkpoints WHERE id = $1 AND project_id = $2`,
        [checkpointId, projectId],
      );

      if (!checkpoint) {
        throw new NotFoundError('Checkpoint', checkpointId);
      }

      // Insert evidence record
      const result = await queryOne<EvidenceItem>(
        `INSERT INTO gate_evidence (project_id, checkpoint_name, evidence_type, label, value, link_metadata, uploaded_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id, project_id, checkpoint_name, evidence_type, label, value, link_metadata, uploaded_by, created_at`,
        [
          projectId,
          checkpoint.checkpoint_name,
          input.evidence_type,
          input.label || null,
          input.value,
          input.link_metadata ? JSON.stringify(input.link_metadata) : null,
          userEmail,
        ],
      );

      if (!result) {
        throw new Error('Failed to create evidence record');
      }

      // Side effect: if meeting_link type, also update checkpoint.meeting_link
      if (input.evidence_type === 'meeting_link') {
        await queryOne(
          `UPDATE macro_checkpoints SET meeting_link = $1 WHERE id = $2`,
          [input.value, checkpointId],
        );
        log('info', 'CHECKPOINT_ENRICHED', { checkpointId, field: 'meeting_link' });
      }

      // If ai_analysis type, also update checkpoint analysis_result (for analysis domain)
      if (input.evidence_type === 'ai_analysis' && input.link_metadata) {
        await queryOne(
          `UPDATE macro_checkpoints SET analysis_result = $1 WHERE id = $2`,
          [JSON.stringify(input.link_metadata), checkpointId],
        );
      }

      log('info', 'EVIDENCE_ATTACHED', {
        projectId,
        checkpointId,
        evidenceType: input.evidence_type,
        uploadedBy: userEmail,
      });

      return ok(result, 201);
    } catch (err) {
      return handleError(err);
    }
  }),
);
