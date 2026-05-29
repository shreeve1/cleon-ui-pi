import { randomUUID } from "crypto";
import { promises as fs } from "fs";
import path from "path";
import { taskManager, broadcastTaskUpdate } from "./tasks.js";
import { broadcastToSession, startSessionBuffer } from "./broadcast.js";
import { publish } from "./bus.js";
import { createActivityTracker } from "./activity.js";
import { register, setStatus } from "./session-registry.js";
import { getSdkSessionManager } from "./session-manager-instance.js";
import { createExtensionUIBridge } from "./extension-ui-bridge.js";
import { encode as encodePiDirName } from "./pi-path.js";
import { createEventTransformer } from "./event-transformer.js";

// ─── Active sessions ────────────────────────────────────────────────

// Map<sessionId, SessionInfo>
// SessionInfo: { session: AgentSession, ws, username, activityTracker, bridge }
const activeSessions = new Map();

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

		// Create per-turn transformer with adapters bound to this session's context
		const turnTransformer = createEventTransformer({
			taskTracker: {
				trackStart(details) {
					const task = taskManager.trackTaskStart(currentSessionId, details);
					broadcastTaskUpdate(
						ws,
						"task-started",
						task,
						username,
						currentSessionId,
					);
					return task;
				},
				trackComplete(taskId, outputStr) {
					const task = taskManager.trackTaskComplete(currentSessionId, taskId, {
						output: outputStr,
					});
					if (task)
						broadcastTaskUpdate(
							ws,
							"task-completed",
							task,
							username,
							currentSessionId,
						);
				},
				trackFailed(taskId, outputStr) {
					const task = taskManager.trackTaskFailed(
						currentSessionId,
						taskId,
						outputStr,
					);
					if (task)
						broadcastTaskUpdate(
							ws,
							"task-failed",
							task,
							username,
							currentSessionId,
						);
				},
			},
			activityTracker: sessionInfo.activityTracker,
		});

		unsubscribeEvents = session.subscribe((event) => {
			const transformed = turnTransformer.transform(event, currentSessionId);
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

// Re-export transformer for testing
export { createEventTransformer } from "./event-transformer.js";
