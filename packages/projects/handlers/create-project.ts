/**
 * POST /api/projects
 * Create a new project with CASDM template seeding.
 * See specs/api/projects.yaml for API documentation.
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { z } from 'zod';
import { withRoles } from '@kiro-governance/shared/middleware/rbac';
import { ok, handleError, AppError, zodToValidationError } from '@kiro-governance/shared/middleware/error-handler';
import { getPool } from '@kiro-governance/shared/db/pool';
import { AuthContext } from '@kiro-governance/shared/types/auth';
import { CreateProjectInput, CreateProjectResponse, Project } from '../types';
import { assertLinkageAuthz, assertNoCrossColumnCollision, mapPgUniqueViolation } from '../services/linkage.service';
import { triggerLinkTimeSync } from '../services/gate-sync.service';
// CR-12 T1: Level-2 micro-artifact reconcile is a gates-domain concern (gates owns micro_artifacts,
// the sync-artifacts endpoint, and the reconcile service). Imported via the gates package PUBLIC
// entry (@kiro-governance/gates) — never a cross-domain relative path — per code-structure §2.
// Best-effort, always-resolving trigger, mirroring the CR-16 macro triggerLinkTimeSync above; it
// never throws, so it cannot fail the create.
import { triggerMicroArtifactReconcile } from '@kiro-governance/gates';

const GITHUB_REPO_RE = /^[A-Za-z0-9._-]{1,100}$/;
const GITHUB_URL_RE = /^https:\/\/github\.com\/[A-Za-z0-9._/-]{1,200}$/;
const SLACK_CHANNEL_RE = /^[A-Za-z0-9]{1,64}$/; // non-secret channel id shape; never a token/webhook

const CreateProjectInputSchema = z.object({
  title: z.string().min(1).max(255),
  project_type: z.string().default('AppDev'),
  project_manager: z.string(),
  solution_architect: z.string(),
  account_executive: z.string().optional(),
  engineers_assigned: z.string().optional(),
  sow_hours: z.number().positive().optional(),
  planned_kickoff_date: z.string().optional(),
  expected_completion_date: z.string().optional(),
  description: z.string().optional(),
  github_repo: z.string().regex(GITHUB_REPO_RE, 'github_repo must match ^[A-Za-z0-9._-]{1,100}$').optional(),
  github_url: z.string().regex(GITHUB_URL_RE, 'github_url must be an https://github.com/… URL').optional(),
  slack_micro_channel_id: z.string().regex(SLACK_CHANNEL_RE, 'slack_micro_channel_id must match ^[A-Za-z0-9]{1,64}$').optional(),
  slack_macro_channel_id: z.string().regex(SLACK_CHANNEL_RE, 'slack_macro_channel_id must match ^[A-Za-z0-9]{1,64}$').optional(),
});

async function createProject(
  input: CreateProjectInput,
  auth: AuthContext,
): Promise<CreateProjectResponse> {
  // §5 authz: only admin/leadership may create an already-linked project.
  // Runs before any DB work so a non-privileged linkage attempt is a clean 403.
  assertLinkageAuthz(input, auth);

  const pool = await getPool();

  // Set updated_by iff any linkage field is present so the AFTER INSERT audit
  // trigger attributes actor_sub to the Cognito sub (not 'db_direct').
  const linkagePresent =
    input.github_repo != null ||
    input.github_url != null ||
    input.slack_micro_channel_id != null ||
    input.slack_macro_channel_id != null;

  // Use a transaction to atomically create project + seed templates
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // SEC-M4 cross-column collision guard (repo == another project's jira_key)
    if (input.github_repo != null) {
      await assertNoCrossColumnCollision(client, input.github_repo);
    }

    // Generate next jira_key
    const keyResult = await client.query(
      `SELECT 'DP-' || LPAD((COALESCE(MAX(
        CAST(SUBSTRING(jira_key FROM 4) AS INTEGER)
      ), 0) + 1)::TEXT, 3, '0') AS next_key
      FROM projects WHERE jira_key LIKE 'DP-%'`,
    );
    const jiraKey = keyResult.rows[0]?.next_key || 'DP-001';

    // Insert project
    let projectResult;
    try {
      projectResult = await client.query(
        `INSERT INTO projects (
        jira_key, title, description, project_type, status,
        project_manager, solution_architect, account_executive,
        engineers_assigned, sow_hours, planned_kickoff_date,
        expected_completion_date,
        github_repo, github_url, slack_micro_channel_id, slack_macro_channel_id,
        updated_by
      ) VALUES ($1, $2, $3, $4, 'Active', $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
      RETURNING *`,
        [
          jiraKey,
          input.title,
          input.description || null,
          input.project_type,
          input.project_manager,
          input.solution_architect,
          input.account_executive || null,
          input.engineers_assigned || null,
          input.sow_hours || null,
          input.planned_kickoff_date || null,
          input.expected_completion_date || null,
          input.github_repo ?? null,
          input.github_url ?? null,
          input.slack_micro_channel_id ?? null,
          input.slack_macro_channel_id ?? null,
          linkagePresent ? auth.userId : null,
        ],
      );
    } catch (err) {
      // Map unique violation → 409. The outer catch performs the single ROLLBACK.
      mapPgUniqueViolation(err);
    }

    const projectRow = projectResult.rows[0];

    // Seed CASDM templates
    let templateRows = await client.query(
      `SELECT * FROM casdm_config
       WHERE project_type = $1 AND is_active = true
       ORDER BY phase_order, item_order`,
      [input.project_type],
    );

    // Fallback to 'default' if no rows found
    if (templateRows.rows.length === 0) {
      const fallback = await client.query(
        `SELECT * FROM casdm_config
         WHERE project_type = 'default' AND is_active = true
         ORDER BY phase_order, item_order`,
      );
      templateRows = fallback;
    }

    if (templateRows.rows.length === 0) {
      await client.query('ROLLBACK');
      throw new AppError(
        'NO_CASDM_TEMPLATE',
        `No CASDM template found for project_type '${input.project_type}' or 'default'`,
        422,
      );
    }

    const rows = templateRows.rows;
    const microRows = rows.filter((r: any) => r.config_type === 'micro_artifact');
    const macroRows = rows.filter((r: any) => r.config_type === 'macro_checkpoint');

    // Insert micro_artifacts
    for (const row of microRows) {
      await client.query(
        `INSERT INTO micro_artifacts (project_id, phase, phase_name, artifact_name)
         VALUES ($1, $2, $3, $4)`,
        [jiraKey, row.phase, row.phase_name, row.item_name],
      );
    }

    // Insert macro_checkpoints
    for (const row of macroRows) {
      await client.query(
        `INSERT INTO macro_checkpoints (project_id, phase, phase_name, checkpoint_name, checkpoint_type)
         VALUES ($1, $2, $3, $4, $5)`,
        [jiraKey, row.phase, row.phase_name, row.item_name, row.item_type],
      );
    }

    // Insert onboarding checklist items
    const ONBOARDING_ITEMS = [
      'Set up Slack/Teams channel',
      'Set up Clockify',
      'Assign resources via email',
      'Complete SOW handoff checklist',
      'Send customer intro email — Introduce team',
      'Send customer intro email — Schedule kickoff',
      'Send customer intro email — Share discovery agenda & questions',
      'Send customer intro email — Figure out account access',
      'Send customer intro email — Confirm communication channels',
    ];

    for (const itemName of ONBOARDING_ITEMS) {
      await client.query(
        `INSERT INTO onboarding_checklist_items (project_id, item_name)
         VALUES ($1, $2)`,
        [jiraKey, itemName],
      );
    }

    await client.query('COMMIT');

    const project: Project = {
      id: projectRow.id,
      jira_key: projectRow.jira_key,
      jira_id: projectRow.jira_id,
      jira_link: projectRow.jira_link,
      title: projectRow.title,
      description: projectRow.description,
      project_type: projectRow.project_type,
      status: projectRow.status,
      account_executive: projectRow.account_executive,
      solution_architect: projectRow.solution_architect,
      project_manager: projectRow.project_manager,
      engineers_assigned: projectRow.engineers_assigned,
      planned_kickoff_date: projectRow.planned_kickoff_date,
      expected_completion_date: projectRow.expected_completion_date,
      resource_assignment_date: projectRow.resource_assignment_date,
      sow_hours: projectRow.sow_hours,
      hours_consumed: projectRow.hours_consumed,
      sow_link: projectRow.sow_link,
      current_phase: 'Phase 0',
      created_at: projectRow.created_at,
      github_repo: projectRow.github_repo,
      github_url: projectRow.github_url,
      slack_micro_channel_id: projectRow.slack_micro_channel_id,
      slack_macro_channel_id: projectRow.slack_macro_channel_id,
      updated_by: projectRow.updated_by,
      updated_at: projectRow.updated_at,
    };

    return {
      project,
      seeded: {
        micro_artifacts: microRows.length,
        macro_checkpoints: macroRows.length,
        onboarding_items: ONBOARDING_ITEMS.length,
      },
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export const handler = withRoles(['pm', 'leadership', 'admin'], async (event: APIGatewayProxyEvent, context: any): Promise<APIGatewayProxyResult> => {
  try {
    const body = event.body ? JSON.parse(event.body) : {};
    const input = CreateProjectInputSchema.parse(body);

    const result = await createProject(input, context.auth);

    // CR-16 T1: best-effort link-time gate sync when the project was created already linked.
    // triggerLinkTimeSync always resolves (never throws), so awaiting it cannot fail the create;
    // awaiting (rather than fire-and-forget) avoids a post-response Lambda freeze dropping the
    // sync (CR16-L1). Runs after COMMIT — the project + seeded checkpoints already exist.
    if (input.github_repo) {
      await triggerLinkTimeSync(result.project.jira_key, context.auth.userId);
      // CR-12 T1: also reconcile Level-2 micro-artifacts from any pre-existing repo micro events.
      await triggerMicroArtifactReconcile(result.project.jira_key, context.auth.userId);
    }

    return ok(result, 201);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return handleError(zodToValidationError(error));
    }
    return handleError(error);
  }
});
