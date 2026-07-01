import { APIGatewayProxyHandler, APIGatewayProxyEvent, Context, APIGatewayProxyResult } from 'aws-lambda';
import { AuthContext } from '../types/auth';
import { ForbiddenError, handleError } from './error-handler';
import { extractAuthContextFromEvent } from './auth';

/**
 * RBAC wrapper: enforces role-based access control on Lambda handlers.
 * 
 * Checks that the authenticated user's role is in the allowed list.
 * If not, returns 403 Forbidden.
 * 
 * Attaches AuthContext to handler context for use in business logic.
 * 
 * @param allowedRoles - Roles permitted to call this handler
 * @param handler - Lambda handler to wrap
 * @returns Wrapped handler that enforces RBAC
 */
export function withRoles(
  allowedRoles: AuthContext['role'][],
  handler: (
    event: any,
    context: Context & { auth: AuthContext },
  ) => Promise<APIGatewayProxyResult>,
): APIGatewayProxyHandler {
  return async (event: APIGatewayProxyEvent, context: Context): Promise<APIGatewayProxyResult> => {
    try {
      // Extract auth context from API Gateway authorizer
      const auth = extractAuthContextFromEvent(event);
      if (!auth) {
        return handleError(
          new ForbiddenError('Missing authentication context'),
        );
      }

      // Check if user role is allowed
      if (!allowedRoles.includes(auth.role)) {
        console.warn('[rbac.middleware] Role permission denied', {
          userId: auth.userId,
          userRole: auth.role,
          allowedRoles,
          method: event.httpMethod,
          path: event.path,
        });

        return handleError(
          new ForbiddenError(
            `Role '${auth.role}' is not permitted to access this resource`,
          ),
        );
      }

      // Attach auth context to context for handler to use
      const ctxWithAuth = context as any;
      ctxWithAuth.auth = auth;

      // Call the actual handler
      const result = await handler(event, ctxWithAuth);
      return result;
    } catch (error) {
      return handleError(error);
    }
  };
}

/**
 * Convenience wrapper: admin-only handler.
 */
export function withAdminOnly(
  handler: (
    event: any,
    context: Context & { auth: AuthContext },
  ) => Promise<APIGatewayProxyResult>,
): APIGatewayProxyHandler {
  return withRoles(['admin'], handler);
}

/**
 * Convenience wrapper: admin or leadership.
 */
export function withLeadership(
  handler: (
    event: any,
    context: Context & { auth: AuthContext },
  ) => Promise<APIGatewayProxyResult>,
): APIGatewayProxyHandler {
  return withRoles(['admin', 'leadership'], handler);
}
