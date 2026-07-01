/**
 * POST /api/projects/{projectId}/checkpoints/{checkpointId}/notes
 * Add an append-only note to a checkpoint.
 * See specs/api/gates.yaml for API documentation.
 */

import { APIGatewayProxyHandler } from 'aws-lambda';
import { withRoles } from '@kiro-governance/shared/middleware/rbac';
import { ok, handleError, NotFoundError, ValidationError } from '@kiro-governance/shared/middleware/error-handler';
import { withLogging, log } from '@kiro-governance/shared/middleware/logger';
import { queryOne } from '@kiro-governance/shared/db/pool';
import { AddNoteInputSchema } from '../validation';
import { GateNote } from '../types';
import { AuthContext } from '@kiro-governance/shared/types/auth';

export const handler: APIGatewayProxyHandler = withRoles(
  ['pm', 'sa', 'leadership', 'admin'],
  withLogging(async (event, context: any) => {
    try {
      const projectId = event.pathParameters?.projectId;
      const checkpointId = event.pathParameters?.checkpointId;

      if (!projectId || !checkpointId) {
        throw new ValidationError('Project ID and checkpoint ID are required');
      }

      const input = AddNoteInputSchema.parse(JSON.parse(event.body || '{}'));

      // Verify checkpoint exists and belongs to the project
      const checkpoint = await queryOne<{ checkpoint_name: string }>(
        `SELECT checkpoint_name FROM macro_checkpoints
         WHERE id = $1 AND project_id = $2`,
        [parseInt(checkpointId), projectId],
      );

      if (!checkpoint) {
        throw new NotFoundError('Checkpoint', checkpointId);
      }

      // Get current user email from auth context
      const auth: AuthContext = context.auth || {};
      const authorEmail = auth.email || auth.sub || 'unknown';

      // Insert note
      const result = await queryOne<GateNote>(
        `INSERT INTO checkpoint_notes (project_id, checkpoint_id, checkpoint_name, note_text, author)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, project_id, checkpoint_name, note_text, author, created_at`,
        [projectId, parseInt(checkpointId), checkpoint.checkpoint_name, input.note_text, authorEmail],
      );

      if (!result) {
        throw new Error('Failed to create note');
      }

      log('CHECKPOINT_NOTE_ADDED', {
        projectId,
        checkpointId,
        checkpointName: checkpoint.checkpoint_name,
        noteId: result.id,
        author: authorEmail,
      });

      return ok(result, 201);
    } catch (err) {
      return handleError(err);
    }
  }),
);
