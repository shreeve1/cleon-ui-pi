---
title: Entity — server/pi-agent.js
type: entity
status: candidate
created: 2026-05-27
updated: 2026-05-27
sources:
  - wiki/raw/code/server-pi-agent.js
  - wiki/raw/claude-md-2026-05-27.md
confidence: high
tags: [backend, pi-sdk, sessions, streaming, tools, attachments]
---

# Entity — `server/pi-agent.js`

Pi SDK transaction handler. Receives WebSocket chat messages, fetches/creates a persistent `AgentSession` from `server/sdk-session-manager.js`, subscribes to SDK events, transforms them into Cleon UI JSON, and streams them to the browser. 773 lines.

## Responsibilities

- Transform Pi SDK `AgentSessionEvent` objects into UI-friendly JSON messages.
- Manage tool lifecycle: start/end timing, task correlation, dropped-tool dedup.
- Ingest chat messages (with image attachments) and dispatch to the SDK session via `session.prompt()`.
- Maintain `activeSessions` map and per-session activity trackers.
- Sanitize bearer tokens, basic auth, and credential assignments out of bash commands before broadcast.

## Public surface

- `handleChat(msg, ws, username)` — main WS message handler.
- `handleAbort(sessionId)` — abort active or pooled session.
- `isSessionActive(sessionId)` — streaming-status check.
- `resubscribeSession(sessionId, newWs)` — swap WS for an existing session (reconnection).
- `handleQuestionResponse(sessionId, toolUseId, answers)` — route extension UI answers.
- `handlePlanResponse(...)` — stub (plan mode unused with Pi).
- `_transformEvent(event, sessionId, sessionInfo)` — exported for tests.

## Key regions

| Region | Lines | Purpose |
|--------|-------|---------|
| `stripAnsi` regex + helper | 19–24 | strip SGR/CSI/OSC escape sequences (ECMA-48) |
| Send + truncate + sanitize | 45–94 | message envelope + redaction |
| Tool formatters | 97–139 | per-tool summary generators (bash, read, write, edit, glob, grep, task, …) |
| Event transformation switch | 176–449 | message_update, tool_execution_*, turn_*, tokens, extension errors, compaction, retries, dropped tools |
| Chat handler core | 456–515 | attachment handling, prompt assembly, session fetch, model selection |
| Event subscription + streaming | 597–630 | `subscribe → prompt → forward` loop |
| Error handling + cleanup | 632–685 | abort detection, rate-limit detection, temp-file cleanup |

## Pi SDK integration

- `getSdkSessionManager().getOrCreate()` — fetch/create persistent session.
- `session.bindExtensions(uiContext)` — bind extension UI bridge (cached in `session._extensionUIContext`; subsequent turns only call `setUIContext()`).
- `session.modelRegistry.find(...)` + `session.setModel(...)` — model selection per turn.
- `session.subscribe(listener)` → `await session.prompt(prompt)` — the one SDK call that runs an agentic turn.
- `session.abort()` — interrupt.

## State / persistence

- In-memory: `activeSessions` map (sessionId → `{session, ws, username, activityTracker, bridge}`), tool timing maps (`toolStartTimes`, `toolUseToTaskMap`, `notifiedDroppedTools`).
- Temp files: `${projectPath}/.pi-uploads/upload-<uuid>.<ext>` for image attachments; deleted in the `finally` after `prompt()` completes (lines ~681–684).
- Session-file persistence is delegated entirely to `sdk-session-manager.js`; this file never writes `~/.pi/agent/cleon-sessions.json`.

## Inter-file coupling

- ↔ `sdk-session-manager.js` via `getOrCreate()`, `release()`, `get()`.
- ↔ `server/index.js`: `handleChat` and `handleAbort` are routed from the WS dispatcher.
- ↔ `tasks.js`, `broadcast.js`, `bus.js`, `activity.js`, `session-registry.js`, `extension-ui-bridge.js`.

## Ops gotchas

- **Silent model fallback** (lines ~575–586): missing registry or unknown model → session continues with default; only the log line warns. Mismatch between `config/models.json` and `~/.pi/agent/models.json` is the usual trigger (see `C-0003`).
- **Two abort paths** (lines ~691–727): `activeSessions` (live) vs. `manager.get()` (pooled idle). Touching one path without the other leaves sessions hanging.
- **Image-upload failures don't abort chat**: a failed save appends a fallback message; user may not realize the attachment never made it.
- **Dropped-tool notification map manually evicts oldest when size > 500** — no auto-expiry; stale entries can accumulate over long uptimes.
- **`session-created` broadcast** lives here (per `QUICK_TEST_GUIDE`). Touching session creation flow risks regressing the multi-tab sync fix — see `wiki/candidates/analysis-session-sync-bugs.md`.

## Cross-references

- Session pool lifecycle → `wiki/candidates/entity-server-sdk-session-manager.md`.
- Dispatch from WebSocket → `wiki/candidates/entity-server-index.md`.
- Model dropdown history → `wiki/candidates/source-design-plans-history.md`.
