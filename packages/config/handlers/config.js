"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.updateConfigItemHandler = exports.createConfigItemHandler = exports.getConfigHandler = void 0;
const auth_1 = require("@kiro-governance/shared/middleware/auth");
const error_handler_1 = require("@kiro-governance/shared/middleware/error-handler");
const validation_1 = require("../validation");
const config_service_1 = require("../services/config.service");
/**
 * GET /api/admin/config?project_type={type}
 * Retrieve full CASDM template for a project type (all phases, gates, artifacts)
 * Auth: leadership/admin only
 * Source: docs/phase2/config-architecture.md §6.2
 */
const getConfigHandler = async (event) => {
    try {
        const auth = (0, auth_1.requireRole)(['leadership', 'admin'], event);
        const projectType = event.queryStringParameters?.project_type || 'default';
        const items = await (0, config_service_1.getTemplate)(projectType);
        // Organize by phase
        const phases = new Map();
        for (const item of items) {
            if (!phases.has(item.phase)) {
                phases.set(item.phase, {
                    phase: item.phase,
                    phase_name: item.phase_name,
                    phase_order: item.phase_order,
                    micro_artifacts: [],
                    macro_checkpoints: [],
                });
            }
            const phase = phases.get(item.phase);
            if (item.config_type === 'micro_artifact' && item.item_name) {
                phase.micro_artifacts.push({
                    id: item.id,
                    item_name: item.item_name,
                    item_order: item.item_order,
                    item_type: item.item_type,
                    is_mandatory: item.is_mandatory,
                    is_active: item.is_active,
                });
            }
            else if (item.config_type === 'macro_checkpoint' && item.item_name) {
                phase.macro_checkpoints.push({
                    id: item.id,
                    item_name: item.item_name,
                    item_order: item.item_order,
                    item_type: item.item_type,
                    is_mandatory: item.is_mandatory,
                    is_active: item.is_active,
                });
            }
        }
        const response = {
            project_type: projectType,
            phases: Array.from(phases.values()),
        };
        return { statusCode: 200, body: JSON.stringify(response) };
    }
    catch (err) {
        return (0, error_handler_1.handleError)(err);
    }
};
exports.getConfigHandler = getConfigHandler;
/**
 * POST /api/admin/config/items
 * Create a new config item (phase, artifact, or checkpoint)
 * Auth: leadership/admin only
 * Source: docs/phase2/config-architecture.md §6.3
 */
const createConfigItemHandler = async (event) => {
    try {
        const auth = (0, auth_1.requireRole)(['leadership', 'admin'], event);
        const projectType = event.queryStringParameters?.project_type || 'default';
        const input = JSON.parse(event.body || '{}');
        // Validate input
        validation_1.CreateConfigItemSchema.parse(input);
        const item = await (0, config_service_1.createConfigItem)(projectType, input, auth.email || auth.sub);
        return { statusCode: 201, body: JSON.stringify({ item }) };
    }
    catch (err) {
        return (0, error_handler_1.handleError)(err);
    }
};
exports.createConfigItemHandler = createConfigItemHandler;
/**
 * PATCH /api/admin/config/items/{id}
 * Update a config item (rename, reorder, toggle active)
 * Auth: leadership/admin only
 * Source: docs/phase2/config-architecture.md §6.4
 */
const updateConfigItemHandler = async (event) => {
    try {
        const auth = (0, auth_1.requireRole)(['leadership', 'admin'], event);
        const projectType = event.queryStringParameters?.project_type || 'default';
        const id = parseInt(event.pathParameters?.id || '0', 10);
        const input = JSON.parse(event.body || '{}');
        if (!id) {
            return { statusCode: 400, body: JSON.stringify({ error: 'Invalid config item ID' }) };
        }
        // Validate input
        validation_1.UpdateConfigItemSchema.parse(input);
        const item = await (0, config_service_1.updateConfigItem)(projectType, id, input, auth.email || auth.sub);
        return { statusCode: 200, body: JSON.stringify({ item }) };
    }
    catch (err) {
        return (0, error_handler_1.handleError)(err);
    }
};
exports.updateConfigItemHandler = updateConfigItemHandler;
