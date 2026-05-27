# Cleon UI Pi — Agent Context

Web UI for Pi Coding Agent. Retro neon aesthetic, mobile-first. Runs on port 3015.

## Quick Reference

| Item | Value |
|------|-------|
| Port | 3015 (configurable via `.env`) |
| PM2 process | `cleon-ui-pi` |
| Domain | `https://pi.testytech.net` |
| Main entry | `server/index.js` |
| Config | `.env` (source of truth, uses `dotenv` with `override: true`) |

## Directory Structure

```
cleon-ui-pi/
├── server/              # Backend
│   ├── index.js         # Express + WebSocket server
│   ├── pi-agent.js      # Pi SDK session handler
│   ├── sdk-session-manager.js  # Session lifecycle
│   ├── auth.js          # JWT authentication
│   ├── models.js        # Model config loader
│   └── ...
├── public/              # Frontend (vanilla JS)
│   ├── index.html       # SPA entry
│   ├── app.js           # Client logic
│   └── style.css        # Neon styling
├── config/
│   └── models.json      # Available AI models
├── .env                 # Environment config (PORT, ALLOWED_ORIGINS, etc.)
├── ecosystem.config.cjs # PM2 configuration
└── package.json
```

## Configuration

### .env (Source of Truth)

Server uses `dotenv.config({ override: true })` — `.env` always wins over shell/PM2 env vars.

Key variables:
- `PORT` — Server port (default: 3015)
- `HOST` — Bind address (default: 0.0.0.0)
- `ALLOWED_ORIGINS` — CORS whitelist (comma-separated)
- `JWT_SECRET` — Auth token secret (min 32 chars)
- `ANTHROPIC_API_KEY` — API key for Pi agent (or configure in `~/.pi/agent/auth.json`)
- `LOG_LEVEL` — Logging verbosity (debug/info/warn/error)
- `SDK_MAX_CONCURRENT` — Cap on simultaneously-warm Pi `AgentSession`s (default: 50). When the cap is hit, the least-recently-active idle session is evicted silently.
- `SDK_IDLE_TIMEOUT_MS` — Idle time before a pooled session is eligible for eviction (default: 600000 = 10 min).

### config/models.json

Models available in dropdown. Must match Pi SDK registry (`~/.pi/agent/models.json`).

```json
{
  "models": ["zai/glm-5", "openai-codex/gpt-5.5"],
  "default": "zai/glm-5"
}
```

## PM2 Operations

```bash
# Start/restart
npm run pm2

# Restart only
npm run pm2:restart

# View logs
npm run pm2:logs

# Stop
npm run pm2:stop
```

The `ecosystem.config.cjs` uses `cwd: __dirname` for portability. Only `NODE_ENV` is set there — all other config comes from `.env`.

## Common Issues & Fixes

### EADDRINUSE / Port Conflict

**Symptom**: Server crash loop, logs show `EADDRINUSE: address already in use`

**Cause**: Another process (often `cleon-ui` on port 3010) using the same port, or PM2 env vars not loading properly.

**Fix**:
```bash
# Delete and restart with ecosystem config
pm2 delete cleon-ui-pi
pm2 start ecosystem.config.cjs
```

### CORS Errors

**Symptom**: Browser shows "Not allowed by CORS" or WebSocket connection rejected

**Cause**: Origin not in `ALLOWED_ORIGINS` whitelist

**Fix**: Add domain to `ALLOWED_ORIGINS` in `.env`:
```
ALLOWED_ORIGINS=https://pi.testytech.net
```

Then restart: `npm run pm2:restart`

### Model Not Found

**Symptom**: Log shows `[Pi] Model xxx not found in registry, using default model`

**Cause**: Model ID in `config/models.json` doesn't match Pi SDK registry

**Fix**: Check `~/.pi/agent/models.json` for available model IDs, update `config/models.json` to match exactly.

### Shell Env Vars Override .env

**Symptom**: Server uses wrong PORT or ALLOWED_ORIGINS despite .env being correct

**Cause**: Shell has exported vars (e.g., from another cleon-ui instance)

**Fix**: Server now uses `dotenv.config({ override: true })` so `.env` takes precedence. If still having issues:
```bash
env | grep -E '^(PORT|ALLOWED_ORIGINS)='  # Check shell vars
unset PORT ALLOWED_ORIGINS                 # Remove if needed
npm run pm2:restart
```

### "Connection lost. Reconnecting..."

**Symptom**: UI shows connection error, reconnection attempts fail

**Cause**: Usually PM2 crash loop — check logs first:
```bash
pm2 logs cleon-ui-pi --lines 30
```

Common causes:
1. Port conflict (see EADDRINUSE above)
2. CORS rejection (see CORS errors above)
3. Missing dependencies (`npm install`)

## Git Configuration

Uses personal SSH key for push access:
```
git@github-personal:shreeve1/cleon-ui-pi.git
```

SSH config entry (`~/.ssh/config`):
```
Host github-personal
    HostName github.com
    User git
    IdentityFile ~/.ssh/id_ed25519_github_personal
    IdentitiesOnly yes
```

## Development Notes

### Running Locally

```bash
npm install
cp .env.example .env  # Edit as needed
npm start             # Direct node
npm run dev           # With --watch
```

### Testing

