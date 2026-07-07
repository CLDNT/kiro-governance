/**
 * GET /api/projects
 * List projects with filters and cursor-based pagination.
 * See specs/api/projects.yaml for API documentation.
 */

import { APIGatewayProxyEvent } from 'aws-lambda';
import { z } from 'zod';
import { withRoles } from '@kiro-governance/shared/middleware/rbac';
import { ok, handleError, ValidationError } from '@kiro-governance/shared/middleware/error-handler';
import { getPool } from '@kiro-governance/shared/db/pool';
import { AuthContext } from '@kiro-governance/shared/types/auth';
import { ProjectListResponse, ProjectSummary } from '../types';

const ListProjectsQuerySchema = z.object({
  status: z.string().optional(),
  phase: z.string().optional(),
  pm: z.string().optional(),
  sa: z.string().optional(),
  type: z.string().optional(),
  search: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50).optional(),
  cursor: z.string().optional(),
});

type ListProjectsQuery = z.infer<typeof ListProjectsQuerySchema>;

/**
 * Compute current_phase for a project using EXISTS logic.
 * Returns the first phase (in order) where NOT EXISTS a mandatory incomplete checkpoint.
 */
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

async function listProjects(
  query: ListProjectsQuery,
  _auth: AuthContext,
): Promise<ProjectListResponse> {
  const pool = await getPool();

  const limit = query.limit ?? 50;
  const offset = query.cursor ? parseInt(Buffer.from(query.cursor, 'base64').toString(), 10) : 0;

  // Build WHERE clauses
  const whereConditions: string[] = [];
  const params: any[] = [];

  // Default filter: exclude Closed and TEMPLATE projects
  if (!query.status) {
    whereConditions.push(`status NOT IN ('Closed', 'TEMPLATE')`);
  } else {
    whereConditions.push(`status = $${params.length + 1}`);
    params.push(query.status);
  }

  if (query.phase) {
    // Note: phase is computed, so we filter after the CTE
    // We'll handle this differently below
  }

  if (query.pm) {
    whereConditions.push(`project_manager = $${params.length + 1}`);
    params.push(query.pm);
  }

  if (query.sa) {
    whereConditions.push(`solution_architect = $${params.length + 1}`);
    params.push(query.sa);
  }

  if (query.type) {
    whereConditions.push(`project_type = $${params.length + 1}`);
    params.push(query.type);
  }

  if (query.search) {
    whereConditions.push(
      `(title ILIKE $${params.length + 1} OR jira_key ILIKE $${params.length + 1})`,
    );
    params.push(`%${query.search}%`);
  }

  const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';

  // Total count query
  const countQuery = `SELECT COUNT(*) as count FROM projects ${whereClause}`;
  const countResult = await pool.query(countQuery, params);
  const totalCount = parseInt(countResult.rows[0].count, 10);

  // Main query with current_phase LATERAL join
  const sql = `
    SELECT
      p.id,
      p.jira_key,
      p.title,
      p.project_type,
      p.status,
      p.project_manager,
      p.solution_architect,
      cp.current_phase,
      p.sow_hours,
      p.hours_consumed,
      CASE
        WHEN p.sow_hours > 0 THEN ROUND((p.hours_consumed / p.sow_hours) * 100, 2)
        ELSE NULL
      END as burn_rate_pct,
      p.planned_kickoff_date,
      p.expected_completion_date
    FROM projects p
    CROSS JOIN LATERAL (
      SELECT ${CURRENT_PHASE_SQL.replace(/p\./g, 'p.')}
    ) cp
    ${whereClause}
    ORDER BY p.id DESC
    LIMIT $${params.length + 1} OFFSET $${params.length + 2}
  `;

  params.push(limit + 1, offset); // fetch one extra to determine if there's a next page

  const result = await pool.query(sql, params);
  const rows = result.rows;

  const projects: ProjectSummary[] = rows.slice(0, limit).map((row: any) => ({
    id: row.id,
    jira_key: row.jira_key,
    title: row.title,
    project_type: row.project_type,
    status: row.status,
    project_manager: row.project_manager,
    solution_architect: row.solution_architect,
    current_phase: row.current_phase,
    sow_hours: row.sow_hours,
    hours_consumed: row.hours_consumed,
    burn_rate_pct: row.burn_rate_pct,
    planned_kickoff_date: row.planned_kickoff_date,
    expected_completion_date: row.expected_completion_date,
  }));

  const hasMore = rows.length > limit;
  const nextCursor = hasMore ? Buffer.from((offset + limit).toString()).toString('base64') : null;

  return {
    projects,
    next_cursor: nextCursor,
    total_count: totalCount,
  };
}

export const handler = withRoles(['pm', 'sa', 'engineer', 'leadership', 'admin'], async (event: APIGatewayProxyEvent, context: any) => {
  try {
    // Parse query parameters
    const query = ListProjectsQuerySchema.parse(event.queryStringParameters || {});

    const result = await listProjects(query, context.auth);

    return ok(result);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return handleError(new ValidationError('Invalid query parameters', {}));
    }
    return handleError(error);
  }
});
