/**
 * Config domain service layer
 * Handles CASDM template and analysis prompt operations
 * Source: docs/phase2/config-architecture.md §6
 */
import { query as runQuery } from '@kiro-governance/shared/db/pool';
import { AppError, ValidationError, NotFoundError } from '@kiro-governance/shared/middleware/error-handler';
import {
  CasdmConfigItem,
  AnalysisPrompt,
  CreateConfigItemInput,
  UpdateConfigItemInput,
  UpdatePromptInput,
  CopyTemplateInput,
  TemplateListResponse,
  TemplateTypeSummary,
  PromptListResponse,
} from '../types';

/**
 * Get configuration template for a specific project type
 * Falls back to 'default' if project type has no rows
 */
export async function getTemplate(projectType: string): Promise<CasdmConfigItem[]> {
  // Try specific project type first
  const { rows } = await runQuery(
    `SELECT * FROM casdm_config
     WHERE project_type = $1 AND is_active = true
     ORDER BY phase_order, item_order`,
    [projectType]
  );

  if (rows.length > 0) {
    return rows as CasdmConfigItem[];
  }

  // Fall back to 'default' template
  const { rows: defaultRows } = await runQuery(
    `SELECT * FROM casdm_config
     WHERE project_type = 'default' AND is_active = true
     ORDER BY phase_order, item_order`
  );

  if (defaultRows.length === 0) {
    throw new AppError('NO_CASDM_TEMPLATE', 'No CASDM template found for this project type', 422);
  }

  return defaultRows as CasdmConfigItem[];
}

/**
 * List all project types with their template statistics
 */
export async function listTemplates(): Promise<TemplateTypeSummary[]> {
  const { rows } = await runQuery(`
    SELECT
      project_type,
      COUNT(DISTINCT CASE WHEN config_type = 'phase' THEN phase END) AS phase_count,
      COUNT(*) FILTER (WHERE config_type = 'micro_artifact' AND is_active = true) AS micro_artifact_count,
      COUNT(*) FILTER (WHERE config_type = 'macro_checkpoint' AND is_active = true) AS macro_checkpoint_count,
      MAX(updated_at) AS last_updated
    FROM casdm_config
    WHERE is_active = true
    GROUP BY project_type
    ORDER BY project_type
  `);

  return rows as TemplateTypeSummary[];
}

/**
 * Create a new config item (phase, artifact, or checkpoint)
 */
export async function createConfigItem(
  projectType: string,
  input: CreateConfigItemInput,
  actor: string
): Promise<CasdmConfigItem> {
  // Validate macro checkpoint constraint: item_type required for macro_checkpoint
  if (input.config_type === 'macro_checkpoint' && !input.item_type) {
    throw new ValidationError('item_type is required for macro_checkpoint config_type');
  }

  // Auto-assign item_order if not provided
  let itemOrder = input.item_order;
  if (!itemOrder && (input.config_type === 'micro_artifact' || input.config_type === 'macro_checkpoint')) {
    const { rows } = await runQuery(
      `SELECT COALESCE(MAX(item_order), 0) + 1 AS next_order
       FROM casdm_config
       WHERE project_type = $1 AND phase = $2 AND config_type = $3`,
      [projectType, input.phase, input.config_type]
    );
    itemOrder = rows[0]?.next_order || 1;
  }

  const isActive = true;
  const isMandatory = input.is_mandatory ?? true;

  try {
    const { rows } = await runQuery(
      `INSERT INTO casdm_config
       (config_type, phase, phase_name, phase_order, item_name, item_order, item_type, is_mandatory, project_type, changed_by, is_active, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, now())
       RETURNING *`,
      [
        input.config_type,
        input.phase,
        input.phase_name,
        input.phase_order,
        input.item_name ?? null,
        itemOrder ?? null,
        input.item_type ?? null,
        isMandatory,
        projectType,
        actor,
        isActive,
      ]
    );

    return rows[0] as CasdmConfigItem;
  } catch (err: any) {
    // Unique constraint: (phase, item_name, project_type, config_type)
    if (err.code === '23505') {
      throw new AppError('DUPLICATE_CONFIG_ITEM', 'This item already exists in this phase and project type', 409);
    }
    throw err;
  }
}

/**
 * Update a config item (rename, reorder, toggle active)
 */
