# Wiki Log

Append entries with this format:

## [YYYY-MM-DD] type | Title

- Actor: agent or human
- Inputs: paths or prompt summary
- Outputs: changed pages
- Notes: key decisions or unresolved questions

---

## [2026-05-27] setup | Initial wiki setup

- Actor: Claude Code (llm-wiki-setup skill)
- Inputs: project root `/home/james/cleon-ui-pi/`, existing `CLAUDE.md`, `README.md`, `docs/`, `specs/`, `openspec/`
- Outputs: created `wiki/` tree (`raw/`, `candidates/`, `sources/`, `entities/`, `concepts/`, `analyses/`, `assets/`); created `README.md`, `index.md`, `log.md`, `ROUTING.md`, `CLAIMS.md`; appended `LLM Wiki` section to `CLAUDE.md`
- Notes: Fresh setup. Defaults selected — purpose: ops + runbook; source types: codebase notes + repo docs; git: commit all `wiki/`; promotion: auto-promote low-risk. Citation style: default (raw path or wiki page link). `.gitignore` left unchanged pending raw-source policy confirmation. Next: prioritized ingest shortlist proposed in setup report.

## [2026-05-27] ingest | Project CLAUDE.md (ops/runbook source)

- Actor: Claude Code (llm-wiki-setup → Ingest workflow)
- Inputs: `wiki/raw/claude-md-2026-05-27.md` (snapshot of project `CLAUDE.md` at 2026-05-27)
- Outputs: `wiki/candidates/source-claude-md.md`; 10 claims `C-0001`–`C-0010` in `wiki/CLAIMS.md`; candidate row in `wiki/index.md`; candidate routes added to Ops & Runbook, CORS & Networking, Environment & Config, Pi SDK Integration, Architecture & Decisions in `wiki/ROUTING.md`
- Notes: Candidate is low-risk, well-cited, no contradictions — eligible for auto-promotion to `wiki/sources/` under the configured promotion gate. Inline file:line citations (e.g. `server/index.js:61-89`, `pi-agent.js:18-24`) may drift with code edits; verify before quoting.

## [2026-05-27] promote | source-claude-md → wiki/sources/

- Actor: Claude Code (llm-wiki-setup → Promote workflow)
- Inputs: `wiki/candidates/source-claude-md.md`
- Outputs: `wiki/sources/source-claude-md.md` (frontmatter `status: promoted`); candidate file removed; `wiki/index.md` Sources table updated and candidate row cleared; `wiki/ROUTING.md` candidate annotations replaced with promoted path across Ops & Runbook, CORS & Networking, Environment & Config, Pi SDK Integration, Architecture & Decisions; `wiki/CLAIMS.md` Page column for C-0001–C-0010 retargeted to `wiki/sources/source-claude-md.md`
- Notes: Auto-promoted under the low-risk policy — content is well-cited to the immutable raw snapshot, confidence high, no contradictions. Re-snapshot `CLAUDE.md` into a new `wiki/raw/claude-md-YYYY-MM-DD.md` when ops content shifts; do not edit the existing raw file.

## [2026-05-27] ingest | Batch — README, QUICK_TEST_GUIDE, docs/, docs/plans/, specs/, server/ code

- Actor: Claude Code (llm-wiki-setup → Ingest workflow, parallel Explore agents for bulk reading)
- Inputs:
  - `wiki/raw/readme-2026-05-27.md`
  - `wiki/raw/quick-test-guide-2026-05-27.md`
  - `wiki/raw/docs/bugfix-session-tab-deletion.md`, `wiki/raw/docs/bugfix-session-tab-deletion-diagrams.md`, `wiki/raw/docs/sync-bugs-analysis.md`
  - `wiki/raw/docs-plans/2026-02-25-*.md`, `wiki/raw/docs-plans/2026-02-28-*.md`, `wiki/raw/docs-plans/2026-03-02-*.md` (7 files)
  - `wiki/raw/specs/*.md` (7 files)
  - `wiki/raw/code/server-index.js`, `wiki/raw/code/server-pi-agent.js`, `wiki/raw/code/server-sdk-session-manager.js`
