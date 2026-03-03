# OMP → Pi Coding Agent Migration Plan

**Goal:** Replace the OMP RPC backend in Cleon UI with Pi coding agent's RPC mode (`pi --mode rpc`), maintaining full feature parity.

**Architecture:** Keep the existing RPC-over-stdin/stdout architecture. Rename `server/omp.js` → `server/pi-agent.js`, update the `RpcClient` to match Pi's protocol (no `ready` event, different field names on events, different `extension_ui_response` format), and update the `transformEvent()` function to map Pi's event schema to Cleon UI's frontend message format. The WebSocket handler interface (`handleChat`, `handleAbort`, `handleQuestionResponse`, `handlePlanResponse`) stays identical.

**Tech Stack:** Node.js, Pi coding agent CLI (`pi --mode rpc`), JSONL over stdin/stdout, WebSockets, Vitest

**Test command:** `npx vitest run`

---

## Protocol Differences: OMP vs Pi

### Startup
| Aspect | OMP | Pi |
|--------|-----|----|
| Binary | `omp --mode rpc` | `pi --mode rpc` |
| Ready signal | `{ type: "ready" }` event | **None** — process is ready after ~100ms if not exited |
| First response | After `ready` event | Immediate — send commands as soon as process is alive |

### Event Field Mapping

#### `tool_execution_start`
| Field | OMP | Pi |
|-------|-----|----|
| Tool call ID | `toolCallId` or `toolUseId` or `id` | `toolCallId` |
| Tool name | `toolName` or `tool` or `name` | `toolName` |
| Arguments | `args` or `input` | `args` |

#### `tool_execution_end`
| Field | OMP | Pi |
|-------|-----|----|
| Tool call ID | `toolCallId` or `toolUseId` or `id` | `toolCallId` |
| Result | `result` (nested `.content[]`) or `output` | `result` (has `.content[]` and `.details`) |
| Error flag | `isError` or `error` presence | `isError` |

#### `turn_end`
| Field | OMP | Pi |
|-------|-----|----|
| Token usage | `event.message.usage.{input,output,cacheRead,cacheWrite}` | `event.message.usage.{input,output,cacheRead,cacheWrite,cost}` |
| Model | `event.message.model` | `event.message.model` |

#### `extension_ui_request`
Identical protocol. Both use `method`, `id`, `title`, `options`, `message`, `placeholder`, `timeout`.

#### `extension_ui_response`
| Field | OMP (Cleon sends) | Pi (expects) |
|-------|-------------------|--------------|
| Confirm | `{ id, confirmed: bool }` | `{ type: "extension_ui_response", id, confirmed: bool }` |
| Select/Input | `{ id, value: string }` | `{ type: "extension_ui_response", id, value: string }` |
| Cancel | N/A (not used) | `{ type: "extension_ui_response", id, cancelled: true }` |

#### Additional Pi events (not in OMP)
- `tool_execution_update` — streaming tool output (new, optional to handle)
- `message_start` / `message_end` — message lifecycle (can ignore)
- `auto_compaction_start/end` — context compaction (can forward as info)
- `auto_retry_start/end` — retry on transient errors (can forward as info)

### Session Storage
| Aspect | OMP | Pi |
|--------|-----|----|
| Location | `~/.claude/projects/-{name}/{sessionId}.jsonl` | `~/.pi/agent/sessions/--{path}--/{timestamp}_{uuid}.jsonl` |
| Format | OMP-specific JSONL | Pi tree-structured JSONL (v3) |
| History loading | Custom `loadSessionHistory()` reads OMP files | Pi manages history internally via `--session` or `--continue` flags |

---

## Tasks

### Phase 0: Preparation & Safety

#### Task 0.1: Create migration branch
- **Files:** N/A (git operation)
- **Instructions:**
  ```bash
  git checkout -b feat/pi-agent-migration
  ```
- **Verify:** `git branch --show-current` → `feat/pi-agent-migration`
- **Commit:** `chore: create pi-agent migration branch`

#### Task 0.2: Backup current omp.js
- **Files:** Create `server/omp.js.bak`
- **Instructions:**
  ```bash
  cp server/omp.js server/omp.js.bak
  ```
