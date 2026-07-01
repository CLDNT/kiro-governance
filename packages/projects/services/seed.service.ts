/**
 * CASDM template seeding service.
 * Seeds micro_artifacts, macro_checkpoints, and onboarding_checklist_items
 * from casdm_config template rows.
 */

import { Pool, PoolClient } from 'pg';

export const ONBOARDING_CHECKLIST_ITEMS = [
  'Set up Slack/Teams channel',
  'Set up Clockify',
  'Assign resources via email',
  'Complete SOW handoff checklist',
  'Send customer intro email — Introduce team',
  'Send customer intro email — Schedule kickoff',
  'Send customer intro email — Share discovery agenda & questions',
  'Send customer intro email — Figure out account access',
  'Send customer intro email — Confirm communication channels',
] as const;

export interface SeedResult {
  micro_artifacts: number;
  macro_checkpoints: number;
  onboarding_items: number;
}

/**
 * Seed CASDM template for a new project.
 * Reads casdm_config rows matching the project_type, or falls back to 'default'.
 * Inserts micro_artifacts, macro_checkpoints, and onboarding_checklist_items.
 * 
 * @param tx - Database transaction handle
 * @param projectId - The jira_key of the new project
 * @param projectType - The project_type (e.g. 'AppDev', 'App Mod/Migration')
 * @returns Counts of each artifact type seeded
 * @throws AppError with code 'NO_CASDM_TEMPLATE' if no template found
 */
export async function seedCasdmTemplate(
  tx: PoolClient,
  projectId: string,
  projectType: string,
): Promise<SeedResult> {
  // Fetch template rows for the specified project_type
  let templateRows = await tx.query(
    `SELECT * FROM casdm_config
     WHERE project_type = $1 AND is_active = true
     ORDER BY phase_order, item_order`,
    [projectType],
  );

  // Fallback to 'default' if no rows found
  if (templateRows.rows.length === 0) {
    const fallback = await tx.query(
      `SELECT * FROM casdm_config
       WHERE project_type = 'default' AND is_active = true
       ORDER BY phase_order, item_order`,
      [],
    );
    templateRows = fallback;
  }

  if (templateRows.rows.length === 0) {
    const err = new Error(`NO_CASDM_TEMPLATE`);
    (err as any).code = 'NO_CASDM_TEMPLATE';
    (err as any).statusCode = 422;
    throw err;
  }

  const rows = templateRows.rows;

  // Separate micro_artifacts and macro_checkpoints
  const microRows = rows.filter((r: any) => r.config_type === 'micro_artifact');
  const macroRows = rows.filter((r: any) => r.config_type === 'macro_checkpoint');

  let microCount = 0;
  let macroCount = 0;

  // Insert micro_artifacts
  for (const row of microRows) {
    await tx.query(
      `INSERT INTO micro_artifacts (project_id, phase, phase_name, artifact_name)
       VALUES ($1, $2, $3, $4)`,
      [projectId, row.phase, row.phase_name, row.item_name],
    );
    microCount++;
  }

  // Insert macro_checkpoints
  for (const row of macroRows) {
    await tx.query(
      `INSERT INTO macro_checkpoints (project_id, phase, phase_name, checkpoint_name, checkpoint_type)
       VALUES ($1, $2, $3, $4, $5)`,
      [projectId, row.phase, row.phase_name, row.item_name, row.item_type],
    );
    macroCount++;
  }

  // Insert 9 onboarding checklist items
  for (const itemName of ONBOARDING_CHECKLIST_ITEMS) {
    await tx.query(
      `INSERT INTO onboarding_checklist_items (project_id, item_name)
       VALUES ($1, $2)`,
      [projectId, itemName],
    );
  }

  return {
    micro_artifacts: microCount,
    macro_checkpoints: macroCount,
    onboarding_items: ONBOARDING_CHECKLIST_ITEMS.length,
  };
}

/**
 * Generate the next available project key (DP-001, DP-002, etc).
 * Uses the existing pattern from the database.
 * 
 * @param tx - Database transaction handle
 * @returns The next key (e.g., 'DP-001')
 */
export async function generateProjectKey(tx: PoolClient): Promise<string> {
  const result = await tx.query(
    `SELECT 'DP-' || LPAD((COALESCE(MAX(
      CAST(SUBSTRING(jira_key FROM 4) AS INTEGER)
    ), 0) + 1)::TEXT, 3, '0') AS next_key
    FROM projects WHERE jira_key LIKE 'DP-%'`,
  );

  return result.rows[0]?.next_key || 'DP-001';
}