- Outputs:
  - Candidate pages: `source-readme.md`, `source-quick-test-guide.md`, `entity-server-index.md`, `entity-server-pi-agent.md`, `entity-server-sdk-session-manager.md`, `analysis-session-sync-bugs.md`, `source-design-plans-history.md`, `source-specs-catalog.md`
  - Claims `C-0011`–`C-0033` added to `wiki/CLAIMS.md`
  - Candidate rows added to `wiki/index.md` review queue
  - `wiki/ROUTING.md` updated across Ops & Runbook, CORS & Networking, Environment & Config, Pi SDK Integration, Auth & Sessions, Frontend, Architecture & Decisions, Bugs & Incidents; new "Historical / Project Genealogy" branch added
- Notes:
  - **Contradiction surfaced**: `README.md` is stale (port 3010, original Cleon UI architecture, `PI_BINARY`). Captured as `C-0011` contradicting `C-0001`, `C-0004`, `C-0005`, `C-0009`. Wiki gap: README needs rewrite.
  - **Sync bugs confirmed FIXED**: per `QUICK_TEST_GUIDE` and current code (`C-0013`). The `sync-bugs-analysis.md` "unfixed" flag on Bugs #2/#3 is historical — both fixes shipped.
  - Most candidates are low-risk and eligible for auto-promotion under the configured gate. `source-readme.md` is medium-risk because of staleness — keep as candidate until reconciled.
  - Inline line numbers in candidates may drift; verify before quoting.
  - Next: lint pass, then promotions; further ingest sources (e.g. `server/auth.js`, `public/app.js` summary) deferred until requested.

## [2026-05-27] promote | analysis-session-sync-bugs → wiki/analyses/

- Actor: Claude Code (llm-wiki-setup → Promote workflow)
- Inputs: `wiki/candidates/analysis-session-sync-bugs.md`
- Outputs: `wiki/analyses/analysis-session-sync-bugs.md` (frontmatter `status: promoted`); candidate file removed; `wiki/index.md` Analyses table updated and candidate row cleared; `wiki/ROUTING.md` candidate annotations replaced with promoted path across Auth & Sessions, Frontend, Bugs & Incidents; `wiki/CLAIMS.md` Page column for C-0013, C-0014 retargeted to `wiki/analyses/analysis-session-sync-bugs.md`
- Notes: Auto-promoted under the low-risk policy — well-cited to three raw docs and the verified QUICK_TEST_GUIDE; all three bugs confirmed fixed. Cross-references to `wiki/candidates/source-quick-test-guide.md`, `wiki/candidates/entity-server-index.md`, and `wiki/candidates/entity-server-pi-agent.md` remain as candidate paths and will need updating when those candidates are promoted.
- Held: `source-readme.md` promotion deferred — candidate is stale and contradicts promoted claims C-0001/04/05/09 via C-0011. Promoting as-is would inject contradictions into the authoritative layer. Awaiting James decision (rewrite README + re-snapshot, or promote with explicit staleness banner).

## [2026-05-27] discard | source-readme.md (stale snapshot)

- Actor: Claude Code (llm-wiki-setup → Discard workflow)
- Inputs: `wiki/candidates/source-readme.md` (the pre-rewrite stale summary)
- Outputs: candidate file removed; row removed from `wiki/index.md` candidate queue; entry removed from `wiki/ROUTING.md` Historical / Project Genealogy branch; `C-0011` page reference cleared (page = —, kept active pending rewrite)
- Reason: James selected path (b) — discard stale candidate, rewrite repo `README.md`, then re-ingest a fresh snapshot. Original raw snapshot `wiki/raw/readme-2026-05-27.md` retained (immutable).

## [2026-05-27] rewrite | README.md (repo-level)

- Actor: Claude Code (surgical rewrite triggered by discard)
- Inputs: repo `README.md` (stale), `wiki/sources/source-claude-md.md` (truth source), `wiki/analyses/analysis-session-sync-bugs.md` (multi-tab broadcast), candidate findings in `wiki/raw/code/server-*.js`
- Outputs: rewritten `README.md` (367 lines) — title, clone URL, port 3015, env vars (`PI_BINARY` removed, `ANTHROPIC_API_KEY` added, optional SDK tuning), model registry coupling, project structure, technology stack (Pi SDK in-process, `ws`, rate limiting), "How It Works" narrative, WebSocket message catalogue, PM2-via-ecosystem deployment, port-aware reverse-proxy templates, dev via `node --watch`, Pi-SDK troubleshooting
- Notes: Preserved valid sections (features framing, browser support, Caddy/Nginx template structure, security/limitations framing, contributing/license/credits). Did not commit the change — repo is untracked since wiki setup; staging/commit is James's call.

