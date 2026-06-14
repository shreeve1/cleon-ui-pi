---
title: Source Catalog — specs/
type: source-summary
status: candidate
created: 2026-05-27
updated: 2026-05-30
sources:
  - wiki/raw/specs/add-global-and-project-slash-commands.md
  - wiki/raw/sessions/2026-05-30-slash-skill-discovery-preservation.md
  - wiki/raw/specs/at-mention-file-search.md
  - wiki/raw/specs/chat-mode-toggle-button.md
  - wiki/raw/specs/favorite-projects-feature.md
  - wiki/raw/specs/file-paste-upload-feature.md
  - wiki/raw/specs/lightweight-claude-ui.md
  - wiki/raw/specs/plan-mode-question-display.md
confidence: medium
tags: [specs, features, historical, frontend, backend]
---

# Source Catalog — `specs/`

Tight catalog of feature specs at the repo root. Mixed shipping status: some shipped, some partial, some never started, one umbrella spec is fully historical.

| Spec | Purpose (≤25 words) | Shipped | Surfaces | Notes |
|------|---------------------|---------|----------|-------|
| `add-global-and-project-slash-commands.md` | Load custom slash commands from `~/.claude/commands/` and project dirs into autocomplete. | **Superseded / shipped differently** | backend + frontend | Original status was stale. `/api/commands` and `server/commands.js` now exist; Pi skill discovery is captured in `concept-slash-skill-discovery`. |
| `at-mention-file-search.md` | `@` mention in chat to search & reference project files. | **Partial** | backend + frontend | `fileMentionsEl` and search UI rendered in `public/app.js`; backend wiring incomplete or unverified. |
| `chat-mode-toggle-button.md` | Left-side button cycling Default → Plan → Bypass without slash commands. | **Unshipped** | frontend | No mode-toggle handler found in `public/app.js`. |
| `favorite-projects-feature.md` | Star button on projects; localStorage; float favorited projects to top. | **Shipped** | frontend | `favorite-btn`, `isFavorite()`, `toggleFavorite()` present in `public/app.js`. |
| `file-paste-upload-feature.md` | Paste/drag-drop images, text, PDF, markdown into chat with preview. | **Partial** | backend + frontend + config | `attachments[]` state and preview UI in `app.js`; `server/uploads.js` exists; full paste/drag-drop wiring unverified. |
| `lightweight-claude-ui.md` | 37 KB umbrella spec for original Cleon UI (pre-Pi). | **Historical** | n/a | Project has since migrated to Cleon UI Pi (port 3015, Pi SDK). Treat as archived context. |
| `plan-mode-question-display.md` | Render `mcp_question` tool output with interactive options; respond via `query.streamInput()`. | **Partial** | backend + frontend | `renderQuestion()` and `mcp_question` handling in `app.js`; server-side bidirectional handler completeness unverified. |

## Recommended treatment

- Promote `favorite-projects-feature.md` as a shipped feature reference if/when a concept page is needed.
- Keep `at-mention-file-search.md`, `file-paste-upload-feature.md`, `plan-mode-question-display.md` as partial-status references; revisit if a user reports a bug in one of those surfaces and verify shipping status against code.
- Treat `add-global-and-project-slash-commands.md` status as superseded by `wiki/concepts/concept-slash-skill-discovery.md`; do not use this historical spec to remove or narrow `server/commands.js`.
- Defer `chat-mode-toggle-button.md` — it is not wired up.
- `lightweight-claude-ui.md` is umbrella context only. Don't re-ingest unless someone asks specifically about the pre-Pi era.

## Cross-references

- Slash skill discovery current state → `wiki/concepts/concept-slash-skill-discovery.md`.
- README staleness vs. current state → `wiki/sources/source-readme.md`.
- Current backend → `wiki/entities/entity-server-index.md`, `wiki/entities/entity-server-pi-agent.md`.
