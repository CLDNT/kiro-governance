/**
 * POST /api/projects/{projectId}/sync-gates
 * Fetch the project's linked repo docs/project-progress.md, parse the resolved macro gates, and
 * idempotently complete the matching macro_checkpoints (reviewed_by='system:repo-sync').
 *
 * Admin/leadership only (same role set as linkage mutation). Own-repo-only: the repo is read
 * from the project row, never from request input. Returns { project_id, matched, resolved,
 * skipped }. An unlinked project returns all-zero (graceful). GitHub rate-limit / auth / network
 * failures surface as 503 REPO_SYNC_UNAVAILABLE (secret-free) so the actor can retry.
 *
 * See specs/api/projects.yaml and specs/phase2/CR-16-link-time-gate-detection-spec.md §7.
 */
import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { withRoles } from '@kiro-governance/shared/middleware/rbac';
import { ok, handleError, AppError, ValidationError } from '@kiro-governance/shared/middleware/error-handler';
import { AuthContext } from '@kiro-governance/shared/types/auth';
import { SyncGatesResponse } from '../types';
import { syncGatesFromRepo } from '../services/gate-sync.service';
import { GithubFetchError } from '../services/github.service';

export const handler = withRoles(
  ['admin', 'leadership'],
  async (event: APIGatewayProxyEvent, context: Context & { auth: AuthContext }): Promise<APIGatewayProxyResult> => {
    try {
      const projectId = event.pathParameters?.projectId;
      if (!projectId) {
        throw new ValidationError('projectId is required');
      }

      const summary: SyncGatesResponse = await syncGatesFromRepo(projectId, context.auth.userId);
      return ok(summary);
    } catch (error) {
      // GitHub rate-limit / auth / network failures → retriable 503 (secret-free code).
      if (error instanceof GithubFetchError) {
        return handleError(new AppError('REPO_SYNC_UNAVAILABLE', 'Repository sync is temporarily unavailable', 503));
      }
      return handleError(error);
    }
  },
);
