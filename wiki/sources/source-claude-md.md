---
title: Source Summary — Project CLAUDE.md
type: source-summary
status: promoted
created: 2026-05-27
updated: 2026-05-28
sources:
  - wiki/raw/claude-md-2026-05-27.md
confidence: high
tags: [ops, runbook, pm2, cors, env, pi-sdk]
---

# Source Summary — Project CLAUDE.md

Snapshot of `CLAUDE.md` taken 2026-05-27. Highest-density ops/runbook reference for cleon-ui-pi: deployment, env policy, common incidents, key file pointers.

## Scope

Covers: port assignment, PM2 process management, `.env` precedence, CORS policy, model registry coupling, PM2 crash diagnostics, git remote SSH config, Pi SDK integration touchpoints, top-level architecture summary.

Does not cover: WebSocket message protocol, frontend SPA wiring, JWT auth internals, SQLite schema, session lifecycle deep dive — these are referenced by file path only and remain ingest gaps.

## Key Sections

- **Quick Reference** — port 3015, PM2 name `cleon-ui-pi`, domain `pi.testytech.net`, entry `server/index.js`, config `.env` with `dotenv override:true`. See `wiki/raw/claude-md-2026-05-27.md` lines 5-13.
- **Configuration** — `.env` is source of truth; `dotenv.config({ override: true })` so shell/PM2 env vars do not win. Snapshot listed `PORT`, `HOST`, `ALLOWED_ORIGINS`, `JWT_SECRET`, `ANTHROPIC_API_KEY`, `LOG_LEVEL`; `ANTHROPIC_API_KEY` is now stale for Cleon UI Pi app config and superseded by `C-0035`. See lines 39-49.
- **Models** — `config/models.json` must match Pi SDK registry at `~/.pi/agent/models.json` exactly. See lines 51-60.
- **PM2 Operations** — `npm run pm2`, `npm run pm2:restart`, `npm run pm2:logs`, `npm run pm2:stop`. `ecosystem.config.cjs` uses `cwd: __dirname` for portability; only `NODE_ENV` is set there. See lines 62-78.
- **Common Issues** — four incidents documented with symptom/cause/fix:
  - EADDRINUSE / port conflict on configured port. Fix: `pm2 delete cleon-ui-pi && pm2 start ecosystem.config.cjs`. Lines 82-93.
  - CORS rejection. Fix: add origin to `ALLOWED_ORIGINS` in `.env`, then `npm run pm2:restart`. Lines 95-106.
  - Model not found in Pi registry. Fix: align `config/models.json` to `~/.pi/agent/models.json`. Lines 108-114.
  - Shell env vars overriding `.env`. Fix already applied via `override: true`; if persisting, `unset PORT ALLOWED_ORIGINS`. Lines 116-127.
  - Connection lost UI error. Usually PM2 crash loop — check `pm2 logs cleon-ui-pi --lines 30`. Lines 129-141.
- **Git** — uses personal SSH key alias `github-personal` → `git@github-personal:shreeve1/cleon-ui-pi.git`. SSH config block documented. Lines 143-157.
- **Debug pointers** — `server/index.js:61-89` (CORS), `server/index.js:515` (PORT fallback now `process.env.PORT || 3015` in live code), `server/pi-agent.js` (Pi SDK), `server/sdk-session-manager.js` (sessions, `~/.pi/agent/cleon-sessions.json`). Lines 176-181.
- **Pi SDK** — `@mariozechner/pi-coding-agent`, session mappings in `~/.pi/agent/cleon-sessions.json`, `stripAnsi()` at `pi-agent.js:18-24`. Lines 183-187.
- **Architecture** — vanilla JS SPA frontend, Express + ws backend, JWT/bcrypt auth, better-sqlite3 at `~/.cleon-ui/`, SSE for AI streaming, PM2 with ecosystem config. Lines 189-196.

## Surfaced Entities

- `server/index.js` — Express + WebSocket server
- `server/pi-agent.js` — Pi SDK session handler with `stripAnsi`
- `server/sdk-session-manager.js` — session lifecycle, owns `~/.pi/agent/cleon-sessions.json`
- `server/auth.js` — JWT authentication
- `ecosystem.config.cjs` — PM2 config, portable via `cwd: __dirname`
- `.env` — config source of truth (override precedence)
- `config/models.json` — model dropdown registry; must mirror Pi SDK registry

## Surfaced Concepts

- `.env` override precedence (`dotenv override:true`)
- CORS allowlist enforcement
- PM2 crash-loop diagnostic path
- Pi SDK model-registry coupling
- Port-conflict resolution via delete-then-restart

## Notes

- Source is a living doc; re-snapshot whenever ops content shifts.
- Auth setup guidance in this 2026-05-27 snapshot is superseded by `C-0035` / `wiki/concepts/concept-pi-auth-boundary.md`: current docs no longer require `ANTHROPIC_API_KEY` in Cleon UI Pi `.env`.
- Inline file:line citations point to current `server/` code; verify before quoting in answers.
- Promoted 2026-05-27 under auto-promote-low-risk policy: well-cited, no contradictions.
