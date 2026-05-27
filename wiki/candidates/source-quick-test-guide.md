---
title: Source Summary — QUICK_TEST_GUIDE.md
type: source-summary
status: candidate
created: 2026-05-27
updated: 2026-05-27
sources:
  - wiki/raw/quick-test-guide-2026-05-27.md
confidence: high
tags: [test, runbook, sync-bugs, sessions]
---

# Source Summary — QUICK_TEST_GUIDE.md

Two-minute manual smoke test for the session-sync bug fixes shipped on `cleon-ui-pi`. Documents that **all three sync bugs identified in `docs/sync-bugs-analysis.md` are fixed**.

## Tests

1. **Original bug — session deletion persistence**: create session → close tab (X) → refresh; deleted session must not reappear. Fix: client now sends `close-session` WebSocket message to the server registry.
2. **Multi-tab closure broadcast**: close session in Tab A → Tab B should drop the session immediately. Fix: server broadcasts `session-closed` to all user connections.
3. **Multi-tab creation broadcast**: create session in Tab A → Tab B should show it within ~2 s. Fix: server broadcasts `session-created` to all user connections.

## Reported fix surfaces

- `server/index.js` — broadcasts session closure.
- `server/pi-agent.js` — broadcasts session creation.
- `public/app.js` — listens for remote `session-closed` / `session-created` events.

## Cross-reference

- Detailed root-cause analysis in `wiki/candidates/analysis-session-sync-bugs.md` (this batch).
- Fix landed before this snapshot date. The file states "Server running on port 3015 (PID 96672)" at top — confirms port 3015 deployment (consistent with `C-0001`).

## Notes

- Treat as a regression-test checklist. Re-run after touching WebSocket message handlers, session registry, or `app.js` session adoption logic.
- Companion doc to `docs/sync-bugs-analysis.md`; both should be kept in lock-step.
