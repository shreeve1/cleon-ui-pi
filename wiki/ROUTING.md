# Wiki Routing

Use this file after reading `index.md` when narrowing a wiki-backed question to likely branches.

## Ops & Runbook

- Pages:
  - `wiki/sources/source-claude-md.md`
  - `wiki/sources/source-readme.md`
  - `wiki/entities/entity-server-index.md`
  - `wiki/sources/source-quick-test-guide.md`
- Keywords: PM2, ecosystem.config.cjs, EADDRINUSE, port conflict, restart, crash loop, logs, pm2 delete, npm run pm2, graceful shutdown, kill_timeout, rate limit

## CORS & Networking

- Pages:
  - `wiki/sources/source-claude-md.md`
  - `wiki/entities/entity-server-index.md`
- Keywords: ALLOWED_ORIGINS, CORS, WebSocket, origin, whitelist, pi.testytech.net, 3015, helmet, CSP, private IP bypass, SSE heartbeat

## Environment & Config

- Pages:
  - `wiki/sources/source-claude-md.md`
  - `wiki/entities/entity-server-index.md`
- Keywords: .env, dotenv override, PORT, HOST, JWT_SECRET, ANTHROPIC_API_KEY, LOG_LEVEL, shell env override, SDK_MAX_CONCURRENT, SDK_IDLE_TIMEOUT_MS

## Pi SDK Integration

- Pages:
  - `wiki/sources/source-claude-md.md`
  - `wiki/entities/entity-server-pi-agent.md`
  - `wiki/entities/entity-server-sdk-session-manager.md`
  - `wiki/candidates/source-design-plans-history.md` (candidate — OMP→Pi migration history)
- Keywords: pi-agent.js, sdk-session-manager.js, @mariozechner/pi-coding-agent, cleon-sessions.json, stripAnsi, model registry, ~/.pi/agent/, AgentSession, session.prompt, toolCallId, set_model

## Auth & Sessions

- Pages:
  - `wiki/entities/entity-server-sdk-session-manager.md`
  - `wiki/entities/entity-server-pi-agent.md`
  - `wiki/analyses/analysis-session-sync-bugs.md`
- Keywords: JWT, bcrypt, auth.js, session lifecycle, better-sqlite3, ~/.cleon-ui/, session pool, idle timeout, MAX_CONCURRENT, session-registry, attach, state-snapshot

## Frontend

- Pages:
  - `wiki/analyses/analysis-session-sync-bugs.md`
  - `wiki/candidates/source-specs-catalog.md` (candidate — favorites, @-mention, paste/upload, plan-mode question)
  - `wiki/candidates/source-design-plans-history.md` (candidate — message formatting, model dropdown)
- Keywords: public/, app.js, style.css, neon, SPA, vanilla JS, mobile-first, closeSession, auto-adopt, model dropdown, favorite-btn, attachments

## Architecture & Decisions

- Pages:
  - `wiki/sources/source-claude-md.md`
  - `wiki/entities/entity-server-index.md`
  - `wiki/candidates/source-design-plans-history.md` (candidate — OMP→Pi migration)
- Keywords: Express, WebSocket, SSE, streaming, ecosystem.config.cjs, cwd portability, helmet, multer, rate-limit, Pi RPC migration

## Bugs & Incidents

- Pages:
  - `wiki/analyses/analysis-session-sync-bugs.md`
  - `wiki/sources/source-quick-test-guide.md`
- Keywords: bugfix, session tab deletion, sync bugs, multi-tab broadcast, publish, session-closed, session-created, auto-adopt, dual source of truth, regression

## Historical / Project Genealogy

- Pages:
  - `wiki/candidates/source-design-plans-history.md` (candidate)
  - `wiki/candidates/source-specs-catalog.md` (candidate)
- Keywords: Cleon UI, Claude Lite rename, OMP, Anthropic SDK, lightweight-claude-ui, pre-Pi, historical, archived
