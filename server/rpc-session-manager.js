import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { RpcClient } from './pi-agent.js';

// ─── Constants ──────────────────────────────────────────────────────

const IDLE_TIMEOUT_MS = parseInt(process.env.RPC_IDLE_TIMEOUT_MS, 10) || 10 * 60 * 1000; // 10 min
const CLEANUP_INTERVAL_MS = 60_000; // 60s
const MAX_CONCURRENT_RPC = parseInt(process.env.RPC_MAX_CONCURRENT, 10) || 10;
const SESSIONS_FILE = path.join(os.homedir(), '.pi', 'agent', 'cleon-sessions.json');

// ─── RpcSessionManager ─────────────────────────────────────────────

/**
 * Manages long-lived RPC processes keyed by session ID.
 *
 * Each entry in the sessions Map:
 *   {
 *     rpc: RpcClient,
 *     sessionFile: string | null,
 *     projectPath: string,
 *     username: string,
 *     lastActivity: Date,
 *     eventListeners: Set<Function>,
 *     idleTimer: NodeJS.Timeout | null,
 *   }
 */
class RpcSessionManager {
  /** @type {Map<string, object>} Live in-memory sessions with RPC processes */
  #sessions = new Map();

  /** @type {Map<string, string>} Persistent sessionId → sessionFile mapping (superset of live) */
  #sessionFileMap = new Map();

  /** @type {NodeJS.Timeout | null} */
  #cleanupInterval = null;

  /** @type {boolean} */
  #started = false;

  // ── Lifecycle ───────────────────────────────────────────────────

  /**
   * Initialize the manager: load persistent session map, start cleanup interval.
   */
  async start() {
    if (this.#started) return;
    this.#started = true;

    await this.#loadSessionFileMap();

    this.#cleanupInterval = setInterval(() => {
      this.cleanup();
    }, CLEANUP_INTERVAL_MS);

    // Don't keep Node alive just for this timer
    if (this.#cleanupInterval.unref) {
      this.#cleanupInterval.unref();
    }

