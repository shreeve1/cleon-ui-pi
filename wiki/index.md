# Wiki Index

## Sources

| Page | Summary | Sources | Updated |
|------|---------|---------|---------|
| [source-claude-md](sources/source-claude-md.md) | Snapshot summary of project CLAUDE.md — ops/runbook, env policy, PM2, CORS, Pi SDK, incidents; auth setup note superseded by `C-0035`. | `wiki/raw/claude-md-2026-05-27.md` | 2026-05-28 |
| [source-readme](sources/source-readme.md) | Project README.md (post-rewrite) — user-facing runbook reconciled with current Pi-SDK reality; auth setup note superseded by `C-0035`. | `wiki/raw/readme-2026-05-27-rewrite.md` | 2026-05-28 |
| [source-quick-test-guide](sources/source-quick-test-guide.md) | Two-minute manual smoke test for session-sync bug fixes; confirms port 3015 deploy. | `wiki/raw/quick-test-guide-2026-05-27.md` | 2026-05-27 |

## Entities

| Page | Summary | Sources | Updated |
|------|---------|---------|---------|
| [entity-server-index](entities/entity-server-index.md) | Express + WebSocket entry point; CORS, rate limiting, SSE, graceful shutdown. | `wiki/raw/code/server-index.js`, `wiki/raw/claude-md-2026-05-27.md` | 2026-05-27 |
| [entity-server-pi-agent](entities/entity-server-pi-agent.md) | Pi SDK transaction handler — chat dispatch, event transformation, attachment lifecycle. | `wiki/raw/code/server-pi-agent.js`, `wiki/raw/claude-md-2026-05-27.md` | 2026-05-27 |
| [entity-server-sdk-session-manager](entities/entity-server-sdk-session-manager.md) | Session pool manager; persistence to `~/.pi/agent/cleon-sessions.json`; idle/concurrency eviction. | `wiki/raw/code/server-sdk-session-manager.js`, `wiki/raw/claude-md-2026-05-27.md` | 2026-05-27 |

## Concepts

| Page | Summary | Sources | Updated |
|------|---------|---------|---------|
| [concept-pi-auth-boundary](concepts/concept-pi-auth-boundary.md) | Auth/config boundary: Cleon UI Pi delegates provider auth to Pi under `~/.pi/agent/`; do not require provider API keys in app `.env`. | `wiki/raw/sessions/2026-05-28-pi-auth-correction.md`, `README.md`, `CLAUDE.md`, `.env.example` | 2026-06-14 |
| [concept-slash-skill-discovery](concepts/concept-slash-skill-discovery.md) | Canonical slash-menu skill discovery behavior: preserve `/skill:<name>` commands and Pi-compatible skill locations to avoid recurring overwrites. | `wiki/raw/sessions/2026-05-30-slash-skill-discovery-preservation.md`, `server/commands.js`, `tests/unit/commands.test.js` | 2026-06-14 |

## Analyses

| Page | Summary | Sources | Updated |
|------|---------|---------|---------|
| [analysis-session-sync-bugs](analyses/analysis-session-sync-bugs.md) | All three session-sync bugs (deletion, multi-tab close, multi-tab create); fixes shipped; regression guard. | `wiki/raw/docs/*.md`, `wiki/raw/quick-test-guide-2026-05-27.md` | 2026-05-27 |

## Candidate Review Queue

Candidate rows are discoverability aids only; do not treat them as promoted knowledge.

| Candidate | Summary | Sources | Created | Status |
|-----------|---------|---------|---------|--------|
| [source-design-plans-history](candidates/source-design-plans-history.md) | Catalog of `docs/plans/` (message-formatting, OMP integration, model dropdown, OMP→Pi migration). | `wiki/raw/docs-plans/*.md` | 2026-05-27 | candidate — historical catalog |
| [source-specs-catalog](candidates/source-specs-catalog.md) | Catalog of `specs/` (slash commands, @-mention, mode toggle, favorites, file paste/upload, lightweight-claude-ui, plan-mode question); slash-command status superseded by `concept-slash-skill-discovery`. | `wiki/raw/specs/*.md`, `wiki/raw/sessions/2026-05-30-slash-skill-discovery-preservation.md` | 2026-05-27 | candidate — historical catalog, partially superseded |
