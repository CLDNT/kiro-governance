"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getTemplate = getTemplate;
exports.listTemplates = listTemplates;
exports.createConfigItem = createConfigItem;
exports.updateConfigItem = updateConfigItem;
exports.listPrompts = listPrompts;
exports.updatePrompt = updatePrompt;
exports.listProjectTypes = listProjectTypes;
exports.copyTemplate = copyTemplate;
/**
 * Config domain service layer
 * Handles CASDM template and analysis prompt operations
 * Source: docs/phase2/config-architecture.md §6
 */
const pool_1 = require("@kiro-governance/shared/db/pool");
const error_handler_1 = require("@kiro-governance/shared/middleware/error-handler");
/**
 * Get configuration template for a specific project type
 * Falls back to 'default' if project type has no rows
 */
async function getTemplate(projectType) {
    // Try specific project type first
    const { rows } = await pool_1.pool.query(`SELECT * FROM casdm_config
     WHERE project_type = $1 AND is_active = true
     ORDER BY phase_order, item_order`, [projectType]);
    if (rows.length > 0) {
        return rows;
    }
    // Fall back to 'default' template
    const { rows: defaultRows } = await pool_1.pool.query(`SELECT * FROM casdm_config
     WHERE project_type = 'default' AND is_active = true
     ORDER BY phase_order, item_order`);
    if (defaultRows.length === 0) {
        throw new error_handler_1.AppError('NO_CASDM_TEMPLATE', 'No CASDM template found for this project type', 422);
    }
    return defaultRows;
}
/**
 * List all project types with their template statistics
 */
async function listTemplates() {
    const { rows } = await pool_1.pool.query(`
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
    return rows;
}
/**
 * Create a new config item (phase, artifact, or checkpoint)
 */
async function createConfigItem(projectType, input, actor) {
    // Validate macro checkpoint constraint: item_type required for macro_checkpoint
    if (input.config_type === 'macro_checkpoint' && !input.item_type) {
        throw new error_handler_1.ValidationError('item_type is required for macro_checkpoint config_type');
    }
    // Auto-assign item_order if not provided
    let itemOrder = input.item_order;
    if (!itemOrder && (input.config_type === 'micro_artifact' || input.config_type === 'macro_checkpoint')) {
        const { rows } = await pool_1.pool.query(`SELECT COALESCE(MAX(item_order), 0) + 1 AS next_order
       FROM casdm_config
       WHERE project_type = $1 AND phase = $2 AND config_type = $3`, [projectType, input.phase, input.config_type]);
        itemOrder = rows[0]?.next_order || 1;
    }
    const isActive = true;
    const isMandatory = input.is_mandatory ?? true;
    try {
        const { rows } = await pool_1.pool.query(`INSERT INTO casdm_config
       (config_type, phase, phase_name, phase_order, item_name, item_order, item_type, is_mandatory, project_type, changed_by, is_active, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, now())
       RETURNING *`, [
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
        ]);
        return rows[0];
    }
    catch (err) {
        // Unique constraint: (phase, item_name, project_type, config_type)
        if (err.code === '23505') {
            throw new error_handler_1.AppError('DUPLICATE_CONFIG_ITEM', 'This item already exists in this phase and project type', 409);
        }
        throw err;
    }
}
/**
 * Update a config item (rename, reorder, toggle active)
 */
async function updateConfigItem(projectType, id, input, actor) {
    // Verify at least one field is provided
    if (Object.keys(input).length === 0) {
        throw new error_handler_1.ValidationError('At least one field must be provided for update');
    }
    try {
        // Build dynamic update query
        const updates = [];
        const values = [];
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
        const { rows } = await pool_1.pool.query(query, values);
        if (rows.length === 0) {
            throw new error_handler_1.NotFoundError('ConfigItem', `${id}`);
        }
        return rows[0];
    }
    catch (err) {
        if (err.code === '23505') {
            throw new error_handler_1.AppError('DUPLICATE_CONFIG_ITEM', 'This item name already exists in this phase', 409);
        }
        throw err;
    }
}
/**
 * List all analysis prompts
 */
async function listPrompts() {
    const { rows } = await pool_1.pool.query(`SELECT id, checkpoint_name, prompt_text, updated_by, updated_at, created_at
     FROM analysis_prompts
     ORDER BY checkpoint_name`);
    return rows;
}
/**
 * Update an analysis prompt (upsert)
 * Uses INSERT ON CONFLICT DO UPDATE
 */
async function updatePrompt(checkpointName, input, actor) {
    const { rows } = await pool_1.pool.query(`INSERT INTO analysis_prompts (checkpoint_name, prompt_text, updated_by, updated_at, created_at)
     VALUES ($1, $2, $3, now(), now())
     ON CONFLICT (checkpoint_name) DO UPDATE SET
       prompt_text = EXCLUDED.prompt_text,
       updated_by = EXCLUDED.updated_by,
       updated_at = now()
     RETURNING *`, [checkpointName, input.prompt_text, actor]);
    return rows[0];
}
/**
 * Get list of all distinct project types
 */
async function listProjectTypes() {
    const { rows } = await pool_1.pool.query(`SELECT DISTINCT project_type FROM casdm_config ORDER BY project_type`);
    return rows.map((r) => r.project_type);
}
/**
 * Copy all casdm_config rows from source to target project type
 * Returns 409 if target already has rows
 */
async function copyTemplate(input, actor) {
    const { source_project_type, target_project_type } = input;
    // Check if target already has rows
    const { rows: targetCheck } = await pool_1.pool.query(`SELECT COUNT(*) as count FROM casdm_config WHERE project_type = $1`, [target_project_type]);
    if (targetCheck[0].count > 0) {
        throw new error_handler_1.AppError('TEMPLATE_ALREADY_EXISTS', `Target project type '${target_project_type}' already has configuration rows`, 409);
    }
    // Copy all rows from source to target
    const { rows } = await pool_1.pool.query(`INSERT INTO casdm_config
     (config_type, phase, phase_name, phase_order, item_name, item_order, item_type, is_mandatory, is_active, project_type, changed_by, created_at, updated_at)
     SELECT config_type, phase, phase_name, phase_order, item_name, item_order, item_type, is_mandatory, is_active, $2, $3, now(), now()
     FROM casdm_config
     WHERE project_type = $1
     RETURNING 1`, [source_project_type, target_project_type, actor]);
    return rows.length;
}
