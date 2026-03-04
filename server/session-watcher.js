/**
 * Session file watcher — detects active CLI pi sessions by monitoring
 * .jsonl session files for changes, and streams new entries as events.
 *
 * This bridges the gap between standalone `pi` terminal sessions and
 * the Cleon UI web interface: when a user navigates to a session that
 * is being actively driven from the CLI, this module tails the session
 * file and publishes events through the event bus.
 */

import { promises as fs } from 'fs';
import { watch } from 'fs';
import { execSync } from 'child_process';
import path from 'path';
import os from 'os';
import { publish } from './bus.js';
import { startSessionBuffer, broadcastToSession, clearSessionBuffer, hasActiveBuffer } from './broadcast.js';
import { register, setStatus, getSession } from './session-registry.js';
import { getRpcSessionManager } from './session-manager-instance.js';

const PI_SESSIONS = path.join(os.homedir(), '.pi', 'agent', 'sessions');

// How recently the file must have been modified to be considered "active" (ms)
const ACTIVE_THRESHOLD_MS = 5 * 60_000; // 5 minutes — generous because pi sessions
                                         // can be idle while the user reads output

// How long without file changes before we check if pi process is still running
const IDLE_CHECK_MS = 30_000; // 30 seconds — then we verify via process detection

// How often to re-check if the pi process is still running when file is idle
const PROCESS_CHECK_INTERVAL_MS = 15_000; // 15 seconds

// How long after the last assistant message before we consider the turn "done"
const TURN_COMPLETE_DELAY_MS = 3_000; // 3 seconds

// Active watchers: sessionId → WatcherState
const activeWatchers = new Map();

/**
 * @typedef {Object} WatcherState
 * @property {string} sessionId
 * @property {string} filePath
 * @property {string} username
 * @property {string} projectPath - resolved project cwd (for process detection)
 * @property {number} offset - bytes read so far
 * @property {import('fs').FSWatcher | null} fsWatcher
 * @property {NodeJS.Timeout | null} idleTimer
 * @property {NodeJS.Timeout | null} turnCompleteTimer - timer for sending 'done' after assistant message
 * @property {boolean} processing - debounce flag
 * @property {boolean} turnComplete - true if we've sent 'done' for the current turn
 * @property {string | null} lastAssistantMessageId - ID of last assistant message seen
 */

/**
 * Resolve a session ID to its .jsonl file path.
 * Session files are named: <timestamp>_<uuid>.jsonl
 * The sessionId is the <uuid> part.
 *
 * @param {string} sessionId - UUID portion of the filename
 * @returns {Promise<string|null>} Absolute path to the session file, or null
 */
async function resolveSessionFile(sessionId) {
  try {
    const dirs = await fs.readdir(PI_SESSIONS, { withFileTypes: true });
    for (const dir of dirs) {
      if (!dir.isDirectory()) continue;
      const dirPath = path.join(PI_SESSIONS, dir.name);
      const files = await fs.readdir(dirPath);
      for (const file of files) {
        if (file.endsWith('.jsonl') && file.includes(sessionId)) {
          return path.join(dirPath, file);
        }
      }
    }
  } catch { /* ignore */ }
  return null;
}

/**
 * Extract project info from a Pi session file.
 * Reads the session header (first line) to get the actual cwd.
 * Falls back to decoding the directory name (lossy for paths with dashes).
 */
async function getProjectInfo(filePath) {
  const dirName = path.basename(path.dirname(filePath));

  // Try to read the cwd from the session file header
  try {
    const fd = await fs.open(filePath, 'r');
    try {
      const buf = Buffer.alloc(4096); // Header is usually small
      await fd.read(buf, 0, buf.length, 0);
      const firstLine = buf.toString('utf8').split('\n')[0];
      if (firstLine) {
        const entry = JSON.parse(firstLine);
        if (entry.type === 'session' && entry.cwd) {
          return {
            name: dirName,
            path: entry.cwd,
            displayName: path.basename(entry.cwd),
          };
        }
      }
    } finally {
      await fd.close();
    }
  } catch { /* fall through */ }

  // Fallback: decode directory name (lossy for dashes)
  const rawPath = '/' + dirName.slice(2, -2).replace(/-/g, '/');
  return {
    name: dirName,
    path: rawPath,
    displayName: path.basename(rawPath),
  };
}

/**
 * Check if a session file is actively being written to (by a CLI pi process).
 *
 * @param {string} filePath - Path to the .jsonl file
 * @returns {Promise<boolean>}
 */
async function isFileActive(filePath) {
  try {
    const stats = await fs.stat(filePath);
    const age = Date.now() - stats.mtimeMs;
    return age < ACTIVE_THRESHOLD_MS;
  } catch {
    return false;
  }
}

