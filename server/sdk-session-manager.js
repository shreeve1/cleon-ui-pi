import { promises as fs } from "fs";
import path from "path";
import os from "os";
import {
	createAgentSession,
	SessionManager,
} from "@mariozechner/pi-coding-agent";
import { publish } from "./bus.js";
import {
	encode as encodePiDirName,
	decode as decodePiDirName,
} from "./pi-path.js";
import logger from "./logger.js";

// ─── Constants ──────────────────────────────────────────────────────

const IDLE_TIMEOUT_MS =
	parseInt(process.env.SDK_IDLE_TIMEOUT_MS, 10) || 10 * 60 * 1000; // 10 min
const CLEANUP_INTERVAL_MS = 60_000; // 60s
// Pi's AgentSession is persistent — every (user, project, session) triple
// consumes a slot until idle eviction. A single user with two browser tabs +
// a CLI session is already at 3; the old cap of 10 silently evicted real
// in-use sessions. 50 buys headroom; warm-but-idle sessions cost mostly
// references until reactivated.
const MAX_CONCURRENT = parseInt(process.env.SDK_MAX_CONCURRENT, 10) || 50;
const SESSIONS_FILE = path.join(
	os.homedir(),
	".pi",
	"agent",
	"cleon-sessions.json",
);

// ─── SdkSessionManager ─────────────────────────────────────────────

/**
 * Manages long-lived AgentSession objects keyed by session ID.
 *
 * Each entry in the sessions Map:
 *   {
 *     session: AgentSession,
 *     sessionManager: SessionManager,       // Pi SDK session manager (file persistence)
 *     sessionFile: string | null,
 *     projectPath: string,
 *     username: string,
 *     lastActivity: Date,
 *     idleTimer: NodeJS.Timeout | null,
 *   }
 *
 * Session IDs are scoped to projects to prevent context leakage.
 * The internal key format for the persistent map is: "${projectPath}:${sessionId}"
 */
class SdkSessionManager {
	/** @type {Map<string, object>} Live in-memory sessions */
	#sessions = new Map();

	/** @type {Map<string, string>} Persistent projectPath:sessionId → sessionFile mapping */
	#sessionFileMap = new Map();

	/** @type {Map<string, string>} Legacy sessionId → sessionFile mapping for backward compatibility */
	#legacySessionFileMap = new Map();

	/** @type {NodeJS.Timeout | null} */
	#cleanupInterval = null;

	/** @type {boolean} */
	#started = false;

	// ── Lifecycle ───────────────────────────────────────────────────

	async start() {
		if (this.#started) return;
		this.#started = true;

		await this.#loadSessionFileMap();

		this.#cleanupInterval = setInterval(() => {
			this.cleanup();
		}, CLEANUP_INTERVAL_MS);

		if (this.#cleanupInterval.unref) {
			this.#cleanupInterval.unref();
		}

