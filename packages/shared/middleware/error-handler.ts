import { APIGatewayProxyResult } from 'aws-lambda';
import type { ZodError } from 'zod';

/**
 * CORS headers added to every Lambda response.
 * API Gateway Gateway Responses handle error responses from the gateway itself,
 * but successful Lambda responses (200) must include these headers explicitly.
 */
export const CORS_HEADERS = {
  'Access-Control-Allow-Origin': 'https://d2s8z1ws7s6cmc.cloudfront.net',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-Amz-Date,X-Api-Key,X-Amz-Security-Token',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
  'Content-Type': 'application/json',
};

/**
 * Wrap a successful response with CORS headers.
 */
export function ok(body: unknown, statusCode = 200): APIGatewayProxyResult {
  return {
    statusCode,
    headers: CORS_HEADERS,
    body: JSON.stringify(body),
  };
}

/**
 * Base error class for all application errors.
 * Provides machine-readable code, human-readable message, and HTTP status code.
 */
export class AppError extends Error {
  constructor(
    public readonly code: string,
    public readonly message: string,
    public readonly statusCode: number,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

/**
 * 404 Not Found error.
 */
export class NotFoundError extends AppError {
  constructor(resource: string, identifier?: string) {
    const message = identifier ? `${resource} with id ${identifier} not found` : `${resource} not found`;
    super('NOT_FOUND', message, 404);
    this.name = 'NotFoundError';
  }
}

/**
 * 400 Bad Request / Validation error.
 */
export class ValidationError extends AppError {
  constructor(message: string, details?: Record<string, string[]>) {
    super('VALIDATION_ERROR', message, 400, details);
    this.name = 'ValidationError';
  }
}

/**
 * 403 Forbidden / Permission denied error.
 */
export class ForbiddenError extends AppError {
  constructor(message: string = 'Permission denied') {
    super('FORBIDDEN', message, 403);
    this.name = 'ForbiddenError';
  }
}

/**
 * Convert a ZodError into a field-scoped ValidationError so the client learns
 * exactly which field failed (required by the CR-02 §7 error contract).
 */
export function zodToValidationError(err: ZodError): ValidationError {
  const details: Record<string, string[]> = {};
  for (const issue of err.issues) {
    const key = issue.path.join('.') || '_root';
    (details[key] ??= []).push(issue.message);
  }
  return new ValidationError('Invalid request body', details);
}

/**
 * 409 Conflict error (duplicate, concurrent edit, state violation).
 */
export class ConflictError extends AppError {
  constructor(message: string, details?: unknown) {
    super('CONFLICT', message, 409, details);
    this.name = 'ConflictError';
  }
}

/**
 * Convert error to API Gateway response.
 * Logs error details to CloudWatch (never exposed to client).
 * Returns user-friendly error response.
 */
export function handleError(error: unknown): APIGatewayProxyResult {
  if (error instanceof AppError) {
    const response: any = {
      code: error.code,
      message: error.message,
    };

    if (error.details) {
      response.details = error.details;
    }

    return {
      statusCode: error.statusCode,
      headers: CORS_HEADERS,
      body: JSON.stringify(response),
    };
  }

  // Unexpected error — log details, return 500 without exposing internals
  if (error instanceof Error) {
    console.error('[error-handler] Unexpected error', {
      name: error.name,
      message: error.message,
      stack: error.stack,
    });
  } else {
    console.error('[error-handler] Unknown error', { error });
  }

  return {
    statusCode: 500,
    headers: CORS_HEADERS,
    body: JSON.stringify({
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred',
    }),
  };
}