export async function updateConfigItem(
  projectType: string,
  id: number,
  input: UpdateConfigItemInput,
  actor: string
): Promise<CasdmConfigItem> {
  // Verify at least one field is provided
  if (Object.keys(input).length === 0) {
    throw new ValidationError('At least one field must be provided for update');
  }

  try {
    // Build dynamic update query
    const updates: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    if (input.item_name !== undefined) {
      updates.push(`item_name = $${paramIndex++}`);
      values.push(input.item_name);
    }
    if (input.phase_name !== undefined) {
      updates.push(`phase_name = $${paramIndex++}`);
      values.push(input.phase_name);
    }
    if (input.item_order !== undefined) {
      updates.push(`item_order = $${paramIndex++}`);
      values.push(input.item_order);
    }
    if (input.phase_order !== undefined) {
      updates.push(`phase_order = $${paramIndex++}`);
      values.push(input.phase_order);
    }
    if (input.is_active !== undefined) {
      updates.push(`is_active = $${paramIndex++}`);
      values.push(input.is_active);
    }
    if (input.is_mandatory !== undefined) {
      updates.push(`is_mandatory = $${paramIndex++}`);
      values.push(input.is_mandatory);
    }

    updates.push(`changed_by = $${paramIndex++}`);
    values.push(actor);

    updates.push(`updated_at = now()`);

    values.push(id);
    values.push(projectType);

    const query = `
      UPDATE casdm_config
      SET ${updates.join(', ')}
      WHERE id = $${paramIndex++} AND project_type = $${paramIndex++}
      RETURNING *
    `;

    const { rows } = await runQuery(query, values);

    if (rows.length === 0) {
      throw new NotFoundError('ConfigItem', `${id}`);
    }

    return rows[0] as CasdmConfigItem;
  } catch (err: any) {
    if (err.code === '23505') {
      throw new AppError('DUPLICATE_CONFIG_ITEM', 'This item name already exists in this phase', 409);
    }
    throw err;
  }
}

/**
 * List all analysis prompts
 */
export async function listPrompts(): Promise<AnalysisPrompt[]> {
  const { rows } = await runQuery(
    `SELECT id, checkpoint_name, prompt_text, updated_by, updated_at, created_at
     FROM analysis_prompts
     ORDER BY checkpoint_name`
  );

  return rows as AnalysisPrompt[];
}

/**
 * Update an analysis prompt (upsert)
 * Uses INSERT ON CONFLICT DO UPDATE
 */
export async function updatePrompt(
  checkpointName: string,
  input: UpdatePromptInput,
  actor: string
): Promise<AnalysisPrompt> {
  const { rows } = await runQuery(
    `INSERT INTO analysis_prompts (checkpoint_name, prompt_text, updated_by, updated_at, created_at)
     VALUES ($1, $2, $3, now(), now())
     ON CONFLICT (checkpoint_name) DO UPDATE SET
       prompt_text = EXCLUDED.prompt_text,
       updated_by = EXCLUDED.updated_by,
       updated_at = now()
     RETURNING *`,
    [checkpointName, input.prompt_text, actor]
  );

  return rows[0] as AnalysisPrompt;
}

/**
 * Get list of all distinct project types
 */
export async function listProjectTypes(): Promise<string[]> {
  const { rows } = await runQuery(
    `SELECT DISTINCT project_type FROM casdm_config ORDER BY project_type`
  );

  return rows.map((r: any) => r.project_type);
}

/**
 * Copy all casdm_config rows from source to target project type
 * Returns 409 if target already has rows
 */
export async function copyTemplate(input: CopyTemplateInput, actor: string): Promise<number> {
  const { source_project_type, target_project_type } = input;

  // Check if target already has rows
  const { rows: targetCheck } = await runQuery(
    `SELECT COUNT(*) as count FROM casdm_config WHERE project_type = $1`,
    [target_project_type]
  );

  if (targetCheck[0].count > 0) {
    throw new AppError('TEMPLATE_ALREADY_EXISTS', `Target project type '${target_project_type}' already has configuration rows`, 409);
  }

  // Copy all rows from source to target
  const { rows } = await runQuery(
    `INSERT INTO casdm_config
     (config_type, phase, phase_name, phase_order, item_name, item_order, item_type, is_mandatory, is_active, project_type, changed_by, created_at, updated_at)
     SELECT config_type, phase, phase_name, phase_order, item_name, item_order, item_type, is_mandatory, is_active, $2, $3, now(), now()
     FROM casdm_config
     WHERE project_type = $1
     RETURNING 1`,
    [source_project_type, target_project_type, actor]
  );

  return rows.length;
}
