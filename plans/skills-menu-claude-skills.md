# Plan: Skills menu must show project `.claude/skills`

## Task Description
The web UI slash-command menu (`/api/commands` → `getAllCommands` → `getPiSkills`) builds its skill list from a hand-maintained set of Pi skill locations. It omits project-level `.claude/skills` — the location the `cross-agent.ts` extension injects into the live agent. Result: the agent actually loads `symphony/.claude/skills/*` (verified — 15 skills), but the UI slash menu never lists them. The menu is out of sync with what the agent can run.

Global `~/.claude/skills` currently appears only because the user's `~/.pi/agent/settings.json` lists it under `skills`; that is incidental, not part of `getPiSkills`'s own location list.

## Objective
Make the slash-menu skill list include project `.claude/skills` and global `~/.claude/skills`, mirroring the exact locations `cross-agent.ts` scans, so the menu matches what the agent loads.

## Problem Statement
`getPiSkills` (`server/commands.js:372`) assembles `skillPaths` from: `~/.pi/agent/skills`, `~/.agents/skills`, ancestor `.agents/skills`, extension skill dirs, and configured settings paths. Project `.claude/skills` and an explicit global `~/.claude/skills` entry are absent. The agent gets these via `cross-agent.ts`'s `resources_discover` handler (`collectClaudeDirs`), so the two lists diverge. The visible symptom: symphony's 15 Claude-Code skills never appear in the web UI's `/skill:` menu.

## Solution Approach
Add the two `cross-agent.ts` `.claude` locations to `getPiSkills`'s `skillPaths` array, mirroring `collectClaudeDirs` semantics exactly:

1. **Project `.claude/skills`** — resolve through git root, NOT `projectPath` directly. `cross-agent.ts`'s `collectClaudeDirs` does `join(findProjectRoot(cwd), ".claude")`, and `findProjectRoot` walks UP to the nearest `.git`, falling back to `cwd` when none exists. The web UI creates its agent session with `createAgentSession({ cwd: projectPath })` (`server/sdk-session-manager.js:202`), so cross-agent's `event.cwd` IS `projectPath`, meaning the agent loads `<gitRoot>/.claude/skills`. To match: `const claudeRoot = (await findGitRepoRoot(projectPath)) ?? projectPath;` then `path.join(claudeRoot, ".claude", "skills")`. `findGitRepoRoot` already exists in `commands.js` and returns `null` on no-git — the `?? projectPath` fallback reproduces `findProjectRoot`'s no-git behavior exactly.
2. **Global `~/.claude/skills`** — `path.join(home, ".claude", "skills")`, added unconditionally.

Reuse the existing `discoverSkillPath` scanner so discovery and parsing behave identically to every other location. No new scanner, no session reads, no changes to the chat/session path. Dedup is handled by `getAllCommands`'s `commandMap.set` by skill name (see Notes).

## Relevant Files
- `server/commands.js` — `getPiSkills` (line 372) is the single edit target. Its `skillPaths` array (lines 381-388) is where the two `.claude` entries are added.
- `tests/unit/commands.test.js` — existing skill-discovery test (`getAllCommands skill discovery`); extend with a `.claude/skills` project case.
- `/home/james/.pi/agent/extensions/cross-agent.ts` — parity reference only; **not modified**. `collectClaudeDirs` (project `.claude` + global `~/.claude`) defines the locations to mirror.

## Step by Step Tasks

### 1. Add `.claude/skills` locations to `getPiSkills`
- [x] [1.1] In `server/commands.js`, inside `getPiSkills`, resolve the project `.claude` root through git to match `cross-agent.ts`'s `findProjectRoot`: `const claudeRoot = (await findGitRepoRoot(projectPath)) ?? projectPath;` (guarded — only when `projectPath` is truthy). Then add `path.join(claudeRoot, ".claude", "skills")` to the `skillPaths` array (lines 381-388). Add the global entry `path.join(home, ".claude", "skills")` unconditionally, alongside the existing `~/.agents/skills` entry. `getPiSkills` is already `async`, so `await findGitRepoRoot(...)` is safe.
- [x] [1.2] No new helper function. The two `.claude` entries reuse the existing `findGitRepoRoot` helper (already used by `getAncestorAgentsSkillDirs`) and plain `path.join`. Do NOT add an ancestor-walk helper for `.claude`; `findGitRepoRoot` gives the single git-root path that `collectClaudeDirs` targets.