/**
 * Check if a session is already owned by the Cleon UI RPC session manager.
 * If so, we should NOT watch the file — events are already flowing through RPC.
 *
 * @param {string} sessionId
 * @returns {boolean}
 */
function isOwnedByRpc(sessionId) {
  const manager = getRpcSessionManager();
  const live = manager.get(sessionId);
  return !!(live && live.rpc && live.rpc.alive);
}

/**
 * Try to attach to a CLI pi session. If the session file is actively being
 * written to and is not owned by an RPC process, start tailing it.
 *
 * @param {string} sessionId - The Pi session UUID
 * @param {string} username - Cleon UI username (for event bus routing)
 * @returns {Promise<{status: string, watching: boolean}>}
 */
export async function attachToCliSession(sessionId, username) {
  // Already watching?
  if (activeWatchers.has(sessionId)) {
    const w = activeWatchers.get(sessionId);
    resetIdleTimer(w);
    return { status: 'streaming', watching: true };
  }

  // Owned by RPC? Let the normal flow handle it.
  if (isOwnedByRpc(sessionId)) {
    return { status: 'rpc-owned', watching: false };
  }

  // Resolve file
  const filePath = await resolveSessionFile(sessionId);
  if (!filePath) {
    return { status: 'not-found', watching: false };
  }

  // Is the file active?
  const active = await isFileActive(filePath);
  if (!active) {
    return { status: 'idle', watching: false };
  }

  // Start watching
  console.log(`[SessionWatcher] Starting file watch for CLI session ${sessionId}: ${filePath}`);

  const stats = await fs.stat(filePath);
  const watcher = {
    sessionId,
    filePath,
    username,
    offset: stats.size, // Start from current end — don't replay existing content
    fsWatcher: null,
    idleTimer: null,
    turnCompleteTimer: null,
    processing: false,
    turnComplete: true, // Start as complete (no turn in progress yet)
    lastAssistantMessageId: null,
  };

  // Register in session registry so SSE state-snapshot includes it
  const projectInfo = await getProjectInfo(filePath);
  watcher.projectPath = projectInfo.path; // Cache for process detection
  register(sessionId, {
    username,
    projectPath: projectInfo.path,
    projectName: projectInfo.name,
    displayName: projectInfo.displayName,
    status: 'streaming',
    piSessionFile: filePath,
  });

  // Start message buffer for replay
  startSessionBuffer(sessionId);

  // Notify client that session is streaming
  publish(username, { type: 'session-status', sessionId, status: 'streaming' });

  // Start fs.watch
  watcher.fsWatcher = watch(filePath, { persistent: false }, (eventType) => {
    if (eventType === 'change' && !watcher.processing) {
      watcher.processing = true;
      processNewLines(watcher).finally(() => {
        watcher.processing = false;
      });
      resetIdleTimer(watcher);
    }
  });

  resetIdleTimer(watcher);
  activeWatchers.set(sessionId, watcher);

  return { status: 'streaming', watching: true };
}

/**
 * Read new bytes appended to the session file and emit events.
 */
async function processNewLines(watcher) {
  try {
    const stats = await fs.stat(watcher.filePath);
    if (stats.size <= watcher.offset) return;

    // Read new bytes
    const fd = await fs.open(watcher.filePath, 'r');
    try {
      const buf = Buffer.alloc(stats.size - watcher.offset);
      await fd.read(buf, 0, buf.length, watcher.offset);
      watcher.offset = stats.size;

      const text = buf.toString('utf8');
      const lines = text.split('\n').filter(Boolean);

      for (const line of lines) {
        try {
          const entry = JSON.parse(line);
          emitSessionEntry(watcher, entry);
        } catch { /* skip malformed */ }
      }
    } finally {
      await fd.close();
    }
  } catch (err) {
    console.error(`[SessionWatcher] Error reading ${watcher.filePath}:`, err.message);
  }
}

/**
 * Transform a Pi JSONL session entry into Cleon UI events and publish them.
 */
