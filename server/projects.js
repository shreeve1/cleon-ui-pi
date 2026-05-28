import express from "express";
import { promises as fs } from "fs";
import path from "path";
import os from "os";
import { glob } from "glob";
import { getSdkSessionManager } from "./session-manager-instance.js";
import {
	encode as encodePiDirName,
	decode as decodePiDirName,
	extractProjectPath,
	isPiDirName,
} from "./pi-path.js";

const router = express.Router();
const PI_SESSIONS = path.join(os.homedir(), ".pi", "agent", "sessions");

// Constants
const MAX_PROJECTS = 30;
const MAX_SESSIONS = 30;
const MAX_FILE_RESULTS = 20;
const SESSION_PREVIEW_LENGTH = 120;

// Pi dir name codec imported from pi-path.js

/**
 * GET /api/projects/search?q=/path/to/project
 * Search projects by path substring
 */
router.get("/search", async (req, res) => {
	const query = (req.query.q || "").toLowerCase().trim();

	try {
		const projects = [];

		// ── Read from Pi sessions directory ──
		try {
			const entries = await fs.readdir(PI_SESSIONS, { withFileTypes: true });

			for (const entry of entries) {
				if (!entry.isDirectory()) continue;
				// Pi dir names look like --Users-james-1-testytech-homelab--
				if (!entry.name.startsWith("--") || !entry.name.endsWith("--"))
					continue;

				const piDir = path.join(PI_SESSIONS, entry.name);
				const actualPath = await extractProjectPath(piDir, entry.name);

				if (query && !actualPath.toLowerCase().includes(query)) continue;

				let piFiles;
				try {
					piFiles = await fs.readdir(piDir);
				} catch {
					continue;
				}
				const piSessions = piFiles.filter((f) => f.endsWith(".jsonl"));

				projects.push({
					name: entry.name,
					path: actualPath,
					displayName: path.basename(actualPath),
					sessionCount: piSessions.length,
					source: "pi",
				});
			}
		} catch (err) {
			if (err.code !== "ENOENT") {
				console.error("[Projects] Error reading Pi sessions:", err);
			}
		}

		// Sort by path
		projects.sort((a, b) => a.path.localeCompare(b.path));

		res.json(projects.slice(0, MAX_PROJECTS));
	} catch (err) {
		console.error("[Projects] Search error:", err);
		res.status(500).json({ error: "Failed to search projects" });
	}
});

/**
 * GET /api/projects/:name/sessions
 * List sessions for a project, sorted by most recent.
 */
