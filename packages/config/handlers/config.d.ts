/**
 * DP-32: Config CRUD Handlers
 * GET /api/admin/config?project_type={type} — get template
 * POST /api/admin/config/items — create config item
 * PATCH /api/admin/config/items/{id} — update config item
 */
import { APIGatewayProxyHandler } from 'aws-lambda';
/**
 * GET /api/admin/config?project_type={type}
 * Retrieve full CASDM template for a project type (all phases, gates, artifacts)
 * Auth: leadership/admin only
 * Source: docs/phase2/config-architecture.md §6.2
 */
export declare const getConfigHandler: APIGatewayProxyHandler;
/**
 * POST /api/admin/config/items
 * Create a new config item (phase, artifact, or checkpoint)
 * Auth: leadership/admin only
 * Source: docs/phase2/config-architecture.md §6.3
 */
export declare const createConfigItemHandler: APIGatewayProxyHandler;
/**
 * PATCH /api/admin/config/items/{id}
 * Update a config item (rename, reorder, toggle active)
 * Auth: leadership/admin only
 * Source: docs/phase2/config-architecture.md §6.4
 */
export declare const updateConfigItemHandler: APIGatewayProxyHandler;
