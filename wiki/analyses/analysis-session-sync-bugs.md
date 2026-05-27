---
title: Analysis — Session Sync Bugs (deletion, multi-tab close, multi-tab create)
type: analysis
status: promoted
created: 2026-05-27
updated: 2026-05-27
sources:
  - wiki/raw/docs/bugfix-session-tab-deletion.md
  - wiki/raw/docs/bugfix-session-tab-deletion-diagrams.md
  - wiki/raw/docs/sync-bugs-analysis.md
  - wiki/raw/quick-test-guide-2026-05-27.md
confidence: high
tags: [bugfix, sessions, websocket, multi-tab, registry, broadcast]
---

# Analysis — Session Sync Bugs

Three related synchronization defects in the session lifecycle. All three are fixed in the snapshot dated 2026-05-27. Documented here for future regression hunts.

## Bug #1 — Deleted sessions reappear after refresh (FIXED)

**Symptom.** User closes a session tab (X button). Reloads page. The deleted tab reappears.

**Root cause.**
- `public/app.js:290` `closeSession()` removed the session from local state + localStorage only.
- The server-side session registry was never told, so it persisted the entry to disk.
- On refresh, the SSE `state-snapshot` returned every registry session, and the auto-adopt branch at `public/app.js:1143-1156` re-adopted the "orphan" the client had just dropped.

**Fix.** Frontend `closeSession()` now sends a `close-session` WebSocket message (with `sessionId`, only when the WS is `OPEN`). Server handler in `server/index.js` (~lines 132-141 of the diff) removes from the registry. Test in `tests/unit/session-close-removes-from-registry.test.js`.

## Bug #2 — Multi-tab close not broadcast (FIXED)

**Symptom.** Tab A closes a session. Tab B still shows the session until manual refresh.

**Root cause.** The original `close-session` handler in `server/index.js:384-392` removed the entry but did not call `publish(username, …)` — so other WS connections owned by the same user never learned about it. Other ops paths (`setStatus`, etc.) already use `publish()`; this one was missed.

**Fix.** Server now broadcasts `{ type: 'session-closed', sessionId }` to all connections for `username` after registry removal. Frontend handler added in `public/app.js` (proposed slot at ~line 1180 in `sync-bugs-analysis.md`) drops the session from state.

## Bug #3 — Multi-tab create not broadcast (FIXED)

**Symptom.** Tab A creates a new session. Tab B does not see it until refresh.

**Root cause.** `sendMessage()` in `server/pi-agent.js:267-275` only broadcasts to all user connections when the message contains a `sessionId`. The `session-created` message at `server/pi-agent.js:777-779` was missing one, so the code fell through to the no-broadcast branch.

**Fix.** Either add `sessionId` to the `session-created` payload, or call `publish(username, …)` unconditionally on session creation (latter is the shipped form, per `QUICK_TEST_GUIDE`). Frontend listens for `session-created` and inserts the new tab.

## Common shape

All three failures are instances of the same architectural smell: **dual source of truth (client localStorage + server registry) without a broadcast contract on mutations**. Operations that mutate session state must:

1. Touch the server registry first.
2. Publish a typed event (`session-closed`, `session-created`, etc.) via `publish(username, …)` to fan it out to every WS connection for the user.
3. Let each connected client reconcile its local state from the event.

The pattern already existed in `pi-agent.js` for streaming/turn updates; the session-mutation paths simply hadn't adopted it.

## Regression guard

Re-run `wiki/candidates/source-quick-test-guide.md` after any change to:

- `server/index.js` WebSocket dispatcher or `close-session` handler.
- `server/pi-agent.js` `sendMessage()` or session-creation flow.
- `public/app.js` session adoption / `closeSession()` / multi-tab event handlers.

## Open items

- `sync-bugs-analysis.md` also flags **Issue #4** (model selection cross-device sync) and **Issue #5** (favorites cross-device sync). Both are deliberately *per-browser-only* design choices, not bugs. If product direction changes, revisit.
- No remaining unfixed sync bugs identified in this batch.

## Cross-references

- Test plan → `wiki/candidates/source-quick-test-guide.md`.
- WebSocket dispatcher → `wiki/candidates/entity-server-index.md`.
- Session-create broadcast → `wiki/candidates/entity-server-pi-agent.md`.
