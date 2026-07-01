/**
 * PATCH /api/projects/{projectId}
 * Update project metadata.
 * project_type is immutable after creation.
 * See specs/api/projects.yaml for API documentation.
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { z } from 'zod';
import { withRoles } from '@kiro-governance/shared/middleware/rbac';
import { ok, handleError, ValidationError, NotFoundError, AppError, ForbiddenError } from '@kiro-governance/shared/middleware/error-handler';
import { getPool } from '@kiro-governance/shared/db/pool';
import { AuthContext } from '@kiro-governance/shared/types/auth';
import { UpdateProjectInput, Project } from '../types';

const UpdateProjectInputSchema = z.object({
  title: z.string().min(1).max(255).optional(),
  description: z.string().optional(),
  status: z.string().optional(),
  project_manager: z.string().optional(),
  solution_architect: z.string().optional(),
  account_executive: z.string().optional(),
  engineers_assigned: z.string().optional(),
  planned_kickoff_date: z.string().nullable().optional(),
  expected_completion_date: z.string().nullable().optional(),
  sow_hours: z.number().positive().nullable().optional(),
  project_type: z.string().optional(), // Not allowed to be changed
});

const CURRENT_PHASE_SQL = `
  CASE
    WHEN EXISTS (
      SELECT 1 FROM macro_checkpoints mc
      INNER JOIN casdm_config cc ON cc.phase = mc.phase
        AND cc.item_name = mc.checkpoint_name
        AND cc.config_type = 'macro_checkpoint'
        AND cc.is_mandatory = true AND cc.is_active = true
        AND cc.project_type = COALESCE(p.project_type, 'default')
      WHERE mc.project_id = p.jira_key AND mc.phase = 'Phase 0'
        AND mc.reached_at IS NULL
    ) THEN 'Phase 0'
    WHEN EXISTS (
      SELECT 1 FROM macro_checkpoints mc
      INNER JOIN casdm_config cc ON cc.phase = mc.phase
        AND cc.item_name = mc.checkpoint_name
        AND cc.config_type = 'macro_checkpoint'
        AND cc.is_mandatory = true AND cc.is_active = true
        AND cc.project_type = COALESCE(p.project_type, 'default')
      WHERE mc.project_id = p.jira_key AND mc.phase = 'Phase 1'
        AND mc.reached_at IS NULL
    ) THEN 'Phase 1'
    WHEN EXISTS (
      SELECT 1 FROM macro_checkpoints mc
      INNER JOIN casdm_config cc ON cc.phase = mc.phase
        AND cc.item_name = mc.checkpoint_name
        AND cc.config_type = 'macro_checkpoint'
        AND cc.is_mandatory = true AND cc.is_active = true
        AND cc.project_type = COALESCE(p.project_type, 'default')
      WHERE mc.project_id = p.jira_key AND mc.phase = 'Phase 2'
        AND mc.reached_at IS NULL
    ) THEN 'Phase 2'
    WHEN EXISTS (
      SELECT 1 FROM macro_checkpoints mc
      INNER JOIN casdm_config cc ON cc.phase = mc.phase
        AND cc.item_name = mc.checkpoint_name
        AND cc.config_type = 'macro_checkpoint'
        AND cc.is_mandatory = true AND cc.is_active = true
        AND cc.project_type = COALESCE(p.project_type, 'default')
      WHERE mc.project_id = p.jira_key AND mc.phase = 'Phase 3'
        AND mc.reached_at IS NULL
    ) THEN 'Phase 3'
    ELSE 'Phase 4'
  END AS current_phase
`;

async function updateProject(
  projectId: string,
  input: UpdateProjectInput,
  auth: AuthContext,
): Promise<Project> {
  const pool = await getPool();

  // Check if project exists and get current state
  const existing = await pool.query(
    `SELECT project_type, project_manager FROM projects WHERE jira_key = $1`,
    [projectId],
  );

  if (existing.rows.length === 0) {
    throw new NotFoundError('Project', projectId);
  }

  const current = existing.rows[0];

  // Check immutable field: project_type
  if (input.project_type !== undefined && input.project_type !== current.project_type) {
    throw new AppError(
      'IMMUTABLE_FIELD',
      'project_type cannot be changed after creation',
      422,
    );
  }

  // Check PM permission: PM can only update their own projects
  if (auth.role === 'pm' && current.project_manager !== auth.email) {
    throw new ForbiddenError(`PM can only update their own projects`);
  }

  // Build update query
  const updates: string[] = [];
  const params: any[] = [];
  let paramIndex = 1;

  if (input.title !== undefined) {
    updates.push(`title = $${paramIndex++}`);
    params.push(input.title);
  }

  if (input.description !== undefined) {
    updates.push(`description = $${paramIndex++}`);
    params.push(input.description);
  }

  if (input.status !== undefined) {
    // Leadership-only gate: can only reopen (Active) from Closed if leadership/admin
    if (input.status === 'Active' && current.status === 'Closed') {
      if (!['leadership', 'admin'].includes(auth.role)) {
        throw new ForbiddenError('Only leadership/admin can reopen a closed project');
      }
    }
    updates.push(`status = $${paramIndex++}`);
    params.push(input.status);
  }

  if (input.project_manager !== undefined) {
    updates.push(`project_manager = $${paramIndex++}`);
    params.push(input.project_manager);
  }

  if (input.solution_architect !== undefined) {
    updates.push(`solution_architect = $${paramIndex++}`);
    params.push(input.solution_architect);
  }

  if (input.account_executive !== undefined) {
    updates.push(`account_executive = $${paramIndex++}`);
    params.push(input.account_executive);
  }

  if (input.engineers_assigned !== undefined) {
    updates.push(`engineers_assigned = $${paramIndex++}`);
    params.push(input.engineers_assigned);
  }

  if (input.planned_kickoff_date !== undefined) {
    updates.push(`planned_kickoff_date = $${paramIndex++}`);
    params.push(input.planned_kickoff_date);
  }

  if (input.expected_completion_date !== undefined) {
    updates.push(`expected_completion_date = $${paramIndex++}`);
    params.push(input.expected_completion_date);
  }

  if (input.sow_hours !== undefined) {
    updates.push(`sow_hours = $${paramIndex++}`);
    params.push(input.sow_hours);
  }

  if (updates.length === 0) {
    // No updates - just return current project
    const result = await pool.query(
      `SELECT
        p.id, p.jira_key, p.jira_id, p.jira_link, p.title, p.description,
        p.project_type, p.status, p.account_executive, p.solution_architect,
        p.project_manager, p.engineers_assigned, p.planned_kickoff_date,
        p.expected_completion_date, p.resource_assignment_date, p.sow_hours,
        p.hours_consumed, p.sow_link, cp.current_phase, p.created_at
      FROM projects p
      CROSS JOIN LATERAL (
        SELECT ${CURRENT_PHASE_SQL.replace(/p\./g, 'p.')}
      ) cp
      WHERE p.jira_key = $1`,
      [projectId],
    );

    if (result.rows.length === 0) {
      throw new NotFoundError('Project', projectId);
    }

    return result.rows[0];
  }

  // Execute update
  params.push(projectId);
  const sql = `
    UPDATE projects SET ${updates.join(', ')}
    WHERE jira_key = $${paramIndex}
    RETURNING *
  `;

  const updateResult = await pool.query(sql, params);

  if (updateResult.rows.length === 0) {
    throw new NotFoundError('Project', projectId);
  }

  // Fetch updated project with current_phase
  const result = await pool.query(
    `SELECT
      p.id, p.jira_key, p.jira_id, p.jira_link, p.title, p.description,
      p.project_type, p.status, p.account_executive, p.solution_architect,
      p.project_manager, p.engineers_assigned, p.planned_kickoff_date,
      p.expected_completion_date, p.resource_assignment_date, p.sow_hours,
      p.hours_consumed, p.sow_link, cp.current_phase, p.created_at
    FROM projects p
    CROSS JOIN LATERAL (
      SELECT ${CURRENT_PHASE_SQL.replace(/p\./g, 'p.')}
    ) cp
    WHERE p.jira_key = $1`,
    [projectId],
  );

  return result.rows[0];
}

export const handler = withRoles(['pm', 'leadership', 'admin'], async (event: APIGatewayProxyEvent, context: any): Promise<APIGatewayProxyResult> => {
  try {
    const projectId = event.pathParameters?.projectId;
    if (!projectId) {
      throw new Error('Missing projectId path parameter');
    }

    const body = event.body ? JSON.parse(event.body) : {};
    const input = UpdateProjectInputSchema.parse(body);

    const project = await updateProject(projectId, input, context.auth);

    return ok(project);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return handleError(new ValidationError('Invalid request body', {}));
    }
    return handleError(error);
  }
});