- **Verify:** `diff server/omp.js server/omp.js.bak` → no diff
- **Commit:** `chore: backup omp.js before migration`

---

### Phase 1: Write Tests for the New Event Transformation Layer

#### Task 1.1: Create Pi event transformation unit tests
- **Files:** Create `tests/unit/pi-agent-transform.test.js`
- **Instructions:** Write tests for `transformEvent()` covering all Pi event types. These tests will initially fail (TDD red phase) and pass after implementation in Phase 2.

```javascript
/**
 * Unit tests for Pi agent event transformation.
 * Tests that Pi RPC events are correctly mapped to Cleon UI frontend messages.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// We'll import transformEvent after creating pi-agent.js
// For now, define expected input/output pairs

describe('Pi Agent Event Transformation', () => {

  describe('message_update (text_delta)', () => {
    it('should transform text_delta into Cleon text message', () => {
      const piEvent = {
        type: 'message_update',
        message: { role: 'assistant', content: [] },
        assistantMessageEvent: {
          type: 'text_delta',
          contentIndex: 0,
          delta: 'Hello world',
        },
      };
      // Expected output:
      // { type: 'text', content: 'Hello world', timestamp: string, messageId: string }
    });

    it('should return null for non-text_delta message_update events', () => {
      const piEvent = {
        type: 'message_update',
        message: { role: 'assistant', content: [] },
        assistantMessageEvent: {
          type: 'toolcall_delta',
          contentIndex: 0,
          delta: '{"command',
        },
      };
      // Expected: null
    });
  });

  describe('tool_execution_start', () => {
    it('should transform Pi tool_execution_start with consistent field names', () => {
      const piEvent = {
        type: 'tool_execution_start',
        toolCallId: 'call_abc123',
        toolName: 'bash',
        args: { command: 'ls -la' },
      };
      // Expected: { type: 'tool_use', tool: 'bash', id: 'call_abc123', ... }
    });
  });

  describe('tool_execution_end', () => {
    it('should extract text from Pi result.content array', () => {
      const piEvent = {
        type: 'tool_execution_end',
        toolCallId: 'call_abc123',
        toolName: 'bash',
        result: {
          content: [{ type: 'text', text: 'total 48\ndrwxr-xr-x ...' }],
          details: {},
        },
        isError: false,
      };
      // Expected: { type: 'tool_result', id: 'call_abc123', success: true, output: 'total 48...' }
    });

    it('should handle error results', () => {
      const piEvent = {
        type: 'tool_execution_end',
        toolCallId: 'call_err',
        toolName: 'bash',
        result: {
          content: [{ type: 'text', text: 'command not found' }],
          details: {},
        },
        isError: true,
      };
      // Expected: { type: 'tool_result', id: 'call_err', success: false, ... }
    });
  });

  describe('turn_end (token usage)', () => {
    it('should extract token usage from Pi turn_end event', () => {
      const piEvent = {
        type: 'turn_end',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'Hello' }],
          model: 'claude-sonnet-4-20250514',
          usage: {
            input: 1000,
            output: 200,
            cacheRead: 500,
            cacheWrite: 100,
            cost: { input: 0.003, output: 0.003, cacheRead: 0.0005, cacheWrite: 0.000375, total: 0.006875 },
          },
        },
        toolResults: [],
      };
      // Expected: { type: '_token_usage', usage: { cumulativeInput: 1000, ... } }
    });
  });

  describe('extension_ui_request', () => {
    it('should transform select method to Cleon question format', () => {
      const piEvent = {
        type: 'extension_ui_request',
        id: 'uuid-1',
        method: 'select',
        title: 'Choose option',
        options: ['A', 'B', 'C'],
      };
      // Expected: { type: 'question', id: 'uuid-1', questions: [{ question: 'Choose option', options: [...] }] }
    });

    it('should transform confirm method to Yes/No question', () => {
      const piEvent = {
        type: 'extension_ui_request',
        id: 'uuid-2',
        method: 'confirm',
        title: 'Proceed?',
        message: 'Are you sure?',
      };
    });

    it('should transform input method to freeText question', () => {
      const piEvent = {
        type: 'extension_ui_request',
        id: 'uuid-3',
        method: 'input',
        title: 'Enter value',
        placeholder: 'type here...',
      };
    });
  });

  describe('agent lifecycle', () => {
    it('should return _agent_end for agent_end events', () => {
      const piEvent = { type: 'agent_end', messages: [] };
      // Expected: { type: '_agent_end' }
    });

    it('should return null for agent_start', () => {
      const piEvent = { type: 'agent_start' };
      // Expected: null (side effect: start activity tracker thinking)
    });
  });

  describe('events to ignore', () => {
    it('should return null for message_start', () => {
      const piEvent = { type: 'message_start', message: {} };
    });

    it('should return null for message_end', () => {
      const piEvent = { type: 'message_end', message: {} };
    });

    it('should return null for tool_execution_update', () => {
      const piEvent = {
        type: 'tool_execution_update',
        toolCallId: 'call_abc',
        toolName: 'bash',
        args: {},
        partialResult: { content: [{ type: 'text', text: 'partial...' }], details: {} },
      };
    });

    it('should return null for response events', () => {
      const piEvent = { type: 'response', id: 'req_1', command: 'prompt', success: true };
    });
  });

  describe('extension_error', () => {
    it('should transform extension_error into text message', () => {
      const piEvent = {
        type: 'extension_error',
        extensionPath: '/path/to/ext.ts',
        event: 'tool_call',
        error: 'Something went wrong',
      };
      // Expected: { type: 'text', content: '\n\n[Extension error: Something went wrong]\n' }
    });
  });
});
```

