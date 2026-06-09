/**
 * Session file watcher — detects active CLI pi sessions by monitoring
 * .jsonl session files for changes, and streams new entries as events.
 *
 * This bridges the gap between standalone `pi` terminal sessions and
 * the Cleon UI web interface: when a user navigates to a session that
 * is being actively driven from the CLI, this module tails the session
 * file and publishes events through the event bus.
 */

import { promises as fs } from "fs";
import { watch } from "fs";
import { execSync } from "child_process";
import path from "path";
import os from "os";
import { publish } from "./bus.js";
import logger from "./logger.js";
import {
	startSessionBuffer,
	broadcastToSession,
	clearSessionBuffer,
} from "./broadcast.js";
import { register, setStatus } from "./session-registry.js";
import { getSdkSessionManager } from "./session-manager-instance.js";
import { decode as decodePiDirName } from "./pi-path.js";

const PI_SESSIONS = path.join(os.homedir(), ".pi", "agent", "sessions");

// How recently the file must have been modified to be considered "active" (ms)
const ACTIVE_THRESHOLD_MS = 5 * 60_000; // 5 minutes — generous because pi sessions
// can be idle while the user reads output

// How long without file changes before we check if pi process is still running
const IDLE_CHECK_MS = 30_000; // 30 seconds — then we verify via process detection

// How often to re-check if the pi process is still running when file is idle
const PROCESS_CHECK_INTERVAL_MS = 15_000; // 15 seconds

// How often to poll for file changes (fallback for unreliable fs.watch on macOS)
const POLL_INTERVAL_MS = 2_000; // 2 seconds

// How long after the last assistant message before we consider the turn "done"
const TURN_COMPLETE_DELAY_MS = 3_000; // 3 seconds

