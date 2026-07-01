/**
 * DP-34: Project Type Template Handlers
 * GET /api/admin/config/project-types — list all project types
 * POST /api/admin/config/copy-template — copy template from source to target
 */
import { APIGatewayProxyHandler } from 'aws-lambda';
/**
 * GET /api/admin/config/project-types
 * List all project types in the system
 * Auth: all roles can read
 * Source: docs/phase2/config-architecture.md §6 (per task)
 */
export declare const listProjectTypesHandler: APIGatewayProxyHandler;
/**
 * POST /api/admin/config/copy-template
 * Copy all casdm_config rows from source to target project type
 * Returns 409 if target already has rows
 * Auth: leadership/admin only
 * Source: docs/phase2/config-architecture.md §6 (per task)
 */
export declare const copyTemplateHandler: APIGatewayProxyHandler;
