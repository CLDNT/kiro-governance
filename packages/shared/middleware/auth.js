"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractAuthContext = extractAuthContext;
exports.extractAuthContextFromEvent = extractAuthContextFromEvent;
/**
 * Role mapping from cognito:groups to role enum.
 * First group in array is mapped to the primary role.
 * Unknown groups map to 'engineer' (least privileged default).
 */
const GROUP_TO_ROLE_MAP = {
    admin: 'admin',
    leadership: 'leadership',
    pm: 'pm',
    sa: 'sa',
    engineer: 'engineer',
};
/**
 * Extract and parse authentication context from API Gateway authorizer claims.
 *
 * Expects event.requestContext.authorizer.claims to contain:
 * - sub: Cognito user ID
 * - email: User email
 * - name: User name
 * - cognito:groups: Array or comma-separated string of group names
 *
 * @param claims - Authorizer claims from API Gateway event
 * @returns Parsed AuthContext
 * @throws Error if required claims are missing
 */
function extractAuthContext(claims) {
    const userId = claims.sub;
    const email = claims.email;
    const name = claims.name;
    if (!userId || !email || !name) {
        throw new Error('Missing required auth claims: sub, email, name');
    }
    // Parse cognito:groups — can be array or comma-separated string
    let groups = [];
    const groupsClaim = claims['cognito:groups'];
    if (Array.isArray(groupsClaim)) {
        groups = groupsClaim.map((g) => String(g));
    }
    else if (typeof groupsClaim === 'string') {
        groups = groupsClaim.split(',').map((g) => g.trim());
    }
    // Map first group to role, default to 'engineer' if no groups
    let role = 'engineer';
    if (groups.length > 0) {
        const firstGroup = groups[0].toLowerCase();
        role = (GROUP_TO_ROLE_MAP[firstGroup] || 'engineer');
    }
    return {
        userId,
        email,
        name,
        role,
        groups,
    };
}
/**
 * Extract AuthContext from Lambda event.
 *
 * @param event - API Gateway Lambda event with authorizer claims
 * @returns AuthContext or null if authorizer is missing
 */
function extractAuthContextFromEvent(event) {
    const claims = event.requestContext?.authorizer?.claims;
    if (!claims) {
        return null;
    }
    try {
        return extractAuthContext(claims);
    }
    catch (err) {
        console.error('[auth.middleware] Failed to extract auth context', {
            error: err instanceof Error ? err.message : String(err),
        });
        return null;
    }
}
