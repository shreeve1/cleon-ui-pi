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