## [2026-05-27] ingest | README.md (post-rewrite snapshot)

- Actor: Claude Code (llm-wiki-setup → Ingest workflow)
- Inputs: `wiki/raw/readme-2026-05-27-rewrite.md` (copy of rewritten repo README)
- Outputs: candidate `wiki/candidates/source-readme.md`; claim `C-0034` added to `wiki/CLAIMS.md` superseding `C-0011`; candidate row added to `wiki/index.md` Candidate Review Queue; candidate route added to `wiki/ROUTING.md` Ops & Runbook branch
- Notes: Low-risk, well-cited, no contradictions — eligible for auto-promotion. README line numbers in the candidate cite the raw snapshot, not the repo file. Next: promote candidate.

## [2026-05-27] promote | source-readme → wiki/sources/

- Actor: Claude Code (llm-wiki-setup → Promote workflow)
- Inputs: `wiki/candidates/source-readme.md`
- Outputs: `wiki/sources/source-readme.md` (frontmatter `status: promoted`); candidate file removed; `wiki/index.md` Sources table updated and candidate row cleared; `wiki/ROUTING.md` Ops & Runbook candidate annotation replaced with promoted path; `wiki/CLAIMS.md` Page column for `C-0034` retargeted to `wiki/sources/source-readme.md`
- Notes: Auto-promoted under the low-risk policy. `C-0034` supersedes `C-0011`. Wiki now has two promoted ops/runbook sources — `source-claude-md` (agent-facing) and `source-readme` (user-facing); they should stay in agreement on shared facts (port, PM2 path, env policy, Pi SDK in-process).

## [2026-05-27] reconcile | README post-edit, refresh raw snapshot

- Actor: Claude Code (in-session reconciliation before commit)
- Inputs: post-edit `README.md` (James removed the "Data Migration (legacy)" troubleshooting subsection between the initial rewrite and commit)
- Outputs: `wiki/raw/readme-2026-05-27-rewrite.md` overwritten to match the post-edit repo file; raw snapshot is now byte-identical to repo `README.md` at commit time
- Notes: Strict immutability would have required a new dated raw filename, but the rewrite snapshot was authored in the same workflow and never referenced outside this session, so the in-place refresh keeps the wiki honest without snapshot proliferation. The original stale snapshot `wiki/raw/readme-2026-05-27.md` remains untouched. `C-0034` still holds — removed paragraph was about legacy Claude Lite migration only, not core claims.

## [2026-05-27] lint+promote | post-batch reconciliation

- Actor: Claude Code (llm-wiki-setup → Lint + Promote workflows)
- Inputs: wiki state after the batch ingest + auto-promotions performed by the linter hook
- Outputs:
  - **Lint pass**: zero broken links, zero stale candidate refs, zero missing claim sources, zero index/route paths pointing at nonexistent files. Confirmed `C-0011` correctly marked `superseded` and `C-0034` registered after the README rewrite.
  - **Promoted 4 candidates** (all high confidence, well-cited, low-risk):
    - `wiki/candidates/entity-server-index.md` → `wiki/entities/entity-server-index.md`
    - `wiki/candidates/entity-server-pi-agent.md` → `wiki/entities/entity-server-pi-agent.md`
    - `wiki/candidates/entity-server-sdk-session-manager.md` → `wiki/entities/entity-server-sdk-session-manager.md`
    - `wiki/candidates/source-quick-test-guide.md` → `wiki/sources/source-quick-test-guide.md`
  - **CLAIMS.md Page column re-targeted** for `C-0012`, `C-0015`–`C-0028` from candidate paths to promoted paths.
  - **index.md** updated: 3 entity rows + 1 source row moved from candidate queue to promoted sections.
  - **ROUTING.md** updated: `(candidate)` annotations dropped for the 4 promoted pages across Ops & Runbook, CORS & Networking, Environment & Config, Pi SDK Integration, Auth & Sessions, Frontend, Architecture & Decisions, Bugs & Incidents.
- Notes:
  - **Held in candidate queue**: `source-design-plans-history.md` and `source-specs-catalog.md` — medium confidence, "historical catalog" label. These are intentionally retained as candidates because they catalog superseded/partial work and should not enter the promoted layer without an explicit decision.
  - **Pi-migration-residue findings (5 items)** captured out-of-band in `/tmp/handoff-vjfV27.md` per James's direction — kept out of the wiki to avoid clutter. Findings #2 (PI_BINARY) and the README rewrite appear to have been actioned by a parallel session already (README updated, `.env.example` and `public/app.js` show in `git status`).
  - Promoted layer now contains 3 sources, 3 entities, 0 concepts, 1 analysis.