		logger.info(
			`[SdkSessionManager] Started — ${this.#sessionFileMap.size} known sessions loaded, idle timeout ${IDLE_TIMEOUT_MS}ms, max concurrent ${MAX_CONCURRENT}`,
		);
	}

	// ── Core API ────────────────────────────────────────────────────

	/**
	 * Get or create an SDK session.
	 *
	 * @param {string} sessionId   Cleon UI session ID
	 * @param {string} projectPath Absolute path to the project directory
	 * @param {string} username    Owning user
	 * @returns {Promise<{ session: AgentSession, sessionFile: string|null, isNew: boolean }>}
	 */
	async getOrCreate(sessionId, projectPath, username) {
		const projectKey = this.#makeKey(projectPath, sessionId);

		// ── Case 1: Live session exists ──
		const existing = this.#sessions.get(sessionId);
		if (existing) {
			// Verify project path matches
			if (existing.projectPath !== projectPath) {
				logger.error(
					`[SdkSessionManager] Session ${sessionId} project mismatch! ` +
						`Live session is for "${existing.projectPath}" but requested for "${projectPath}". ` +
						`Destroying incompatible session and creating new one.`,
				);
				await this.destroy(sessionId);
				// Fall through to create new session
			} else {
				existing.lastActivity = new Date();
				this.#clearIdleTimer(existing);
				logger.info(`[SdkSessionManager] Reusing live session ${sessionId}`);
				return {
					session: existing.session,
					sessionFile: existing.sessionFile,
					isNew: false,
				};
			}
		}

		// ── Determine session file (from persistent map or null for new) ──
		let sessionFile = this.#sessionFileMap.get(projectKey) || null;

		// Fall back to legacy map
		if (!sessionFile) {
			sessionFile = this.#legacySessionFileMap.get(sessionId) || null;
			if (sessionFile) {
				const legacyProjectPath =
					this.#extractProjectFromSessionFile(sessionFile);
				if (legacyProjectPath && legacyProjectPath !== projectPath) {
					logger.warn(
						`[SdkSessionManager] Legacy session ${sessionId} project mismatch. Treating as new session.`,
					);
					sessionFile = null;
				}
			}
		}

		// If a mapping pointed at a file that no longer exists on disk, treat it
		// as a new session. Resuming a phantom path makes Pi SDK throw ENOENT
		// from an async event handler, which pi-lens' uncaughtException guard
		// rethrows and kills the process. Dropping the mapping here also stops
		// it from coming back on next boot.
		if (sessionFile && !(await this.#fileExists(sessionFile))) {
			logger.warn(
				`[SdkSessionManager] Mapped session file missing on disk, treating session ${sessionId} as new: ${sessionFile}`,
			);
			const removedFromMap = this.#sessionFileMap.delete(projectKey);
			const removedFromLegacy = this.#legacySessionFileMap.delete(sessionId);
			if (removedFromMap || removedFromLegacy) {
				await this.#saveSessionFileMap();
			}
			sessionFile = null;
		}

		// ── Final fallback: scan Pi sessions directory for a matching CLI session file ──
		// This handles the common case where a user starts a session in the CLI and then
		// navigates to it in the web UI. The CLI session file is never registered in
		// cleon-sessions.json, so we scan the Pi sessions directory directly.
		// The Pi session file UUID (in the filename AND the header) matches the Cleon sessionId,
		// so a filename-based scan is sufficient — no file reading required.
		if (!sessionFile) {
			sessionFile = await this.#findCliSessionFile(projectPath, sessionId);
			if (sessionFile) {
				// Cache it immediately so future requests skip the scan
				this.#sessionFileMap.set(projectKey, sessionFile);
				await this.#saveSessionFileMap();
				logger.info(
					`[SdkSessionManager] Session ${sessionId} — found CLI session file: ${sessionFile}`,
				);
			}
		}

		const isNew = !sessionFile;

		// ── Enforce concurrency limit ──
		if (this.#sessions.size >= MAX_CONCURRENT) {
			const evicted = this.#evictOldestIdle();
			if (!evicted) {
				throw new Error(
					`Max concurrent SDK sessions (${MAX_CONCURRENT}) reached. ` +
						`Cannot create session ${sessionId}.`,
				);
			}
		}

		// ── Create SDK session ──
		let piSessionManager;
		if (sessionFile) {
			// Resume existing session from file
			piSessionManager = SessionManager.open(sessionFile);
		} else {
			// Create new session for this project
			piSessionManager = SessionManager.create(projectPath);
		}

		const { session } = await createAgentSession({
			cwd: projectPath,
			sessionManager: piSessionManager,
		});

		// Get the actual session file from the SDK
		const actualSessionFile = session.sessionFile || null;
		if (isNew && actualSessionFile) {
			sessionFile = actualSessionFile;
			this.#sessionFileMap.set(projectKey, sessionFile);
			this.#legacySessionFileMap.delete(sessionId);
			await this.#saveSessionFileMap();
			logger.info(
				`[SdkSessionManager] Session ${sessionId} file: ${sessionFile} (project: ${projectPath})`,
			);
		} else if (
			!isNew &&
			actualSessionFile &&
			actualSessionFile !== sessionFile
		) {
			logger.error(
				`[SdkSessionManager] WARNING: Session ${sessionId} resume may have failed! ` +
					`Expected: ${sessionFile}, Got: ${actualSessionFile}. Keeping original mapping.`,
			);
		} else if (!isNew) {
			logger.info(
				`[SdkSessionManager] Session ${sessionId} resumed from ${sessionFile} (project: ${projectPath})`,
			);
		}

		const entry = {
			session,
			sessionManager: piSessionManager,
			sessionFile: sessionFile || actualSessionFile,
			projectPath,
			username,
			lastActivity: new Date(),
			idleTimer: null,
		};

		this.#sessions.set(sessionId, entry);
		logger.info(
			`[SdkSessionManager] ${isNew ? "Created new" : "Resumed"} session ${sessionId} ` +
				`(${this.#sessions.size}/${MAX_CONCURRENT} active)`,
		);

		return { session, sessionFile: entry.sessionFile, isNew };
	}

	/**
	 * Get a live session by ID (or null).
	 */
	get(sessionId) {
		return this.#sessions.get(sessionId) || null;
	}

	/**
	 * Mark a session as idle and start its timeout.
	 */
	release(sessionId) {
		const entry = this.#sessions.get(sessionId);
		if (!entry) return;

		entry.lastActivity = new Date();
		this.#clearIdleTimer(entry);

		entry.idleTimer = setTimeout(() => {
			logger.info(
				`[SdkSessionManager] Session ${sessionId} idle timeout — destroying`,
			);
			this.#notifyEvicted(sessionId, entry, "idle-timeout");
			this.destroy(sessionId);
		}, IDLE_TIMEOUT_MS);

		if (entry.idleTimer.unref) {
			entry.idleTimer.unref();
		}
	}

	/**
	 * Immediately dispose an AgentSession and remove the live entry.
	 * The persistent sessionId→sessionFile mapping is preserved.
	 */
	async destroy(sessionId) {
		const entry = this.#sessions.get(sessionId);
		if (!entry) return;

		this.#clearIdleTimer(entry);

		try {
			entry.session.dispose();
		} catch (err) {
			logger.warn(
				`[SdkSessionManager] Error disposing session ${sessionId}:`,
				err.message,
			);
		}

		this.#sessions.delete(sessionId);
		logger.info(
			`[SdkSessionManager] Destroyed session ${sessionId} (${this.#sessions.size}/${MAX_CONCURRENT} active)`,
		);
	}

	/**
	 * Gracefully destroy all live sessions.
	 */
	async destroyAll() {
		logger.info(
			`[SdkSessionManager] Destroying all ${this.#sessions.size} sessions`,
		);

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
		logger.info("[SdkSessionManager] All sessions destroyed");
	}

	/**
	 * Get the Pi session file path for a given session ID (from persistent map).
	 */
	getSessionFile(sessionId, projectPath = null) {
		if (projectPath) {
			const projectKey = this.#makeKey(projectPath, sessionId);
			const file = this.#sessionFileMap.get(projectKey);
			if (file) return file;
		}

		for (const [key, value] of this.#sessionFileMap) {
			if (key.endsWith(`:${sessionId}`)) {
				return value;
			}
		}

		return this.#legacySessionFileMap.get(sessionId) || null;
	}

	/**
	 * Cleanup idle sessions that have exceeded the timeout.
	 */
	cleanup() {
		const now = Date.now();
		let cleaned = 0;

		for (const [sessionId, entry] of this.#sessions) {
			const idleMs = now - entry.lastActivity.getTime();

			if (idleMs > IDLE_TIMEOUT_MS && !entry.idleTimer) {
				logger.info(
					`[SdkSessionManager] Cleanup: session ${sessionId} idle for ${Math.round(idleMs / 1000)}s`,
				);
				this.destroy(sessionId);
				cleaned++;
			}
		}

		if (cleaned > 0) {
			logger.info(
				`[SdkSessionManager] Cleanup: removed ${cleaned} sessions (${this.#sessions.size} remaining)`,
			);
		}
	}

	// ── Introspection ───────────────────────────────────────────────

	get size() {
		return this.#sessions.size;
	}

	get knownSessions() {
		return this.#sessionFileMap.size;
	}

	listSessions() {
		return [...this.#sessions.keys()];
	}

	/**
	 * Get resolved session-file aliases for a project.
	 * Returns Map<absoluteSessionFile, logicalSessionId>.
	 */
	getSessionAliasesForProject(projectPath) {
		const aliases = new Map();
		const prefix = `${projectPath}:`;

		for (const [key, filePath] of this.#sessionFileMap) {
			if (!key.startsWith(prefix) || typeof filePath !== "string") continue;

			const logicalSessionId = key.slice(prefix.length);
			const resolvedFilePath = path.resolve(filePath);
			const fileSessionId = this.#extractSessionIdFromSessionFile(filePath);
			const existing = aliases.get(resolvedFilePath);

			// Prefer Cleon's logical ID over Pi's file UUID when both point at the same file.
			if (
				!existing ||
				(existing === fileSessionId && logicalSessionId !== fileSessionId)
			) {
				aliases.set(resolvedFilePath, logicalSessionId);
			}
		}

		return aliases;
	}

	// ── Private helpers ─────────────────────────────────────────────

	#makeKey(projectPath, sessionId) {
		return `${projectPath}:${sessionId}`;
	}

	/**
	 * Scan the Pi sessions directory for a file whose name contains the given sessionId.
	 * The Pi SDK names session files as: <timestamp>_<uuid>.jsonl, where <uuid> is also
	 * stored in the file header's `id` field. Since the Cleon sessionId IS this UUID,
	 * a filename scan is sufficient — no file reading required.
	 *
	 * This bridges CLI → web UI continuity: CLI sessions are never registered in
	 * cleon-sessions.json, so without this scan they'd always start fresh.
	 *
	 * @param {string} projectPath - Absolute project path (e.g. /Users/james/myproject)
	 * @param {string} sessionId - The Cleon / Pi session UUID to look for
	 * @returns {Promise<string|null>} Absolute path to the matching .jsonl file, or null
	 */
	async #findCliSessionFile(projectPath, sessionId) {
		try {
			const safePath = encodePiDirName(projectPath);
			const sessionDir = path.join(
				os.homedir(),
				".pi",
				"agent",
				"sessions",
				safePath,
			);

			const files = await fs.readdir(sessionDir);
			for (const file of files) {
				if (file.endsWith(".jsonl") && file.includes(sessionId)) {
					return path.join(sessionDir, file);
				}
			}
		} catch {
			// Session directory doesn't exist or is unreadable — not an error, just no match
		}
		return null;
	}

	#extractProjectFromSessionFile(sessionFile) {
		const match = sessionFile.match(/\/sessions\/(--[^/]+--)\/[^/]+\.jsonl$/);
		if (!match) return null;
		return decodePiDirName(match[1]);
	}

	#extractSessionIdFromSessionFile(sessionFile) {
		const basename = path.basename(sessionFile, ".jsonl");
		const match = basename.match(
			/_([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/,
		);
		return match ? match[1] : basename;
	}

	#clearIdleTimer(entry) {
		if (entry.idleTimer) {
			clearTimeout(entry.idleTimer);
			entry.idleTimer = null;
		}
	}

	#evictOldestIdle() {
		let oldestId = null;
		let oldestEntry = null;
		let oldestTime = Infinity;

		for (const [sessionId, entry] of this.#sessions) {
			if (entry.idleTimer && entry.lastActivity.getTime() < oldestTime) {
				oldestTime = entry.lastActivity.getTime();
				oldestId = sessionId;
				oldestEntry = entry;
			}
		}

		if (oldestId) {
			logger.info(
				`[SdkSessionManager] Evicting idle session ${oldestId} to make room`,
			);
			this.#notifyEvicted(oldestId, oldestEntry, "capacity");
			this.destroy(oldestId);
			return true;
		}

		return false;
	}

	// Publish a session-evicted event so subscribed tabs can surface a toast.
	// The Pi AgentSession is gone; the persistent sessionId→sessionFile mapping
	// remains, so the next prompt for this session reopens it transparently.
	#notifyEvicted(sessionId, entry, reason) {
		if (!entry?.username) return;
		try {
			publish(entry.username, {
				type: "session-evicted",
				sessionId,
				reason,
			});
		} catch (err) {
			logger.warn(
				`[SdkSessionManager] Failed to publish session-evicted for ${sessionId}:`,
				err.message,
			);
		}
	}

	async #fileExists(p) {
		try {
			await fs.access(p);
			return true;
		} catch {
			return false;
		}
	}

	async #loadSessionFileMap() {
		try {
			const data = await fs.readFile(SESSIONS_FILE, "utf8");
			const parsed = JSON.parse(data);

			let prunedCount = 0;

			if (parsed && typeof parsed === "object") {
				for (const [key, value] of Object.entries(parsed)) {
					if (typeof value !== "string") continue;

					if (!(await this.#fileExists(value))) {
						prunedCount++;
						logger.warn(
							`[SdkSessionManager] Pruning stale mapping (file missing): ${key} → ${value}`,
						);
						continue;
					}

					if (key.includes(":") && key.startsWith("/")) {
						this.#sessionFileMap.set(key, value);
					} else {
						const projectPath = this.#extractProjectFromSessionFile(value);
						if (projectPath) {
							const newKey = this.#makeKey(projectPath, key);
							this.#sessionFileMap.set(newKey, value);
							logger.info(
								`[SdkSessionManager] Migrated legacy session ${key} → ${newKey}`,
							);
						} else {
							this.#legacySessionFileMap.set(key, value);
							logger.info(
								`[SdkSessionManager] Keeping legacy session ${key} (could not extract project)`,
							);
						}
					}
				}
			}

			if (prunedCount > 0) {
				await this.#saveSessionFileMap();
			}

			logger.info(
				`[SdkSessionManager] Loaded ${this.#sessionFileMap.size} session mappings ` +
					`(+ ${this.#legacySessionFileMap.size} legacy, pruned ${prunedCount}) from ${SESSIONS_FILE}`,
			);
		} catch (err) {
			if (err.code === "ENOENT") {
				logger.info(
					`[SdkSessionManager] No existing sessions file at ${SESSIONS_FILE}`,
				);
			} else {
				logger.warn(
					`[SdkSessionManager] Failed to load sessions file:`,
					err.message,
				);
			}
		}
	}

	async #saveSessionFileMap() {
		let tmpFile = null;
		try {
			const dir = path.dirname(SESSIONS_FILE);
			await fs.mkdir(dir, { recursive: true });

			tmpFile = path.join(
				dir,
				`.cleon-sessions.${process.pid}.${Date.now()}.tmp`,
			);
			const obj = Object.fromEntries(this.#sessionFileMap);
			await fs.writeFile(tmpFile, JSON.stringify(obj, null, 2) + "\n", "utf8");
			await fs.rename(tmpFile, SESSIONS_FILE);
		} catch (err) {
			if (tmpFile) {
				try {
					await fs.unlink(tmpFile);
				} catch {
					/* ignore cleanup failure */
				}
			}
			logger.error(
				`[SdkSessionManager] Failed to save sessions file:`,
				err.message,
			);
		}
	}
}

// ─── Singleton export ───────────────────────────────────────────────

export { SdkSessionManager };
