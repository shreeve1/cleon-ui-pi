---
title: Entity — server/index.js
type: entity
status: promoted
created: 2026-05-27
updated: 2026-05-27
sources:
  - wiki/raw/code/server-index.js
  - wiki/raw/claude-md-2026-05-27.md
confidence: high
tags: [backend, http, websocket, express, sse, auth, cors, pm2]
---

# Entity — `server/index.js`

Entry point (`#!/usr/bin/env node`) for the Cleon UI Pi backend. Boots Express HTTP server, WebSocket upgrade handler, SSE stream, file watchers, and graceful shutdown sequencing. 713 lines.

## Responsibilities

- Bootstrap Express + WebSocket server, default port 3010 (operational deploy uses 3015 via `.env`).
- Apply `helmet` CSP (HSTS/COOP/CORP disabled for local HTTP), `cors` origin validation, and `express-rate-limit` throttling.
- Route WebSocket messages (`chat`, `abort`, `question-response`, `plan-response`, `close-session`) to handlers exported by `server/pi-agent.js`.
- Maintain the per-user Server-Sent Events stream that snapshots session state and replays broadcast buffers.
- Run the session-attach workflow: stale-streaming detection, CLI watcher detection, buffer replay.
- Sequence graceful shutdown for PM2: heartbeat clear → CLI watchers → WebSocket close → SDK destroy → HTTP close.

## Imports / coupling

- `./auth.js` — `authRoutes`, `authenticateToken`, `authenticateWebSocket`.
- `./pi-agent.js` — `handleChat`, `handleAbort`, plus question/plan response handlers.
- `./session-registry.js` — session-state queries and mutations.
- `./broadcast.js` — per-session buffer replay and active-buffer checks.
- `./session-watcher.js` — CLI session file watchers.
- `./session-manager-instance.js` — singleton SDK session manager.

## Key regions

| Region | Lines | Purpose |
|--------|-------|---------|
| Helmet + CSP | 64–79 | local-dev hardening |
| CORS origin validation | 82–122 | allows configured origins + all localhost/private IPs |
| Rate limiting | 124–145 | 100/IP general, 10/IP for `/api/auth`, 15-min window |
| Multer upload | 164–168 | 10 MB in-memory |
| Static frontend serve | 171–180 | no-cache, no-store |
| Session attach endpoint | 249–388 | stale detection, CLI watcher, buffer replay |
| SSE stream | 390–446 | 10s heartbeat, state snapshot, per-session replay |
| WebSocket handler | 486–590 | dispatch + error/close events |
| PORT fallback | ~515 | `process.env.PORT \|\| 3010` |
| Graceful shutdown | 619–710 | staged 500/800/300 ms windows |

## External deps

`express`, `ws`, `helmet`, `cors`, `express-rate-limit`, `multer`, `dotenv`, Node stdlib (`http`, `path`, `url`).

## State / side-effects

- Env reads: `PORT`, `HOST`, `ALLOWED_ORIGINS` (comma-split, normalized at startup).
- Filesystem: serves `../public`; session file watchers monitor `.json` files on disk.
- In-memory: per-session broadcast buffers, WebSocket heartbeat state, session registry references.
- No direct DB writes from this file (auth + sessions own those).

## Ops gotchas

- **CORS private-IP bypass**: requests from `127.0.0.1`, `localhost`, 10.x.x.x, 172.16–31.x.x, and 192.168.x.x are auto-allowed regardless of `ALLOWED_ORIGINS`. Treat any LAN as trusted; do not expose this server directly to an untrusted local network.
- **Stale-streaming detection** keys on `stopReason !== "toolUse"` + last-message age > 3 s. If wrong, UI hangs on attach.
- **Reverse-proxy idle timeout**: SSE heartbeat (10 s) prevents Nginx/Caddy from closing connections at ~60 s idle. Do not remove without raising the proxy timeout.
- **PM2 kill window**: total graceful shutdown is ~2 s. If PM2 `kill_timeout < 3000`, processes may be force-terminated mid-flush.
- **WebSocket token in query string**: appears in proxy access logs. Prefer HTTPS-only deployment.
- **Heartbeat ping**: WebSocket clients receive a ping every 30 s; missing pong → connection terminated.

## Cross-references

- Auth flow → `server/auth.js`.
- Session lifecycle → `wiki/entities/entity-server-sdk-session-manager.md`.
- Chat dispatch → `wiki/entities/entity-server-pi-agent.md`.
- Sync-bug fixes that landed here → `wiki/candidates/analysis-session-sync-bugs.md`.
