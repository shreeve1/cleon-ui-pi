---
title: Source Catalog — docs/plans/ (design + plan history)
type: source-summary
status: candidate
created: 2026-05-27
updated: 2026-05-27
sources:
  - wiki/raw/docs-plans/2026-02-25-message-formatting-design.md
  - wiki/raw/docs-plans/2026-02-25-message-formatting.md
  - wiki/raw/docs-plans/2026-02-28-omp-integration-design.md
  - wiki/raw/docs-plans/2026-02-28-omp-integration-plan.md
  - wiki/raw/docs-plans/2026-03-02-model-dropdown-design.md
  - wiki/raw/docs-plans/2026-03-02-model-dropdown-plan.md
  - wiki/raw/docs-plans/2026-03-02-omp-to-pi-migration.md
confidence: medium
tags: [history, plans, migration, omp, pi, model-dropdown, message-formatting]
---

# Source Catalog — `docs/plans/`

Genealogy of the design/plan docs under `docs/plans/`. All shipped; OMP-era plans are now superseded by the Pi-agent migration.

| Plan | Purpose (≤25 words) | Status | Durable outcome |
|------|---------------------|--------|-----------------|
| `2026-02-25-message-formatting-design.md` | CSS-only prose styling (tables, headings, lists, blockquotes) for assistant message content. | Shipped | `.message.assistant`-scoped rules in `public/style.css` using existing design-system variables (`--neon-cyan`, `--neon-purple`). |
| `2026-02-25-message-formatting.md` | Implement the design above in 5 CSS-block tasks with per-block regression checks. | Shipped | Styles appended after line ~1541 in `public/style.css`; tables get grid borders + horizontal overflow scroll for narrow viewports. |
| `2026-02-28-omp-integration-design.md` | Replace Anthropic SDK with OMP RPC; preserve all features via event-transformation layer. | **Superseded** by Pi migration | RPC-over-stdin/stdout architecture; `extension_ui_request` bridge; streaming deltas accumulated on frontend. |
| `2026-02-28-omp-integration-plan.md` | Implement OMP in 4 phases (RpcClient, streaming, interactive questions, polish). | **Superseded** by Pi migration | Test discipline (`npx vitest run`); JSONL correlation IDs; one-line import switch for rollback. |
| `2026-03-02-model-dropdown-design.md` | Replace hardcoded Anthropic toggle with `config/models.json`-backed dropdown; send `set_model` RPC before each prompt. | Shipped | Model ID format `provider/modelId`; localStorage persistence; `GET /api/models` endpoint; display-name normalization (strip date suffix, hyphens → spaces, title-case). |
| `2026-03-02-model-dropdown-plan.md` | Implement model dropdown in 7 tasks: config, REST, RPC wiring, HTML/CSS/JS, regression. | Shipped | `config/models.json` (`models[]` + `default`); `server/models.js` loader with `toDisplayName()`; `set_model` injected before `prompt()` in `pi-agent.js` (per plan, line ~887 in the OMP era; rebased into the Pi flow). |
| `2026-03-02-omp-to-pi-migration.md` | Replace OMP RPC with Pi (`pi --mode rpc --no-session`); preserve event semantics. | Shipped | `server/omp.js` → `server/pi-agent.js`; new handlers for `tool_execution_update`, `message_start/end`, `auto_compaction_*`, `auto_retry_*`; field renames (`toolUseId` → `toolCallId`, `toolName`, `args`); `loadSessionHistory()` removed because Pi manages context internally. |

## Key cross-cutting facts

- **Backend has migrated end-to-end from Anthropic SDK → OMP RPC → Pi SDK.** Current state is Pi via `@mariozechner/pi-coding-agent` (see `wiki/candidates/entity-server-pi-agent.md`).
- **Field rename to remember**: OMP plans use `toolUseId`; Pi code uses `toolCallId`. When reading OMP-era plans, mentally translate.
- **Plan-style discipline** in this folder: split design + plan per feature, ship per-task with regression checks. Worth continuing.
- **`docs/plans/` is historical.** Don't update these in place — write new design docs and link to the historical record.

## Atomic claims (highest-signal)

The Pi-migration outcome and the model-dropdown architecture are durable enough to lift into `wiki/CLAIMS.md`. The OMP-era pre-Pi internals are not durable.

## Cross-references

- Current Pi handler → `wiki/candidates/entity-server-pi-agent.md`.
- Model registry coupling → `wiki/sources/source-claude-md.md` (claim `C-0003`).
- Feature specs → `wiki/candidates/source-specs-catalog.md`.