- **Verify:** `npx vitest run tests/unit/pi-agent-transform.test.js` — tests should fail (no implementation yet)
- **Commit:** `test: add Pi agent event transformation unit tests (red phase)`

#### Task 1.2: Create RpcClient startup/lifecycle unit tests
- **Files:** Create `tests/unit/pi-agent-rpc.test.js`
- **Instructions:** Write tests for the new RpcClient behavior changes:
  - No `ready` event wait — should resolve start after brief delay + process-alive check
  - Should use `pi` binary instead of `omp`
  - Should read `PI_BINARY` env var
  - `sendCommand()` same protocol (JSONL command/response)
  - `sendExtensionUIResponse()` must include `type: "extension_ui_response"` in frame

```javascript
import { describe, it, expect, vi } from 'vitest';

describe('Pi RpcClient', () => {
  describe('binary configuration', () => {
    it('should default to "pi" binary', () => {
      // Verify PI_BINARY default
    });

    it('should respect PI_BINARY env override', () => {
      // Verify env override
    });
  });

  describe('startup', () => {
    it('should NOT wait for a ready event', () => {
      // Pi does not emit ready — client waits 500ms then checks process.exitCode
    });
  });

  describe('extension_ui_response framing', () => {
    it('should include type field in extension_ui_response', () => {
      // Pi requires: { type: "extension_ui_response", id, ...payload }
      // OMP did: { type: "extension_ui_response", id, ...payload } — same!
      // But verify the frame is correct
    });
  });
});
```

- **Verify:** `npx vitest run tests/unit/pi-agent-rpc.test.js` — tests should fail
- **Commit:** `test: add Pi RPC client lifecycle tests (red phase)`

---

### Phase 2: Implement the Pi Agent Module

#### Task 2.1: Create `server/pi-agent.js` by copying and modifying `server/omp.js`
- **Files:** Create `server/pi-agent.js`
- **Instructions:** Copy `server/omp.js` to `server/pi-agent.js` and make the following changes:

**Change 1: Binary constant (line ~16)**
```javascript
// OLD:
const OMP_BINARY = process.env.OMP_BINARY || 'omp';

// NEW:
const PI_BINARY = process.env.PI_BINARY || 'pi';
```

**Change 2: Spawn args (RpcClient constructor + start method, line ~38-41)**
```javascript
// OLD:
const args = ['--mode', 'rpc', ...this.#extraArgs];
this.#process = spawn(OMP_BINARY, args, {

// NEW:
const args = ['--mode', 'rpc', '--no-session', ...this.#extraArgs];
this.#process = spawn(PI_BINARY, args, {
```
Note: `--no-session` prevents Pi from creating persistent session files (Cleon manages its own session concept). The `--no-session` flag means Pi runs ephemeral.

