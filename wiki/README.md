# Cleon UI Pi — LLM Wiki

LLM-maintained knowledge base for the Cleon UI Pi project. Focus: ops + runbook knowledge (PM2, CORS, Pi SDK, env quirks, incident root causes, deployment notes).

## Rules

- `raw/` is immutable source material.
- `candidates/` contains unpromoted generated pages.
- Promoted pages must be indexed in `index.md`; candidates appear only in the candidate review queue.
- Important factual claims must be tracked in `CLAIMS.md`.
- All changes must be logged in `log.md`.
- Promotion policy: low-risk candidates may auto-promote when citations and confidence checks pass; high-risk or contradictory candidates require James approval.

## Workflows

- **Ingest**: add source to `raw/`, summarize, extract claims, create candidate, update candidate index/routing/claims, log.
- **Session update**: use `/wiki-update` to capture durable decisions, verified facts, and follow-ups from a session into raw session notes, candidates, claims, routing, index, and log.
- **Query**: read `index.md`, use `ROUTING.md` to narrow, then read relevant promoted pages; cite sources.
- **Lint**: check broken links, orphans, stale claims, duplicates, missing concepts, gaps, contradictions.
- **Promote**: move candidate to final location; update index/routing/claims/log.
- **Discard**: remove stale candidate index rows, routes, claim refs; log the discard.

## Layout

```
wiki/
├── index.md          # content catalog + candidate review queue
├── log.md            # append-only event log
├── ROUTING.md        # topic-branch → likely pages
├── CLAIMS.md         # atomic claims with citations and confidence
├── raw/              # immutable sources (codebase notes, docs, session captures)
├── candidates/       # review gate
├── sources/          # promoted source summaries
├── entities/         # promoted entity pages (services, processes, files)
├── concepts/         # promoted concept pages (CORS policy, session lifecycle, etc.)
├── analyses/         # promoted query outputs and syntheses
└── assets/           # generated/wiki-native attachments
```
