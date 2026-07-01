/**
 * POST /api/projects/{projectId}/close
 * Close a project after validating all 4 closure checkpoints are complete.
 * See specs/api/projects.yaml for API documentation.
 */

import { APIGatewayProxyHandler } from 'aws-lambda';
import { withRoles } from '@kiro-governance/shared/middleware/rbac';
import { ok, handleError, NotFoundError, ValidationError, AppError } from '@kiro-governance/shared/middleware/error-handler';
import { withLogging, log } from '@kiro-governance/shared/middleware/logger';
import { queryOne, queryMany } from '@kiro-governance/shared/db/pool';

interface CheckpointRow {
  checkpoint_name: string;
}

interface ProjectRow {
  status: string;
}

interface CloseResponse {
  status: string;
  closed_at: string;
}

const CLOSURE_CHECKPOINTS = [
  'Request Signoff from Business Ops',
  'Share Signoff with Customer',
  'Project Closure Meeting/Email',
  'Create Project Closure Deck',
];

export const handler: APIGatewayProxyHandler = withRoles(
  ['pm', 'leadership', 'admin'],
  withLogging(async (event) => {
    try {
      const projectId = event.pathParameters?.projectId;

      if (!projectId) {
        throw new ValidationError('Project ID is required');
      }

      // Verify project exists and is not already closed
      const project = await queryOne<ProjectRow>(
        `SELECT status FROM projects WHERE jira_key = $1`,
        [projectId],
      );

      if (!project) {
        throw new NotFoundError('Project', projectId);
      }

      if (project.status === 'Closed') {
        throw new ValidationError('Project is already closed');
      }

      // Check all 4 closure checkpoints are complete
      const incompleteCheckpoints = await queryMany<CheckpointRow>(
        `SELECT checkpoint_name FROM macro_checkpoints
         WHERE project_id = $1
           AND checkpoint_name = ANY($2)
           AND phase = 'Phase 4'
           AND (occurred IS NULL OR occurred = false)
           AND reached_at IS NULL`,
        [projectId, CLOSURE_CHECKPOINTS],
      );

      if (incompleteCheckpoints.length > 0) {
        throw new AppError(
          'CLOSURE_INCOMPLETE',
          `Cannot close project. Incomplete closure items: ${incompleteCheckpoints.map(c => c.checkpoint_name).join(', ')}`,
          400,
        );
      }

      // Also check that "Create Project Closure Deck" has evidence attached
      // (since it's a checklist item that requires file upload as evidence)
      const deckEvidence = await queryOne<{ count: number }>(
        `SELECT COUNT(*) as count FROM gate_evidence
         WHERE project_id = $1
           AND checkpoint_name = 'Create Project Closure Deck'`,
        [projectId],
      );

      if (!deckEvidence || deckEvidence.count === 0) {
        throw new AppError(
          'CLOSURE_INCOMPLETE',
          'Create Project Closure Deck requires evidence attachment (e.g., closure deck file)',
          400,
        );
      }

      // All checks passed — close the project
      const result = await queryOne<CloseResponse>(
        `UPDATE projects
         SET status = 'Closed'
         WHERE jira_key = $1
         RETURNING status, now() as closed_at`,
        [projectId],
      );

      if (!result) {
        throw new Error('Failed to close project');
      }

      log('PROJECT_CLOSED', {
        projectId,
        closedAt: result.closed_at,
      });

      return ok({
        status: result.status,
        closed_at: result.closed_at,
      });
    } catch (err) {
      return handleError(err);
    }
  }),
);
