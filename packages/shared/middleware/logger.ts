import { APIGatewayProxyEvent, Context, APIGatewayProxyResult, Callback } from 'aws-lambda';

/**
 * Structured log entry format.
 */
export interface LogEntry {
  timestamp: string;
  level: 'debug' | 'info' | 'warn' | 'error';
  method: string;
  path: string;
  userId?: string;
  duration_ms: number;
  status_code: number;
  message?: string;
  error?: string;
}

/**
 * Write structured JSON log entry to stdout.
 * CloudWatch automatically parses and indexes these fields.
 */
function logStructured(entry: LogEntry): void {
  console.log(JSON.stringify(entry));
}

/**
 * Extract user ID from Lambda context auth claim if available.
 */
function extractUserId(event: APIGatewayProxyEvent): string | undefined {
  const authorizer = event.requestContext.authorizer as any;
  return authorizer?.claims?.sub;
}

/**
 * Logging wrapper: tracks request duration, status code, and user ID.
 * Logs all requests (including errors) with consistent structured format.
 *
 * Usage:
 *   export const handler = withLogging(async (event, context) => {
 *     return { statusCode: 200, body: 'OK' };
 *   });
 *
 * @param fn - Async handler function
 * @returns Wrapped handler that logs all requests
 */
export function withLogging(
  fn: (event: APIGatewayProxyEvent, context: Context) => Promise<APIGatewayProxyResult>,
) {
  return async (
    event: APIGatewayProxyEvent,
    context: Context,
    callback?: Callback<APIGatewayProxyResult>,
  ): Promise<APIGatewayProxyResult> => {
    const startTime = Date.now();
    const userId = extractUserId(event);
    const method = event.httpMethod || 'UNKNOWN';
    const path = event.path || '/';

    try {
      const result = await fn(event, context);

      const duration = Date.now() - startTime;
      logStructured({
        timestamp: new Date().toISOString(),
        level: 'info',
        method,
        path,
        userId,
        duration_ms: duration,
        status_code: result?.statusCode || 200,
      });

      if (callback) {
        callback(null, result);
      }
      return result;
    } catch (error) {
      const duration = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      logStructured({
        timestamp: new Date().toISOString(),
        level: 'error',
        method,
        path,
        userId,
        duration_ms: duration,
        status_code: 500,
        error: errorMessage,
      });

      if (callback) {
        callback(error instanceof Error ? error : new Error(String(error)));
      }
      throw error;
    }
  };
}

/**
 * Log a custom event with structured format.
 * Useful for audit logging and business metrics.
 */
export function log(
  level: 'debug' | 'info' | 'warn' | 'error',
  message: string,
  extra?: Record<string, unknown>,
): void {
  const entry: any = {
    timestamp: new Date().toISOString(),
    level,
    message,
  };

  if (extra) {
    Object.assign(entry, extra);
  }

  console.log(JSON.stringify(entry));
}