// How many bytes to read from the end of the file to check turn state
const TURN_STATE_CHECK_BYTES = 200_000; // 200KB - handles very long assistant messages

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
 * @property {NodeJS.Timeout | null} pollTimer - polling interval for file changes (macOS fs.watch fallback)
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
				if (file.endsWith(".jsonl") && file.includes(sessionId)) {
					return path.join(dirPath, file);
				}
			}
		}
	} catch {
		/* ignore */
	}
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
		const fd = await fs.open(filePath, "r");
		try {
			const buf = Buffer.alloc(4096); // Header is usually small
			await fd.read(buf, 0, buf.length, 0);
			const firstLine = buf.toString("utf8").split("\n")[0];
			if (firstLine) {
				const entry = JSON.parse(firstLine);
				if (entry.type === "session" && entry.cwd) {
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
	} catch {
		/* fall through */
	}

	// Fallback: decode directory name (lossy for dashes)
	const rawPath = decodePiDirName(dirName);
	return {
		name: dirName,
		path: rawPath,
		displayName: path.basename(rawPath),
	};
}

// How long an assistant turn must sit unchanged before we treat it as a
// stale streaming status that the orphan-detection path should clear.
const STALE_TURN_AGE_MS = 3_000;

// How long the session file mtime must be quiet before we treat the session
// as crashed even when the last persisted message doesn't look like a clean
// turn end (assistant + toolUse, or just a user prompt). Matches
// ACTIVE_THRESHOLD_MS so this never undercuts the CLI-attach heuristic.
const STALE_FILE_AGE_MS = ACTIVE_THRESHOLD_MS;

/**
 * Decide whether a session whose registry status is 'streaming' should be
 * reclassified as idle, based on the most recent persisted message and the
 * session file's mtime.
 *
 * Two independent signals can trip the decision:
 *
 *   1. The last persisted message looks like a clean turn end (assistant
 *      with stopReason 'stop' | 'aborted' | 'error') and has been quiet for
 *      >= STALE_TURN_AGE_MS. stopReason 'toolUse' means the agent was
 *      waiting for a tool result; stopReason null means a mid-stream message
 *      that never got finalised — neither qualifies as a clean end.
 *
 *   2. The session file itself has been quiet for >= STALE_FILE_AGE_MS.
 *      Pi's auto-compaction and auto-retry both run in the owning process,
 *      so once we know that process isn't us, a long-quiet file means the
 *      owner is gone. This catches the cases (1) misses: crash mid-tool-call
 *      and crash right after a bare user prompt.
 *
 * @param {{ lastRole: string|null, timestamp: Date|null, stopReason: string|null, fileMtimeMs: number|null }} turnState
 * @param {number} [now=Date.now()]
 * @returns {{ stale: boolean, reason: 'message-age'|'file-age'|null, messageQuietMs: number|null, fileQuietMs: number|null }}
 */
export function evaluateStaleStreaming(turnState, now = Date.now()) {
	const turnEndedCleanly =
		turnState.lastRole === "assistant" &&
		turnState.stopReason !== "toolUse" &&
		turnState.stopReason !== null;

	const messageQuietMs =
		turnEndedCleanly && turnState.timestamp
			? now - turnState.timestamp.getTime()
			: null;

	const fileQuietMs =
		turnState.fileMtimeMs != null ? now - turnState.fileMtimeMs : null;

	const staleByMessage =
		messageQuietMs != null && messageQuietMs >= STALE_TURN_AGE_MS;
	const staleByFile = fileQuietMs != null && fileQuietMs >= STALE_FILE_AGE_MS;

	let reason = null;
	if (staleByMessage) reason = "message-age";
	else if (staleByFile) reason = "file-age";

	return {
		stale: staleByMessage || staleByFile,
		reason,
		messageQuietMs,
		fileQuietMs,
	};
}

/**
 * Check the last message in a session file to determine turn state.
 * Reads the last ~200KB of the file and parses JSONL entries to find
 * the last message and its role/timestamp. Skips partial lines at the
 * start of the buffer to ensure only complete JSONL entries are parsed.
 *
 * Also returns the file's mtime so callers can detect a long-quiet
 * session file (a crashed owner stops writing entirely).
 *
 * @param {string} filePath - Path to the .jsonl session file
 * @returns {Promise<{lastRole: 'assistant'|'user'|'toolResult'|null, timestamp: Date|null, stopReason: string|null, fileMtimeMs: number|null}>}
 */
export async function checkLastMessageTurnState(filePath) {
	try {
		const stats = await fs.stat(filePath);
		if (stats.size === 0) {
			return {
				lastRole: null,
				timestamp: null,
				stopReason: null,
				fileMtimeMs: stats.mtimeMs,
			};
		}

		// Read the last TURN_STATE_CHECK_BYTES of the file
		const readSize = Math.min(TURN_STATE_CHECK_BYTES, stats.size);
		const offset = stats.size - readSize;

		const fd = await fs.open(filePath, "r");
		try {
			const buf = Buffer.alloc(readSize);
			await fd.read(buf, 0, readSize, offset);
			const text = buf.toString("utf8");

			// Split into lines and parse JSONL entries
			const lines = text.split("\n").filter(Boolean);

			// Skip the first line if it's partial (we may have started reading mid-line)
			// A partial line won't start at the beginning of our buffer
			const startIndex = offset > 0 ? 1 : 0;
			const entries = [];

			for (let i = startIndex; i < lines.length; i++) {
				const line = lines[i];
				try {
					const entry = JSON.parse(line);
					entries.push(entry);
				} catch {
					// Skip malformed lines
				}
			}

			// Find the last message entry (scan from end)
			for (let i = entries.length - 1; i >= 0; i--) {
				const entry = entries[i];
				if (entry.type === "message" && entry.message && entry.message.role) {
					const role = entry.message.role;
					const timestamp = entry.timestamp ? new Date(entry.timestamp) : null;
					const stopReason = entry.message.stopReason || null;
					return {
						lastRole: role,
						timestamp,
						stopReason,
						fileMtimeMs: stats.mtimeMs,
					};
				}
			}

			return {
				lastRole: null,
				timestamp: null,
				stopReason: null,
				fileMtimeMs: stats.mtimeMs,
			};
		} finally {
			await fd.close();
		}
	} catch (err) {
		logger.error(
			`[SessionWatcher] Error checking turn state for ${filePath}:`,
			err.message,
		);
		return {
			lastRole: null,
			timestamp: null,
			stopReason: null,
			fileMtimeMs: null,
		};
	}
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
 * Check if a session is already owned by the Cleon UI SDK session manager.
 * If so, we should NOT watch the file — events are already flowing through the SDK.
 *
 * @param {string} sessionId
 * @returns {boolean}
 */
function isOwnedBySdk(sessionId) {
	const manager = getSdkSessionManager();
	const live = manager.get(sessionId);
	return !!(live && live.session);
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
		return { status: w.turnComplete ? "idle" : "streaming", watching: true };
	}

	// Owned by SDK? Let the normal flow handle it.
	if (isOwnedBySdk(sessionId)) {
		return { status: "sdk-owned", watching: false };
	}

	// Resolve file
	const filePath = await resolveSessionFile(sessionId);
	if (!filePath) {
		return { status: "not-found", watching: false };
	}

	// Is the file active?
	const active = await isFileActive(filePath);
	if (!active) {
		return { status: "idle", watching: false };
	}

	// Check the last message in the session file to determine turn state
	const turnState = await checkLastMessageTurnState(filePath);
	let initialTurnComplete = false;
	let initialStatus = "streaming";

	// If last message is from assistant and timestamp is older than TURN_COMPLETE_DELAY_MS,
	// the turn is already complete
	if (turnState.lastRole === "assistant" && turnState.timestamp) {
		const timeSinceLastMessage = Date.now() - turnState.timestamp.getTime();
		if (timeSinceLastMessage >= TURN_COMPLETE_DELAY_MS) {
			initialTurnComplete = true;
			initialStatus = "idle";
		}
	}

	// Start watching
	logger.info(
		`[SessionWatcher] Starting file watch for CLI session ${sessionId}: ${filePath}`,
	);

	const stats = await fs.stat(filePath);
	const watcher = {
		sessionId,
		filePath,
		username,
		offset: stats.size, // Start from current end — don't replay existing content
		fsWatcher: null,
		idleTimer: null,
		turnCompleteTimer: null,
		pollTimer: null,
		processing: false,
		turnComplete: initialTurnComplete,
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
		status: initialStatus,
		piSessionFile: filePath,
	});

	// Start message buffer for replay
	startSessionBuffer(sessionId);

	// Notify client of session status
	publish(username, {
		type: "session-status",
		sessionId,
		status: initialStatus,
	});

	// If session is already idle (turn complete), send 'done' event immediately
	// so the UI is unblocked and shows the send button
	if (initialStatus === "idle") {
		const doneEvent = { type: "done", sessionId };
		broadcastToSession(sessionId, doneEvent);
		publish(username, doneEvent);
		logger.info(
			`[SessionWatcher] Session ${sessionId} — turn already complete, sent 'done' event`,
		);
	}

	// Start fs.watch (primary) + polling fallback
	// fs.watch on macOS can intermittently stop firing 'change' events,
	// so we also poll the file size every POLL_INTERVAL_MS as a safety net.
	watcher.fsWatcher = watch(filePath, { persistent: false }, (eventType) => {
		if (
			(eventType === "change" || eventType === "rename") &&
			!watcher.processing
		) {
			watcher.processing = true;
			processNewLines(watcher).finally(() => {
				watcher.processing = false;
			});
			resetIdleTimer(watcher);
		}
	});

	// Polling fallback: check file size periodically
	// This catches writes that fs.watch misses (common on macOS)
	watcher.pollTimer = setInterval(async () => {
		if (watcher.processing) return;
		try {
			const stats = await fs.stat(watcher.filePath);
			if (stats.size > watcher.offset) {
				watcher.processing = true;
				await processNewLines(watcher);
				watcher.processing = false;
				resetIdleTimer(watcher);
			}
		} catch {
			/* file may have been deleted */
		}
	}, POLL_INTERVAL_MS);
	if (watcher.pollTimer.unref) watcher.pollTimer.unref();

	resetIdleTimer(watcher);
	activeWatchers.set(sessionId, watcher);

	return { status: initialStatus, watching: true };
}