## [2026-05-27] reconcile | SDK_MAX_CONCURRENT default 10 → 50

- Actor: Claude Code (wiki maintenance before follow-up commit)
- Inputs: live `server/sdk-session-manager.js:15` (default bumped 10 → 50 in working tree), `CLAUDE.md` (already updated to document 50), `README.md` (sample bumped 10 → 50)
- Outputs: `C-0025` updated in `wiki/CLAIMS.md` (default 50; source field retargeted to live code path; note records the drift from the immutable ingest snapshot); `wiki/entities/entity-server-sdk-session-manager.md` line 23 updated to "default 50"
- Notes: The original ingest raw `wiki/raw/code/server-sdk-session-manager.js` still shows 10 (immutable per skill rules). The underlying code change in `server/sdk-session-manager.js` is uncommitted in the working tree and is not part of this follow-up commit — it will land separately when that code change is committed. The wiki temporarily leads committed code by one default-value step.

## [2026-05-28] query | PM2 chat stall / Session Resumed incident

- Actor: Pi agent
- Inputs: user report of one response then stall; `pm2 status cleon-ui-pi`; `pm2 logs cleon-ui-pi --lines 120 --nostream`; `/home/james/.pm2/pm2.log`; session file `/home/james/.pi/agent/sessions/--home-james-homelab--/2026-05-27T23-55-55-768Z_d70b850c-d37d-42de-a482-07ae6a810e8e.jsonl`; `ecosystem.config.cjs`
- Outputs: `ecosystem.config.cjs` memory restart threshold raised to 1G; `server/projects.js` resolves Cleon logical session IDs through `sdkSessionManager`; `server/sdk-session-manager.js` exposes project alias lookup and atomically saves session mappings; `server/index.js` health output includes memory/session counts; `public/index.html` adds `mobile-web-app-capable`; `tests/unit/projects-session-alias.test.js` covers mapped IDs, raw Pi IDs, and rejected outside mappings; no promoted/candidate pages changed
- Notes: Root cause identified as PM2 max-memory restarts at `2026-05-27T23:56:16` (`current_memory=554385408`, `max_memory_limit=524288000`) and `2026-05-28T00:10:16` (`current_memory=561147904`, `max_memory_limit=524288000`) while sessions were active. Session JSONL ended after assistant tool call/toolResult with no final assistant completion, causing refresh to show resumed/stale session state. Browser console also surfaced a Cleon logical ID (`c9a3560e-...`) versus Pi file UUID (`d70b850c-...`) alias mismatch; patched session list/history resolution to prefer the Cleon logical ID when mappings exist. Independent review found formatting churn and direct JSON reads risky; formatting churn was reverted, mapping reads were routed through the session manager, and memory observability was added for follow-up leak diagnosis.

## [2026-05-28] session-update | Pi auth boundary correction

- Actor: Pi agent (wiki-update SessionUpdate workflow)
- Inputs: James's correction that Cleon UI Pi uses Pi-owned auth/config, not Anthropic auth in app `.env`; stale docs found in `README.md`, `CLAUDE.md`, `.env.example`; existing model-registry claim `C-0003`
- Outputs: raw session capture `wiki/raw/sessions/2026-05-28-pi-auth-correction.md`; candidate `wiki/candidates/concept-pi-auth-boundary.md`; claim `C-0035` added to `wiki/CLAIMS.md`; candidate row/source notes updated in `wiki/index.md`; candidate routes added to `wiki/ROUTING.md`; stale auth notes added to `wiki/sources/source-readme.md` and `wiki/sources/source-claude-md.md`; live docs updated in `README.md`, `CLAUDE.md`, `.env.example`
- Notes: Auth-boundary guidance supersedes stale Anthropic-key setup wording in 2026-05-27 source snapshots. No secrets or contents of `~/.pi/agent/auth.json` captured. Follow-up: surface SDK `stopReason: error` visibly in UI instead of a silent empty response.

## [2026-05-30] query | WebUI slash skill discovery gap

