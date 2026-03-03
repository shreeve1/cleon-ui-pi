/**
 * Centralized validation utilities for Cleon UI
 * Consolidates validation logic from across the codebase
 */

import path from 'path';

// ─── String Validation ───────────────────────────────────────────────

/**
 * Validate username format and length
 * @param {string} username 
 * @returns {{ valid: boolean, error?: string }}
 */
export function validateUsername(username) {
  if (!username || typeof username !== 'string') {
    return { valid: false, error: 'Username is required' };
  }
  if (username.length < 3) {
    return { valid: false, error: 'Username must be at least 3 characters' };
  }
  if (username.length > 50) {
    return { valid: false, error: 'Username must be at most 50 characters' };
  }
  if (!/^[a-zA-Z0-9_-]+$/.test(username)) {
    return { valid: false, error: 'Username can only contain letters, numbers, underscores, and hyphens' };
  }
  return { valid: true };
}

/**
 * Validate password strength
 * @param {string} password 
 * @returns {{ valid: boolean, error?: string }}
 */
export function validatePassword(password) {
  if (!password || typeof password !== 'string') {
    return { valid: false, error: 'Password is required' };
  }
  if (password.length < 6) {
    return { valid: false, error: 'Password must be at least 6 characters' };
  }
  if (password.length > 256) {
    return { valid: false, error: 'Password is too long' };
  }
  return { valid: true };
}

/**
 * Validate a generic string with length constraints
 * @param {string} value 
 * @param {object} options 
 * @returns {{ valid: boolean, error?: string }}
 */
export function validateString(value, { name = 'Value', min = 1, max = 10000, required = true } = {}) {
  if (!value || typeof value !== 'string') {
    if (required) {
      return { valid: false, error: `${name} is required` };
    }
    return { valid: true };
  }
  if (value.length < min) {
    return { valid: false, error: `${name} must be at least ${min} characters` };
  }
  if (value.length > max) {
    return { valid: false, error: `${name} must be at most ${max} characters` };
  }
  return { valid: true };
}

// ─── Path Validation ──────────────────────────────────────────────────

/**
 * Validate a project path for security
 * Prevents path traversal attacks
 * @param {string} projectPath 
 * @returns {{ valid: boolean, error?: string }}
 */
export function validateProjectPath(projectPath) {
  if (!projectPath || typeof projectPath !== 'string') {
    return { valid: false, error: 'Project path is required' };
  }
  // Prevent path traversal
  if (projectPath.includes('..')) {
    return { valid: false, error: 'Invalid path: path traversal detected' };
  }
  if (path.isAbsolute(projectPath) && !projectPath.startsWith(process.env.HOME || '/')) {
    // Allow absolute paths under home directory only
    return { valid: false, error: 'Invalid path: must be under home directory' };
  }
  return { valid: true };
}

/**
 * Validate a relative path within a project
 * @param {string} relativePath 
 * @returns {{ valid: boolean, error?: string }}
 */
export function validateRelativePath(relativePath) {
  if (!relativePath || typeof relativePath !== 'string') {
    return { valid: false, error: 'Relative path is required' };
  }
  // Prevent escaping project root
  if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    return { valid: false, error: 'Invalid relative path' };
  }
  return { valid: true };
}

/**
 * Validate and resolve a path, ensuring it's within the project root
 * @param {string} projectRoot 
 * @param {string} relativePath 
 * @returns {{ valid: boolean, resolvedPath?: string, error?: string }}
 */
export function validateAndResolvePath(projectRoot, relativePath) {
  const relativeValidation = validateRelativePath(relativePath);
  if (!relativeValidation.valid) {
    return relativeValidation;
  }
  
  const resolvedPath = path.resolve(projectRoot, relativePath);
  const realProjectRoot = path.resolve(projectRoot);
  
  if (!resolvedPath.startsWith(realProjectRoot)) {
    return { valid: false, error: 'Path escapes project root' };
  }
  
  return { valid: true, resolvedPath };
}

// ─── ID Validation ────────────────────────────────────────────────────

/**
 * Validate a session ID format (UUID)
 * @param {string} sessionId 
 * @returns {{ valid: boolean, error?: string }}
 */
export function validateSessionId(sessionId) {
  if (!sessionId || typeof sessionId !== 'string') {
    return { valid: false, error: 'Session ID is required' };
  }
  // UUID v4 format: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(sessionId)) {
    return { valid: false, error: 'Invalid session ID format' };
  }
  return { valid: true };
}

/**
 * Validate a MongoDB-style ObjectId or numeric ID
 * @param {string|number} id 
 * @returns {{ valid: boolean, error?: string }}
 */
export function validateId(id) {
  if (id === undefined || id === null) {
    return { valid: false, error: 'ID is required' };
  }
  if (typeof id === 'number') {
    if (!Number.isInteger(id) || id < 1) {
      return { valid: false, error: 'Invalid ID' };
    }
    return { valid: true };
  }
  if (typeof id === 'string') {
    if (id.length < 1 || id.length > 128) {
      return { valid: false, error: 'Invalid ID length' };
    }
    return { valid: true };
  }
  return { valid: false, error: 'Invalid ID type' };
}

// ─── Message Validation ───────────────────────────────────────────────

/**
 * Validate a chat message
 * @param {string} message 
 * @returns {{ valid: boolean, error?: string }}
 */
export function validateMessage(message) {
  return validateString(message, { 
    name: 'Message', 
    min: 1, 
    max: 100000, 
    required: true 
  });
}

/**
 * Validate a project name
 * @param {string} name 
 * @returns {{ valid: boolean, error?: string }}
 */
export function validateProjectName(name) {
  if (!name || typeof name !== 'string') {
    return { valid: false, error: 'Project name is required' };
  }
  if (name.startsWith('-')) {
    return { valid: false, error: 'Project name cannot start with a hyphen' };
  }
  if (name.length > 255) {
    return { valid: false, error: 'Project name is too long' };
  }
  return { valid: true };
}

// ─── Validation Middleware Factory ─────────────────────────────────────

/**
 * Create validation middleware for Express routes
 * @param {object} schema - Object mapping field names to validation functions
 * @returns {function} Express middleware
 */
export function validateBody(schema) {
  return (req, res, next) => {
    const errors = [];
    
    for (const [field, validator] of Object.entries(schema)) {
      const value = req.body[field];
      const result = validator(value);
      if (!result.valid) {
        errors.push({ field, message: result.error });
      }
    }
    
    if (errors.length > 0) {
      return res.status(400).json({ 
        error: 'Validation failed', 
        details: errors 
      });
    }
    
    next();
  };
}