/**
 * Read new bytes appended to the session file and emit events.
 */
async function processNewLines(watcher) {
	// If the SDK has taken over this session (user sent a message via web UI),
	// stop the file watcher immediately to prevent duplicate events.
	// The SDK emits its own events through the broadcast system.
	if (isOwnedBySdk(watcher.sessionId)) {
		logger.info(
			`[SessionWatcher] Session ${watcher.sessionId} — SDK took over, stopping file watcher`,
		);
		stopWatcher(watcher.sessionId);
		return;
	}

	try {
		const stats = await fs.stat(watcher.filePath);
		if (stats.size <= watcher.offset) return;

		// Read new bytes
		const fd = await fs.open(watcher.filePath, "r");
		try {
			const buf = Buffer.alloc(stats.size - watcher.offset);
			await fd.read(buf, 0, buf.length, watcher.offset);
			watcher.offset = stats.size;

			const text = buf.toString("utf8");
			const lines = text.split("\n").filter(Boolean);

			for (const line of lines) {
				try {
					const entry = JSON.parse(line);
					emitSessionEntry(watcher, entry);
				} catch {
					/* skip malformed */
				}
			}
		} finally {
			await fd.close();
		}
	} catch (err) {
		logger.error(
			`[SessionWatcher] Error reading ${watcher.filePath}:`,
			err.message,
		);
	}
}