**Change 3: Remove `ready` event wait (start method, lines ~55-70)**
```javascript
// OLD:
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

// NEW:
// Pi RPC mode does not emit a 'ready' event.
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
```

**Change 4: Update `sendExtensionUIResponse` to always include `type` field (line ~115)**
```javascript
// OLD:
sendExtensionUIResponse(id, payload) {
  if (!this.#alive) return;
  const frame = { type: 'extension_ui_response', id, ...payload };
  // ^ This already includes type — no change needed!

// Verify: This is already correct for Pi. No change needed.
```

**Change 5: Update all log prefixes from `[OMP]` to `[Pi]`**
Find-and-replace all `[OMP` with `[Pi` throughout the file.

**Change 6: Update `transformEvent()` for Pi's consistent field names (lines ~476-530)**

The tool_execution_start handler:
```javascript
// OLD (permissive field resolution):
case 'tool_execution_start': {
  const toolName = event.toolName || event.tool || event.name || 'unknown';
  const toolUseId = event.toolCallId || event.toolUseId || event.id || randomUUID();
  const input = event.args || event.input || {};

// NEW (Pi uses consistent field names):
case 'tool_execution_start': {
  const toolName = event.toolName || 'unknown';
  const toolUseId = event.toolCallId || randomUUID();
  const input = event.args || {};
```

The tool_execution_end handler:
```javascript
// OLD (complex result extraction):
case 'tool_execution_end': {
  const toolUseId = event.toolCallId || event.toolUseId || event.id || '';
  const isError = event.isError === true || !!event.error;
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

// NEW (Pi has consistent structure):
case 'tool_execution_end': {
  const toolUseId = event.toolCallId || '';
  const isError = event.isError === true;
  let output = '';
  if (event.result && event.result.content) {
    const content = event.result.content;
    if (Array.isArray(content)) {
      output = content.filter(c => c.type === 'text').map(c => c.text).join('\n');
    } else {
      output = JSON.stringify(event.result);
    }
  }
```

**Change 7: Update `turn_end` token usage extraction for Pi's usage format**
```javascript
// OLD:
case 'turn_end': {
  const msgUsage = event.message?.usage;
  if (msgUsage) {
    const model = event.message?.model || null;
    const input = msgUsage.input || 0;
    const output = msgUsage.output || 0;
    const cacheRead = msgUsage.cacheRead || 0;
    const cacheCreate = msgUsage.cacheWrite || 0;
    const cumulativeTotal = input + output + cacheRead + cacheCreate;
    const contextWindow = 200000;

// NEW (Pi includes cost breakdown and model info in AssistantMessage):
case 'turn_end': {
  const msg = event.message;
  const msgUsage = msg?.usage;
  if (msgUsage) {
    const model = msg?.model || null;
    const input = msgUsage.input || 0;
    const output = msgUsage.output || 0;
    const cacheRead = msgUsage.cacheRead || 0;
    const cacheCreate = msgUsage.cacheWrite || 0;
    const cumulativeTotal = input + output + cacheRead + cacheCreate;
    const contextWindow = 200000;
    // Note: Pi also provides msgUsage.cost.total but we keep the existing format
```
This is functionally identical — no actual change needed, but verify the field names match.

**Change 8: Add handlers for new Pi events (near the `default` case, line ~724)**
```javascript
// After existing cases, add:
case 'tool_execution_update': {
  // Pi streams partial tool output. We can optionally forward this
  // for live tool output display. For now, skip (no frontend support).
  return null;
}

case 'message_start':
case 'message_end':
  // Pi lifecycle events — no direct frontend mapping needed
  return null;

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
```

**Change 9: Remove `loadSessionHistory` and related functions (lines ~337-414)**
Pi manages its own session history via the `--session` / `--continue` flags. Since we use `--no-session`, the conversation context is fully managed by Pi within the process lifetime. Remove:
- `loadSessionHistory()`
- `parseHistoryEntry()`
- `formatConversationHistory()`

