/**
 * Error handling utilities for Cleon UI
 * Provides consistent error responses and async route handling
 */

import logger from './logger.js';

// ─── Custom Error Classes ─────────────────────────────────────────────

/**
 * Base application error with status code
 */
export class AppError extends Error {
  constructor(message, statusCode = 500, code = 'INTERNAL_ERROR') {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.isOperational = true; // Distinguishes from programming errors
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Validation error (400 Bad Request)
 */
export class ValidationError extends AppError {
  constructor(message, details = null) {
    super(message, 400, 'VALIDATION_ERROR');
    this.details = details;
  }
}

/**
 * Authentication error (401 Unauthorized)
 */
export class AuthenticationError extends AppError {
  constructor(message = 'Authentication required') {
    super(message, 401, 'AUTHENTICATION_ERROR');
  }
}

/**
 * Authorization error (403 Forbidden)
 */
export class AuthorizationError extends AppError {
  constructor(message = 'Access denied') {
    super(message, 403, 'AUTHORIZATION_ERROR');
  }
}

/**
 * Not found error (404 Not Found)
 */
export class NotFoundError extends AppError {
  constructor(message = 'Resource not found') {
    super(message, 404, 'NOT_FOUND');
  }
}

/**
 * Conflict error (409 Conflict)
 */
export class ConflictError extends AppError {
  constructor(message = 'Resource conflict') {
    super(message, 409, 'CONFLICT');
  }
}

/**
 * Rate limit error (429 Too Many Requests)
 */
export class RateLimitError extends AppError {
  constructor(message = 'Too many requests') {
    super(message, 429, 'RATE_LIMIT');
  }
}

// ─── Async Handler Wrapper ─────────────────────────────────────────────

/**
 * Wraps async route handlers to catch errors and pass to error middleware
 * Eliminates the need for try/catch in every route
 * 
 * @example
 * app.get('/api/data', asyncHandler(async (req, res) => {
 *   const data = await fetchData(); // Errors automatically caught
 *   res.json(data);
 * }));
 */
export function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

// ─── Error Response Formatter ──────────────────────────────────────────

/**
 * Format error response consistently
 */
function formatErrorResponse(error, includeStack = false) {
  const response = {
    error: error.message || 'An unexpected error occurred',
    code: error.code || 'INTERNAL_ERROR'
  };
  
  // Include validation details if present
  if (error.details) {
    response.details = error.details;
  }
  
  // Include stack trace in development
  if (includeStack && error.stack) {
    response.stack = error.stack;
  }
  
  return response;
}

// ─── Error Handler Middleware ──────────────────────────────────────────

/**
 * Global error handler middleware
 * Must be registered after all routes
 * 
 * @example
 * app.use(errorHandler);
 */
export function errorHandler(err, req, res, next) {
  // If headers already sent, delegate to default Express error handler
  if (res.headersSent) {
    return next(err);
  }
  
  // Determine status code
  const statusCode = err.statusCode || 500;
  
  // Log the error
  if (statusCode >= 500) {
    logger.error('Server error', {
      message: err.message,
      code: err.code,
      stack: err.stack,
      path: req.path,
      method: req.method,
      ip: req.ip
    });
  } else {
    logger.warn('Client error', {
      message: err.message,
      code: err.code,
      path: req.path,
      method: req.method
    });
  }
  
  // Send error response
  const includeStack = process.env.NODE_ENV !== 'production';
  res.status(statusCode).json(formatErrorResponse(err, includeStack));
}

// ─── 404 Handler ───────────────────────────────────────────────────────

/**
 * Handler for unmatched API routes
 */
export function notFoundHandler(req, res, next) {
  const error = new NotFoundError(`Route ${req.method} ${req.path} not found`);
  next(error);
}

// ─── Utility Functions ─────────────────────────────────────────────────

/**
 * Throw a not found error if resource is null/undefined
 * @param {*} resource - The resource to check
 * @param {string} name - Name of the resource for error message
 * @throws {NotFoundError}
 */
export function requireResource(resource, name = 'Resource') {
  if (resource === null || resource === undefined) {
    throw new NotFoundError(`${name} not found`);
  }
  return resource;
}

/**
 * Throw an authentication error if condition is false
 * @param {boolean} condition 
 * @param {string} message 
 * @throws {AuthenticationError}
 */
export function requireAuth(condition, message = 'Authentication required') {
  if (!condition) {
    throw new AuthenticationError(message);
  }
}

/**
 * Throw an authorization error if condition is false
 * @param {boolean} condition 
 * @param {string} message 
 * @throws {AuthorizationError}
 */
export function requirePermission(condition, message = 'Access denied') {
  if (!condition) {
    throw new AuthorizationError(message);
  }
}
