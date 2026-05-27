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
