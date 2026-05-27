# Wiki Index

## Sources

| Page | Summary | Sources | Updated |
|------|---------|---------|---------|
| [source-claude-md](sources/source-claude-md.md) | Snapshot summary of project CLAUDE.md — ops/runbook, env policy, PM2, CORS, Pi SDK, incidents. | `wiki/raw/claude-md-2026-05-27.md` | 2026-05-27 |
| [source-readme](sources/source-readme.md) | Project README.md (post-rewrite) — user-facing runbook reconciled with current Pi-SDK reality. | `wiki/raw/readme-2026-05-27-rewrite.md` | 2026-05-27 |
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

## Analyses

| Page | Summary | Sources | Updated |
|------|---------|---------|---------|
| [analysis-session-sync-bugs](analyses/analysis-session-sync-bugs.md) | All three session-sync bugs (deletion, multi-tab close, multi-tab create); fixes shipped; regression guard. | `wiki/raw/docs/*.md`, `wiki/raw/quick-test-guide-2026-05-27.md` | 2026-05-27 |

## Candidate Review Queue

Candidate rows are discoverability aids only; do not treat them as promoted knowledge.

| Candidate | Summary | Sources | Created | Status |
|-----------|---------|---------|---------|--------|
| [source-design-plans-history](candidates/source-design-plans-history.md) | Catalog of `docs/plans/` (message-formatting, OMP integration, model dropdown, OMP→Pi migration). | `wiki/raw/docs-plans/*.md` | 2026-05-27 | candidate — historical catalog |
| [source-specs-catalog](candidates/source-specs-catalog.md) | Catalog of `specs/` (slash commands, @-mention, mode toggle, favorites, file paste/upload, lightweight-claude-ui, plan-mode question). | `wiki/raw/specs/*.md` | 2026-05-27 | candidate — historical catalog |