And in `handleChat()`, remove the history loading block:
```javascript
// REMOVE this entire block (~lines 744-757):
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
```

**Change 10: Update extension_ui_request field mapping for Pi (line ~594)**
Pi sends `options` as a string array (not objects with label/description). Update:
```javascript
// OLD:
if (method === 'select') {
  const options = (event.options || []).map(opt => {
    if (typeof opt === 'string') return { label: opt };
    return { label: opt.label || opt.value || String(opt), description: opt.description || '' };
  });

// NEW (Pi always sends string arrays):
if (method === 'select') {
  const options = (event.options || []).map(opt => {
    if (typeof opt === 'string') return { label: opt };
    return { label: String(opt) };
  });
```

- **Verify:** File compiles: `node -c server/pi-agent.js`
- **Commit:** `feat: create pi-agent.js with Pi RPC protocol support`

#### Task 2.2: Wire up `server/pi-agent.js` in `server/index.js`
- **Files:** Modify `server/index.js`
- **Instructions:** Change the import on line 17:

```javascript
// OLD:
import { handleChat, handleAbort, handleQuestionResponse, handlePlanResponse } from './omp.js';

// NEW:
import { handleChat, handleAbort, handleQuestionResponse, handlePlanResponse } from './pi-agent.js';
```

No other changes needed in `index.js` — the exported function signatures are identical.

- **Verify:** `node -c server/index.js`
- **Commit:** `feat: switch index.js import from omp.js to pi-agent.js`

---

### Phase 3: Update Configuration

#### Task 3.1: Update `.env.example`
- **Files:** Modify `.env.example`
- **Instructions:** Replace the Claude SDK section:

```bash
# OLD:
# Claude SDK Configuration
ANTHROPIC_API_KEY=your-api-key-here
CONTEXT_WINDOW=200000

# NEW:
# Pi Coding Agent Configuration
# The pi binary must be installed: npm install -g @mariozechner/pi-coding-agent
# Configure API keys in Pi's own config: ~/.pi/agent/auth.json or env vars
ANTHROPIC_API_KEY=your-api-key-here
# Override pi binary path (default: 'pi' from PATH)
# PI_BINARY=/opt/homebrew/bin/pi
CONTEXT_WINDOW=200000
```

- **Verify:** `cat .env.example | grep PI_BINARY`
- **Commit:** `docs: update .env.example for Pi agent configuration`

#### Task 3.2: Update `package.json` dependencies
- **Files:** Modify `package.json`
- **Instructions:** Remove the OMP SDK dependency:

```json
// REMOVE this line from dependencies:
"@anthropic-ai/claude-agent-sdk": "^0.1.29",
```

Pi is used as a CLI binary (`pi --mode rpc`), not as an npm dependency. No new dependency needed.

- **Verify:** `node -e "const p = require('./package.json'); console.log(p.dependencies['@anthropic-ai/claude-agent-sdk'] ? 'FAIL: still present' : 'OK: removed')"`
- **Commit:** `chore: remove @anthropic-ai/claude-agent-sdk dependency`

---

### Phase 4: Update Tests

#### Task 4.1: Update existing tests that reference `omp.js`
- **Files:** Modify `tests/unit/code-analysis.test.js`, `tests/integration/ws-reconnect-flow.test.js`
- **Instructions:** Update all references from `omp.js` to `pi-agent.js`:

In `tests/unit/code-analysis.test.js`:
```javascript
// OLD:
it('should import handleChat, handleAbort, handleQuestionResponse, handlePlanResponse from omp.js', () => {
  expect(indexJs).toMatch(/import\s*\{[^}]*handleChat[^}]*handleAbort[^}]*handleQuestionResponse[^}]*handlePlanResponse[^}]*\}\s*from\s*'\.\/omp\.js'/);

// NEW:
it('should import handleChat, handleAbort, handleQuestionResponse, handlePlanResponse from pi-agent.js', () => {
  expect(indexJs).toMatch(/import\s*\{[^}]*handleChat[^}]*handleAbort[^}]*handleQuestionResponse[^}]*handlePlanResponse[^}]*\}\s*from\s*'\.\/pi-agent\.js'/);
```

