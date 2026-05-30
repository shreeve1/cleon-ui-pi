# Session Capture: Slash Skill Discovery Preservation

- Date: 2026-05-30
- Purpose: Preserve the WebUI slash-menu skill discovery fix because James reported this fix has been overwritten multiple times.
- Scope: Captures the shipped fix, verification commands, command naming, and anti-regression guidance for future agents.

## Durable Facts

- Commit `441c0d0` (`fix: surface Pi skills in slash menu`) changed `server/commands.js`, added `tests/unit/commands.test.js`, and updated `wiki/log.md` for the slash skill discovery fix. — Evidence: `git show --stat --oneline 441c0d0`
- The WebUI slash command API must expose Pi skills as `/skill:<name>` commands, matching Pi SDK skill expansion. Example: `/skill:discover`. — Evidence: `server/commands.js`, `tests/unit/commands.test.js`
- The fix broadened skill discovery beyond `~/.pi/agent/skills` to include Pi-compatible skill locations: `~/.agents/skills`, project ancestor `.agents/skills`, extension skill directories, configured `settings.skills`, and project `.pi/skills`. — Evidence: `server/commands.js`, `tests/unit/commands.test.js`
- A live verification after restart showed `/api/commands` returned `/skill:discover` and did not return `/skills:discover`. — Evidence: local diagnostic command against `http://127.0.0.1:3015/api/commands?projectPath=...`
- The Pi global settings file `~/.pi/agent/settings.json` was updated locally to include `~/.claude/skills` after James approved loading Claude Code skills globally. This file is outside the repository and is not committed with the app code. — Evidence: session action; file path `~/.pi/agent/settings.json`

## Decisions

- Preserve the slash skill discovery behavior as project knowledge so future changes do not overwrite or narrow it again. — Evidence: James said this fix has been overwritten multiple times.
- Use Pi's singular skill command format (`/skill:<name>`) in the WebUI menu; do not use `/skills:<name>`. — Evidence: Pi SDK behavior and live `/api/commands` verification.

## Evidence

- `server/commands.js` — implements command and skill discovery for `/api/commands`.
- `tests/unit/commands.test.js` — regression test asserting discovery of default Pi skills, `.agents` skills, extension skills, and configured `~/.claude/skills`.
- `441c0d0` — committed fix: `fix: surface Pi skills in slash menu`.
- `npm test` — passed after the fix.
- `npm run pm2:restart` — restarted `cleon-ui-pi` after the server-side command discovery change.

## Exclusions

- No secrets, credentials, API keys, private SSH key material, auth tokens, or full transcript content were captured.
- The contents of `~/.pi/agent/settings.json` were not copied verbatim beyond the non-secret skill path setting.

## Open Questions And Follow-Ups

- Future agents should update or supersede stale slash-command spec catalog entries that still claim `/api/commands` or `server/commands.js` are unshipped.
- If this is changed again, verify with both `npm test` and the live `/api/commands` endpoint after PM2 restart.
