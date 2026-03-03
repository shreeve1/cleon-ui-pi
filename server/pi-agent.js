import { spawn } from 'child_process';
import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { taskManager, broadcastTaskUpdate } from './tasks.js';
import { broadcastToSession, startSessionBuffer } from './broadcast.js';
import { publish } from './bus.js';
import { createActivityTracker } from './activity.js';
import { register, setStatus } from './session-registry.js';
import { getRpcSessionManager } from './session-manager-instance.js';

// Constants
const TOOL_OUTPUT_TRUNCATE_LENGTH = 1500;
const TOOL_SUMMARY_TRUNCATE_LENGTH = 200;
const RPC_COMMAND_TIMEOUT_MS = 60_000;
const PI_BINARY = process.env.PI_BINARY || 'pi';

// ─── RpcClient ──────────────────────────────────────────────────────

class RpcClient {
  #process = null;
  #requestId = 0;
  #pendingResponses = new Map(); // id -> { resolve, reject, timer }
  #eventListeners = new Set();
  #lineBuffer = '';
  #cwd = null;
  #sessionFile = null;
  #extraArgs = [];
  #alive = false;

  constructor(cwd, options = {}) {
    this.#cwd = cwd;
    this.#sessionFile = options.sessionFile || null;
    this.#extraArgs = options.extraArgs || [];
  }

  async start() {
    if (this.#alive) return;

    const args = ['--mode', 'rpc'];
    if (this.#sessionFile) {
      args.push('--session', this.#sessionFile);
    }
    args.push(...this.#extraArgs);
    this.#process = spawn(PI_BINARY, args, {
      cwd: this.#cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env },
    });

    this.#alive = true;

    this.#process.stdout.on('data', (chunk) => {
      this.#lineBuffer += chunk.toString();
      this.#drainLines();
    });