function emitSessionEntry(watcher, entry) {
  const { sessionId, username } = watcher;
  const timestamp = entry.timestamp || new Date().toISOString();
  const messageId = entry.id || crypto.randomUUID?.() || String(Date.now());

  if (entry.type !== 'message') return;

  const msg = entry.message;
  if (!msg) return;

  if (msg.role === 'assistant') {
    const content = msg.content;
    if (!Array.isArray(content)) return;

    // Track this assistant message for turn completion detection
    // If this is a new message (different ID), reset turn state
    if (watcher.lastAssistantMessageId !== messageId) {
      watcher.lastAssistantMessageId = messageId;
      // New assistant message means a new turn is starting
      watcher.turnComplete = false;
      // Update session status to streaming
      setStatus(sessionId, 'streaming');
      publish(username, { type: 'session-status', sessionId, status: 'streaming' });
    }
    // Cancel any pending turn complete (more content is arriving)
    cancelTurnComplete(watcher);

    for (const block of content) {
      if (block.type === 'text' && block.text) {
        const event = {
          type: 'message',
          sessionId,
          data: {
            type: 'text',
            content: block.text,
            timestamp,
            messageId,
          },
        };
        broadcastToSession(sessionId, event);
        publish(username, event);
      }

      if (block.type === 'toolCall') {
        const event = {
          type: 'message',
          sessionId,
          data: {
            type: 'tool_use',
            tool: block.name || 'unknown',
            id: block.id || messageId,
            summary: { summary: formatToolSummary(block.name, block.arguments) },
            timestamp,
            messageId,
            input: block.arguments || {},
          },
        };
        broadcastToSession(sessionId, event);
        publish(username, event);
      }
    }

    // After processing all blocks of an assistant message, schedule turn complete
    // If no more activity for TURN_COMPLETE_DELAY_MS, we'll send 'done'
    scheduleTurnComplete(watcher);
  }

  if (msg.role === 'toolResult') {
    // Tool result means assistant is still processing - cancel pending turn complete
    // The assistant will emit another message with the next step
    cancelTurnComplete(watcher);

    const output = extractTextContent(msg.content);
    const event = {
      type: 'message',
      sessionId,
      data: {
        type: 'tool_result',
        id: msg.toolCallId || messageId,
        success: !msg.isError,
        output: truncate(output, 1500),
        timestamp,
        messageId,
      },
    };
    broadcastToSession(sessionId, event);
    publish(username, event);
  }

  if (msg.role === 'user') {
    // User message means a new turn is starting
    // Cancel any pending turn complete from previous assistant message
    cancelTurnComplete(watcher);
    watcher.turnComplete = true; // Previous turn is done
    watcher.lastAssistantMessageId = null; // Reset for new turn

    // User messages from CLI — could show these too
    // but they're already in the session file and loaded via history
  }
}

/**
 * Check if a pi process is running with a matching project path as its cwd.
 * This is used to keep watching even when the file isn't being written to
 * (pi is idle waiting for user input in the terminal).
 *
 * @param {string} projectPath - The project path to match against process cwds
 * @returns {boolean}
 */