router.get("/:name/sessions", async (req, res) => {
	// Explicitly disable caching for session lists (they change frequently)
	res.setHeader(
		"Cache-Control",
		"no-store, no-cache, must-revalidate, proxy-revalidate",
	);
	res.setHeader("Pragma", "no-cache");
	res.setHeader("Expires", "0");

	const projectName = req.params.name;

	try {
		const sessions = [];

		// ── Pi sessions ──
		const piDirName = await resolvePiDirName(projectName);
		if (piDirName) {
			const piDir = path.join(PI_SESSIONS, piDirName);
			try {
				const files = await fs.readdir(piDir);
				const jsonlFiles = files.filter((f) => f.endsWith(".jsonl"));
				const projectPath = await extractProjectPath(piDir, piDirName);
				const sessionAliases =
					getSdkSessionManager().getSessionAliasesForProject(projectPath);

				const piSessions = await Promise.all(
					jsonlFiles.map(async (file) => {
						const filePath = path.join(piDir, file);
						const stats = await fs.stat(filePath);
						const preview = await getSessionPreview(filePath);

						// Extract UUID from filename: 2026-03-03T00-24-17-226Z_e824d2d4-297b-4b26-86ba-4d927e7a376b.jsonl
						const basename = path.basename(file, ".jsonl");
						const uuidMatch = basename.match(
							/_([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/,
						);
						const sessionId = uuidMatch ? uuidMatch[1] : basename;
						const logicalSessionId =
							sessionAliases.get(path.resolve(filePath)) || sessionId;

						return {
							id: logicalSessionId,
							file,
							lastModified: stats.mtime.toISOString(),
							preview,
							source: "pi",
						};
					}),
				);

				sessions.push(...piSessions);
			} catch (err) {
				if (err.code !== "ENOENT") {
					console.error("[Projects] Error reading Pi sessions:", err);
				}
			}
		}

		// Sort by most recent first
		sessions.sort(
			(a, b) => new Date(b.lastModified) - new Date(a.lastModified),
		);

		res.json(sessions.slice(0, MAX_SESSIONS));
	} catch (err) {
		console.error("[Projects] Sessions error:", err);
		res.status(500).json({ error: "Failed to load sessions" });
	}
});

/**
 * GET /api/projects/:name/sessions/:sessionId/messages
 * Get messages for a specific session
 */
router.get("/:name/sessions/:sessionId/messages", async (req, res) => {
	const { name, sessionId } = req.params;
	const limit = parseInt(req.query.limit) || 100;

	console.log(
		`[Projects] GET messages for project="${name}" sessionId="${sessionId}"`,
	);

	try {
		const messages = await getSessionMessages(name, sessionId, limit);
		console.log(`[Projects] Returning ${messages.length} messages`);
		res.json({ messages });
	} catch (err) {
		console.error("[Projects] Messages error:", err);
		res.status(500).json({ error: "Failed to load messages" });
	}
});

/**
 * GET /api/projects/:name/path
 * Get the actual filesystem path for a project
 */
router.get("/:name/path", async (req, res) => {
	const projectName = req.params.name;

	// Try Pi directory
	if (projectName.startsWith("--") && projectName.endsWith("--")) {
		const piDir = path.join(PI_SESSIONS, projectName);
		try {
			const actualPath = await extractProjectPath(piDir, projectName);
			return res.json({ path: actualPath });
		} catch {
			/* fall through */
		}
	}

	// Fallback to decoded name
	res.json({ path: decodePiDirName(projectName) });
});

// ─── Helpers: Project path extraction ───────────────────────────────

/**
 * Resolve the Pi directory name for a given project name.
 * If the name is already a Pi dir name (--..--), use it directly.
 * Otherwise, try to find a matching Pi dir by path.
 */
async function resolvePiDirName(projectName) {
	// Already a Pi dir name
	if (isPiDirName(projectName)) {
		return projectName;
	}

	// Try encoding as Pi dir name and check
	const piDirName = encodePiDirName(projectName);
	try {
		await fs.access(path.join(PI_SESSIONS, piDirName));
		return piDirName;
	} catch {
		/* not found, try scanning */
	}

	// Fallback: scan Pi dirs for a cwd match
	try {
		const entries = await fs.readdir(PI_SESSIONS, { withFileTypes: true });
		for (const entry of entries) {
			if (!entry.isDirectory()) continue;
			if (!entry.name.startsWith("--") || !entry.name.endsWith("--")) continue;

			const piDir = path.join(PI_SESSIONS, entry.name);
			const resolvedPath = await extractProjectPath(piDir, entry.name);
			if (resolvedPath === projectName) {
				return entry.name;
			}
		}
	} catch {
		/* ignore */
	}

	return null;
}

async function validateSessionFilePath(filePath, piDir) {
	try {
		const realFilePath = await fs.realpath(filePath);
		const realPiDir = await fs.realpath(piDir);
		const relative = path.relative(realPiDir, realFilePath);

		if (relative.startsWith("..") || path.isAbsolute(relative)) {
			return null;
		}

		return realFilePath;
	} catch {
		return null;
	}
}

async function getMappedSessionPath(projectPath, sessionId, piDir) {
	const sessionFile = getSdkSessionManager().getSessionFile(
		sessionId,
		projectPath,
	);
	if (!sessionFile) return null;

	return validateSessionFilePath(sessionFile, piDir);
}

// ─── Helpers: Session preview extraction ────────────────────────────

/**
 * Extract first meaningful user message as session preview.
 */
async function getSessionPreview(filePath) {
	try {
		const content = await fs.readFile(filePath, "utf8");
		const lines = content.split("\n").filter(Boolean);

		for (const line of lines.slice(0, 50)) {
			try {
				const entry = JSON.parse(line);

				// Pi format: { type: "message", message: { role: "user", content: [...] } }
				if (entry.type !== "message") continue;
				if (entry.message?.role !== "user") continue;

				const text = extractPiTextContent(entry.message.content);
				if (
					text &&
					!text.startsWith("<") &&
					!text.startsWith("{") &&
					!text.includes("CRITICAL:")
				) {
					const preview = text.slice(0, SESSION_PREVIEW_LENGTH);
					return preview + (text.length > SESSION_PREVIEW_LENGTH ? "..." : "");
				}
			} catch {
				/* skip malformed */
			}
		}

		return "New session";
	} catch {
		return "New session";
	}
}

/**
 * Extract text from Pi message content.
 * Content can be a string or an array of { type: "text", text: "..." } blocks.
 */
function extractPiTextContent(content) {
	if (typeof content === "string") return content;
	if (Array.isArray(content)) {
		const textBlocks = content.filter((c) => c.type === "text");
		if (textBlocks.length > 0) {
			return textBlocks.map((c) => c.text).join("\n");
		}
	}
	return null;
}

// ─── Helpers: Session messages ──────────────────────────────────────

async function getSessionMessages(projectName, sessionId, limit = 100) {
	console.log(
		`[getSessionMessages] projectName="${projectName}" sessionId="${sessionId}"`,
	);

	const piMessages = await getPiSessionMessages(projectName, sessionId, limit);
	console.log(`[getSessionMessages] Pi: ${piMessages.length} messages`);

	piMessages.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
	return piMessages.slice(-limit);
}

/**
 * Get messages from a Pi session file.
 * Pi sessions: each .jsonl file IS a session. The session ID is the UUID from the filename
 * or the header's id field. All entries in the file belong to that session.
 */
async function getPiSessionMessages(projectName, sessionId, _limit) {
	try {
		const piDirName = await resolvePiDirName(projectName);
		if (!piDirName) return [];

		const piDir = path.join(PI_SESSIONS, piDirName);
		const files = await fs.readdir(piDir);
		const jsonlFiles = files.filter((f) => f.endsWith(".jsonl"));
		const projectPath = await extractProjectPath(piDir, piDirName);

		// First resolve Cleon's logical session ID to the Pi SDK session file.
		let targetFilePath = await getMappedSessionPath(
			projectPath,
			sessionId,
			piDir,
		);

		// Find the file matching this session ID
		if (!targetFilePath) {
			for (const file of jsonlFiles) {
				// Check if UUID in filename matches
				if (file.includes(sessionId)) {
					targetFilePath = await validateSessionFilePath(
						path.join(piDir, file),
						piDir,
					);
					break;
				}
			}
		}

		// Also check session headers if no filename match
		if (!targetFilePath) {
			for (const file of jsonlFiles) {
				try {
					const candidatePath = path.join(piDir, file);
					const content = await fs.readFile(candidatePath, "utf8");
					const firstLine = content.split("\n")[0];
					if (!firstLine) continue;
					const header = JSON.parse(firstLine);
					if (header.type === "session" && header.id === sessionId) {
						targetFilePath = await validateSessionFilePath(
							candidatePath,
							piDir,
						);
						break;
					}
				} catch {
					/* skip */
				}
			}
		}

		if (!targetFilePath) return [];

		const content = await fs.readFile(targetFilePath, "utf8");
		const lines = content.split("\n").filter(Boolean);
		const messages = [];

		for (const line of lines) {
			try {
				const entry = JSON.parse(line);
				const msg = parsePiMessageEntry(entry);
				if (msg) messages.push(msg);
			} catch {
				/* skip malformed */
			}
		}

		return messages;
	} catch {
		return [];
	}
}

// ─── Message parsing: Pi format ─────────────────────────────────────

function parsePiMessageEntry(entry) {
	// Only process message-type entries
	if (entry.type !== "message") return null;

	const timestamp = entry.timestamp || new Date().toISOString();
	const messageId = entry.id || null;
	const message = entry.message;
	if (!message) return null;

	const role = message.role;
	const content = message.content;

	// ── User message ──
	if (role === "user") {
		const text = extractPiTextContent(content);
		if (
			text &&
			text.length > 0 &&
			!text.startsWith("<") &&
			!text.startsWith("{")
		) {
			return { role: "user", content: text, timestamp, messageId };
		}
		return null;
	}

	// ── Assistant message ──
	if (role === "assistant") {
		if (Array.isArray(content)) {
			// Extract text parts
			const textParts = content
				.filter((c) => c.type === "text")
				.map((c) => c.text);
			if (textParts.length > 0) {
				const model = message.model || entry.message?.model || null;
				return {
					role: "assistant",
					content: textParts.join("\n"),
					timestamp,
					messageId,
					model,
				};
			}

			// If only tool calls, report the first one
			const toolCall = content.find((c) => c.type === "toolCall");
			if (toolCall) {
				const summary = buildToolSummary(toolCall.name, toolCall.arguments);
				return {
					role: "tool",
					tool: toolCall.name,
					input: toolCall.arguments,
					timestamp,
					messageId,
					summary,
				};
			}
		}
		if (typeof content === "string" && content.length > 0) {
			return { role: "assistant", content, timestamp, messageId };
		}
		return null;
	}

	// ── Tool result ──
	if (role === "toolResult") {
		const toolName = message.toolName || "unknown";
		const isError = message.isError === true;
		const resultText = extractPiTextContent(content);

		return {
			role: "tool_result",
			tool: toolName,
			toolCallId: message.toolCallId || null,
			success: !isError,
			output: resultText ? resultText.slice(0, 1500) : "",
			timestamp,
			messageId,
		};
	}

	return null;
}

// ─── Shared helpers ─────────────────────────────────────────────────

/**
 * Build enhanced tool summary with full command details.
 * Returns object with summary string and full command details.
 */
function buildToolSummary(tool, input) {
	if (!input) return { summary: tool };

	const result = { summary: tool };

	switch (tool) {
		case "Bash":
			result.summary = `$ ${(input.command || "").slice(0, 80)}`;
			result.fullCommand = input.command || "";
			break;
		case "Read":
		case "read":
			result.summary = `Read ${input.file_path || input.path || ""}`;
			result.fullCommand = input.file_path || input.path || "";
			result.filePath = input.file_path || input.path || "";
			break;
		case "Write":
		case "write":
			result.summary = `Write ${input.file_path || input.path || ""}`;
			result.fullCommand = input.file_path || input.path || "";
			result.filePath = input.file_path || input.path || "";
			break;
		case "Edit":
		case "edit":
			result.summary = `Edit ${input.file_path || input.path || ""}`;
			result.fullCommand = input.file_path || input.path || "";
			result.filePath = input.file_path || input.path || "";
			break;
		case "Glob":
		case "glob":
		case "find":
			result.summary = `Find ${input.pattern || ""}`;
			result.fullCommand = input.pattern || "";
			result.pattern = input.pattern || "";
			break;
		case "Grep":
		case "grep":
			result.summary = `Search ${input.pattern || ""}`;
			result.fullCommand = input.pattern || "";
			result.pattern = input.pattern || "";
			result.fullQuery = input.query || "";
			break;
		default:
			result.summary = tool;
	}

	return result;
}

/**
 * GET /api/projects/:name/files/search?q=query
 * Search files within a project using glob patterns
 */
router.get("/:name/files/search", async (req, res) => {
	const { name } = req.params;
	const query = (req.query.q || "").trim();

	try {
		// Get the actual project path from Pi
		let actualPath;
		if (name.startsWith("--") && name.endsWith("--")) {
			const piDir = path.join(PI_SESSIONS, name);
			actualPath = await extractProjectPath(piDir, name);
		} else {
			// Try to resolve as a path
			const piDirName = await resolvePiDirName(name);
			if (piDirName) {
				const piDir = path.join(PI_SESSIONS, piDirName);
				actualPath = await extractProjectPath(piDir, piDirName);
			} else {
				actualPath = name;
			}
		}

		// Check if project path exists and is absolute
		if (!actualPath || !path.isAbsolute(actualPath)) {
			return res.status(400).json({ error: "Invalid project path" });
		}

		// Resolve and normalize the path to prevent traversal attacks
		const resolvedPath = path.resolve(actualPath);

		// Verify the resolved path doesn't escape to sensitive directories
		const sensitivePatterns = [
			"/etc",
			"/var",
			"/usr",
			"/bin",
			"/sbin",
			"/root",
		];
		if (sensitivePatterns.some((p) => resolvedPath.startsWith(p))) {
			return res
				.status(403)
				.json({ error: "Access to this path is not allowed" });
		}

		// Check if directory exists
		try {
			const stats = await fs.stat(resolvedPath);
			if (!stats.isDirectory()) {
				return res
					.status(400)
					.json({ error: "Project path is not a directory" });
			}
		} catch (err) {
			return res.status(404).json({ error: "Project directory not found" });
		}

		// Sanitize query to prevent path traversal in search
		const sanitizedQuery = query.replace(/\.\./g, "").replace(/[<>:"|?*]/g, "");

		// Build glob pattern based on query
		let pattern;
		if (sanitizedQuery.includes("/") || sanitizedQuery.includes("\\")) {
			pattern = path.join(resolvedPath, "**", `*${sanitizedQuery}*`);
		} else if (sanitizedQuery) {
			pattern = path.join(resolvedPath, "**", `*${sanitizedQuery}*`);
		} else {
			pattern = path.join(resolvedPath, "**", "*");
		}

		// Execute glob search
		const files = await glob(pattern, {
			cwd: resolvedPath,
			absolute: false,
			nodir: true,
			ignore: [
				"**/node_modules/**",
				"**/.git/**",
				"**/dist/**",
				"**/build/**",
				"**/.pi/**",
				"**/coverage/**",
				"**/*.log",
				"**/.DS_Store",
			],
			limit: MAX_FILE_RESULTS,
		});

		// Verify each file path stays within the project directory
		const safeFiles = files.filter((file) => {
			const fullPath = path.resolve(resolvedPath, file);
			return fullPath.startsWith(resolvedPath);
		});

		// Sort by relevance (exact matches first, then alphabetical)
		const lowerQuery = sanitizedQuery.toLowerCase();
		safeFiles.sort((a, b) => {
			const aLower = a.toLowerCase();
			const bLower = b.toLowerCase();
			const aExact = aLower.includes(lowerQuery);
			const bExact = bLower.includes(lowerQuery);

			if (aExact && !bExact) return -1;
			if (!aExact && bExact) return 1;
			return a.localeCompare(b);
		});

		res.json({ files: safeFiles.slice(0, MAX_FILE_RESULTS) });
	} catch (err) {
		console.error("[Projects] File search error:", err);
		res.status(500).json({ error: "Failed to search files" });
	}
});

export { router as projectRoutes };
