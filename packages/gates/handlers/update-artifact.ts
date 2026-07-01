/**
 * PATCH /api/projects/{id}/artifacts/{artifactId}
 * Update micro artifact status
 */

import { APIGatewayProxyHandler } from 'aws-lambda';
import { withRoles } from '@kiro-governance/shared/middleware/rbac';
import { ok, handleError, NotFoundError, ValidationError } from '@kiro-governance/shared/middleware/error-handler';
import { withLogging, log } from '@kiro-governance/shared/middleware/logger';
import { queryOne } from '@kiro-governance/shared/db/pool';
import { UpdateArtifactInputSchema } from '../validation';
import { MicroArtifactDetail } from '../types';

interface ArtifactRow {
  id: number;
  project_id: string;
  phase: string;
  phase_name: string;
  artifact_name: string;
  status: string;
  completed_at: string | null;
  completed_by: string | null;
}

export const handler: APIGatewayProxyHandler = withRoles(
  ['pm', 'sa', 'leadership', 'admin'],
  withLogging(async (event) => {
    try {
      const projectId = event.pathParameters?.id;
      const artifactId = event.pathParameters?.artifactId;
      const userEmail = event.requestContext?.authorizer?.claims?.['email'] || 'unknown';

      if (!projectId || !artifactId) {
        throw new ValidationError('Project ID and artifact ID are required');
      }

      const input = UpdateArtifactInputSchema.parse(JSON.parse(event.body || '{}'));

      // Load artifact
      const artifact = await queryOne<ArtifactRow>(
        `SELECT id, project_id, phase, phase_name, artifact_name, status, completed_at, completed_by
         FROM micro_artifacts
         WHERE id = $1 AND project_id = $2`,
        [artifactId, projectId],
      );

      if (!artifact) {
        throw new NotFoundError('Artifact', artifactId);
      }

      // Update status
      // When transitioning to 'complete', set completed_at and completed_by
      // When moving away from 'complete', clear both
      const updated = await queryOne<ArtifactRow>(
        `UPDATE micro_artifacts
         SET status = $1,
             completed_at = CASE WHEN $1 = 'complete' THEN now() ELSE NULL END,
             completed_by = CASE WHEN $1 = 'complete' THEN $2 ELSE NULL END
         WHERE id = $3
         RETURNING id, project_id, phase, phase_name, artifact_name, status, completed_at, completed_by`,
        [input.status, userEmail, artifactId],
      );

      if (!updated) {
        throw new Error('Failed to update artifact');
      }

      log('ARTIFACT_STATUS_UPDATED', {
        artifactId,
        newStatus: input.status,
        updatedBy: userEmail,
      });

      const response: MicroArtifactDetail = {
        id: updated.id,
        artifact_name: updated.artifact_name,
        phase: updated.phase,
        phase_name: updated.phase_name,
        status: updated.status as any,
        completed_at: updated.completed_at,
        completed_by: updated.completed_by,
      };

      return ok(response);
    } catch (err) {
      return handleError(err);
    }
  }),
);