function isPiProcessRunning(projectPath) {
  try {
    // Find pi processes by name, then check each one's cwd and command line
    const pids = execSync('pgrep -x pi 2>/dev/null', {
      encoding: 'utf8', timeout: 3000
    }).trim().split('\n').filter(Boolean);

    for (const pid of pids) {
      try {
        // Get the full command line to filter out RPC and interactive sessions
        // RPC mode runs with '--mode rpc' - we only want CLI sessions
        const cmdline = execSync(`cat /proc/${pid}/cmdline 2>/dev/null || ps -p ${pid} -o args= 2>/dev/null`, {
          encoding: 'utf8', timeout: 1000
        }).trim();

        // Skip RPC mode processes (they have their own completion handling)
        if (cmdline.includes('--mode rpc') || cmdline.includes('-m rpc')) {
          continue;
        }

        // lsof -p <pid> returns all FDs for that specific process.
        // Filter for cwd type and extract the path.
        // Output format: "p<pid>\nfcwd\nn<path>\n..."
        const output = execSync(`lsof -p ${pid} -Fn -d cwd 2>/dev/null`, {
          encoding: 'utf8', timeout: 2000
        });
        // Find lines starting with 'n' that follow 'fcwd' — get the first one
        // matching our target PID (lsof may include child processes)
        const lines = output.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (lines[i] === `p${pid}` && i + 2 < lines.length && lines[i + 1] === 'fcwd') {
            const cwdLine = lines[i + 2];
            if (cwdLine.startsWith('n') && cwdLine.slice(1) === projectPath) {
              return true;
            }
          }
        }
      } catch { /* skip this pid */ }
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Schedule a turn complete ('done') event after seeing an assistant message.
 * This handles the case where the CLI pi process keeps running but the AI
 * has finished its turn.
 */
function scheduleTurnComplete(watcher) {
  // Clear any existing timer
  if (watcher.turnCompleteTimer) {
    clearTimeout(watcher.turnCompleteTimer);
  }

  // Mark turn as in progress
  watcher.turnComplete = false;

  watcher.turnCompleteTimer = setTimeout(() => {
    // Only send done if we haven't already for this turn
    if (!watcher.turnComplete) {
      console.log(`[SessionWatcher] Session ${watcher.sessionId} — turn complete (no activity for ${TURN_COMPLETE_DELAY_MS}ms)`);
      watcher.turnComplete = true;

      // Send done event for this turn
      const doneEvent = { type: 'done', sessionId: watcher.sessionId };
      broadcastToSession(watcher.sessionId, doneEvent);
      publish(watcher.username, doneEvent);

      // Update session status to idle
      setStatus(watcher.sessionId, 'idle');
      publish(watcher.username, { type: 'session-status', sessionId: watcher.sessionId, status: 'idle' });
    }
  }, TURN_COMPLETE_DELAY_MS);

  if (watcher.turnCompleteTimer.unref) watcher.turnCompleteTimer.unref();
}

/**
 * Cancel any pending turn complete timer (called when new activity is detected).
 */
function cancelTurnComplete(watcher) {
  if (watcher.turnCompleteTimer) {
    clearTimeout(watcher.turnCompleteTimer);
    watcher.turnCompleteTimer = null;
  }
}

/**
 * Reset the idle timer. When no file changes arrive, we check if the pi
 * process is still running. If it is, we keep watching. If not, we stop.
 */
function resetIdleTimer(watcher) {
  if (watcher.idleTimer) clearTimeout(watcher.idleTimer);
  watcher.idleTimer = setTimeout(() => {
    checkAndMaybeStop(watcher);
  }, IDLE_CHECK_MS);
  if (watcher.idleTimer.unref) watcher.idleTimer.unref();
}

/**
 * Called when the file has been idle. Check if the pi process is still running.
 * If yes, schedule another check. If no, stop watching.
 */
function checkAndMaybeStop(watcher) {
  if (isPiProcessRunning(watcher.projectPath)) {
    // Pi is still running — keep watching, check again later
    console.log(`[SessionWatcher] Session ${watcher.sessionId} file idle but pi process still running`);
    watcher.idleTimer = setTimeout(() => {
      checkAndMaybeStop(watcher);
    }, PROCESS_CHECK_INTERVAL_MS);
    if (watcher.idleTimer.unref) watcher.idleTimer.unref();
  } else {
    console.log(`[SessionWatcher] Session ${watcher.sessionId} — pi process no longer running, stopping watch`);
    stopWatcher(watcher.sessionId);
  }
}

/**
 * Stop watching a session file.
 */
function stopWatcher(sessionId) {
  const watcher = activeWatchers.get(sessionId);
  if (!watcher) return;

  if (watcher.fsWatcher) {
    watcher.fsWatcher.close();
    watcher.fsWatcher = null;
  }
  if (watcher.idleTimer) {
    clearTimeout(watcher.idleTimer);
    watcher.idleTimer = null;
  }
  if (watcher.turnCompleteTimer) {
    clearTimeout(watcher.turnCompleteTimer);
    watcher.turnCompleteTimer = null;
  }

  // Only send done if turn wasn't already marked complete
  if (!watcher.turnComplete) {
    // Mark session as idle
    setStatus(sessionId, 'idle');
    publish(watcher.username, { type: 'session-status', sessionId, status: 'idle' });

    // Send done event
    const doneEvent = { type: 'done', sessionId };
    broadcastToSession(sessionId, doneEvent);
    publish(watcher.username, doneEvent);
  }

  // Clear buffer after a brief delay (let clients process 'done' first)
  setTimeout(() => clearSessionBuffer(sessionId), 2000);

  activeWatchers.delete(sessionId);
  console.log(`[SessionWatcher] Stopped watching ${sessionId}`);
}

/**
 * Check if a session is being watched (active CLI session).
 */
export function isWatching(sessionId) {
  return activeWatchers.has(sessionId);
}

/**
 * Stop all active watchers (for graceful shutdown).
 */
export function stopAll() {
  for (const sessionId of activeWatchers.keys()) {
    stopWatcher(sessionId);
  }
}

// ─── Helpers ────────────────────────────────────────────────────────

function extractTextContent(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.filter(c => c.type === 'text').map(c => c.text).join('\n');
  }
  return String(content || '');
}

function truncate(str, max) {
  if (str.length <= max) return str;
  return str.slice(0, max) + `\n... (${str.length - max} more chars)`;
}

function formatToolSummary(tool, args) {
  if (!args) return tool || 'unknown';
  const t = (tool || '').toLowerCase();
  switch (t) {
    case 'bash': return `$ ${truncate(args.command || '', 200)}`;
    case 'read': return `Read ${args.path || args.file_path || ''}`;
    case 'write': return `Write ${args.path || args.file_path || ''}`;
    case 'edit': return `Edit ${args.path || args.file_path || ''}`;
    case 'glob': return `Find ${args.pattern || ''}`;
    case 'grep': return `Search ${args.pattern || ''}`;
    default: return tool || 'unknown';
  }
}
