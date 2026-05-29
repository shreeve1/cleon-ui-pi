/**
 * Event transformer — converts Pi SDK AgentSessionEvents into Cleon UI messages.
 *
 * Factory pattern: createEventTransformer({ taskTracker, activityTracker })
 * returns a transform(event, sessionId) function.
 *
 * Side effects (task tracking, activity tracking) are dispatched through
 * injected adapters. Two adapters justify the seam: production and test.
 */

import { randomUUID } from "crypto";

// ─── Constants ─────────────────────────────────────────────────────

const TOOL_OUTPUT_TRUNCATE_LENGTH = 1500;
const TOOL_SUMMARY_TRUNCATE_LENGTH = 200;
const SUPPRESS_TOOL_DROP_NOTIFICATIONS =
	String(process.env.SUPPRESS_TOOL_DROP_NOTIFICATIONS || "").toLowerCase() ===
	"true";

// Matches: ESC[ ... m (SGR), ESC[ ... (other CSI), ESC] ... BEL/ST (OSC)
const ANSI_PATTERN =
	/\x1b\[[0-9;]*[A-Za-z]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)?|\x1b[PX^_][^\x1b]*\x1b\\?/g;

// ─── Pure helpers ──────────────────────────────────────────────────

function stripAnsi(text) {
	if (typeof text !== "string") return text;
	return text.replace(ANSI_PATTERN, "");
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

// ─── Factory ───────────────────────────────────────────────────────

/**
 * Create an event transformer with injected side-effect adapters.
 *
 * @param {Object} deps
 * @param {Object} [deps.taskTracker] - Adapter for task tracking + broadcast
 *   .trackStart({ title, progress, metadata }) → { taskId }
 *   .trackComplete(taskId, outputStr)
 *   .trackFailed(taskId, outputStr)
 * @param {Object} [deps.activityTracker] - Adapter for activity tracking
 *   .startTool(toolName, summaryText)
 *   .completeTool()
 *   .startThinking()
 * @returns {{ transform: (event: Object, sessionId: string) => Object|null }}
 */
export function createEventTransformer({ taskTracker, activityTracker } = {}) {
	// Internal state — tool timing and deduplication
	const toolStartTimes = new Map();
	const toolUseToTaskMap = new Map();
	const notifiedDroppedTools = new Map();

	function shouldNotifyDroppedTool(sessionId, toolName) {
		if (!sessionId || !toolName || SUPPRESS_TOOL_DROP_NOTIFICATIONS)
			return false;
		if (!notifiedDroppedTools.has(sessionId)) {
			notifiedDroppedTools.set(sessionId, new Set());
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

	/**
	 * Transform a Pi SDK event into a Cleon UI message (or null to skip).
	 */
	function transform(event, sessionId) {
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
				if (taskTracker && sessionId) {
					const summary = getToolSummary(toolName, input);
					const taskTitle =
						typeof summary === "object" ? summary.summary : summary;
					const task = taskTracker.trackStart({
						title: taskTitle,
						progress: 0,
						metadata: { tool: toolName, toolUseId, input },
					});
					toolUseToTaskMap.set(toolUseId, task.taskId);
					if (toolUseToTaskMap.size > 100) {
						toolUseToTaskMap.delete(toolUseToTaskMap.keys().next().value);
					}
				}

				// Track activity
				if (activityTracker) {
					const summary = getToolSummary(toolName, input);
					const summaryText =
						typeof summary === "object" ? summary.summary : summary;
					activityTracker.startTool(toolName, summaryText);
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
				if (taskTracker && sessionId) {
					const taskId = toolUseToTaskMap.get(toolUseId);
					if (taskId) {
						const outputStr =
							typeof output === "string" ? output : JSON.stringify(output);
						if (isError) {
							taskTracker.trackFailed(taskId, outputStr);
						} else {
							taskTracker.trackComplete(taskId, outputStr);
						}
						toolUseToTaskMap.delete(toolUseId);
					}
				}

				// Track activity
				if (activityTracker) {
					activityTracker.completeTool();
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
				if (activityTracker) {
					activityTracker.startThinking();
				}
				return null;
			}

			case "agent_end": {
				return { type: "_agent_end" };
			}

			case "turn_start": {
				if (activityTracker) {
					activityTracker.startThinking();
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

	return { transform };
}
