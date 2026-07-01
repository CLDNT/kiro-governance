/**
 * GET /api/projects/{projectId}/checklist
 * List onboarding checklist items for a project.
 * See specs/api/projects.yaml for API documentation.
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { withRoles } from '@kiro-governance/shared/middleware/rbac';
import { ok, handleError, NotFoundError } from '@kiro-governance/shared/middleware/error-handler';
import { getPool } from '@kiro-governance/shared/db/pool';
import { AuthContext } from '@kiro-governance/shared/types/auth';
import { ChecklistResponse, OnboardingChecklistItem } from '../types';

async function listChecklist(
  projectId: string,
  _auth: AuthContext,
): Promise<ChecklistResponse> {
  const pool = await getPool();

  // Verify project exists
  const projectCheck = await pool.query(
    `SELECT jira_key FROM projects WHERE jira_key = $1`,
    [projectId],
  );

  if (projectCheck.rows.length === 0) {
    throw new NotFoundError('Project', projectId);
  }

  // Get checklist items
  const result = await pool.query(
    `SELECT id, project_id, item_name, completed, completed_by, completed_at, created_at
     FROM onboarding_checklist_items
     WHERE project_id = $1
     ORDER BY created_at`,
    [projectId],
  );

  const items: OnboardingChecklistItem[] = result.rows.map((row: any) => ({
    id: row.id,
    project_id: row.project_id,
    item_name: row.item_name,
    completed: row.completed,
    completed_by: row.completed_by,
    completed_at: row.completed_at,
    created_at: row.created_at,
  }));

  const completedCount = items.filter((i) => i.completed).length;
  const totalCount = items.length;

  return {
    items,
    completed_count: completedCount,
    total_count: totalCount,
  };
}

export const handler = withRoles(['pm', 'sa', 'engineer', 'leadership', 'admin'], async (event: APIGatewayProxyEvent, context: any): Promise<APIGatewayProxyResult> => {
  try {
    const projectId = event.pathParameters?.projectId;
    if (!projectId) {
      throw new Error('Missing projectId path parameter');
    }

    const result = await listChecklist(projectId, context.auth);

    return ok(result);
  } catch (error) {
    return handleError(error);
  }
});
