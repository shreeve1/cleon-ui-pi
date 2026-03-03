/**
 * Session registry for persistent session tracking
 * Tracks sessions across query() calls, survives between streaming sessions
 * Persists to disk so sessions survive PM2 restarts
 */

import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';

const REGISTRY_FILE = path.join(os.homedir(), '.pi', 'agent', 'cleon-sessions-registry.json');

// Map of sessionId -> { username, projectPath, projectName, displayName, status, piSessionFile, createdAt, lastActiveAt }
const sessions = new Map();

// --- Debounced disk persistence ---

let saveTimer = null;
const SAVE_DEBOUNCE_MS = 2000;

function scheduleSave() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    saveTimer = null;
    try {
      const dir = path.dirname(REGISTRY_FILE);
      await fs.mkdir(dir, { recursive: true });
      const data = JSON.stringify({ sessions: Object.fromEntries(sessions) }, null, 2);
      await fs.writeFile(REGISTRY_FILE, data, 'utf-8');
    } catch (err) {
      console.error('[session-registry] Failed to save to disk:', err.message);
    }
  }, SAVE_DEBOUNCE_MS);
}

// --- Load from disk on startup ---

async function loadFromDisk() {
  try {
    const raw = await fs.readFile(REGISTRY_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    if (parsed && parsed.sessions && typeof parsed.sessions === 'object') {
      for (const [id, meta] of Object.entries(parsed.sessions)) {
        sessions.set(id, meta);
      }
    }
  } catch (err) {
    if (err.code === 'ENOENT') {
      // File doesn't exist yet — start fresh
      return;
    }
    console.warn('[session-registry] Could not load registry from disk (starting fresh):', err.message);
  }
}

await loadFromDisk();

// --- Public API ---

/**
 * Register or update a session in the registry
 * @param {string} sessionId - The session ID
 * @param {Object} metadata - Session metadata
 * @param {string} metadata.username - Username who owns this session
 * @param {string} metadata.projectPath - Path to the project
 * @param {string} metadata.projectName - Name of the project
 * @param {string} metadata.displayName - Display name for the session
 * @param {string} [metadata.status] - Status ('idle' or 'streaming', defaults to 'streaming')
 * @param {string} [metadata.piSessionFile] - Path to the Pi JSONL session file
 */
export function register(sessionId, metadata) {
  const existing = sessions.get(sessionId);
  sessions.set(sessionId, {
    ...metadata,
    status: metadata.status || 'streaming',
    piSessionFile: metadata.piSessionFile || existing?.piSessionFile || null,
    createdAt: existing?.createdAt || new Date().toISOString(),
    lastActiveAt: new Date().toISOString()
  });
  scheduleSave();
}

/**
 * Update the status of a session
 * @param {string} sessionId - The session ID
 * @param {string} status - New status ('idle' or 'streaming')
 */
export function setStatus(sessionId, status) {
  const session = sessions.get(sessionId);
  if (session) {
    session.status = status;
    session.lastActiveAt = new Date().toISOString();
    scheduleSave();
  }
}

/**
 * Get all sessions for a specific user
 * @param {string} username - The username
 * @returns {Array} Array of session objects with sessionId included
 */
export function getSessionsForUser(username) {
  return [...sessions.entries()]
    .filter(([, s]) => s.username === username)
    .map(([id, s]) => ({ sessionId: id, ...s }));
}

/**
 * Check if a session is currently streaming
 * @param {string} sessionId - The session ID
 * @returns {boolean} True if session status is 'streaming'
 */
export function isStreaming(sessionId) {
  return sessions.get(sessionId)?.status === 'streaming';
}

/**
 * Get a single session by ID
 * @param {string} sessionId - The session ID
 * @returns {Object|null} Session object or null if not found
 */
export function getSession(sessionId) {
  return sessions.get(sessionId) || null;
}

/**
 * Remove a session from the registry (explicit cleanup only)
 * @param {string} sessionId - The session ID
 */
export function remove(sessionId) {
  sessions.delete(sessionId);
  scheduleSave();
}

/**
 * Get all sessions that have a piSessionFile set (restorable after restart)
 * @returns {Array} Array of session objects with sessionId included
 */
export function restoreAll() {
  return [...sessions.entries()]
    .filter(([, s]) => s.piSessionFile)
    .map(([id, s]) => ({ sessionId: id, ...s }));
}
