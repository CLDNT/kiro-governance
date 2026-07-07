/**
 * GET /api/projects/{projectId}
 * Get project detail with computed current_phase and burn_rate_pct.
 * See specs/api/projects.yaml for API documentation.
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { withRoles } from '@kiro-governance/shared/middleware/rbac';
import { ok, handleError, NotFoundError } from '@kiro-governance/shared/middleware/error-handler';
import { getPool } from '@kiro-governance/shared/db/pool';
import { AuthContext } from '@kiro-governance/shared/types/auth';
import { Project } from '../types';

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

async function getProject(projectId: string, _auth: AuthContext): Promise<Project> {
  const pool = await getPool();

  const sql = `
    SELECT
      p.id,
      p.jira_key,
      p.jira_id,
      p.jira_link,
      p.title,
      p.description,
      p.project_type,
      p.status,
      p.account_executive,
      p.solution_architect,
      p.project_manager,
      p.engineers_assigned,
      p.planned_kickoff_date,
      p.expected_completion_date,
      p.resource_assignment_date,
      p.sow_hours,
      p.hours_consumed,
      p.sow_link,
      p.github_repo,
      p.github_url,
      p.slack_micro_channel_id,
      p.slack_macro_channel_id,
      p.updated_by,
      p.updated_at,
      cp.current_phase,
      p.created_at
    FROM projects p
    CROSS JOIN LATERAL (
      SELECT ${CURRENT_PHASE_SQL.replace(/p\./g, 'p.')}
    ) cp
    WHERE p.jira_key = $1
  `;

  const result = await pool.query(sql, [projectId]);

  if (result.rows.length === 0) {
    throw new NotFoundError('Project', projectId);
  }

  const row = result.rows[0];
  const burn_rate_pct = row.sow_hours && row.sow_hours > 0 
    ? Math.round((row.hours_consumed / row.sow_hours) * 100 * 100) / 100
    : null;

  return {
    id: row.id,
    jira_key: row.jira_key,
    jira_id: row.jira_id,
    jira_link: row.jira_link,
    title: row.title,
    description: row.description,
    project_type: row.project_type,
    status: row.status,
    account_executive: row.account_executive,
    solution_architect: row.solution_architect,
    project_manager: row.project_manager,
    engineers_assigned: row.engineers_assigned,
    planned_kickoff_date: row.planned_kickoff_date,
    expected_completion_date: row.expected_completion_date,
    resource_assignment_date: row.resource_assignment_date,
    sow_hours: row.sow_hours,
    hours_consumed: row.hours_consumed,
    sow_link: row.sow_link,
    current_phase: row.current_phase,
    created_at: row.created_at,
    github_repo: row.github_repo,
    github_url: row.github_url,
    slack_micro_channel_id: row.slack_micro_channel_id,
    slack_macro_channel_id: row.slack_macro_channel_id,
    updated_by: row.updated_by,
    updated_at: row.updated_at,
  };
}

export const handler = withRoles(['pm', 'sa', 'engineer', 'leadership', 'admin'], async (event: APIGatewayProxyEvent, context: any): Promise<APIGatewayProxyResult> => {
  try {
    const projectId = event.pathParameters?.projectId;
    if (!projectId) {
      throw new Error('Missing projectId path parameter');
    }

    const project = await getProject(projectId, context.auth);

    return ok(project);
  } catch (error) {
    return handleError(error);
  }
});