### 2. Extend the discovery test
- [x] [2.1] In `tests/unit/commands.test.js`, within the existing `getAllCommands skill discovery` block, create a skill at `<projectPath>/.claude/skills/symphony-suite` using the `createSkill` helper, where `<projectPath>` is a real temp project dir (not `/tmp/project`) so the path resolves.
- [x] [2.2] Change the `getAllCommands("/tmp/project")` call to use the temp project dir that contains the `.claude/skills` tree, and assert `names` includes `/skill:symphony-suite`.
- [x] [2.3] Keep the existing assertions (dotfiles, gitnexus-cli, research, diagnose) intact so the global `~/.claude/skills` + settings paths remain covered.

### 3. Validate
- [x] [3.1] Run `npm test` and confirm the discovery test passes.
- [x] [3.2] Run `node --check server/commands.js` to confirm no syntax errors.

## Tests

### T.1. Project `.claude/skills` discovery
- [x] [T.1.1] A skill created at `<tempProject>/.claude/skills/my-skill/SKILL.md` is returned by `getAllCommands(tempProject)` as `/skill:my-skill`.

### T.2. Regression — existing locations still discovered
- [x] [T.2.1] `~/.pi/agent/skills`, `~/.agents/skills`, extension skills, and `~/.claude/skills` (via settings) are all still present after the change.
- [x] [T.2.2] No duplicate `/skill:` entries when a skill name exists in both project `.claude/skills` and another location (existing `commandMap` precedence handles this — verify no regression).

## Progress
**Phase Status:**
- Build: `complete`
- Test: `pending` (audit passed; pi reviewer flagged test-rigor gap — see Warning)

**Task Counts:**
- Implementation: `2/2` tasks complete
- Tests: `2/2` test categories

**Last Updated:** 2026-06-28

## Acceptance Criteria
- `getAllCommands(<projectPath>)` returns `/skill:<name>` for every skill under `<projectPath>/.claude/skills/*/SKILL.md`.
- `getAllCommands(<projectPath>)` returns `/skill:<name>` for every skill under `~/.claude/skills/*/SKILL.md` regardless of settings.json.
- All previously-discovered locations (`~/.pi/agent/skills`, `~/.agents/skills`, extension skills) still appear.
- `npm test` passes with zero failures.
- The slash menu in the running web UI shows symphony's Claude-Code skills when symphony is the active project.

## Testing Promise
All unit tests in `tests/unit/` pass with zero failures, and the skill-discovery test proves project `.claude/skills` and global `~/.claude/skills` are both discovered.

## Validation Commands
- `npm test` — run vitest suite; the `getAllCommands skill discovery` test must pass.
- `node --check server/commands.js` — confirm no syntax errors in the edited file.
- `node -e "import('./server/commands.js').then(m=>m.getAllCommands('/home/james/symphony').then(c=>console.log(c.filter(x=>x.name.startsWith('/skill:')).map(x=>x.name))))"` — manual smoke against the real symphony project; expect symphony's 15 skills present.

## Notes
- Parity source of truth is `cross-agent.ts` `collectClaudeDirs`: project `.claude` resolved at the git root (`findProjectRoot(cwd)`, which walks UP to the nearest `.git`, falling back to `cwd`) + global `~/.claude`. The plan reproduces this with `(await findGitRepoRoot(projectPath)) ?? projectPath`. Do NOT add a per-ancestor walk for `.claude/skills` (every `*/.claude` up the tree) — that would discover skills the agent does not load. The git-root walk in `findGitRepoRoot` is the only "walk" needed and it targets a single root, matching cross-agent.
- Dedup mechanism: `discoverSkillPath` / `discoverSkills` do NOT dedup across calls. The real dedup is `getAllCommands`'s `commandMap.set(skill.name, skill)` by skill name (`commands.js:451-470`). After this change, global `~/.claude/skills` is scanned twice in production (once explicitly, once via `getConfiguredSkillPaths` because settings lists `~/.claude/skills`) and twice in the test; both collapse to a single `/skill:` entry by name. Harmless, and the test uses `toContain` so length is not asserted.
- Known limitation — description-less skills: `cross-agent.ts`'s `scanSkills` SKIPS any skill whose frontmatter lacks a non-empty `description`; cleon's `parseSkillFile` has no such check and falls back to `Run <name> skill`. So cleon would menu-list description-less skills Pi refuses to register. This is PRE-EXISTING for all skill sources, not introduced by this plan, and moot for symphony (all 15 skills carry `description:`). Not in scope; flag for a separate fix if strict load-parity becomes an acceptance bar.
- The existing `commandMap` precedence in `getAllCommands` (project skills > pi skills > pi prompts) means a project `.claude/skills` entry with the same name as a `~/.pi/agent/skills` entry is resolved by insertion order; no change to precedence is needed.
- Global `~/.claude/skills` is also loaded today via the user's settings `skills: ["~/.claude/skills"]`. Adding it explicitly to `getPiSkills` makes the menu correct even if that settings entry is removed, and is harmless when present (collapses by name in `commandMap`).