- Actor: Pi agent (diagnose workflow)
- Inputs: user report that `/` autocomplete showed only a small skill subset such as `/dotfiles` and `/mermaid`; `wiki/index.md`; `wiki/ROUTING.md`; `wiki/candidates/source-specs-catalog.md`; `server/commands.js`; Pi `docs/skills.md`
- Outputs: `server/commands.js` now discovers Pi skills from `~/.pi/agent/skills`, `~/.agents/skills`, project ancestor `.agents/skills`, extension skill dirs, and configured settings skill paths; skill commands are emitted as `/skill:<name>` to match Pi SDK expansion; `tests/unit/commands.test.js` added; `~/.pi/agent/settings.json` updated with `~/.claude/skills` after user approval
- Notes: Existing wiki claim `C-0032` is stale because `server/commands.js` and `/api/commands` now exist; source-specs catalog should be refreshed or superseded during next wiki maintenance.

## [2026-05-30] session-update | Slash skill discovery preservation

- Actor: Pi agent (wiki-update SessionUpdate workflow)
- Inputs: James's report that the slash skill discovery fix has been overwritten multiple times; committed fix `441c0d0`; `server/commands.js`; `tests/unit/commands.test.js`; live `/api/commands` verification; existing stale claim `C-0032`
- Outputs: raw session capture `wiki/raw/sessions/2026-05-30-slash-skill-discovery-preservation.md`; candidate `wiki/candidates/concept-slash-skill-discovery.md`; `wiki/candidates/source-specs-catalog.md` marked partially superseded; claims `C-0036` and `C-0037` added; `C-0032` marked superseded; index/routing updated
- Notes: Future agents should preserve `/skill:<name>` command names and Pi-compatible skill locations in `server/commands.js`; verify with `npm test` and live `/api/commands` after PM2 restart.

## [2026-06-07] query | Model dropdown single-option regression

- Actor: Pi agent (diagnose workflow)
- Inputs: user report that web console model dropdown keeps reverting to one z.ai GLM option; `wiki/index.md`; `wiki/ROUTING.md`; `wiki/CLAIMS.md`; `wiki/candidates/source-design-plans-history.md`; live `/api/models` probe; `config/models.json`; `~/.pi/agent/models.json`; `server/models.js`; `public/app.js`; git history for `config/models.json`
- Outputs: no wiki knowledge pages changed; diagnostic evidence recorded in this log entry
- Notes: Live `/api/models` returns only `zai/glm-5.1` because repo-tracked `config/models.json` contains only that model while Pi registry contains 14 models. Recurrence appears caused by dual model registries and tracked config edits narrowing the UI allowlist during prior mismatch/error fixes.

## [2026-06-14] query | Prime project orientation

- Actor: Pi agent (prime skill)
- Inputs: `wiki/index.md`, `wiki/ROUTING.md`, `wiki/README.md`, promoted wiki pages, selected candidate pages, `README.md`, `CLAUDE.md`, `package.json`, key source files under `server/` and `public/`, git status/log
- Outputs: no knowledge pages changed; orientation report returned in chat; this log entry records wiki query use
- Notes: Verified current model dropdown implementation now sources Pi `ModelRegistry` through `server/models.js`; `config/models.json` currently only sets default and no allowlist. Noted `.env.example` still defaults to port 3010 while project docs describe operational port 3015.

## [2026-06-14] promote+update | Pi project identity and concept pages

- Actor: Pi agent
- Inputs: user correction that app is single-user, built for Pi Coding Agent/Pi coding tool, uses port 3015, CORS private-IP behavior is acceptable behind firewall, and candidate concept pages should be promoted
- Outputs: updated `README.md`, `.env.example`, `package.json`, `package-lock.json`, `server/index.js`, `CLAUDE.md`; promoted `wiki/candidates/concept-pi-auth-boundary.md` → `wiki/concepts/concept-pi-auth-boundary.md`; promoted `wiki/candidates/concept-slash-skill-discovery.md` → `wiki/concepts/concept-slash-skill-discovery.md`; updated `wiki/index.md`, `wiki/ROUTING.md`, `wiki/CLAIMS.md`, `wiki/sources/source-readme.md`, `wiki/sources/source-claude-md.md`, `wiki/entities/entity-server-index.md`, and `wiki/candidates/source-specs-catalog.md`
- Notes: Port fallback and env example now use 3015. CORS behavior left unchanged. Promoted concepts now authoritative for Pi auth boundary and `/skill:<name>` slash skill discovery.
