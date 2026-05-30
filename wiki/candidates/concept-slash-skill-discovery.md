---
title: Slash Skill Discovery
type: concept
status: candidate
created: 2026-05-30
updated: 2026-05-30
sources:
  - wiki/raw/sessions/2026-05-30-slash-skill-discovery-preservation.md
  - server/commands.js
  - tests/unit/commands.test.js
confidence: high
tags: [frontend, commands, skills, pi-sdk, regression]
---

# Slash Skill Discovery

## Summary

Cleon UI Pi's `/` autocomplete must surface Pi skills using Pi's native command form: `/skill:<name>`.

Example: `/skill:discover`.

Do **not** narrow `server/commands.js` back to only `~/.pi/agent/skills` or emit bare skill names like `/discover`; that is the regression James reported as repeatedly overwritten. The shipped fix is commit `441c0d0` and is captured in `wiki/raw/sessions/2026-05-30-slash-skill-discovery-preservation.md`.

## Required Behavior

`/api/commands` should include skills from these sources:

- `~/.pi/agent/skills`
- `~/.agents/skills`
- project ancestor `.agents/skills`
- package/extension skill directories under `~/.pi/agent/extensions/**/skills`
- configured `skills` paths in `~/.pi/agent/settings.json`
- project `.pi/skills`

Configured skill paths matter because James approved adding `~/.claude/skills` globally in `~/.pi/agent/settings.json`; that local settings file is outside this repo and is not captured by git.

## Anti-Regression Rule

When changing slash commands or skill discovery:

1. Preserve `/skill:<name>` command names.
2. Preserve all Pi-compatible skill locations listed above.
3. Do not replace the logic with a top-level-only `~/.pi/agent/skills` scan.
4. Restart PM2 after server-side command discovery changes.
5. Verify `/skill:discover` appears in live `/api/commands`.

## Verification

Run:

```bash
npm test
```

Expected: `tests/unit/commands.test.js` passes and asserts `/skill:dotfiles`, `/skill:gitnexus-cli`, `/skill:research`, and `/skill:diagnose` are discoverable from representative Pi skill locations.

Live smoke probe after restart:

```bash
npm run pm2:restart
# Then query /api/commands with a valid JWT and confirm /skill:discover exists.
```

Expected:

- `/skill:discover` exists.
- `/skills:discover` does not exist.

## Related Stale Knowledge

`wiki/candidates/source-specs-catalog.md` and claim `C-0032` previously described `add-global-and-project-slash-commands` as unshipped and stated there was no `/api/commands` endpoint or `server/commands.js`. That is now superseded by commit `441c0d0` and this concept page.
