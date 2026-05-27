# OMP Integration Implementation Plan

**Design Document:** `docs/plans/2026-02-28-omp-integration-design.md`
**Goal:** Replace Anthropic SDK backend with OMP RPC backend

## Phase 1: Core Backend (omp.js)

### Task 1.1: Create RpcClient class
**File:** `server/omp.js`

Create the RpcClient class that spawns and communicates with the OMP RPC process:
- Spawn `omp --mode rpc` as a child process
- Implement stdin/stdout JSONL communication
- Request/response correlation with IDs
- Event subscription system

```javascript
class RpcClient {
  constructor() {
    this.process = null;
    this.requestId = 0;
    this.pendingResponses = new Map();
    this.eventListeners = new Set();
  }

  async start() { /* spawn omp --mode rpc */ }
  async stop() { /* kill process */ }
  async sendCommand(cmd) { /* send JSONL, return response promise */ }
  async prompt(message) { /* send prompt command */ }
  async abort() { /* send abort command */ }
  onEvent(callback) { /* subscribe to events */ }
}
```

### Task 1.2: Implement handleChat function
**File:** `server/omp.js`

Implement the main chat handler:
- Accept same parameters as `claude.js` version
- Load session history from SQLite if resuming
- Prepend history to prompt
- Send prompt to OMP
- Process event stream and transform to Cleon UI format
- Handle `message_update` (text_delta) events
- Handle `tool_execution_start` / `tool_execution_end` events
- Handle `agent_end` event
- Track active sessions

### Task 1.3: Implement handleAbort function
**File:** `server/omp.js`

Send abort command to OMP and clean up session state.

### Task 1.4: Implement message transformation
**File:** `server/omp.js`

Transform OMP events to Cleon UI message format:
- `message_update` (text_delta) → emit `text_delta` to frontend
- `message_end` → emit `text_complete` with full text
- `tool_execution_start` → `tool_use` message
- `tool_execution_end` → `tool_result` message
- `agent_end` → `claude-done` message

### Task 1.5: Update index.js import
**File:** `server/index.js`

Change import from `claude.js` to `omp.js`:
```javascript
// Before
import { handleChat, handleAbort, handleQuestionResponse, handlePlanResponse } from './claude.js';

// After
import { handleChat, handleAbort, handleQuestionResponse, handlePlanResponse } from './omp.js';
```

---

## Phase 2: Frontend Streaming

### Task 2.1: Add streaming state tracking
**File:** `public/app.js`

Add state variables to track streaming messages:
```javascript
let streamingMessageId = null;
let streamingText = '';
```

### Task 2.2: Handle text_delta events
**File:** `public/app.js`

Add handler for `text_delta` message type:
- Create new message element if not streaming
- Accumulate delta text
- Update message content in real-time

### Task 2.3: Handle text_complete events
**File:** `public/app.js`

Add handler for `text_complete` message type:
- Finalize the message
- Reset streaming state
- Apply any final formatting

### Task 2.4: Test streaming display
- Verify text appears in real-time
- Verify code blocks render correctly during stream
- Verify message finalizes properly

---

## Phase 3: Interactive Questions

### Task 3.1: Handle extension_ui_request in backend
**File:** `server/omp.js`

Handle `extension_ui_request` events from OMP:
- Detect `method: 'select'` (Ask tool)
- Forward to frontend as `question` message type
- Store pending callback for response

### Task 3.2: Implement handleQuestionResponse
**File:** `server/omp.js`

Handle question responses from frontend:
- Receive answers from frontend
- Send `extension_ui_response` back to OMP
- Resolve pending callback

### Task 3.3: Wire up frontend question handler
**File:** `public/app.js`

Ensure existing question dialog works with new message format (may need minor adjustments to message type handling).

---

## Phase 4: Polish

### Task 4.1: Token usage display
- Identify OMP token usage event format
- Forward to frontend
- Verify display works

### Task 4.2: Session history prepending
- Test session resume
- Verify history is correctly formatted and prepended
- Test conversation continuity

### Task 4.3: Error handling refinement
- Test various error scenarios
- Verify user-friendly error messages
- Test graceful recovery

### Task 4.4: Cleanup
- Remove or comment out unused Anthropic SDK dependency (keep for rollback)
- Update any documentation
- Final testing

---

## Testing Checklist

- [ ] Basic message streaming works
- [ ] Text deltas display in real-time
- [ ] Code blocks render correctly
- [ ] Tool executions display properly
- [ ] Interactive questions work
- [ ] Abort functionality works
- [ ] Session resume works with history
- [ ] Token usage displays
- [ ] Errors display properly
- [ ] Multiple concurrent sessions work

## Rollback

If issues arise, revert `server/index.js` import:
```javascript
import { handleChat, handleAbort, handleQuestionResponse, handlePlanResponse } from './claude.js';
```
