---
title: Source Summary — Project README.md (post-rewrite)
type: source-summary
status: promoted
created: 2026-05-27
updated: 2026-05-27
sources:
  - wiki/raw/readme-2026-05-27-rewrite.md
confidence: high
tags: [docs, readme, ops, runbook]
---

# Source Summary — Project README.md (post-rewrite)

Snapshot of repo `README.md` taken 2026-05-27 **after the stale-fact rewrite**. Replaces the discarded snapshot at `wiki/raw/readme-2026-05-27.md` (which captured the pre-Pi-fork "Cleon UI" content). The rewrite reconciles README with the current Pi-SDK reality documented in `wiki/sources/source-claude-md.md`.

## Scope

User-facing project guide. Covers: features, quick-start install, environment variables, model registry, user data locations, project structure, technology stack, "how it works" narrative, API/WebSocket message catalogue, browser support, security, known limitations, PM2-based production deployment, reverse-proxy templates, development commands, testing, troubleshooting.

## Key Sections

- **Historical Note** (lines 3) — documents the Claude Lite → Cleon UI → Cleon UI Pi lineage and the RPC-subprocess → in-process-SDK migration.
- **Features** (lines 7-18) — aligned with current code (multi-tab session sync, WebSocket dispatch + SSE streaming, paste/upload).
- **Quick Start** (lines 22-49) — prerequisites updated (Anthropic API key OR `~/.pi/agent/auth.json`; Pi SDK model registry at `~/.pi/agent/models.json`); clone URL fixed to `shreeve1/cleon-ui-pi`; default browser URL `http://localhost:3015`.
- **Configuration** (lines 60-95) — `.env` is source of truth via `dotenv override:true`; `PI_BINARY` removed; `ANTHROPIC_API_KEY` documented; optional `SDK_MAX_CONCURRENT` / `SDK_IDLE_TIMEOUT_MS` tuning surfaced.
- **Model Registry** (lines 97-99) — explicitly documents the `config/models.json` ↔ `~/.pi/agent/models.json` coupling and the silent-fallback failure mode.
- **Project Structure** (lines 105-127) — file tree updated to current `server/` layout (`index.js`, `pi-agent.js`, `sdk-session-manager.js`, `auth.js`, `models.js`); adds `config/models.json` and `ecosystem.config.cjs`.
- **Technology Stack** (lines 129-144) — backend now lists `ws`, `@mariozechner/pi-coding-agent` (in-process), and `express-rate-limit` (15-min, 100/IP general, 10/IP for `/api/auth`).
- **How It Works** (lines 146-153) — narrative rewritten around session pool, WebSocket dispatch, SSE streaming with heartbeat, `publish(username, …)` multi-tab broadcast, dual persistence (`~/.cleon-ui/` SQLite + `~/.pi/agent/cleon-sessions.json`).
- **API Endpoints** (lines 155-168) — auth remains REST; chat moved to WebSocket; documents the main client message types and the server publish events.
- **Security Notes** (lines 187-203) — adds the LAN/private-IP auto-allow caveat (`server/index.js:82-122`).
- **Known Limitations** (lines 205-209) — "no rate limiting" removed (rate limiting is now applied).
- **Production Deployment** (lines 211-261) — PM2 is the recommended path; uses `ecosystem.config.cjs`; reverse-proxy templates updated to port 3015; documents SSE 10-s heartbeat and WS 30-s ping; advises proxy idle timeouts.
- **Development** (lines 263-296) — dev command updated to `npm run dev` (`node --watch`); adds `npm test` (vitest); features workflow points at `openspec/changes/` and the LLM Wiki `/wiki-update`.
- **Troubleshooting** (lines 298-358) — replaced the `pi` subprocess troubleshooting with Pi SDK in-process diagnostics; preserves EADDRINUSE, CORS, shell-env-override, model-not-found, connection-lost, and (legacy) Claude Lite → Cleon UI data migration entries.

## Surfaced Entities

No new entities beyond those already promoted/candidate. Reaffirms: `server/index.js`, `server/pi-agent.js`, `server/sdk-session-manager.js`, `server/auth.js`, `server/models.js`, `config/models.json`, `ecosystem.config.cjs`, `.env`.

## Surfaced Concepts

- README rewrite supersedes the pre-Pi-fork stale snapshot.
- README now mirrors `wiki/sources/source-claude-md.md` for ops/runbook content while keeping a user-facing voice and adding deployment/troubleshooting depth.
- Multi-tab session sync via `publish(username, …)` is documented at the README level (cross-references `wiki/analyses/analysis-session-sync-bugs.md`).

## Notes

- No contradictions with promoted claims.
- README is a living doc; re-snapshot on substantive ops/architecture changes.
- Inline line numbers in this candidate point at `wiki/raw/readme-2026-05-27-rewrite.md`, not the current repo `README.md` — repo line numbers may drift with future edits.
- Promotion candidate: low-risk, well-cited, eligible for auto-promotion to `wiki/sources/`.
