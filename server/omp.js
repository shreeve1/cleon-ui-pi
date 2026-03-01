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

// Constants
const TOOL_OUTPUT_TRUNCATE_LENGTH = 1500;
const TOOL_SUMMARY_TRUNCATE_LENGTH = 200;
const RPC_COMMAND_TIMEOUT_MS = 60_000;
const OMP_BINARY = process.env.OMP_BINARY || 'omp';

// ─── RpcClient ──────────────────────────────────────────────────────

class RpcClient {
  #process = null;
  #requestId = 0;
  #pendingResponses = new Map(); // id -> { resolve, reject, timer }
  #eventListeners = new Set();
  #lineBuffer = '';
  #cwd = null;
  #extraArgs = [];
  #alive = false;

  constructor(cwd, extraArgs = []) {
    this.#cwd = cwd;
    this.#extraArgs = extraArgs;
  }

  async start() {
    if (this.#alive) return;

    const args = ['--mode', 'rpc', ...this.#extraArgs];
    this.#process = spawn(OMP_BINARY, args, {
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
      if (text) console.log(`[OMP:stderr] ${text}`);
    });

    this.#process.on('exit', (code, signal) => {
      this.#alive = false;
      console.log(`[OMP] Process exited code=${code} signal=${signal}`);
      // Reject all pending responses
      for (const [id, pending] of this.#pendingResponses) {
        clearTimeout(pending.timer);
        pending.reject(new Error(`OMP process exited (code=${code})`));
      }
      this.#pendingResponses.clear();
      // Notify listeners of exit
      this.#emit({ type: '_process_exit', code, signal });
    });

    this.#process.on('error', (err) => {
      this.#alive = false;
      console.error('[OMP] Process error:', err.message);
      this.#emit({ type: '_process_error', error: err.message });
    });

    // Wait for the { type: "ready" } message
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('OMP RPC startup timed out (no "ready" event)'));
      }, 15_000);

      const onReady = (event) => {
        if (event.type === 'ready') {
          clearTimeout(timeout);
          this.#eventListeners.delete(onReady);
          resolve();
        }
      };
      this.#eventListeners.add(onReady);
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
    if (!this.#alive) throw new Error('OMP RPC process not running');

    const id = `req_${++this.#requestId}`;
    const frame = { id, ...cmd };
    const line = JSON.stringify(frame) + '\n';

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pendingResponses.delete(id);
        reject(new Error(`OMP command timed out after ${RPC_COMMAND_TIMEOUT_MS}ms: ${cmd.type}`));
      }, RPC_COMMAND_TIMEOUT_MS);

      this.#pendingResponses.set(id, { resolve, reject, timer });

      try {
        this.#process.stdin.write(line);
      } catch (err) {
        clearTimeout(timer);
        this.#pendingResponses.delete(id);
        reject(new Error(`Failed to write to OMP stdin: ${err.message}`));
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
      console.error('[OMP] Failed to send extension_ui_response:', err.message);
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
        console.error('[OMP] Failed to parse JSONL:', line.slice(0, 200));
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
        console.error('[OMP] Event listener error:', err.message);
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

// ─── Session history ────────────────────────────────────────────────

function formatConversationHistory(messages, maxChars = 100000) {
  if (!messages || messages.length === 0) return '';

  const lines = [];
  let totalChars = 0;
  const recentMessages = messages.slice(-50);

  for (const msg of recentMessages) {
    let line = '';
    const timestamp = msg.timestamp ? `[${new Date(msg.timestamp).toLocaleTimeString()}] ` : '';

    if (msg.role === 'user') {
      line = `${timestamp}USER: ${msg.content || ''}`;
    } else if (msg.role === 'assistant') {
      const content = msg.content || '';
      const truncated = content.length > 2000
        ? content.slice(0, 2000) + '...[truncated]'
        : content;
      line = `${timestamp}ASSISTANT: ${truncated}`;
    } else if (msg.role === 'tool') {
      line = `${timestamp}TOOL (${msg.tool}): ${msg.summary || 'executed'}`;
    }

    if (line) {
      totalChars += line.length;
      if (totalChars > maxChars) break;
      lines.push(line);
    }
  }

  if (lines.length === 0) return '';

  return `<conversation-history>
Previous conversation context (${lines.length} messages):

${lines.join('\n\n')}

</conversation-history>

`;
}

async function loadSessionHistory(projectPath, sessionId, limit = 50) {
  const CLAUDE_PROJECTS = path.join(os.homedir(), '.claude', 'projects');
  const projectName = '-' + projectPath.slice(1).replace(/\//g, '-');
  const projectDir = path.join(CLAUDE_PROJECTS, projectName);

  try {
    const files = await fs.readdir(projectDir);
    const jsonlFiles = files.filter(f =>
      f.endsWith('.jsonl') &&
      !f.startsWith('agent-') &&
      f.startsWith(sessionId)
    );

    if (jsonlFiles.length === 0) return [];

    const messages = [];
    const sessionFile = path.join(projectDir, jsonlFiles[0]);
    const content = await fs.readFile(sessionFile, 'utf8');
    const lines = content.split('\n').filter(Boolean);

    for (const line of lines) {
      try {
        const entry = JSON.parse(line);
        if (entry.sessionId !== sessionId) continue;
        const msg = parseHistoryEntry(entry);
        if (msg) messages.push(msg);
      } catch { /* skip malformed */ }
    }

    messages.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    return messages.slice(-limit);
  } catch {
    return [];
  }
}

function parseHistoryEntry(entry) {
  const timestamp = entry.timestamp || new Date().toISOString();

  if (entry.type === 'user' || entry.message?.role === 'user') {
    let text = entry.message?.content;
    if (Array.isArray(text)) {
      text = text.filter(t => t.type === 'text').map(t => t.text).join('\n');
    }
    if (typeof text === 'string' && text.length > 0 &&
        !text.startsWith('<command-') && !text.startsWith('{')) {
      return { role: 'user', content: text, timestamp };
    }
  }

  if (entry.type === 'assistant' || entry.message?.role === 'assistant') {
    const content = entry.message?.content;
    if (Array.isArray(content)) {
      const textParts = content.filter(c => c.type === 'text').map(c => c.text);
      if (textParts.length > 0) return { role: 'assistant', content: textParts.join('\n'), timestamp };
    }
    if (typeof content === 'string' && content.length > 0) {
      return { role: 'assistant', content, timestamp };
    }
  }

  return null;
}

// ─── OMP Event → Cleon UI Message Transformation ────────────────────

/**
 * Transform an OMP RPC event into a Cleon UI message (or null to skip).
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
      const toolName = event.toolName || event.tool || event.name || 'unknown';
      const toolUseId = event.toolCallId || event.toolUseId || event.id || randomUUID();
      const input = event.args || event.input || {};

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
      const toolUseId = event.toolCallId || event.toolUseId || event.id || '';
      const isError = event.isError === true || !!event.error;
      // Extract output text from OMP's result structure
      let output = '';
      if (event.result && typeof event.result === 'object') {
        const content = event.result.content;
        if (Array.isArray(content)) {
          output = content.filter(c => c.type === 'text').map(c => c.text).join('\n');
        } else if (typeof event.result === 'string') {
          output = event.result;
        } else {
          output = JSON.stringify(event.result);
        }
      } else {
        output = event.output || event.error || '';
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
        // Map OMP select → Cleon UI question format
        const options = (event.options || []).map(opt => {
          if (typeof opt === 'string') return { label: opt };
          return { label: opt.label || opt.value || String(opt), description: opt.description || '' };
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

    // ── Process lifecycle (internal) ──
    case '_process_exit':
    case '_process_error':
    case 'ready':
    case 'response':
      return null;

    default:
      // Unknown event types (auto_compaction_start, etc.) — skip
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

  // Build prompt (with optional history and attachments)
  let prompt = content || '';

  if (sessionId && !isNewSession) {
    try {
      console.log(`[OMP] Loading history for session ${sessionId}`);
      const history = await loadSessionHistory(projectPath, sessionId, 50);
      if (history.length > 0) {
        const historyBlock = formatConversationHistory(history);
        prompt = historyBlock + 'CONTINUING CONVERSATION - User asks: ' + prompt;
        console.log(`[OMP] Prepended ${history.length} history messages to prompt`);
      }
    } catch (err) {
      console.error('[OMP] Failed to load history:', err);
    }
  }

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
          console.error('[OMP] Failed to save temp image:', err);
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

  try {
    console.log(`[OMP] Starting RPC - project: ${projectPath}, session: ${currentSessionId}`);
    console.log(`[OMP] Prompt length: ${prompt.length} chars`);

    // Spawn RPC client
    const rpc = new RpcClient(projectPath);
    sessionInfo.rpc = rpc;

    // Register session before spawning so abort can find it
    activeSessions.set(currentSessionId, sessionInfo);
    startSessionBuffer(currentSessionId);
    register(currentSessionId, {
      username,
      projectPath,
      projectName: projectDisplayName,
      displayName: projectDisplayName,
      status: 'streaming',
    });
    publish(username, { type: 'session-status', sessionId: currentSessionId, status: 'streaming' });
    sessionInfo.activityTracker = createActivityTracker((event) => publish(username, event), currentSessionId);

    // If this is a "new" session and client didn't have a sessionId yet, tell them
    if (!sessionId) {
      sendMessage(ws, { type: 'session-created', sessionId: currentSessionId }, username);
    }

    await rpc.start();

    // Subscribe to events and transform them for the frontend
    let agentDone = false;

    const agentEndPromise = new Promise((resolve) => {
      rpc.onEvent((event) => {
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

    // Send the prompt
    await rpc.prompt(prompt);

    // Wait for completion
    await Promise.race([agentEndPromise, processExitPromise]);

    // Stream complete
    console.log(`[OMP] Query complete - session: ${currentSessionId}`);
    sendMessage(ws, { type: 'claude-done', sessionId: currentSessionId }, username);

  } catch (err) {
    console.error('[OMP] Query error:', err);

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

    // Stop RPC process
    if (sessionInfo.rpc) {
      try { await sessionInfo.rpc.stop(); } catch { /* ignore */ }
    }

    activeSessions.delete(currentSessionId);
    setStatus(currentSessionId, 'idle');
    publish(username, { type: 'session-status', sessionId: currentSessionId, status: 'idle' });
    taskManager.clearSession(currentSessionId);

    for (const [toolUseId] of toolUseToTaskMap) {
      toolUseToTaskMap.delete(toolUseId);
    }

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
  const sessionInfo = activeSessions.get(sessionId);
  if (!sessionInfo) {
    console.log(`[OMP] Abort: session ${sessionId} not found`);
    return false;
  }

  try {
    console.log(`[OMP] Aborting session: ${sessionId}`);

    if (sessionInfo.rpc?.alive) {
      await sessionInfo.rpc.abort();
    }

    if (sessionInfo.activityTracker) {
      sessionInfo.activityTracker.finish();
      sessionInfo.activityTracker = null;
    }

    return true;
  } catch (err) {
    console.error(`[OMP] Abort error for ${sessionId}:`, err);
    return false;
  }
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
 * Sends extension_ui_response back to OMP RPC process.
 */
export async function handleQuestionResponse(sessionId, toolUseId, answers) {
  console.log(`[OMP] Received question response for ${toolUseId}`);

  const sessionInfo = activeSessions.get(sessionId);
  if (!sessionInfo?.rpc?.alive) {
    console.log(`[OMP] No active RPC session for ${sessionId}`);
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
    sessionInfo.rpc.sendExtensionUIResponse(toolUseId, { confirmed: responseValue === 'Yes' });
  } else {
    sessionInfo.rpc.sendExtensionUIResponse(toolUseId, { value: responseValue });
  }

  return true;
}

/**
 * Handle plan confirmation response from frontend.
 * Plan mode is not used with OMP — stub for interface compatibility.
 */
export async function handlePlanResponse(sessionId, toolUseId, approved, feedback) {
  console.log(`[OMP] Plan response received (not applicable for OMP backend)`);
  return false;
}