```javascript
// OLD:
it('should NOT import isSessionActive or resubscribeSession from omp.js', () => {
  const ompImport = indexJs.match(/import\s*\{[^}]*\}\s*from\s*'\.\/omp\.js'/);

// NEW:
it('should NOT import isSessionActive or resubscribeSession from pi-agent.js', () => {
  const piImport = indexJs.match(/import\s*\{[^}]*\}\s*from\s*'\.\/pi-agent\.js'/);
```

In `tests/integration/ws-reconnect-flow.test.js`:
```javascript
// OLD:
it('imports from omp.js not claude.js', () => {
  const ompImport = indexJs.match(/import\s*\{[^}]*\}\s*from\s*'\.\/omp\.js'/);

// NEW:
it('imports from pi-agent.js not claude.js', () => {
  const piImport = indexJs.match(/import\s*\{[^}]*\}\s*from\s*'\.\/pi-agent\.js'/);
```

- **Verify:** `npx vitest run tests/unit/code-analysis.test.js tests/integration/ws-reconnect-flow.test.js`
- **Commit:** `test: update test references from omp.js to pi-agent.js`

#### Task 4.2: Complete and wire up Pi transformation tests
- **Files:** Update `tests/unit/pi-agent-transform.test.js` (from Task 1.1)
- **Instructions:** Now that `pi-agent.js` exists, import `transformEvent` and complete all test assertions:

```javascript
// Add at top:
import { transformEvent } from '../../server/pi-agent.js';

// Then for each test, call transformEvent and assert output matches expected format.
// Example:
it('should transform text_delta into Cleon text message', () => {
  const piEvent = {
    type: 'message_update',
    message: { role: 'assistant', content: [] },
    assistantMessageEvent: {
      type: 'text_delta',
      contentIndex: 0,
      delta: 'Hello world',
    },
  };
  const result = transformEvent(piEvent, 'session-123', {});
  expect(result).not.toBeNull();
  expect(result.type).toBe('text');
  expect(result.content).toBe('Hello world');
  expect(result.timestamp).toBeDefined();
  expect(result.messageId).toBeDefined();
});
```

Note: `transformEvent` must be exported from `pi-agent.js`. Add this export at the bottom of `pi-agent.js`:
```javascript
// Add for testability:
export { transformEvent as _transformEvent };
```

- **Verify:** `npx vitest run tests/unit/pi-agent-transform.test.js` — all tests pass (green phase)
- **Commit:** `test: complete Pi event transformation tests (green phase)`

---

### Phase 5: Run Full Test Suite & Verify

#### Task 5.1: Run all unit tests
- **Files:** N/A
- **Instructions:**
  ```bash
  npx vitest run
  ```
- **Verify:** All tests pass. If any fail, fix before proceeding.
- **Commit:** `test: all unit tests passing after Pi migration`

#### Task 5.2: Manual smoke test — Pi RPC mode
- **Files:** N/A
- **Instructions:** Verify Pi works in RPC mode standalone:
  ```bash
  echo '{"type":"prompt","message":"Say hello in 5 words or less"}' | pi --mode rpc --no-session 2>/dev/null | head -50
  ```
  Expected: JSON lines including `agent_start`, `message_update` with `text_delta`, `agent_end`.

- **Verify:** Output contains `"type":"message_update"` lines with `"text_delta"` events
- **Commit:** N/A (manual verification)

#### Task 5.3: Manual smoke test — Cleon UI end-to-end
- **Files:** N/A
- **Instructions:**
  1. Start the server: `npm run dev`
  2. Open browser to `http://localhost:3010`
  3. Send a chat message: "Hello, what files are in this directory?"
  4. Verify:
     - Text streams in real-time ✓
     - Tool executions show as tool pills ✓
     - Token usage updates in UI ✓
     - Abort button works ✓
  5. Test extension UI (if applicable):
     - Extension select/confirm/input dialogs render ✓
     - Responses are sent back correctly ✓

- **Verify:** All 4 checks pass
- **Commit:** N/A (manual verification)

---

### Phase 6: Cleanup

