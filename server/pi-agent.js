import { randomUUID } from "crypto";
import { promises as fs } from "fs";
import path from "path";
import os from "os";
import { taskManager, broadcastTaskUpdate } from "./tasks.js";
import { broadcastToSession, startSessionBuffer } from "./broadcast.js";
import { publish } from "./bus.js";
import { createActivityTracker } from "./activity.js";
import { register, setStatus } from "./session-registry.js";
import { getSdkSessionManager } from "./session-manager-instance.js";
import { createExtensionUIBridge } from "./extension-ui-bridge.js";
import { encode as encodePiDirName } from "./pi-path.js";

// Constants
const TOOL_OUTPUT_TRUNCATE_LENGTH = 1500;
const TOOL_SUMMARY_TRUNCATE_LENGTH = 200;
const SUPPRESS_TOOL_DROP_NOTIFICATIONS =
	String(process.env.SUPPRESS_TOOL_DROP_NOTIFICATIONS || "").toLowerCase() ===
	"true";

// Strip ANSI escape codes from text before sending to browser
// Matches: ESC[ ... m (SGR), ESC[ ... (other CSI), ESC] ... BEL/ST (OSC)
const ANSI_PATTERN =
	/\x1b\[[0-9;]*[A-Za-z]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)?|\x1b[PX^_][^\x1b]*\x1b\\?/g;
function stripAnsi(text) {
	if (typeof text !== "string") return text;
	return text.replace(ANSI_PATTERN, "");
}

// NOTE: "Dropping unknown tool ..." PM2 logs are emitted by the Pi SDK's
// internal claude-agent-bridge logger, not via AgentSessionEvent.
// We cannot intercept those log lines directly unless the SDK exposes events.

// ─── Active sessions ────────────────────────────────────────────────

// Map<sessionId, SessionInfo>
// SessionInfo: { session: AgentSession, ws, username, activityTracker, bridge }
const activeSessions = new Map();

// Tool timing
const toolStartTimes = new Map();
const toolUseToTaskMap = new Map();

// Session-level dedupe for tool-drop notifications: Map<sessionId, Set<toolName>>
const notifiedDroppedTools = new Map();

// ─── Helpers ────────────────────────────────────────────────────────

function sendMessage(ws, data, username) {
	if (data.sessionId) {
		broadcastToSession(data.sessionId, data);
		if (username) publish(username, data);
	} else {
		if (ws && ws.readyState === 1) {
			ws.send(JSON.stringify(data));
		}
	}
}

function generateTimestamp() {
	return new Date().toISOString();
}

function truncateOutput(content, maxLength) {
	if (typeof content !== "string") return String(content);
	if (content.length <= maxLength) return content;
	return (
		content.slice(0, maxLength) +
		`\n... (${content.length - maxLength} more chars)`
	);
}

