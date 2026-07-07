/**
 * PATCH /api/projects/{id}/artifacts/{artifactId}
 * Update micro artifact status. This is also the CR-12 MANUAL OVERRIDE / REVERSE path for
 * Level-2 auto-completion:
 *  - any human status change sets manual_override = true, so the reconciler stops touching the row
 *    (reversibility guarantee — a deliberate human decision is never clobbered by a re-sync);
 *  - every change writes an append-only micro_artifact_audit row ('reverse' when downgrading a
 *    Kiro-auto-completed row or when re-enabling auto-sync, else 'manual_override');
 *  - optional reset_to_auto (admin/leadership only) clears manual_override so the row becomes
 *    auto-eligible again.
 *
 * See specs/phase2/CR-12-14-level2-spec.md §5.5.
 */

import { APIGatewayProxyHandler } from 'aws-lambda';
import { withRoles } from '@kiro-governance/shared/middleware/rbac';
import { ok, handleError, NotFoundError, ValidationError, ForbiddenError } from '@kiro-governance/shared/middleware/error-handler';
import { withLogging, log } from '@kiro-governance/shared/middleware/logger';
import { queryOne, query } from '@kiro-governance/shared/db/pool';
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
  manual_override: boolean;
}

export const handler: APIGatewayProxyHandler = withRoles(
  ['pm', 'sa', 'leadership', 'admin'],
  withLogging(async (event, context) => {
    try {
      const projectId = event.pathParameters?.projectId;
      const artifactId = event.pathParameters?.artifactId;
      const auth = (context as { auth?: { role: string; email: string; userId: string } }).auth;
      const userEmail =
        auth?.email || event.requestContext?.authorizer?.claims?.['email'] || 'unknown';
      const role = auth?.role || '';

      if (!projectId || !artifactId) {
        throw new ValidationError('Project ID and artifact ID are required');
      }

      const input = UpdateArtifactInputSchema.parse(JSON.parse(event.body || '{}'));

      // reset_to_auto is a privileged re-enable of Kiro sync — admin/leadership only.
      if (input.reset_to_auto && !['admin', 'leadership'].includes(role)) {
        throw new ForbiddenError('Only admin/leadership can re-enable Kiro auto-sync (reset_to_auto)');
      }

      // Load artifact (incl. current provenance + override state)
      const artifact = await queryOne<ArtifactRow>(
        `SELECT id, project_id, phase, phase_name, artifact_name, status, completed_at, completed_by, manual_override
         FROM micro_artifacts
         WHERE id = $1 AND project_id = $2`,
        [artifactId, projectId],
      );

      if (!artifact) {
        throw new NotFoundError('Artifact', artifactId);
      }

      // A human change locks the row from auto-sync (manual_override = true), UNLESS the caller
      // explicitly re-enables auto-sync (reset_to_auto = true → manual_override = false).
      const newOverride = input.reset_to_auto ? false : true;

      // Audit action classification: a downgrade of a Kiro-auto-completed row, or an explicit
      // reset_to_auto, is a 'reverse'; any other human status change is a 'manual_override'.
      const wasKiroAuto = (artifact.completed_by ?? '').startsWith('kiro:');
      const leavingComplete = artifact.status === 'complete' && input.status !== 'complete';
      const action: 'manual_override' | 'reverse' =
        input.reset_to_auto || (wasKiroAuto && leavingComplete) ? 'reverse' : 'manual_override';

      // Update status. When transitioning to 'complete', set completed_at/by; otherwise clear both.
      const updated = await queryOne<ArtifactRow>(
        `UPDATE micro_artifacts
         SET status = $1,
             completed_at = CASE WHEN $1 = 'complete' THEN now() ELSE NULL END,
             completed_by = CASE WHEN $1 = 'complete' THEN $2 ELSE NULL END,
             manual_override = $3
         WHERE id = $4
         RETURNING id, project_id, phase, phase_name, artifact_name, status, completed_at, completed_by, manual_override`,
        [input.status, userEmail, newOverride, artifactId],
      );

      if (!updated) {
        throw new Error('Failed to update artifact');
      }

      // Append-only audit — attempted, best-effort (a failure is logged, never fails the update).
      try {
        await query(
          `INSERT INTO micro_artifact_audit
             (project_id, artifact_id, phase, artifact_name, event_code, event_actor, action, old_status, new_status, actor)
           VALUES ($1, $2, $3, $4, NULL, NULL, $5, $6, $7, $8)`,
          [
            artifact.project_id,
            artifact.id,
            artifact.phase,
            artifact.artifact_name,
            action,
            artifact.status,
            updated.status,
            userEmail,
          ],
        );
      } catch (err) {
        log('warn', 'ARTIFACT_AUDIT_FAILED', {
          artifactId,
          error: err instanceof Error ? err.message : String(err),
        });
      }

      log('info', 'ARTIFACT_STATUS_UPDATED', {
        artifactId,
        newStatus: input.status,
        updatedBy: userEmail,
        action,
        manualOverride: newOverride,
      });

      const response: MicroArtifactDetail = {
        id: updated.id,
        artifact_name: updated.artifact_name,
        phase: updated.phase,
        phase_name: updated.phase_name,
        status: updated.status as any,
        completed_at: updated.completed_at,
        completed_by: updated.completed_by,
        manual_override: updated.manual_override,
      };

      return ok(response);
    } catch (err) {
      return handleError(err);
    }
  }),
);
