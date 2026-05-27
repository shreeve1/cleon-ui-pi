---
title: Entity — server/sdk-session-manager.js
type: entity
status: candidate
created: 2026-05-27
updated: 2026-05-27
sources:
  - wiki/raw/code/server-sdk-session-manager.js
  - wiki/raw/claude-md-2026-05-27.md
confidence: high
tags: [backend, pi-sdk, sessions, pool, persistence]
---

# Entity — `server/sdk-session-manager.js`

Pool manager for persistent Pi SDK `AgentSession` objects. Lazy-loads sessions on demand, persists `sessionId ↔ sessionFile` mappings to `~/.pi/agent/cleon-sessions.json` so sessions survive server restarts, evicts idle sessions, and bridges CLI-created sessions to the web UI. 447 lines.

## Responsibilities

- Manage a pool of `AgentSession` objects keyed by `sessionId`.
- Persist `projectPath:sessionId → sessionFile` mappings to `~/.pi/agent/cleon-sessions.json`.
- Discover CLI-created sessions via filesystem scan of `~/.pi/agent/sessions/<safePath>/*.jsonl`.
- Enforce concurrency cap (`SDK_MAX_CONCURRENT`, default 10) by evicting oldest idle session.
- Time out idle sessions (`SDK_IDLE_TIMEOUT_MS`, default 10 minutes) via per-entry `idleTimer` plus a 60 s cleanup sweep.

## Public surface

- `class SdkSessionManager` — exported; the singleton lives in `server/session-manager-instance.js`.
- `start()` — load persistent map, begin cleanup interval.
- `getOrCreate(sessionId, projectPath, username)` → `{ session, sessionFile, isNew }`.
- `get(sessionId)` — peek without touching idle timer.
- `release(sessionId)` — mark idle and start the timeout.
- `destroy(sessionId)` / `destroyAll()` — dispose live entries (persistent mapping preserved on single destroy).
- `getSessionFile(sessionId, projectPath?)` — lookup from persistent map.
- `cleanup()` — scan for stale entries.
- `size`, `knownSessions`, `listSessions()` — introspection.

## Key regions

| Region | Lines | Purpose |
|--------|-------|---------|
| Constants | 6–11 | `IDLE_TIMEOUT_MS`, `MAX_CONCURRENT`, `SESSIONS_FILE` |
| Class fields | 32–46 | `#sessions`, `#sessionFileMap`, `#legacySessionFileMap`, `#cleanupInterval`, `#started` |
| `start()` | 50–65 | load map + start cleanup interval (with `unref()`) |
| `getOrCreate()` core | 77–195 | live → persistent → CLI scan → concurrency check → create/resume |
| `release()` + idle timer | 207–222 | activity timestamp + per-entry timeout |
| `destroy()` + cleanup sweep | 228–304 | dispose live entries + 60 s sweep |
| `#findCliSessionFile()` | 339–356 | scan `~/.pi/agent/sessions/<safePath>/` |
| Concurrency eviction | 136–144, 373–391 | drop least-recently-active idle |
| Persistent map I/O | 393–441 | load + legacy migration + save (pretty JSON) |

## Pi SDK integration

- `import { createAgentSession, SessionManager } from '@mariozechner/pi-coding-agent'`.
- `SessionManager.open(sessionFile)` — resume existing session.
- `SessionManager.create(projectPath)` — initialize new session.
- `await createAgentSession({ cwd, sessionManager })` — produces the `AgentSession` consumed by `pi-agent.js`.
- `session.dispose()` — called on destroy.

## State / persistence

- In-memory: `#sessions` Map (sessionId → `{ session, sessionManager, sessionFile, projectPath, username, lastActivity, idleTimer }`).
- Persistent: `~/.pi/agent/cleon-sessions.json` — object mapping `projectPath:sessionId → sessionFile`. Legacy bare-`sessionId` keys are migrated on startup.
- CLI-discovered sessions: scanned from `~/.pi/agent/sessions/<safePath>/*.jsonl`; cached after first hit.

## Inter-file coupling

- `pi-agent.js` is the only caller: `getOrCreate`, `release`, `get`.
- `session-manager-instance.js` is the singleton wrapper.
- `server/index.js` must call `manager.start()` once at boot, before any chats are processed.

## Ops gotchas

- **`projectPath` mismatch silently destroys the live session** (lines ~84–90). Reusing a sessionId from a different project drops the existing entry without warning; subsequent `prompt()` calls to the old session throw.
- **Two idle-timeout paths** (per-entry timer + cleanup sweep). `destroy()` is idempotent, but timing is unpredictable when both fire.
- **Legacy key migration is lossy** (~lines 104–115). A bare-sessionId mapping pointing to a file from a different project is silently treated as new.
- **First-time CLI discovery is O(N)** per `getOrCreate()` when no persistent mapping exists; results are cached on first hit but cold-start latency scales with session-folder size.
- **`SessionManager.open()` does not validate the file** — malformed `sessionFile` throws downstream from `createAgentSession()`.
- **`unref()` on cleanup interval** lets the process exit even when timers are pending; on hard crash, stale `idleTimer` callbacks are orphaned.

## Cross-references

- Transaction layer → `wiki/candidates/entity-server-pi-agent.md`.
- Boot sequencing → `wiki/candidates/entity-server-index.md`.
- Session-file persistence record → `wiki/sources/source-claude-md.md` (claim `C-0008`).
