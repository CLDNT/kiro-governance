"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.copyTemplateHandler = exports.listProjectTypesHandler = void 0;
const auth_1 = require("@kiro-governance/shared/middleware/auth");
const error_handler_1 = require("@kiro-governance/shared/middleware/error-handler");
const validation_1 = require("../validation");
const config_service_1 = require("../services/config.service");
/**
 * GET /api/admin/config/project-types
 * List all project types in the system
 * Auth: all roles can read
 * Source: docs/phase2/config-architecture.md §6 (per task)
 */
const listProjectTypesHandler = async (event) => {
    try {
        // All roles can read project types
        const auth = (0, auth_1.requireRole)(['pm', 'sa', 'engineer', 'leadership', 'admin'], event);
        const projectTypes = await (0, config_service_1.listProjectTypes)();
        return { statusCode: 200, body: JSON.stringify({ project_types: projectTypes }) };
    }
    catch (err) {
        return (0, error_handler_1.handleError)(err);
    }
};
exports.listProjectTypesHandler = listProjectTypesHandler;
/**
 * POST /api/admin/config/copy-template
 * Copy all casdm_config rows from source to target project type
 * Returns 409 if target already has rows
 * Auth: leadership/admin only
 * Source: docs/phase2/config-architecture.md §6 (per task)
 */
const copyTemplateHandler = async (event) => {
    try {
        const auth = (0, auth_1.requireRole)(['leadership', 'admin'], event);
        const input = JSON.parse(event.body || '{}');
        // Validate input
        validation_1.CopyTemplateSchema.parse(input);
        const rowsCopied = await (0, config_service_1.copyTemplate)(input, auth.email || auth.sub);
        return {
            statusCode: 201,
            body: JSON.stringify({
                rows_copied: rowsCopied,
                target_project_type: input.target_project_type,
            }),
        };
    }
    catch (err) {
        return (0, error_handler_1.handleError)(err);
    }
};
exports.copyTemplateHandler = copyTemplateHandler;
