/**
 * POST /api/projects/{projectId}/sync-artifacts
 * Reconcile the project's OWN-REPO micro governance events into its CASDM micro_artifacts
 * checklist (Level-2 auto-completion). Idempotent, audited, reversible, own-repo-scoped.
 *
 * Admin/leadership only (same privileged set as the CR-16 macro sync). Own-repo-only: the repo is
 * read from the project row, never from request input. Returns { project_id, matched, completed,
 * skipped }. An unlinked project returns all-zero (graceful). Unknown project → 404. There is no
 * GitHub fetch (Level 2 reads DB events only) — no 503/rate-limit path.
 *
 * See specs/api/projects.yaml and specs/phase2/CR-12-14-level2-spec.md §5.2.
 */
import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { withRoles } from '@kiro-governance/shared/middleware/rbac';
import { ok, handleError, ValidationError } from '@kiro-governance/shared/middleware/error-handler';
import { AuthContext } from '@kiro-governance/shared/types/auth';
import { SyncArtifactsResponse } from '../types';
import { reconcileMicroArtifacts } from '../services/micro-artifact-reconcile.service';

export const handler = withRoles(
  ['admin', 'leadership'],
  async (event: APIGatewayProxyEvent, context: Context & { auth: AuthContext }): Promise<APIGatewayProxyResult> => {
    try {
      const projectId = event.pathParameters?.projectId;
      if (!projectId) {
        throw new ValidationError('projectId is required');
      }

      const summary: SyncArtifactsResponse = await reconcileMicroArtifacts(projectId, context.auth.userId);
      return ok(summary);
    } catch (error) {
      return handleError(error);
    }
  },
);
