"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.updatePromptHandler = exports.listPromptsHandler = void 0;
const auth_1 = require("@kiro-governance/shared/middleware/auth");
const error_handler_1 = require("@kiro-governance/shared/middleware/error-handler");
const validation_1 = require("../validation");
const config_service_1 = require("../services/config.service");
/**
 * GET /api/admin/prompts
 * List all analysis prompts
 * Auth: all roles can read
 * Source: docs/phase2/config-architecture.md §6.5
 */
const listPromptsHandler = async (event) => {
    try {
        // All roles can read prompts
        const auth = (0, auth_1.requireRole)(['pm', 'sa', 'engineer', 'leadership', 'admin'], event);
        const prompts = await (0, config_service_1.listPrompts)();
        return { statusCode: 200, body: JSON.stringify({ prompts }) };
    }
    catch (err) {
        return (0, error_handler_1.handleError)(err);
    }
};
exports.listPromptsHandler = listPromptsHandler;
/**
 * PATCH /api/admin/prompts/{checkpointName}
 * Update or create an analysis prompt
 * Uses INSERT ON CONFLICT DO UPDATE (upsert)
 * Auth: leadership/admin only
 * Source: docs/phase2/config-architecture.md §6.6
 */
const updatePromptHandler = async (event) => {
    try {
        const auth = (0, auth_1.requireRole)(['leadership', 'admin'], event);
        const checkpointName = decodeURIComponent(event.pathParameters?.checkpointName || '');
        if (!checkpointName) {
            return { statusCode: 400, body: JSON.stringify({ error: 'Checkpoint name is required' }) };
        }
        const input = JSON.parse(event.body || '{}');
        // Validate input
        validation_1.UpdatePromptSchema.parse(input);
        const prompt = await (0, config_service_1.updatePrompt)(checkpointName, input, auth.email || auth.sub);
        return { statusCode: 200, body: JSON.stringify({ prompt }) };
    }
    catch (err) {
        return (0, error_handler_1.handleError)(err);
    }
};
exports.updatePromptHandler = updatePromptHandler;