    console.log(`[RpcSessionManager] Started — ${this.#sessionFileMap.size} known sessions loaded, idle timeout ${IDLE_TIMEOUT_MS}ms, max concurrent ${MAX_CONCURRENT_RPC}`);
  }

  // ── Core API ────────────────────────────────────────────────────

  /**
   * Get or create an RPC session.
   *
   * @param {string} sessionId   Cleon UI session ID
   * @param {string} projectPath Absolute path to the project directory
   * @param {string} username    Owning user
   * @returns {{ rpc: RpcClient, sessionFile: string|null, isNew: boolean }}
   */
  async getOrCreate(sessionId, projectPath, username) {
    // ── Case 1: Live session with alive RPC ──
    const existing = this.#sessions.get(sessionId);
    if (existing && existing.rpc.alive) {
      existing.lastActivity = new Date();
      this.#clearIdleTimer(existing);
      console.log(`[RpcSessionManager] Reusing live session ${sessionId}`);
      return { rpc: existing.rpc, sessionFile: existing.sessionFile, isNew: false };
    }

    // ── Case 2: Live entry but dead RPC — respawn ──
    if (existing && !existing.rpc.alive) {
      console.log(`[RpcSessionManager] Session ${sessionId} RPC is dead, respawning`);
      this.#clearIdleTimer(existing);
      this.#sessions.delete(sessionId);
      // Fall through to spawn — sessionFile is known
    }

    // ── Determine session file (from persistent map or null for new) ──
    let sessionFile = this.#sessionFileMap.get(sessionId) || null;
    const isNew = !sessionFile;

    // ── Enforce concurrency limit ──
    if (this.#sessions.size >= MAX_CONCURRENT_RPC) {
      // Try to evict the oldest idle session
      const evicted = this.#evictOldestIdle();
      if (!evicted) {
        throw new Error(
          `Max concurrent RPC sessions (${MAX_CONCURRENT_RPC}) reached. ` +
          `Cannot create session ${sessionId}.`
        );
      }
    }

    // ── Spawn new RPC client ──
    const rpcOptions = {};
    if (sessionFile) {
      rpcOptions.sessionFile = sessionFile;
    }

    const rpc = new RpcClient(projectPath, rpcOptions);

    const session = {
      rpc,
      sessionFile,
      projectPath,
      username,
      lastActivity: new Date(),
      eventListeners: new Set(),
      idleTimer: null,
    };

    // Listen for unexpected process exit
    rpc.onEvent((event) => {
      if (event.type === '_process_exit' || event.type === '_process_error') {
        console.warn(
          `[RpcSessionManager] Session ${sessionId} RPC exited unexpectedly ` +
          `(type=${event.type}, code=${event.code ?? 'n/a'})` +
          (session.sessionFile ? ` — session file preserved: ${session.sessionFile}` : '')
        );
        // Keep sessionFile mapping for restoration; only clear idle timer
        this.#clearIdleTimer(session);
        // Do NOT remove from #sessions — getOrCreate will detect dead rpc and respawn
      }
    });

    await rpc.start();

    // ── Discover session file via getState ──
    try {
      const stateResponse = await rpc.getState();
      if (stateResponse?.data?.sessionFile) {
        const reportedFile = stateResponse.data.sessionFile;

        // Only update mapping if this is a genuinely new session.
        // If we expected to resume from sessionFile but Pi reports a different file,
        // that means resume failed and Pi created a new empty session.
        // We should NOT overwrite our mapping in that case.
        if (isNew) {
          session.sessionFile = reportedFile;
          sessionFile = reportedFile;
          this.#sessionFileMap.set(sessionId, sessionFile);
          await this.#saveSessionFileMap();
          console.log(`[RpcSessionManager] Session ${sessionId} file: ${sessionFile}`);
        } else if (reportedFile !== sessionFile) {
          // Resume failed — Pi created a new session instead of resuming
          console.error(
            `[RpcSessionManager] WARNING: Session ${sessionId} resume failed! ` +
            `Expected: ${sessionFile}, Got: ${reportedFile}. ` +
            `Context may be lost. Keeping original mapping.`
          );
          // Keep the original sessionFile in our mapping, but use the new RPC
          // The user will see lost context, but at least we don't orphan the original file
        } else {
          // Successful resume — files match
          console.log(`[RpcSessionManager] Session ${sessionId} resumed from ${sessionFile}`);
        }
      }
    } catch (err) {
      console.warn(`[RpcSessionManager] Failed to get session file for ${sessionId}:`, err.message);
    }

    this.#sessions.set(sessionId, session);
    console.log(
      `[RpcSessionManager] ${isNew ? 'Created new' : 'Resumed'} session ${sessionId} ` +
      `(${this.#sessions.size}/${MAX_CONCURRENT_RPC} active)`
    );

    return { rpc, sessionFile, isNew };
  }

  /**
   * Get a live session by ID (or null).
   * @param {string} sessionId
   * @returns {object|null}
   */
  get(sessionId) {
    return this.#sessions.get(sessionId) || null;
  }

  /**
   * Mark a session as idle and start its timeout.
   * @param {string} sessionId
   */
  release(sessionId) {
    const session = this.#sessions.get(sessionId);
    if (!session) return;

    session.lastActivity = new Date();
    this.#clearIdleTimer(session);

    session.idleTimer = setTimeout(() => {
      console.log(`[RpcSessionManager] Session ${sessionId} idle timeout — destroying`);
      this.destroy(sessionId);
    }, IDLE_TIMEOUT_MS);

    // Don't keep Node alive just for idle timers
    if (session.idleTimer.unref) {
      session.idleTimer.unref();
    }
  }

  /**
   * Immediately kill an RPC process and remove the live session entry.
   * The sessionId→sessionFile mapping in the persistent JSON is preserved.
   * @param {string} sessionId
   */
  async destroy(sessionId) {
    const session = this.#sessions.get(sessionId);
    if (!session) return;

    this.#clearIdleTimer(session);

    // Clear event listeners
    session.eventListeners.clear();

    // Stop the RPC process
    try {
      await session.rpc.stop();
    } catch (err) {
      console.warn(`[RpcSessionManager] Error stopping RPC for ${sessionId}:`, err.message);
    }

    // Remove from live sessions (persistent map untouched)
    this.#sessions.delete(sessionId);
    console.log(`[RpcSessionManager] Destroyed session ${sessionId} (${this.#sessions.size}/${MAX_CONCURRENT_RPC} active)`);
  }

  /**
   * Gracefully destroy all live sessions.
   */
  async destroyAll() {
    console.log(`[RpcSessionManager] Destroying all ${this.#sessions.size} sessions`);

    if (this.#cleanupInterval) {
      clearInterval(this.#cleanupInterval);
      this.#cleanupInterval = null;
    }

    const destroyPromises = [];
    for (const sessionId of this.#sessions.keys()) {
      destroyPromises.push(this.destroy(sessionId));
    }
    await Promise.allSettled(destroyPromises);

    this.#started = false;
    console.log('[RpcSessionManager] All sessions destroyed');
  }

  /**
   * Get the Pi session file path for a given session ID (from persistent map).
   * @param {string} sessionId
   * @returns {string|null}
   */
  getSessionFile(sessionId) {
    return this.#sessionFileMap.get(sessionId) || null;
  }

  /**
   * Cleanup idle sessions that have exceeded the timeout.
   * Called automatically on interval.
   */
  cleanup() {
    const now = Date.now();
    let cleaned = 0;

    for (const [sessionId, session] of this.#sessions) {
      const idleMs = now - session.lastActivity.getTime();

      // Destroy sessions that are idle past the timeout AND have no active idle timer
      // (sessions with an idleTimer are already scheduled for destruction)
      if (idleMs > IDLE_TIMEOUT_MS && !session.idleTimer) {
        console.log(`[RpcSessionManager] Cleanup: session ${sessionId} idle for ${Math.round(idleMs / 1000)}s`);
        this.destroy(sessionId);
        cleaned++;
      }

      // Also clean up sessions whose RPC process is dead and have been idle
      if (!session.rpc.alive && idleMs > IDLE_TIMEOUT_MS) {
        console.log(`[RpcSessionManager] Cleanup: removing dead session ${sessionId}`);
        this.#clearIdleTimer(session);
        this.#sessions.delete(sessionId);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      console.log(`[RpcSessionManager] Cleanup: removed ${cleaned} sessions (${this.#sessions.size} remaining)`);
    }
  }

  // ── Introspection ───────────────────────────────────────────────

  /** Number of live sessions */
  get size() {
    return this.#sessions.size;
  }

  /** Number of known session file mappings */
  get knownSessions() {
    return this.#sessionFileMap.size;
  }

  /** List all live session IDs */
  listSessions() {
    return [...this.#sessions.keys()];
  }

  // ── Private helpers ─────────────────────────────────────────────

  #clearIdleTimer(session) {
    if (session.idleTimer) {
      clearTimeout(session.idleTimer);
      session.idleTimer = null;
    }
  }

  /**
   * Evict the oldest idle session to make room for a new one.
   * Returns true if a session was evicted, false if none eligible.
   */
  #evictOldestIdle() {
    let oldestId = null;
    let oldestTime = Infinity;

    for (const [sessionId, session] of this.#sessions) {
      // Only evict sessions that have an idle timer (i.e., have been released)
      if (session.idleTimer && session.lastActivity.getTime() < oldestTime) {
        oldestTime = session.lastActivity.getTime();
        oldestId = sessionId;
      }
    }

    if (oldestId) {
      console.log(`[RpcSessionManager] Evicting idle session ${oldestId} to make room`);
      this.destroy(oldestId);
      return true;
    }

    return false;
  }

  /**
   * Load the persistent sessionId→sessionFile map from disk.
   */
  async #loadSessionFileMap() {
    try {
      const data = await fs.readFile(SESSIONS_FILE, 'utf8');
      const parsed = JSON.parse(data);

      if (parsed && typeof parsed === 'object') {
        for (const [key, value] of Object.entries(parsed)) {
          if (typeof value === 'string') {
            this.#sessionFileMap.set(key, value);
          }
        }
      }

      console.log(`[RpcSessionManager] Loaded ${this.#sessionFileMap.size} session mappings from ${SESSIONS_FILE}`);
    } catch (err) {
      if (err.code === 'ENOENT') {
        console.log(`[RpcSessionManager] No existing sessions file at ${SESSIONS_FILE}`);
      } else {
        console.warn(`[RpcSessionManager] Failed to load sessions file:`, err.message);
      }
    }
  }

  /**
   * Save the persistent sessionId→sessionFile map to disk.
   */
  async #saveSessionFileMap() {
    try {
      const dir = path.dirname(SESSIONS_FILE);
      await fs.mkdir(dir, { recursive: true });

      const obj = Object.fromEntries(this.#sessionFileMap);
      await fs.writeFile(SESSIONS_FILE, JSON.stringify(obj, null, 2) + '\n', 'utf8');
    } catch (err) {
      console.error(`[RpcSessionManager] Failed to save sessions file:`, err.message);
    }
  }
}

// ─── Singleton export ───────────────────────────────────────────────

export { RpcSessionManager };
export default RpcSessionManager;