    this.#process.stderr.on('data', (chunk) => {
      const text = chunk.toString().trimEnd();
      if (text) console.log(`[Pi:stderr] ${text}`);
    });

    this.#process.on('exit', (code, signal) => {
      this.#alive = false;
      console.log(`[Pi] Process exited code=${code} signal=${signal}`);
      // Reject all pending responses
      for (const [id, pending] of this.#pendingResponses) {
        clearTimeout(pending.timer);
        pending.reject(new Error(`Pi process exited (code=${code})`));
      }
      this.#pendingResponses.clear();
      // Notify listeners of exit
      this.#emit({ type: '_process_exit', code, signal });
    });

    this.#process.on('error', (err) => {
      this.#alive = false;
      console.error('[Pi] Process error:', err.message);
      this.#emit({ type: '_process_error', error: err.message });
    });

    // Pi RPC mode does NOT emit a 'ready' event like OMP did.
    // Wait briefly then verify process is still alive.
    await new Promise((resolve, reject) => {
      const checkAlive = setTimeout(() => {
        if (this.#process && this.#process.exitCode === null) {
          resolve();
        } else {
          reject(new Error(`Pi RPC process exited immediately (exitCode=${this.#process?.exitCode})`));
        }
      }, 500);

      this.#process.on('error', (err) => {
        clearTimeout(checkAlive);
        reject(new Error(`Pi RPC process failed to start: ${err.message}`));
      });

      this.#process.once('exit', (code) => {
        clearTimeout(checkAlive);
        reject(new Error(`Pi RPC process exited during startup (code=${code})`));
      });
    });
  }

  async stop() {
    if (!this.#alive) return;
    this.#alive = false;

    // Close stdin to signal the RPC process to exit
    try {
      this.#process.stdin.end();
    } catch { /* ignore */ }

    // Give it a moment to exit gracefully
    await new Promise((resolve) => {
      const timeout = setTimeout(() => {
        try { this.#process.kill('SIGTERM'); } catch { /* ignore */ }
        resolve();
      }, 3000);

      this.#process.once('exit', () => {
        clearTimeout(timeout);
        resolve();
      });
    });

    this.#process = null;
  }

  get alive() {
    return this.#alive;
  }

  /**
   * Send a command and wait for its correlated response.
   */
  async sendCommand(cmd) {
    if (!this.#alive) throw new Error('Pi RPC process not running');

    const id = `req_${++this.#requestId}`;
    const frame = { id, ...cmd };
    const line = JSON.stringify(frame) + '\n';

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pendingResponses.delete(id);
        reject(new Error(`Pi command timed out after ${RPC_COMMAND_TIMEOUT_MS}ms: ${cmd.type}`));
      }, RPC_COMMAND_TIMEOUT_MS);

      this.#pendingResponses.set(id, { resolve, reject, timer });

      try {
        this.#process.stdin.write(line);
      } catch (err) {
        clearTimeout(timer);
        this.#pendingResponses.delete(id);
        reject(new Error(`Failed to write to Pi stdin: ${err.message}`));
      }
    });
  }

  /**
   * Send a prompt command (returns immediately after ack; results come via events).
   */
  async prompt(message, options = {}) {
    const cmd = { type: 'prompt', message, ...options };
    return this.sendCommand(cmd);
  }

  /**
   * Query Pi's current state (model, session info, etc.).
   * Returns the full get_state response including sessionFile and sessionId.
   */
  async getState() {
    return this.sendCommand({ type: 'get_state' });
  }

  /**
   * Send an abort command.
   */
  async abort() {
    return this.sendCommand({ type: 'abort' });
  }

  /**
   * Send an extension UI response.
   */
  sendExtensionUIResponse(id, payload) {
    if (!this.#alive) return;
    const frame = { type: 'extension_ui_response', id, ...payload };
    const line = JSON.stringify(frame) + '\n';
    try {
      this.#process.stdin.write(line);
    } catch (err) {
      console.error('[Pi] Failed to send extension_ui_response:', err.message);
    }
  }

  /**
   * Subscribe to events. Returns unsubscribe function.
   */
  onEvent(callback) {
    this.#eventListeners.add(callback);
    return () => this.#eventListeners.delete(callback);
  }

  // ─── Internal ───

  #drainLines() {
    let newlineIdx;
    while ((newlineIdx = this.#lineBuffer.indexOf('\n')) !== -1) {
      const line = this.#lineBuffer.slice(0, newlineIdx).trim();
      this.#lineBuffer = this.#lineBuffer.slice(newlineIdx + 1);
      if (!line) continue;

      let parsed;
      try {
        parsed = JSON.parse(line);
      } catch (err) {
        console.error('[Pi] Failed to parse JSONL:', line.slice(0, 200));
        continue;
      }

      // Route: command response vs event
      if (parsed.type === 'response' && parsed.id) {
        const pending = this.#pendingResponses.get(parsed.id);
        if (pending) {
          clearTimeout(pending.timer);
          this.#pendingResponses.delete(parsed.id);
          if (parsed.success) {
            pending.resolve(parsed);
          } else {
            pending.reject(new Error(parsed.error || 'RPC command failed'));
          }
        }
      }

      // Always emit to event listeners (including responses, for transparency)
      this.#emit(parsed);
    }
  }

  #emit(event) {
    for (const listener of this.#eventListeners) {
      try {
        listener(event);
      } catch (err) {
        console.error('[Pi] Event listener error:', err.message);
      }
    }
  }
}

// ─── Active sessions ────────────────────────────────────────────────

// Map<sessionId, SessionInfo>
// SessionInfo: { rpc: RpcClient, ws, username, activityTracker, pendingExtensionUI: Map }
const activeSessions = new Map();

// Tool timing
const toolStartTimes = new Map();
const toolUseToTaskMap = new Map();

// ─── Helpers (mirrored from claude.js) ──────────────────────────────

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
  if (typeof content !== 'string') return String(content);
  if (content.length <= maxLength) return content;
  return content.slice(0, maxLength) + `\n... (${content.length - maxLength} more chars)`;
}

