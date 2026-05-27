# OMP Integration Design

**Date:** 2026-02-28
**Status:** Approved
**Goal:** Replace Anthropic SDK backend with Oh My Pi (OMP) RPC backend while preserving all Cleon UI features

## Overview

Cleon UI currently uses the `@anthropic-ai/claude-agent-sdk` to communicate with Claude. This design replaces that integration with Oh My Pi's RPC mode, allowing Cleon UI to use OMP as the AI coding agent backend.

## Decisions Summary

| Aspect | Decision |
|--------|----------|
| Streaming | Stream deltas to frontend (requires frontend changes) |
| Interactive tools | Handle via OMP Extension UI Sub-Protocol |
| Sessions | Cleon UI manages in SQLite, prepend history to prompts |
| Token usage | Forward OMP's token events to frontend |
| Plan mode | Remove/ignore for now, focus on core streaming first |

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Cleon UI Frontend                        │
│                     (public/app.js, style.css)                  │
│                                                                 │
│  • Accumulates text deltas into complete messages               │
│  • Displays tool executions, questions, token usage             │
│  • Sends user messages and question responses                   │
└───────────────────────────┬─────────────────────────────────────┘
                            │ WebSocket
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                     Cleon UI Backend                            │
│                    (server/index.js)                            │
│                                                                 │
│  • Routes chat requests to omp.js                               │
│  • Handles auth, sessions, projects (unchanged)                 │
└───────────────────────────┬─────────────────────────────────────┘
                            │ Function calls
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                    NEW: server/omp.js                           │
│                                                                 │
│  • RpcClient class - spawns & communicates with omp --mode rpc  │
│  • handleChat() - sends prompts, transforms events              │
│  • handleAbort() - sends abort command                          │
│  • handleQuestionResponse() - sends extension_ui_response       │
│  • Transforms OMP events → Cleon UI message format              │
└───────────────────────────┬─────────────────────────────────────┘
                            │ JSONL over stdio
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                    OMP RPC Process                              │
│                   (omp --mode rpc)                              │
│                                                                 │
│  • AI agent with tools (bash, read, write, etc.)                │
│  • Emits streaming events                                       │
│  • Sends extension_ui_request for questions                     │
└─────────────────────────────────────────────────────────────────┘
```

## Backend: omp.js Module

**File:** `server/omp.js`

**Exports (same interface as claude.js):**
```javascript
export async function handleChat(msg, ws, username)
export async function handleAbort(sessionId)
export async function handleQuestionResponse(sessionId, toolUseId, answers)
export async function handlePlanResponse(sessionId, toolUseId, approved, feedback)
export function isSessionActive(sessionId)
export function resubscribeSession(sessionId, newWs)
```

**RpcClient Class:**
```javascript
class RpcClient {
  #process          // Bun.Subprocess or child_process
  #requestId        // Counter for request correlation
  #pendingResponses // Map<id, resolve/reject>
  #eventListeners   // Set of event callbacks

  async start()              // Spawn: omp --mode rpc
  async stop()               // Kill process
  async sendCommand(cmd)     // Send JSONL command
  async prompt(message)      // Send prompt command
  async abort()              // Send abort command
  onEvent(callback)          // Subscribe to events
}
```

### Event Transformation (OMP → Cleon UI)

| OMP Event | Cleon UI Message |
|-----------|------------------|
| `message_update` (text_delta) | Accumulate delta, emit `text_delta` then `text_complete` |
| `tool_execution_start` | `tool_use` with tool name, id, summary |
| `tool_execution_end` | `tool_result` with success, output |
| `extension_ui_request` (method: select) | `question` with options |
| `agent_end` | `claude-done` |
| `extension_error` | `error` |
| Token usage event | `token-usage` |

### Session History Handling

- On `handleChat()` with existing sessionId: load history from SQLite
- Format as conversation block and prepend to prompt
- OMP always starts fresh (no `--resume`)

## Frontend: Streaming Changes

**File:** `public/app.js`

**Changes:**
- Track streaming state with `streamingMessageId` and `streamingText`
- Handle `text_delta` events - accumulate and update UI in real-time
- Handle `text_complete` events - finalize message

```javascript
// Track streaming state
let streamingMessageId = null;
let streamingText = '';

// Handle text_delta events
case 'text_delta':
  if (!streamingMessageId) {
    streamingMessageId = generateUUID();
    streamingText = '';
    createMessageElement(streamingMessageId, 'assistant');
  }
  streamingText += msg.delta;
  updateMessageContent(streamingMessageId, streamingText);
  break;

// Handle stream end
case 'text_complete':
  streamingMessageId = null;
  streamingText = '';
  break;
```

## Interactive Questions

**Flow:**
```
OMP → extension_ui_request → Backend → WebSocket → Frontend
Frontend → WebSocket → Backend → extension_ui_response → OMP
```

**Backend handling:**
- Map `extension_ui_request.id` → pending promise
- Forward question to frontend via WebSocket
- When frontend responds, send `extension_ui_response` back to OMP

**Frontend handling:**
- Uses existing question dialog UI (already implemented for AskUserQuestion)
- No UI changes needed

## Error Handling

| Error Source | Handling |
|--------------|----------|
| OMP process fails to start | Send `error` message, display "Failed to connect to OMP" |
| OMP process crashes | Detect exit, send `error`, cleanup session |
| RPC command timeout | 60-second timeout, send `error` if exceeded |
| `extension_error` from OMP | Forward to frontend as `error` message |
| WebSocket disconnect | Keep OMP alive, allow reconnect |
| User abandons session | Send `abort` to OMP on cleanup |

## Implementation Phases

```
Phase 1: Core Backend (omp.js)
├── RpcClient class (spawn process, send commands, read events)
├── handleChat() - basic prompt/event loop
├── handleAbort()
└── Message transformation (OMP events → Cleon UI format)

Phase 2: Frontend Streaming
├── Handle text_delta events
├── Accumulate deltas into messages
└── Update UI in real-time

Phase 3: Interactive Questions
├── Handle extension_ui_request in backend
├── Wire up existing frontend question dialog
└── Send extension_ui_response back to OMP

Phase 4: Polish
├── Token usage display
├── Session history prepending
├── Error handling refinement
└── Cleanup old claude.js references
```

## Rollback Plan

- Keep `claude.js` unchanged in codebase
- Single line change in `index.js` to switch back:
  ```javascript
  // import { handleChat, ... } from './omp.js';
  import { handleChat, ... } from './claude.js';
  ```

## Files Changed

| File | Change |
|------|--------|
| `server/omp.js` | NEW - RPC client implementation |
| `server/index.js` | Import from omp.js instead of claude.js |
| `public/app.js` | Handle text_delta streaming |
