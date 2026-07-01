import { APIGatewayProxyResult } from 'aws-lambda';
/**
 * Base error class for all application errors.
 * Provides machine-readable code, human-readable message, and HTTP status code.
 */
export declare class AppError extends Error {
    readonly code: string;
    readonly message: string;
    readonly statusCode: number;
    readonly details?: unknown | undefined;
    constructor(code: string, message: string, statusCode: number, details?: unknown | undefined);
}
/**
 * 404 Not Found error.
 */
export declare class NotFoundError extends AppError {
    constructor(resource: string, identifier?: string);
}
/**
 * 400 Bad Request / Validation error.
 */
export declare class ValidationError extends AppError {
    constructor(message: string, details?: Record<string, string[]>);
}
/**
 * 403 Forbidden / Permission denied error.
 */
export declare class ForbiddenError extends AppError {
    constructor(message?: string);
}
/**
 * 409 Conflict error (duplicate, concurrent edit, state violation).
 */
export declare class ConflictError extends AppError {
    constructor(message: string, details?: unknown);
}
/**
 * Convert error to API Gateway response.
 * Logs error details to CloudWatch (never exposed to client).
 * Returns user-friendly error response.
 */
export declare function handleError(error: unknown): APIGatewayProxyResult;