```bash
npm test              # Run vitest
```

### Key Files for Debugging

- `server/index.js:61-89` — CORS configuration
- `server/index.js:515` — PORT fallback (`process.env.PORT || 3010`)
- `server/pi-agent.js` — Pi SDK integration, session handling
- `server/sdk-session-manager.js` — Session lifecycle, `~/.pi/agent/cleon-sessions.json`

### Pi SDK Integration

Sessions are managed via `@mariozechner/pi-coding-agent` SDK. Session mappings stored in `~/.pi/agent/cleon-sessions.json`.

The `stripAnsi()` function in `pi-agent.js:18-24` removes ANSI escape codes from Pi output before sending to browser.

## Architecture Notes

- **Frontend**: Vanilla JS SPA, no build step
- **Backend**: Express + WebSocket (ws)
- **Auth**: JWT with bcrypt password hashing
- **Database**: SQLite via better-sqlite3 (`~/.cleon-ui/`)
- **Streaming**: Server-Sent Events for AI responses
- **Process Manager**: PM2 with ecosystem.config.cjs

## LLM Wiki

This project uses `wiki/` as an LLM-maintained knowledge base. Focus: ops + runbook knowledge (PM2, CORS, Pi SDK, env quirks, incidents).

### Directories

- `wiki/raw/`: immutable source material; read but do not rewrite.
- `wiki/raw/sessions/`: curated session captures created by `/wiki-update`.
- `wiki/candidates/`: generated pages awaiting review or promotion.
- `wiki/sources/`: promoted source summaries.
- `wiki/entities/`: promoted entity pages (services, processes, files).
- `wiki/concepts/`: promoted concept pages (CORS policy, session lifecycle, etc.).
- `wiki/analyses/`: promoted query outputs and syntheses.
- `wiki/assets/`: generated or wiki-native attachments.

### Required Files

- Read `wiki/index.md` first when answering wiki-backed questions.
- Use `wiki/ROUTING.md` after `wiki/index.md` to narrow large searches.
- Append every ingest, query, lint, and promotion to `wiki/log.md`.
- Track important factual claims in `wiki/CLAIMS.md`.

### Wiki-First Project Search

For any project-specific question, investigation, design task, bug hunt, or code search that needs project context, check the wiki first.

1. Read `wiki/index.md` before searching broadly.
2. Use `wiki/ROUTING.md` to identify relevant promoted pages, candidates, and claim entries.
3. Read relevant wiki pages and `wiki/CLAIMS.md` entries before using general repository search.
4. If the wiki lacks enough information, search the codebase, docs (`docs/`, `specs/`, `openspec/`, `README.md`), or external sources as needed.
5. When non-wiki search reveals durable project knowledge, propose ingesting the source into `wiki/raw/`, creating or updating a page in `wiki/candidates/`, or promoting an existing candidate.
6. If external or codebase search was needed to answer a wiki-backed question, mention the wiki gap and proposed ingest or promotion path in the final answer.

### Session Update Workflow

Use `/wiki-update` during or after meaningful sessions to capture durable decisions, verified facts, root causes, follow-ups, and reusable context. Create curated raw session captures under `wiki/raw/sessions/` when conversation evidence is needed. Do not archive full transcripts, secrets, private material, or raw pasted user content without explicit approval. New or risky session-derived knowledge goes through `wiki/candidates/` and must update `wiki/index.md`, `wiki/ROUTING.md`, `wiki/CLAIMS.md`, and `wiki/log.md`.

### Ingest Workflow

1. Read the new source from `wiki/raw/`.
2. Summarize the source with citations to the raw path.
3. Discuss key takeaways with James when the source is substantial, ambiguous, or likely to touch multiple pages.
4. Extract entities, concepts, contradictions, and atomic claims.
5. Create new pages in `wiki/candidates/` unless the edit is low-risk maintenance.
6. Update `wiki/index.md` candidate queue, `wiki/ROUTING.md`, and `wiki/CLAIMS.md` with cited candidate entries.
7. Append an entry to `wiki/log.md`.

### Query Workflow

1. Read `wiki/index.md` to identify relevant promoted pages and candidates.
2. Use `wiki/ROUTING.md` to narrow branches when the index is too broad.
3. Read only relevant promoted pages and claim entries.
4. Answer with citations to wiki pages or raw sources.
5. If the answer produces durable synthesis, offer to save it as `wiki/candidates/<slug>.md`.

### Promotion Workflow

Auto-promote low-risk candidates when citations are present, confidence is high, and no contradictions exist. High-risk, ambiguous, or contradictory candidates require James approval.

1. Review the candidate page for citations, confidence, and duplicates.
2. Move it to `sources/`, `entities/`, `concepts/`, or `analyses/`.
3. Set `status: promoted` and update timestamps.
4. Update `index.md`, `ROUTING.md`, `CLAIMS.md`, and `log.md`.

### Discard Workflow

When a candidate is rejected, remove its candidate index row, candidate-only routes, and candidate claim page references before deleting the candidate file. Append a discard entry to `wiki/log.md`.

### Lint Workflow

Check broken wikilinks, orphan pages, duplicate concepts, uncited claims, stale claims, contradictions, missing concept pages, data gaps, stale candidate references, and missing index/routing entries. Report findings before making broad changes.
