"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ConflictError = exports.ForbiddenError = exports.ValidationError = exports.NotFoundError = exports.AppError = void 0;
exports.handleError = handleError;
/**
 * Base error class for all application errors.
 * Provides machine-readable code, human-readable message, and HTTP status code.
 */
class AppError extends Error {
    constructor(code, message, statusCode, details) {
        super(message);
        this.code = code;
        this.message = message;
        this.statusCode = statusCode;
        this.details = details;
        this.name = 'AppError';
    }
}
exports.AppError = AppError;
/**
 * 404 Not Found error.
 */
class NotFoundError extends AppError {
    constructor(resource, identifier) {
        const message = identifier ? `${resource} with id ${identifier} not found` : `${resource} not found`;
        super('NOT_FOUND', message, 404);
        this.name = 'NotFoundError';
    }
}
exports.NotFoundError = NotFoundError;
/**
 * 400 Bad Request / Validation error.
 */
class ValidationError extends AppError {
    constructor(message, details) {
        super('VALIDATION_ERROR', message, 400, details);
        this.name = 'ValidationError';
    }
}
exports.ValidationError = ValidationError;
/**
 * 403 Forbidden / Permission denied error.
 */
class ForbiddenError extends AppError {
    constructor(message = 'Permission denied') {
        super('FORBIDDEN', message, 403);
        this.name = 'ForbiddenError';
    }
}
exports.ForbiddenError = ForbiddenError;
/**
 * 409 Conflict error (duplicate, concurrent edit, state violation).
 */
class ConflictError extends AppError {
    constructor(message, details) {
        super('CONFLICT', message, 409, details);
        this.name = 'ConflictError';
    }
}
exports.ConflictError = ConflictError;
/**
 * Convert error to API Gateway response.
 * Logs error details to CloudWatch (never exposed to client).
 * Returns user-friendly error response.
 */
function handleError(error) {
    if (error instanceof AppError) {
        const response = {
            code: error.code,
            message: error.message,
        };
        if (error.details) {
            response.details = error.details;
        }
        return {
            statusCode: error.statusCode,
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
    }
    else {
        console.error('[error-handler] Unknown error', { error });
    }
    return {
        statusCode: 500,
        body: JSON.stringify({
            code: 'INTERNAL_ERROR',
            message: 'An unexpected error occurred',
        }),
    };
}