#### Task 6.1: Remove `server/claude.js` (legacy, unused)
- **Files:** Delete `server/claude.js`
- **Instructions:** The old Claude SDK integration file is no longer imported anywhere. Verify and remove:
  ```bash
  grep -r "from './claude.js'" server/ || echo "Not imported — safe to remove"
  rm server/claude.js
  ```
- **Verify:** `node -c server/index.js` still works
- **Commit:** `chore: remove legacy claude.js (replaced by pi-agent.js)`

#### Task 6.2: Remove `server/omp.js` and backup
- **Files:** Delete `server/omp.js`, `server/omp.js.bak`
- **Instructions:**
  ```bash
  grep -r "from './omp.js'" server/ || echo "Not imported — safe to remove"
  rm server/omp.js server/omp.js.bak
  ```
- **Verify:** `npm run dev` starts without errors
- **Commit:** `chore: remove omp.js and backup (replaced by pi-agent.js)`

#### Task 6.3: Run `npm install` to update lockfile
- **Files:** `package-lock.json`
- **Instructions:**
  ```bash
  npm install
  ```
- **Verify:** No errors. `@anthropic-ai/claude-agent-sdk` no longer in `node_modules`:
  ```bash
  ls node_modules/@anthropic-ai/claude-agent-sdk 2>/dev/null && echo "FAIL" || echo "OK: removed"
  ```
- **Commit:** `chore: update lockfile after removing claude-agent-sdk`

---

### Phase 7: Documentation

#### Task 7.1: Update README or project docs
- **Files:** `README.md` (if exists), or create `docs/pi-agent-integration.md`
- **Instructions:** Document:
  - Pi must be installed globally: `npm install -g @mariozechner/pi-coding-agent`
  - API key configuration: set `ANTHROPIC_API_KEY` env var or configure via `~/.pi/agent/auth.json`
  - Optional `PI_BINARY` env var to override binary path
  - Pi version compatibility: tested with v0.55.3+

- **Verify:** Documentation is accurate and complete
- **Commit:** `docs: add Pi coding agent integration documentation`

---

## Rollback Strategy

If the migration fails at any point:

1. **Immediate rollback (Phase 2-3):**
   ```bash
   # Restore omp.js import in index.js
   sed -i '' "s/from '.\/pi-agent.js'/from '.\/omp.js'/" server/index.js
   ```

2. **Full rollback:**
   ```bash
   git checkout main -- server/omp.js server/index.js package.json .env.example
   npm install
   ```

3. **Parallel operation (if needed):** Both `omp.js` and `pi-agent.js` can coexist. Switch between them by changing a single import line in `server/index.js`. Consider adding an env var toggle:
   ```javascript
   const backend = process.env.AGENT_BACKEND || 'pi';
   const { handleChat, handleAbort, handleQuestionResponse, handlePlanResponse } =
     backend === 'omp'
       ? await import('./omp.js')
       : await import('./pi-agent.js');
   ```

---

## Risk Assessment

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| Pi binary not in PATH on server | Medium | Document PI_BINARY env var; check at startup |
| Pi event format changes in future versions | Low | Pin pi version; add event format version check |
| Extension UI differences | Low | Protocol is nearly identical; tested via unit tests |
| Performance: Pi startup slower than OMP | Low | Pi spawns per-request (same as OMP); 500ms startup is acceptable |
| Session history gap (removing loadSessionHistory) | Medium | Pi manages its own context; multi-turn is handled within a single RPC process lifetime. For cross-session history, consider using `--session` flag in future enhancement. |

---

## Key Decisions

1. **RPC mode (not SDK):** Using `pi --mode rpc` keeps process isolation and matches the existing architecture. The SDK would require `@mariozechner/pi-coding-agent` as a dependency and significant refactoring.

2. **`--no-session` flag:** Pi's session persistence is orthogonal to Cleon UI's own session management. Using `--no-session` prevents duplicate session files.

3. **Per-request process lifecycle:** Each chat message spawns a new Pi RPC process (same as OMP). This means no cross-message context within Pi — history is prepended to prompts if needed. Future enhancement: keep Pi alive across messages using `--session` for native multi-turn.

4. **Export `transformEvent`:** Exported with underscore prefix (`_transformEvent`) to signal it's exported for testing only, not public API.