function sanitizeBashCommand(cmd) {
  if (!cmd || typeof cmd !== 'string') return '';
  let sanitized = cmd
    .replace(/(-H\s+["']?Authorization:\s*Bearer\s+)[^\s"']+/gi, '$1[REDACTED]')
    .replace(/(Bearer\s+)[A-Za-z0-9_\-\.]{20,}/g, '$1[REDACTED]')
    .replace(/(-u\s+)[^\s:]+:[^\s@]+(@)/g, '$1[REDACTED]$2')
    .replace(/(https?:\/\/)[^:@\s]+:[^:@\s]+(@)/g, '$1[REDACTED]$2')
    .replace(/((?:API_KEY|SECRET|TOKEN|PASSWORD|PASS)\s*=\s*)[^\s;]+/gi, '$1[REDACTED]');
  return truncateOutput(sanitized, 200);
}

function sanitizeToolInput(tool, input) {
  if (!input) return {};
  const t = tool.toLowerCase();
  switch (t) {
    case 'bash': return { command: sanitizeBashCommand(input.command || input.cmd || '') };
    case 'read': return { file_path: input.file_path || input.path, offset: input.offset, limit: input.limit };
    case 'write': return { file_path: input.file_path || input.path };
    case 'edit': {
      const old = String(input.old_string || '').slice(0, 30);
      const nw = String(input.new_string || '').slice(0, 30);
      return { file_path: input.file_path || input.path, old_string: old, new_string: nw };
    }
    case 'glob': return { pattern: input.pattern, path: input.path };
    case 'grep': return { pattern: input.pattern, path: input.path, glob: input.glob, type: input.type };
    case 'task': return { description: input.description || input.prompt, subagent_type: input.subagent_type };
    default: return {};
  }
}

// Tool summary formatters
const toolFormatters = {
  bash: (i) => {
    const fullCommand = i.command || i.cmd || '';
    return { summary: `$ ${truncateOutput(fullCommand, TOOL_SUMMARY_TRUNCATE_LENGTH)}`, fullCommand };
  },
  read: (i) => {
    const filePath = i.file_path || i.path || null;
    return { summary: `Reading ${filePath || 'file'}`, filePath };
  },
  write: (i) => {
    const filePath = i.file_path || i.path || null;
    return { summary: `Writing ${filePath || 'file'}`, filePath };
  },
  edit: (i) => {
    const filePath = i.file_path || i.path || null;
    return { summary: `Editing ${filePath || 'file'}`, filePath };
  },
  glob: (i) => {
    const pattern = i.pattern || null;
    return { summary: `Finding ${pattern || 'files'}`, pattern };
  },
  grep: (i) => {
    const pattern = i.pattern || i.query || null;
    return { summary: `Searching: ${truncateOutput(pattern || '', TOOL_SUMMARY_TRUNCATE_LENGTH)}`, pattern };
  },
  todowrite: (i) => {
    const todos = i.todos || [];
    const completedCount = todos.filter(t => t.status === 'completed' || t.status === 'done').length;
    return { summary: todos.length === 0 ? 'Updating todo list' : `Updating todo list (${completedCount}/${todos.length} completed)` };
  },
  todoread: () => ({ summary: 'Reading todo list' }),
  task: (i) => {
    const desc = i?.prompt || i?.task || i?.description || '';
    return { summary: desc ? `Task: ${truncateOutput(desc, TOOL_SUMMARY_TRUNCATE_LENGTH)}` : 'Delegating task' };
  },
  taskoutput: (i) => ({ summary: i?.task_id ? `Checking task ${i.task_id}` : 'Checking task output' }),
};

function getToolSummary(tool, input) {
  if (!input) return { summary: tool };
  const formatter = toolFormatters[tool.toLowerCase()];
  return formatter ? formatter(input) : { summary: tool };
}

// ─── Pi Event → Cleon UI Message Transformation ────────────────────

/**
 * Transform a Pi RPC event into a Cleon UI message (or null to skip).
 * Returns { type, ...data } matching what the frontend expects inside
 * a `claude-message` wrapper.
 */
function transformEvent(event, sessionId, sessionInfo) {
  const timestamp = generateTimestamp();
  const messageId = randomUUID();

  switch (event.type) {
    // ── Text streaming ──
    case 'message_update': {
      const ame = event.assistantMessageEvent;
      if (!ame) return null;

      if (ame.type === 'text_delta' && ame.delta) {
        return {
          type: 'text',
          content: ame.delta,
          timestamp,
          messageId,
        };
      }

      // Tool call delta from the assistant message — we handle tool_execution_start separately
      return null;
    }

    // ── Tool execution ──
    case 'tool_execution_start': {
      // Pi uses consistent field names (no fallbacks needed like OMP)
      const toolName = event.toolName || 'unknown';
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
        const taskTitle = typeof summary === 'object' ? summary.summary : summary;
        const task = taskManager.trackTaskStart(sessionId, {
          title: taskTitle,
          progress: 0,
          metadata: { tool: toolName, toolUseId, input },
        });
        toolUseToTaskMap.set(toolUseId, task.taskId);
        broadcastTaskUpdate(sessionInfo.ws, 'task-started', task, sessionInfo.username, sessionId);
        if (toolUseToTaskMap.size > 100) {
          toolUseToTaskMap.delete(toolUseToTaskMap.keys().next().value);
        }
      }

      // Track activity
      if (sessionInfo?.activityTracker) {
        const summary = getToolSummary(toolName, input);
        const summaryText = typeof summary === 'object' ? summary.summary : summary;
        sessionInfo.activityTracker.startTool(toolName, summaryText);
      }

      const summary = getToolSummary(toolName, input);
      if (typeof summary === 'string') {
        // Normalize to object
      }

      return {
        type: 'tool_use',
        tool: toolName,
        id: toolUseId,
        summary: typeof summary === 'object' ? summary : { summary },
        timestamp,
        messageId,
        startTime: startTime.toISOString(),
        input: sanitizeToolInput(toolName, input),
      };
    }

    case 'tool_execution_end': {
      // Pi uses consistent field names
      const toolUseId = event.toolCallId || '';
      const isError = event.isError === true;
      // Extract output text from Pi's result structure
      let output = '';
      if (event.result && event.result.content) {
        const content = event.result.content;
        if (Array.isArray(content)) {
          output = content.filter(c => c.type === 'text').map(c => c.text).join('\n');
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
          const outputStr = typeof output === 'string' ? output : JSON.stringify(output);
          if (isError) {
            task = taskManager.trackTaskFailed(sessionId, taskId, outputStr);
            if (task) broadcastTaskUpdate(sessionInfo.ws, 'task-failed', task, sessionInfo.username, sessionId);
          } else {
            task = taskManager.trackTaskComplete(sessionId, taskId, { output: outputStr });
            if (task) broadcastTaskUpdate(sessionInfo.ws, 'task-completed', task, sessionInfo.username, sessionId);
          }
          toolUseToTaskMap.delete(toolUseId);
        }
      }

      // Track activity
      if (sessionInfo?.activityTracker) {
        sessionInfo.activityTracker.completeTool();
      }

      return {
        type: 'tool_result',
        id: toolUseId,
        success: !isError,
        output: truncateOutput(
          typeof output === 'string' ? output : JSON.stringify(output),
          TOOL_OUTPUT_TRUNCATE_LENGTH
        ),
        timestamp,
        messageId,
        duration,
        startTime: startTimeIso,
      };
    }

    // ── Extension UI (questions, confirms) ──
    case 'extension_ui_request': {
      const method = event.method;
      const uiId = event.id;

      if (method === 'select') {
        // Pi sends options as string arrays (simplified from OMP)
        const options = (event.options || []).map(opt => {
          if (typeof opt === 'string') return { label: opt };
          return { label: String(opt) };
        });
        return {
          type: 'question',
          id: uiId,
          questions: [{
            question: event.title || event.message || 'Select an option',
            header: event.title || '',
            options,
            multiSelect: event.multiple || false,
          }],
        };
      }

      if (method === 'confirm') {
        return {
          type: 'question',
          id: uiId,
          questions: [{
            question: event.message || event.title || 'Confirm?',
            header: event.title || '',
            options: [
              { label: 'Yes', description: 'Confirm' },
              { label: 'No', description: 'Cancel' },
            ],
            multiSelect: false,
          }],
        };
      }

      if (method === 'input') {
        return {
          type: 'question',
          id: uiId,
          questions: [{
            question: event.title || event.message || 'Enter a value',
            header: event.title || '',
            options: [],
            multiSelect: false,
            freeText: true,
            placeholder: event.placeholder || '',
          }],
        };
      }

      // Other methods (notify, setStatus, etc.) are fire-and-forget; ignore
      return null;
    }

    // ── Session lifecycle ──
    case 'agent_start': {
      if (sessionInfo?.activityTracker) {
        sessionInfo.activityTracker.startThinking();
      }
      return null; // No direct frontend message; streaming state managed elsewhere
    }

    case 'agent_end': {
      // Signals completion — handled by the main loop as 'claude-done'
      return { type: '_agent_end' };
    }

    case 'turn_start': {
      if (sessionInfo?.activityTracker) {
        sessionInfo.activityTracker.startThinking();
      }
      return null;
    }

    case 'turn_end': {
      // Extract token usage from message.usage
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
          type: '_token_usage',
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
    case 'extension_error': {
      return {
        type: 'text',
        content: `\n\n[Extension error: ${event.error || 'unknown'}]\n`,
        timestamp,
        messageId,
      };
    }

    // ── Pi-specific events (not in OMP) ──
    case 'tool_execution_update': {
      // Pi streams partial tool output during long-running tools
      // For now, skip (no frontend support for live tool output)
      return null;
    }

    case 'message_start':
    case 'message_end': {
      // Pi message lifecycle events — no direct frontend mapping needed
      return null;
    }

    case 'auto_compaction_start': {
      return {
        type: 'text',
        content: '\n[Context compaction in progress...]\n',
        timestamp,
        messageId,
      };
    }

    case 'auto_compaction_end': {
      if (event.result) {
        return {
          type: 'text',
          content: `\n[Context compacted: ${event.result.tokensBefore} tokens → reduced]\n`,
          timestamp,
          messageId,
        };
      }
      return null;
    }

    case 'auto_retry_start': {
      return {
        type: 'text',
        content: `\n[Retrying... attempt ${event.attempt}/${event.maxAttempts} after error: ${event.errorMessage}]\n`,
        timestamp,
        messageId,
      };
    }

    case 'auto_retry_end': {
      if (!event.success) {
        return {
          type: 'text',
          content: `\n[Retry failed after ${event.attempt} attempts: ${event.finalError}]\n`,
          timestamp,
          messageId,
        };
      }
      return null;
    }

    // ── Process lifecycle (internal) ──
    case '_process_exit':
    case '_process_error':
    case 'ready':
    case 'response':
      return null;

    default:
      // Unknown event types — skip
      return null;
  }
}

/**
 * Extract token usage from an event or its nested fields.
 */

// ─── Exported API (matches claude.js interface) ─────────────────────

/**
 * Handle incoming chat message from WebSocket.
 */
export async function handleChat(msg, ws, username) {
  const { content, projectPath, sessionId, isNewSession, attachments } = msg;
  const projectDisplayName = projectPath ? projectPath.split('/').pop() : '';

  // Build prompt — just the user's message, no history prepending
  // (Pi maintains native context in the persistent RPC session)
  let prompt = content || '';

  // Handle attachments
  let tempImagePaths = [];
  if (attachments && attachments.length > 0) {
    const textAttachments = [];

    for (const att of attachments) {
      if (att.type === 'image') {
        try {
          const base64Data = att.data.replace(/^data:image\/\w+;base64,/, '');
          const ext = att.mediaType?.split('/')[1] || 'png';
          const tempDir = path.join(projectPath, '.claude-uploads');
          await fs.mkdir(tempDir, { recursive: true });
          const tempPath = path.join(tempDir, `upload-${randomUUID()}.${ext}`);
          await fs.writeFile(tempPath, Buffer.from(base64Data, 'base64'));
          tempImagePaths.push(tempPath);
          const relativePath = path.relative(projectPath, tempPath);
          textAttachments.push(`\n\n[User attached an image: ${att.name}. Please use the Read tool to view the image at: ${relativePath}]`);
        } catch (err) {
          console.error('[Pi] Failed to save temp image:', err);
          textAttachments.push(`\n\n[User tried to attach an image: ${att.name}, but it failed to process]`);
        }
      } else {
        textAttachments.push(`\n\n--- ${att.name} ---\n${att.data}`);
      }
    }

    if (textAttachments.length > 0) {
      prompt += textAttachments.join('');
    }
  }

  // Session info for tracking
  const currentSessionId = sessionId || randomUUID();
  const sessionInfo = {
    rpc: null,
    ws,
    username,
    activityTracker: null,
    pendingExtensionUI: new Map(),
  };

  let unsubscribeEvents = null;

  try {
    console.log(`[Pi] Chat - project: ${projectPath}, session: ${currentSessionId}`);
    console.log(`[Pi] Prompt length: ${prompt.length} chars`);

    // Get or create persistent RPC session
    const manager = getRpcSessionManager();
    const { rpc, sessionFile, isNew } = await manager.getOrCreate(currentSessionId, projectPath, username);
    sessionInfo.rpc = rpc;

    // Register session in active sessions map and session registry
    activeSessions.set(currentSessionId, sessionInfo);
    startSessionBuffer(currentSessionId);
    register(currentSessionId, {
      username,
      projectPath,
      projectName: projectDisplayName,
      displayName: projectDisplayName,
      status: 'streaming',
      piSessionFile: sessionFile,
    });
    publish(username, { type: 'session-status', sessionId: currentSessionId, status: 'streaming' });
    sessionInfo.activityTracker = createActivityTracker((event) => publish(username, event), currentSessionId);

    // If this is a "new" session and client didn't have a sessionId yet, tell them
    if (!sessionId) {
      sendMessage(ws, { type: 'session-created', sessionId: currentSessionId }, username);
    }

    // Set the requested model before prompting
    if (msg.model && msg.model.includes('/')) {
      const slashIdx = msg.model.indexOf('/');
      const provider = msg.model.slice(0, slashIdx);
      const modelId = msg.model.slice(slashIdx + 1);
      try {
        const modelResp = await rpc.sendCommand({ type: 'set_model', provider, modelId });
        if (modelResp && modelResp.success) {
          console.log(`[Pi] Model set to ${msg.model}`);
        } else {
          console.warn(`[Pi] set_model failed for ${msg.model}:`, modelResp);
        }
      } catch (err) {
        console.error(`[Pi] Failed to set model ${msg.model}:`, err.message);
        // Don't fail the chat — continue with default model
      }
    }

    // Subscribe to events and transform them for the frontend
    let agentDone = false;

    const agentEndPromise = new Promise((resolve) => {
      unsubscribeEvents = rpc.onEvent((event) => {
        // Skip internal frames we don't care about
        if (event.type === 'ready' || event.type === 'response') return;

        const transformed = transformEvent(event, currentSessionId, sessionInfo);
        if (!transformed) return;

        // Special internal signals
        if (transformed.type === '_agent_end') {
          agentDone = true;
          resolve();
          return;
        }

        if (transformed.type === '_token_usage') {
          sendMessage(ws, {
            type: 'token-usage',
            sessionId: currentSessionId,
            ...transformed.usage,
          }, username);
          return;
        }

        // Forward to frontend
        sendMessage(ws, {
          type: 'claude-message',
          sessionId: currentSessionId,
          data: transformed,
        }, username);
      });
    });

    // Also resolve on process exit (in case agent_end never fires)
    const processExitPromise = new Promise((resolve) => {
      rpc.onEvent((event) => {
        if (event.type === '_process_exit' || event.type === '_process_error') {
          resolve();
        }
      });
    });

    // Send the prompt (just the user message — Pi has full native context)
    await rpc.prompt(prompt);

    // Wait for completion
    await Promise.race([agentEndPromise, processExitPromise]);

    // Stream complete
    console.log(`[Pi] Query complete - session: ${currentSessionId}`);
    sendMessage(ws, { type: 'claude-done', sessionId: currentSessionId }, username);

  } catch (err) {
    console.error('[Pi] Query error:', err);

    const errMsg = err.message || '';
    const isRateLimit = errMsg.includes('429') ||
                        errMsg.includes('rate limit') ||
                        errMsg.includes('Rate limit');
    const userMessage = isRateLimit
      ? 'Rate limit reached. The API is temporarily throttled — please wait a moment and try again.'
      : errMsg || 'Query failed';

    sendMessage(ws, {
      type: 'error',
      sessionId: currentSessionId || msg.sessionId || null,
      message: userMessage,
    }, username);
  } finally {
    if (sessionInfo.activityTracker) {
      sessionInfo.activityTracker.finish();
      sessionInfo.activityTracker = null;
    }

    // Unsubscribe event listeners for this turn
    if (unsubscribeEvents) {
      unsubscribeEvents();
    }

    // Release session back to pool (starts idle timer) instead of killing
    const manager = getRpcSessionManager();
    manager.release(currentSessionId);

    activeSessions.delete(currentSessionId);
    setStatus(currentSessionId, 'idle');
    publish(username, { type: 'session-status', sessionId: currentSessionId, status: 'idle' });

    // DON'T clear task manager — session is still alive in the pool
    // taskManager.clearSession(currentSessionId);

    // Clean up temp images
    for (const tempPath of tempImagePaths) {
      try { await fs.unlink(tempPath); } catch { /* ignore */ }
    }
  }
}

/**
 * Abort an active session.
 */
export async function handleAbort(sessionId) {
  // First check the active sessions map (mid-query)
  const sessionInfo = activeSessions.get(sessionId);
  if (sessionInfo?.rpc?.alive) {
    try {
      console.log(`[Pi] Aborting session: ${sessionId}`);
      await sessionInfo.rpc.abort();

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

  // Also check the session manager (process may be alive but between queries)
  const manager = getRpcSessionManager();
  const poolSession = manager.get(sessionId);
  if (poolSession?.rpc?.alive) {
    try {
      console.log(`[Pi] Aborting pooled session: ${sessionId}`);
      await poolSession.rpc.abort();
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
 * Sends extension_ui_response back to Pi RPC process.
 */
export async function handleQuestionResponse(sessionId, toolUseId, answers) {
  console.log(`[Pi] Received question response for ${toolUseId}`);

  // Check active sessions first, then fall back to session manager pool
  let rpc = null;
  const sessionInfo = activeSessions.get(sessionId);
  if (sessionInfo?.rpc?.alive) {
    rpc = sessionInfo.rpc;
  } else {
    const manager = getRpcSessionManager();
    const poolSession = manager.get(sessionId);
    if (poolSession?.rpc?.alive) {
      rpc = poolSession.rpc;
    }
  }

  if (!rpc) {
    console.log(`[Pi] No active RPC session for ${sessionId}`);
    return false;
  }

  // Determine the response value from the answers
  // Frontend sends answers as an object like { "0": "Yes" } or { "0": ["option1", "option2"] }
  let responseValue;
  if (answers && typeof answers === 'object') {
    const values = Object.values(answers);
    if (values.length === 1) {
      responseValue = values[0];
    } else {
      responseValue = values;
    }
  } else {
    responseValue = answers;
  }

  // Check if this was a confirm-type question (Yes/No mapped from confirm method)
  if (responseValue === 'Yes' || responseValue === 'No') {
    rpc.sendExtensionUIResponse(toolUseId, { confirmed: responseValue === 'Yes' });
  } else {
    rpc.sendExtensionUIResponse(toolUseId, { value: responseValue });
  }

  return true;
}

/**
 * Handle plan confirmation response from frontend.
 * Plan mode is not used with Pi — stub for interface compatibility.
 */
export async function handlePlanResponse(sessionId, toolUseId, approved, feedback) {
  console.log(`[Pi] Plan response received (not applicable for Pi backend)`);
  return false;
}

// Export transformEvent for testing
export { transformEvent as _transformEvent };

// Export RpcClient for use by rpc-session-manager
export { RpcClient };