/**
 * Transform a Pi JSONL session entry into Cleon UI events and publish them.
 */
function emitSessionEntry(watcher, entry) {
	const { sessionId, username } = watcher;
	const timestamp = entry.timestamp || new Date().toISOString();
	const messageId = entry.id || crypto.randomUUID?.() || String(Date.now());

	if (entry.type !== "message") return;

	const msg = entry.message;
	if (!msg) return;

	if (msg.role === "assistant") {
		const content = msg.content;
		if (!Array.isArray(content)) return;

		// Track this assistant message for turn completion detection
		// If this is a new message (different ID), reset turn state
		if (watcher.lastAssistantMessageId !== messageId) {
			watcher.lastAssistantMessageId = messageId;
			// New assistant message means a new turn is starting
			watcher.turnComplete = false;
			// Update session status to streaming
			setStatus(sessionId, "streaming");
			publish(username, {
				type: "session-status",
				sessionId,
				status: "streaming",
			});
		}
		// Cancel any pending turn complete (more content is arriving)
		cancelTurnComplete(watcher);

		for (const block of content) {
			if (block.type === "text" && block.text) {
				const event = {
					type: "message",
					sessionId,
					data: {
						type: "text",
						content: block.text,
						timestamp,
						messageId,
					},
				};
				broadcastToSession(sessionId, event);
				publish(username, event);
			}

			if (block.type === "toolCall") {
				const event = {
					type: "message",
					sessionId,
					data: {
						type: "tool_use",
						tool: block.name || "unknown",
						id: block.id || messageId,
						summary: {
							summary: formatToolSummary(block.name, block.arguments),
						},
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

	if (msg.role === "toolResult") {
		// Tool result means assistant is still processing - cancel pending turn complete
		// The assistant will emit another message with the next step
		cancelTurnComplete(watcher);

		const output = extractTextContent(msg.content);
		const event = {
			type: "message",
			sessionId,
			data: {
				type: "tool_result",
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

	if (msg.role === "user") {
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
		const pids = execSync("pgrep -x pi 2>/dev/null", {
			encoding: "utf8",
			timeout: 3000,
		})
			.trim()
			.split("\n")
			.filter(Boolean);

		for (const pid of pids) {
			try {
				// lsof -p <pid> returns all FDs for that specific process.
				// Filter for cwd type and extract the path.
				// Output format: "p<pid>\nfcwd\nn<path>\n..."
				const output = execSync(`lsof -p ${pid} -Fn -d cwd 2>/dev/null`, {
					encoding: "utf8",
					timeout: 2000,
				});
				// Find lines starting with 'n' that follow 'fcwd' — get the first one
				// matching our target PID (lsof may include child processes)
				const lines = output.split("\n");
				for (let i = 0; i < lines.length; i++) {
					if (
						lines[i] === `p${pid}` &&
						i + 2 < lines.length &&
						lines[i + 1] === "fcwd"
					) {
						const cwdLine = lines[i + 2];
						if (cwdLine.startsWith("n") && cwdLine.slice(1) === projectPath) {
							return true;
						}
					}
				}
			} catch {
				/* skip this pid */
			}
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
			logger.info(
				`[SessionWatcher] Session ${watcher.sessionId} — turn complete (no activity for ${TURN_COMPLETE_DELAY_MS}ms)`,
			);
			watcher.turnComplete = true;

			// Send done event for this turn
			const doneEvent = { type: "done", sessionId: watcher.sessionId };
			broadcastToSession(watcher.sessionId, doneEvent);
			publish(watcher.username, doneEvent);

			// Update session status to idle
			setStatus(watcher.sessionId, "idle");
			publish(watcher.username, {
				type: "session-status",
				sessionId: watcher.sessionId,
				status: "idle",
			});
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
		logger.info(
			`[SessionWatcher] Session ${watcher.sessionId} file idle but pi process still running`,
		);
		watcher.idleTimer = setTimeout(() => {
			checkAndMaybeStop(watcher);
		}, PROCESS_CHECK_INTERVAL_MS);
		if (watcher.idleTimer.unref) watcher.idleTimer.unref();
	} else {
		logger.info(
			`[SessionWatcher] Session ${watcher.sessionId} — pi process no longer running, stopping watch`,
		);
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
	if (watcher.pollTimer) {
		clearInterval(watcher.pollTimer);
		watcher.pollTimer = null;
	}
	if (watcher.turnCompleteTimer) {
		clearTimeout(watcher.turnCompleteTimer);
		watcher.turnCompleteTimer = null;
	}

	// Only send done if turn wasn't already marked complete
	if (!watcher.turnComplete) {
		// Mark session as idle
		setStatus(sessionId, "idle");
		publish(watcher.username, {
			type: "session-status",
			sessionId,
			status: "idle",
		});

		// Send done event
		const doneEvent = { type: "done", sessionId };
		broadcastToSession(sessionId, doneEvent);
		publish(watcher.username, doneEvent);
	}

	// Clear buffer after a brief delay (let clients process 'done' first)
	setTimeout(() => clearSessionBuffer(sessionId), 2000);

	activeWatchers.delete(sessionId);
	logger.info(`[SessionWatcher] Stopped watching ${sessionId}`);
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
	if (typeof content === "string") return content;
	if (Array.isArray(content)) {
		return content
			.filter((c) => c.type === "text")
			.map((c) => c.text)
			.join("\n");
	}
	return String(content || "");
}

function truncate(str, max) {
	if (str.length <= max) return str;
	return str.slice(0, max) + `\n... (${str.length - max} more chars)`;
}

function formatToolSummary(tool, args) {
	if (!args) return tool || "unknown";
	const t = (tool || "").toLowerCase();
	switch (t) {
		case "bash":
			return `$ ${truncate(args.command || "", 200)}`;
		case "read":
			return `Read ${args.path || args.file_path || ""}`;
		case "write":
			return `Write ${args.path || args.file_path || ""}`;
		case "edit":
			return `Edit ${args.path || args.file_path || ""}`;
		case "glob":
			return `Find ${args.pattern || ""}`;
		case "grep":
			return `Search ${args.pattern || ""}`;
		default:
			return tool || "unknown";
	}
}
