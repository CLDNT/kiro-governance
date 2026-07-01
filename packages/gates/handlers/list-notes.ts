/**
 * GET /api/projects/{projectId}/checkpoints/{checkpointId}/notes
 * List all notes for a checkpoint, sorted by created_at ASC.
 * See specs/api/gates.yaml for API documentation.
 */

import { APIGatewayProxyHandler } from 'aws-lambda';
import { withRoles } from '@kiro-governance/shared/middleware/rbac';
import { ok, handleError, NotFoundError, ValidationError } from '@kiro-governance/shared/middleware/error-handler';
import { withLogging } from '@kiro-governance/shared/middleware/logger';
import { queryOne, queryMany } from '@kiro-governance/shared/db/pool';
import { GateNote } from '../types';

interface ListNotesResponse {
  notes: GateNote[];
  total_count: number;
}

export const handler: APIGatewayProxyHandler = withRoles(
  ['pm', 'sa', 'engineer', 'leadership', 'admin'],
  withLogging(async (event) => {
    try {
      const projectId = event.pathParameters?.projectId;
      const checkpointId = event.pathParameters?.checkpointId;

      if (!projectId || !checkpointId) {
        throw new ValidationError('Project ID and checkpoint ID are required');
      }

      // Verify checkpoint exists and belongs to the project
      const checkpoint = await queryOne<{ checkpoint_name: string }>(
        `SELECT checkpoint_name FROM macro_checkpoints
         WHERE id = $1 AND project_id = $2`,
        [parseInt(checkpointId), projectId],
      );

      if (!checkpoint) {
        throw new NotFoundError('Checkpoint', checkpointId);
      }

      // Fetch notes sorted by created_at ASC
      const notes = await queryMany<GateNote>(
        `SELECT id, project_id, checkpoint_name, note_text, author, created_at
         FROM checkpoint_notes
         WHERE project_id = $1 AND checkpoint_id = $2
         ORDER BY created_at ASC`,
        [projectId, parseInt(checkpointId)],
      );

      const response: ListNotesResponse = {
        notes,
        total_count: notes.length,
      };

      return ok(response);
    } catch (err) {
      return handleError(err);
    }
  }),
);
