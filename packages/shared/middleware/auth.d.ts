import { AuthContext } from '../types/auth';
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
export declare function extractAuthContext(claims: Record<string, unknown>): AuthContext;
/**
 * Extract AuthContext from Lambda event.
 *
 * @param event - API Gateway Lambda event with authorizer claims
 * @returns AuthContext or null if authorizer is missing
 */
export declare function extractAuthContextFromEvent(event: any): AuthContext | null;