function sanitizeBashCommand(cmd) {
	if (!cmd || typeof cmd !== "string") return "";
	const sanitized = cmd
		.replace(/(-H\s+["']?Authorization:\s*Bearer\s+)[^\s"']+/gi, "$1[REDACTED]")
		.replace(/(Bearer\s+)[A-Za-z0-9_\-.]{20,}/g, "$1[REDACTED]")
		.replace(/(-u\s+)[^\s:]+:[^\s@]+(@)/g, "$1[REDACTED]$2")
		.replace(/(https?:\/\/)[^:@\s]+:[^:@\s]+(@)/g, "$1[REDACTED]$2")
		.replace(
			/((?:API_KEY|SECRET|TOKEN|PASSWORD|PASS)\s*=\s*)[^\s;]+/gi,
			"$1[REDACTED]",
		);
	return truncateOutput(sanitized, 200);
}

function sanitizeToolInput(tool, input) {
	if (!input) return {};
	const t = tool.toLowerCase();
	switch (t) {
		case "bash":
			return { command: sanitizeBashCommand(input.command || input.cmd || "") };
		case "read":
			return {
				file_path: input.file_path || input.path,
				offset: input.offset,
				limit: input.limit,
			};
		case "write":
			return { file_path: input.file_path || input.path };
		case "edit": {
			const old = String(input.old_string || "").slice(0, 30);
			const nw = String(input.new_string || "").slice(0, 30);
			return {
				file_path: input.file_path || input.path,
				old_string: old,
				new_string: nw,
			};
		}
		case "glob":
			return { pattern: input.pattern, path: input.path };
		case "grep":
			return {
				pattern: input.pattern,
				path: input.path,
				glob: input.glob,
				type: input.type,
			};
		case "task":
			return {
				description: input.description || input.prompt,
				subagent_type: input.subagent_type,
			};
		default:
			return {};
	}
}

// Tool summary formatters
const toolFormatters = {
	bash: (i) => {
		const fullCommand = i.command || i.cmd || "";
		return {
			summary: `$ ${truncateOutput(fullCommand, TOOL_SUMMARY_TRUNCATE_LENGTH)}`,
			fullCommand,
		};
	},
	read: (i) => {
		const filePath = i.file_path || i.path || null;
		return { summary: `Reading ${filePath || "file"}`, filePath };
	},
	write: (i) => {
		const filePath = i.file_path || i.path || null;
		return { summary: `Writing ${filePath || "file"}`, filePath };
	},
	edit: (i) => {
		const filePath = i.file_path || i.path || null;
		return { summary: `Editing ${filePath || "file"}`, filePath };
	},
	glob: (i) => {
		const pattern = i.pattern || null;
		return { summary: `Finding ${pattern || "files"}`, pattern };
	},
	grep: (i) => {
		const pattern = i.pattern || i.query || null;
		return {
			summary: `Searching: ${truncateOutput(pattern || "", TOOL_SUMMARY_TRUNCATE_LENGTH)}`,
			pattern,
		};
	},
	todowrite: (i) => {
		const todos = i.todos || [];
		const completedCount = todos.filter(
			(t) => t.status === "completed" || t.status === "done",
		).length;
		return {
			summary:
				todos.length === 0
					? "Updating todo list"
					: `Updating todo list (${completedCount}/${todos.length} completed)`,
		};
	},
	todoread: () => ({ summary: "Reading todo list" }),
	task: (i) => {
		const desc = i?.prompt || i?.task || i?.description || "";
		return {
			summary: desc
				? `Task: ${truncateOutput(desc, TOOL_SUMMARY_TRUNCATE_LENGTH)}`
				: "Delegating task",
		};
	},
	taskoutput: (i) => ({
		summary: i?.task_id ? `Checking task ${i.task_id}` : "Checking task output",
	}),
};

function getToolSummary(tool, input) {
	if (!input) return { summary: tool };
	const formatter = toolFormatters[tool.toLowerCase()];
	return formatter ? formatter(input) : { summary: tool };
}

function normalizeDroppedToolName(rawToolName) {
	if (!rawToolName || typeof rawToolName !== "string") return "unknown";
	return rawToolName.replace(/^mcp__[^_]+__/, "");
}

function shouldNotifyDroppedTool(sessionId, toolName) {
	if (!sessionId || !toolName || SUPPRESS_TOOL_DROP_NOTIFICATIONS) return false;
	if (!notifiedDroppedTools.has(sessionId)) {
		notifiedDroppedTools.set(sessionId, new Set());
		// Prevent unbounded growth if many historical session IDs accumulate.
		if (notifiedDroppedTools.size > 500) {
			const oldestSessionId = notifiedDroppedTools.keys().next().value;
			notifiedDroppedTools.delete(oldestSessionId);
		}
	}
	const seen = notifiedDroppedTools.get(sessionId);
	if (seen.has(toolName)) return false;
	seen.add(toolName);
	return true;
}

function formatAgentErrorMessage(rawError) {
	let message = rawError;

	if (message && typeof message === "object") {
		message =
			message.message || message.errorMessage || JSON.stringify(message);
	}

	if (typeof message !== "string" || !message.trim()) {
		return "Agent turn failed without an error message.";
	}

	const trimmed = stripAnsi(message.trim());
	const jsonStart = trimmed.indexOf("{");
	if (jsonStart !== -1) {
		try {
			const parsed = JSON.parse(trimmed.slice(jsonStart));
			const nestedMessage = parsed?.error?.message || parsed?.message;
			if (nestedMessage) {
				return truncateOutput(
					stripAnsi(String(nestedMessage)),
					TOOL_OUTPUT_TRUNCATE_LENGTH,
				);
			}
		} catch {
			// Keep original message when provider payload is not JSON.
		}
	}

	return truncateOutput(trimmed, TOOL_OUTPUT_TRUNCATE_LENGTH);
}

// ─── Pi Event → Cleon UI Message Transformation ────────────────────

/**
 * Transform a Pi SDK event into a Cleon UI message (or null to skip).
 * Returns { type, ...data } matching what the frontend expects inside
 * a `message` wrapper.
 *
 * SDK events are identical to RPC events (same AgentSessionEvent types),
 * so this function is unchanged from the RPC implementation.
 */
function transformEvent(event, sessionId, sessionInfo) {
	const timestamp = generateTimestamp();
	const messageId = randomUUID();

	switch (event.type) {
		// ── Text streaming ──
		case "message_update": {
			const ame = event.assistantMessageEvent;
			if (!ame) return null;

			if (ame.type === "text_delta" && ame.delta) {
				return {
					type: "text",
					content: stripAnsi(ame.delta),
					timestamp,
					messageId,
				};
			}

			// Tool call delta from the assistant message — we handle tool_execution_start separately
			return null;
		}

		// ── Tool execution ──
		case "tool_execution_start": {
			const toolName = event.toolName || "unknown";
			const toolUseId = event.toolCallId || randomUUID();
			const input = event.args || {};

			// Record start time
			const startTime = new Date();
			toolStartTimes.set(toolUseId, startTime);
			if (toolStartTimes.size > 100) {
				toolStartTimes.delete(toolStartTimes.keys().next().value);
			}

			// Create task for tool tracking
			if (sessionId && sessionInfo?.ws) {
				const summary = getToolSummary(toolName, input);
				const taskTitle =
					typeof summary === "object" ? summary.summary : summary;
				const task = taskManager.trackTaskStart(sessionId, {
					title: taskTitle,
					progress: 0,
					metadata: { tool: toolName, toolUseId, input },
				});
				toolUseToTaskMap.set(toolUseId, task.taskId);
				broadcastTaskUpdate(
					sessionInfo.ws,
					"task-started",
					task,
					sessionInfo.username,
					sessionId,
				);
				if (toolUseToTaskMap.size > 100) {
					toolUseToTaskMap.delete(toolUseToTaskMap.keys().next().value);
				}
			}

			// Track activity
			if (sessionInfo?.activityTracker) {
				const summary = getToolSummary(toolName, input);
				const summaryText =
					typeof summary === "object" ? summary.summary : summary;
				sessionInfo.activityTracker.startTool(toolName, summaryText);
			}

			const summary = getToolSummary(toolName, input);

			return {
				type: "tool_use",
				tool: toolName,
				id: toolUseId,
				summary: typeof summary === "object" ? summary : { summary },
				timestamp,
				messageId,
				startTime: startTime.toISOString(),
				input: sanitizeToolInput(toolName, input),
			};
		}

		case "tool_execution_end": {
			const toolUseId = event.toolCallId || "";
			const isError = event.isError === true;
			// Extract output text from Pi's result structure
			let output = "";
			if (event.result && event.result.content) {
				const content = event.result.content;
				if (Array.isArray(content)) {
					output = content
						.filter((c) => c.type === "text")
						.map((c) => c.text)
						.join("\n");
				} else {
					output = JSON.stringify(event.result);
				}
			}

			const startTime = toolStartTimes.get(toolUseId);
			const endTime = new Date();
			let duration = null;
			let startTimeIso = null;
			if (startTime) {
				duration = endTime.getTime() - startTime.getTime();
				startTimeIso = startTime.toISOString();
				toolStartTimes.delete(toolUseId);
			}

			// Complete task
			if (sessionId && sessionInfo?.ws) {
				const taskId = toolUseToTaskMap.get(toolUseId);
				if (taskId) {
					let task;
					const outputStr =
						typeof output === "string" ? output : JSON.stringify(output);
					if (isError) {
						task = taskManager.trackTaskFailed(sessionId, taskId, outputStr);
						if (task)
							broadcastTaskUpdate(
								sessionInfo.ws,
								"task-failed",
								task,
								sessionInfo.username,
								sessionId,
							);
					} else {
						task = taskManager.trackTaskComplete(sessionId, taskId, {
							output: outputStr,
						});
						if (task)
							broadcastTaskUpdate(
								sessionInfo.ws,
								"task-completed",
								task,
								sessionInfo.username,
								sessionId,
							);
					}
					toolUseToTaskMap.delete(toolUseId);
				}
			}

			// Track activity
			if (sessionInfo?.activityTracker) {
				sessionInfo.activityTracker.completeTool();
			}

			return {
				type: "tool_result",
				id: toolUseId,
				success: !isError,
				output: truncateOutput(
					typeof output === "string" ? output : JSON.stringify(output),
					TOOL_OUTPUT_TRUNCATE_LENGTH,
				),
				timestamp,
				messageId,
				duration,
				startTime: startTimeIso,
			};
		}

		// ── Session lifecycle ──
		case "agent_start": {
			if (sessionInfo?.activityTracker) {
				sessionInfo.activityTracker.startThinking();
			}
			return null;
		}

		case "agent_end": {
			return { type: "_agent_end" };
		}

		case "turn_start": {
			if (sessionInfo?.activityTracker) {
				sessionInfo.activityTracker.startThinking();
			}
			return null;
		}

		case "turn_end": {
			const stopReason =
				event.message?.stopReason ||
				event.message?.stop_reason ||
				event.stopReason ||
				event.stop_reason;
			const rawError =
				event.message?.errorMessage ||
				event.message?.error?.message ||
				event.message?.error ||
				event.errorMessage ||
				event.error?.message ||
				event.error;
			if (stopReason === "error" || rawError) {
				return {
					type: "_agent_error",
					message: formatAgentErrorMessage(rawError),
					timestamp,
					messageId,
				};
			}

			const msgUsage = event.message?.usage;
			if (msgUsage) {
				const model = event.message?.model || null;
				const input = msgUsage.input || 0;
				const output = msgUsage.output || 0;
				const cacheRead = msgUsage.cacheRead || 0;
				const cacheCreate = msgUsage.cacheWrite || 0;
				const cumulativeTotal = input + output + cacheRead + cacheCreate;
				const contextWindow = 200000;
				return {
					type: "_token_usage",
					usage: {
						cumulativeTotal,
						cumulativeInput: input,
						cumulativeOutput: output,
						cacheRead,
						cacheCreate,
						contextWindow,
						model,
						estimatedContextUsed: Math.min(cumulativeTotal, contextWindow),
						contextUtilization: Math.min((input / contextWindow) * 100, 100),
						used: cumulativeTotal,
					},
				};
			}
			return null;
		}

		// ── Extension errors ──
		case "extension_error": {
			// Capture full error details including stack traces
			const errorObj = event.error;
			let errorSummary = "unknown";
			let errorType = "Unknown";

			if (errorObj instanceof Error) {
				errorSummary = `${errorObj.name}: ${errorObj.message}`;
				errorType = errorObj.name;
			} else if (typeof errorObj === "object" && errorObj !== null) {
				errorSummary = errorObj.message || JSON.stringify(errorObj);
				errorType = errorObj.name || "Object";
			} else if (typeof errorObj === "string") {
				errorSummary = errorObj;
				errorType = "String";
			}

			return {
				type: "text",
				content: `\n\n[Extension error (${errorType}): ${errorSummary}]\n`,
				timestamp,
				messageId,
			};
		}

		// ── Partial tool output (skip — no frontend support) ──
		case "tool_execution_update": {
			return null;
		}

		case "message_start":
		case "message_end": {
			return null;
		}

		case "auto_compaction_start": {
			return {
				type: "text",
				content: "\n[Context compaction in progress...]\n",
				timestamp,
				messageId,
			};
		}

		case "auto_compaction_end": {
			if (event.result) {
				return {
					type: "text",
					content: `\n[Context compacted: ${event.result.tokensBefore} tokens → reduced]\n`,
					timestamp,
					messageId,
				};
			}
			return null;
		}

		case "auto_retry_start": {
			return {
				type: "text",
				content: `\n[Retrying... attempt ${event.attempt}/${event.maxAttempts} after error: ${event.errorMessage}]\n`,
				timestamp,
				messageId,
			};
		}

		case "auto_retry_end": {
			if (!event.success) {
				return {
					type: "text",
					content: `\n[Retry failed after ${event.attempt} attempts: ${event.finalError}]\n`,
					timestamp,
					messageId,
				};
			}
			return null;
		}

		// NOTE: As of current Pi SDK, there is no documented AgentSessionEvent for
		// dropped/unknown tools. This case is future-proof for potential SDK support.
		case "unknown_tool":
		case "tool_dropped": {
			const droppedTool = normalizeDroppedToolName(
				event.toolName || event.tool || event.name,
			);
			if (!shouldNotifyDroppedTool(sessionId, droppedTool)) return null;
			return {
				type: "text",
				content: `\n[Tool '${droppedTool}' not available - skipping]\n`,
				timestamp,
				messageId,
			};
		}

		default:
			return null;
	}
}

// ─── Exported API ───────────────────────────────────────────────────

/**
 * Handle incoming chat message from WebSocket.
 */
export async function handleChat(msg, ws, username) {
	const { content, projectPath, sessionId, isNewSession, attachments } = msg;
	const projectDisplayName = projectPath ? projectPath.split("/").pop() : "";
	const piProjectName = projectPath
		? encodePiDirName(projectPath)
		: projectDisplayName;

	// Build prompt — just the user's message
	// (Pi maintains native context in the persistent SDK session)
	let prompt = content || "";

	// Handle attachments
	const tempImagePaths = [];
	if (attachments && attachments.length > 0) {
		const textAttachments = [];

		for (const att of attachments) {
			if (att.type === "image") {
				try {
					const base64Data = att.data.replace(/^data:image\/\w+;base64,/, "");
					const ext = att.mediaType?.split("/")[1] || "png";
					const tempDir = path.join(projectPath, ".pi-uploads");
					await fs.mkdir(tempDir, { recursive: true });
					const tempPath = path.join(tempDir, `upload-${randomUUID()}.${ext}`);
					await fs.writeFile(tempPath, Buffer.from(base64Data, "base64"));
					tempImagePaths.push(tempPath);
					const relativePath = path.relative(projectPath, tempPath);
					textAttachments.push(
						`\n\n[User attached an image: ${att.name}. Please use the Read tool to view the image at: ${relativePath}]`,
					);
				} catch (err) {
					console.error("[Pi] Failed to save temp image:", err);
					textAttachments.push(
						`\n\n[User tried to attach an image: ${att.name}, but it failed to process]`,
					);
				}
			} else {
				textAttachments.push(`\n\n--- ${att.name} ---\n${att.data}`);
			}
		}

		if (textAttachments.length > 0) {
			prompt += textAttachments.join("");
		}
	}

	const currentSessionId = sessionId || randomUUID();
	const sessionInfo = {
		session: null,
		ws,
		username,
		activityTracker: null,
		bridge: null,
	};

	let unsubscribeEvents = null;

	try {
		console.log(
			`[Pi] Chat - project: ${projectPath}, session: ${currentSessionId}`,
		);
		console.log(`[Pi] Prompt length: ${prompt.length} chars`);

		// Get or create persistent SDK session
		const manager = getSdkSessionManager();
		const sessionBundle = await manager.getOrCreate(
			currentSessionId,
			projectPath,
			username,
		);

		const { session, sessionFile, isNew } = sessionBundle;
		sessionInfo.session = session;

		// Create extension UI bridge for this turn
		// Wrap sendMessage so the bridge can call sendBridgeMessage(data) without needing ws
		const sendBridgeMessage = (data) => sendMessage(ws, data, username);
		const bridge = createExtensionUIBridge(
			currentSessionId,
			sendBridgeMessage,
			username,
		);
		sessionInfo.bridge = bridge;

		// Bind extensions once per session; on subsequent turns just swap the uiContext
		const alreadyBound = !!session._extensionUIContext;
		console.log(
			`[Pi] Session ${currentSessionId} — extensions already bound: ${alreadyBound}`,
		);
		if (!alreadyBound) {
			await session.bindExtensions({
				uiContext: bridge.uiContext,
				commandContextActions: {},
				onError: (err) => {
					// Serialize full error object, not just err.message
					const errorDetails =
						err instanceof Error
							? { message: err.message, stack: err.stack, name: err.name }
							: typeof err === "object" && err !== null
								? { ...err, errorType: typeof err }
								: { error: err, errorType: typeof err };
					console.error("[Pi] Extension error", {
						sessionId: currentSessionId,
						error: errorDetails,
					});
				},
			});
		} else {
			// Lightweight per-turn update — just swaps the uiContext reference
			session._extensionRunner?.setUIContext(bridge.uiContext);
		}

		// Register session in active sessions map and session registry
		activeSessions.set(currentSessionId, sessionInfo);
		startSessionBuffer(currentSessionId);
		register(currentSessionId, {
			username,
			projectPath,
			projectName: piProjectName,
			displayName: projectDisplayName,
			status: "streaming",
			piSessionFile: sessionFile,
		});
		publish(username, {
			type: "session-status",
			sessionId: currentSessionId,
			status: "streaming",
		});
		sessionInfo.activityTracker = createActivityTracker(
			(event) => publish(username, event),
			currentSessionId,
		);

		// If this is a "new" session and client didn't have a sessionId yet, tell them
		if (!sessionId) {
			publish(username, {
				type: "session-created",
				sessionId: currentSessionId,
				project: {
					name: piProjectName,
					path: projectPath,
					displayName: projectDisplayName,
				},
			});
		}

		// Set the requested model before prompting
		if (msg.model && msg.model.includes("/")) {
			const slashIdx = msg.model.indexOf("/");
			const provider = msg.model.slice(0, slashIdx);
			const modelId = msg.model.slice(slashIdx + 1);
			try {
				// Use the model registry to resolve and set the model
				const modelRegistry = session.modelRegistry;

				// Safely access model registry with proper null checks
				if (!modelRegistry) {
					console.warn(
						`[Pi] Model registry not available, using default model`,
					);
				} else if (typeof modelRegistry.find !== "function") {
					console.warn(
						`[Pi] Model registry API has changed (find method not found), using default model`,
					);
				} else {
					const model = modelRegistry.find(provider, modelId);
					if (model) {
						await session.setModel(model);
						console.log(`[Pi] Model set to ${msg.model}`);
					} else {
						console.warn(
							`[Pi] Model ${msg.model} not found in registry, using default model`,
						);
					}
				}
			} catch (err) {
				console.warn(
					`[Pi] Failed to set model ${msg.model}: ${err.message || err}`,
				);
				// Don't fail the chat — continue with default model
			}
		}

		// Subscribe to events and transform them for the frontend.
		// NOTE: SDK bridge logs like "Dropping unknown tool ..." are emitted
		// internally and are not delivered via AgentSessionEvent today.
		unsubscribeEvents = session.subscribe((event) => {
			const transformed = transformEvent(event, currentSessionId, sessionInfo);
			if (!transformed) return;

			// Special internal signals
			if (transformed.type === "_agent_end") {
				// agent_end is informational in SDK mode — prompt() resolves on completion
				return;
			}

			if (transformed.type === "_token_usage") {
				sendMessage(
					ws,
					{
						type: "token-usage",
						sessionId: currentSessionId,
						...transformed.usage,
					},
					username,
				);
				return;
			}

			if (transformed.type === "_agent_error") {
				sendMessage(
					ws,
					{
						type: "error",
						sessionId: currentSessionId,
						message: transformed.message,
					},
					username,
				);
				return;
			}

			// Forward to frontend
			sendMessage(
				ws,
				{
					type: "message",
					sessionId: currentSessionId,
					data: transformed,
				},
				username,
			);
		});

		// Send the prompt — this resolves when the turn completes!
		// No more guessing about completion with process detection / file watching.
		await session.prompt(prompt);

		// Turn is definitively done
		console.log(`[Pi] Query complete - session: ${currentSessionId}`);
		sendMessage(ws, { type: "done", sessionId: currentSessionId }, username);
	} catch (err) {
		console.error("[Pi] Query error:", err);

		const errMsg = err.message || "";
		const isAbort =
			err.name === "AbortError" || errMsg.toLowerCase().includes("abort");

		// Don't send error message for aborts - the abort-result message handles UI state
		if (isAbort) {
			console.log(`[Pi] Query aborted - session: ${currentSessionId}`);
			// Still send 'done' so the frontend properly finishes streaming
			sendMessage(ws, { type: "done", sessionId: currentSessionId }, username);
		} else {
			const isRateLimit =
				errMsg.includes("429") ||
				errMsg.includes("rate limit") ||
				errMsg.includes("Rate limit");
			const userMessage = isRateLimit
				? "Rate limit reached. The API is temporarily throttled — please wait a moment and try again."
				: errMsg || "Query failed";

			sendMessage(
				ws,
				{
					type: "error",
					sessionId: currentSessionId || msg.sessionId || null,
					message: userMessage,
				},
				username,
			);
		}
	} finally {
		if (sessionInfo.activityTracker) {
			sessionInfo.activityTracker.finish();
			sessionInfo.activityTracker = null;
		}

		// Unsubscribe event listeners for this turn
		if (unsubscribeEvents) {
			unsubscribeEvents();
		}

		// Clean up extension UI bridge
		if (sessionInfo.bridge) {
			sessionInfo.bridge.cleanup();
		}

		// Release session back to pool (starts idle timer)
		const manager = getSdkSessionManager();
		manager.release(currentSessionId);

		activeSessions.delete(currentSessionId);
		setStatus(currentSessionId, "idle");
		publish(username, {
			type: "session-status",
			sessionId: currentSessionId,
			status: "idle",
		});

		// Clean up temp images
		for (const tempPath of tempImagePaths) {
			try {
				await fs.unlink(tempPath);
			} catch {
				/* ignore */
			}
		}
	}
}

/**
 * Abort an active session.
 */
export async function handleAbort(sessionId) {
	// Check the active sessions map (mid-query)
	const sessionInfo = activeSessions.get(sessionId);
	if (sessionInfo?.session) {
		try {
			console.log(`[Pi] Aborting session: ${sessionId}`);
			await sessionInfo.session.abort();

			if (sessionInfo.activityTracker) {
				sessionInfo.activityTracker.finish();
				sessionInfo.activityTracker = null;
			}

			return true;
		} catch (err) {
			console.error(`[Pi] Abort error for ${sessionId}:`, err);
			return false;
		}
	}

	// Also check the session manager pool (session may be idle between queries)
	const manager = getSdkSessionManager();
	const poolEntry = manager.get(sessionId);
	if (poolEntry?.session) {
		try {
			console.log(`[Pi] Aborting pooled session: ${sessionId}`);
			await poolEntry.session.abort();
			return true;
		} catch (err) {
			console.error(`[Pi] Abort error for pooled ${sessionId}:`, err);
			return false;
		}
	}

	console.log(`[Pi] Abort: session ${sessionId} not found`);
	return false;
}

/**
 * Check if session is active.
 */
export function isSessionActive(sessionId) {
	return activeSessions.has(sessionId);
}

/**
 * Resubscribe to an active session with a new WebSocket.
 */
export function resubscribeSession(sessionId, newWs) {
	const sessionInfo = activeSessions.get(sessionId);
	if (!sessionInfo) return false;
	sessionInfo.ws = newWs;
	return true;
}

/**
 * Handle question response from frontend.
 * Routes the answer through the extension UI bridge.
 */
export async function handleQuestionResponse(sessionId, toolUseId, answers) {
	console.log(`[Pi] Received question response for ${toolUseId}`);

	const sessionInfo = activeSessions.get(sessionId);
	if (sessionInfo?.bridge) {
		sessionInfo.bridge.handleResponse(toolUseId, answers);
		return true;
	}

	console.log(`[Pi] No active session with bridge for ${sessionId}`);
	return false;
}

/**
 * Handle plan confirmation response from frontend.
 * Plan mode is not used with Pi — stub for interface compatibility.
 */
export async function handlePlanResponse(
	sessionId,
	toolUseId,
	approved,
	feedback,
) {
	console.log(`[Pi] Plan response received (not applicable for Pi backend)`);
	return false;
}

// Export transformEvent for testing
export { transformEvent as _transformEvent };
