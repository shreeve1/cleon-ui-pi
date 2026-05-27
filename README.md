# Cleon UI Pi

> **Historical Note:** This project began life as "Claude Lite," was rebranded to "Cleon UI" in February 2025, and was forked into **Cleon UI Pi** when the backend migrated from a `pi` RPC subprocess to the in-process [Pi Coding Agent SDK](https://www.npmjs.com/package/@mariozechner/pi-coding-agent). The fork runs on a separate port and lives in its own repo.

A lightweight, mobile-first web interface for the Pi Coding Agent featuring a retro 80s neon arcade aesthetic. Built with vanilla JavaScript for maximum simplicity and minimal dependencies.

## Features

- **Retro Neon Aesthetic**: Vibrant 80s-inspired design with cyan/magenta/yellow accents
- **Mobile-First**: Optimized for touch interfaces and small screens
- **Lightweight**: Vanilla JavaScript, no heavy frameworks
- **Real-Time Streaming**: WebSocket dispatch with Server-Sent Events for live AI responses
- **Multi-Tab Session Sync**: Session create/close events broadcast across every open tab for the same user
- **File Upload & Paste**: Drag-and-drop and clipboard support for images, text, PDFs, and markdown
- **Slash Commands**: Quick access to common actions
- **Favorites System**: Pin frequently-used projects
- **User Authentication**: Multi-user support with JWT-based auth
- **Token Usage Tracking**: Monitor API usage per session

## Quick Start

### Prerequisites

- Node.js 18+ and npm
- An Anthropic API key (or a working `~/.pi/agent/auth.json`)
- A Pi SDK model registry at `~/.pi/agent/models.json`

### Installation

1. Clone the repository:
```bash
git clone https://github.com/shreeve1/cleon-ui-pi.git
cd cleon-ui-pi
```

2. Install dependencies:
```bash
npm install
```

3. Configure environment variables:
```bash
cp .env.example .env
# Edit .env — set JWT_SECRET, ALLOWED_ORIGINS, and ANTHROPIC_API_KEY (or use ~/.pi/agent/auth.json)
```

4. Start the server:
```bash
npm start
```

5. Open your browser to `http://localhost:3015`

### First-Time Setup

1. Create an account on the welcome screen
2. Log in with your credentials
3. Pick a project directory and start a session
4. Chat with the Pi agent

## Configuration

### Environment Variables

`.env` is the source of truth — the server loads it with `dotenv.config({ override: true })`, so values in `.env` always win over shell or PM2 environment variables.

```bash
# Server Configuration
PORT=3015
HOST=0.0.0.0
NODE_ENV=production

# Security (REQUIRED for production)
JWT_SECRET=change-this-to-a-random-secure-string-at-least-32-chars

# CORS: Allowed origins (comma-separated)
ALLOWED_ORIGINS=https://your-domain.com

# Anthropic API key (or configure in ~/.pi/agent/auth.json)
ANTHROPIC_API_KEY=sk-ant-...

# Optional: Logging
LOG_LEVEL=info

# Optional: Pi SDK session pool tuning
# SDK_MAX_CONCURRENT=50
# SDK_IDLE_TIMEOUT_MS=600000
```

### Model Registry

`config/models.json` controls the model dropdown. Entries must match the Pi SDK registry at `~/.pi/agent/models.json` exactly — a mismatch silently falls back to the default model and logs `[Pi] Model xxx not found in registry`.

### User Data Location

User accounts and session data are stored locally:

- **Location**: `~/.cleon-ui/`
- **Files**: `users.db`, `sessions.db`, `messages.db`

Pi SDK session mappings live in `~/.pi/agent/cleon-sessions.json` and are managed by `server/sdk-session-manager.js`.

## Architecture

### Project Structure

```
cleon-ui-pi/
├── public/
│   ├── index.html          # Main UI (single-page app)
│   ├── style.css           # Neon aesthetic styling
│   └── app.js              # Client-side logic
├── server/
│   ├── index.js            # Express + WebSocket entry point, CORS, rate limiting, SSE
│   ├── pi-agent.js         # Pi SDK session handler, event transformation
│   ├── sdk-session-manager.js  # AgentSession pool, persistence, idle eviction
│   ├── auth.js             # JWT + bcrypt authentication
│   └── models.js           # Model config loader
├── config/
│   └── models.json         # Model dropdown (must mirror ~/.pi/agent/models.json)
├── ecosystem.config.cjs    # PM2 config (cwd: __dirname; only NODE_ENV set here)
├── .env                    # Source of truth for runtime config
├── .env.example
└── README.md
```

### Technology Stack

**Frontend:**
- Vanilla JavaScript (no frameworks)
- CSS Grid & Flexbox for layout
- WebSocket for chat/session events; Server-Sent Events for streaming token-by-token output

**Backend:**
- Node.js + Express + `ws`
- `@mariozechner/pi-coding-agent` (Pi SDK, in-process — no subprocess)
- better-sqlite3 for user/session/message persistence
- JWT + bcrypt for authentication
- `express-rate-limit` (15-min window, 100/IP general, 10/IP for `/api/auth`)

### How It Works

1. **Authentication**: Users authenticate via JWT tokens stored in localStorage.
2. **Session pool**: Each user/project pair gets an `AgentSession` from `sdk-session-manager.js`. Sessions are pooled with configurable concurrency and idle timeouts; the least-recently-active session is evicted when the cap is hit.
3. **Chat over WebSocket**: The browser opens a WS connection and sends typed messages (`chat`, `abort`, `question-response`, `plan-response`, `close-session`). `server/index.js` dispatches to handlers in `pi-agent.js` and `session-registry.js`.
4. **Streaming**: AI responses stream via SSE from the active turn to the browser, with 10-second heartbeats so reverse proxies don't time out the connection.
5. **Multi-tab sync**: Every session mutation (`session-created`, `session-closed`) is broadcast via `publish(username, …)` so all tabs reconcile their local state.
6. **Persistence**: User accounts and message history in SQLite at `~/.cleon-ui/`; Pi SDK session mappings at `~/.pi/agent/cleon-sessions.json`.

## API Endpoints

### Authentication (REST)
- `POST /api/auth/register` — Create new account
- `POST /api/auth/login` — Authenticate user
- `GET /api/auth/validate` — Verify JWT token

### Chat & Sessions (WebSocket)
Chat is dispatched over a single WebSocket connection. See `server/index.js` for the full message catalogue; the main client messages are:
- `chat` — send a user turn (with optional attachments)
- `abort` — cancel the in-flight turn
- `question-response` / `plan-response` — reply to mid-turn agent prompts
- `close-session` — drop a session from the server registry (broadcasts `session-closed`)

The server publishes typed events (`turn-update`, `session-created`, `session-closed`, `state-snapshot`, etc.) to every WS connection owned by the same user.

## Browser Support

- Chrome/Edge 90+
- Firefox 88+
- Safari 14+
- Mobile browsers (iOS Safari, Chrome Android)

Requires support for:
- ES6+ JavaScript
- CSS Grid
- WebSocket
- Server-Sent Events
- Fetch API
- localStorage

## Security Notes

### Production Deployment

**Required:**
1. Set a strong `JWT_SECRET` in production.
2. Use HTTPS (never HTTP in production).
3. Protect `.env` (never commit to git).
4. Configure `ALLOWED_ORIGINS` to your real public origin(s).
5. Be aware that `server/index.js` auto-allows all `localhost`/`127.0.0.1` and RFC1918 private IPs (10.x, 172.16-31.x, 192.168.x) for CORS — do not expose the server directly to an untrusted LAN.

**User Data:**
- Passwords are hashed with bcrypt.
- JWTs expire (see `auth.js`).
- User data stored locally in `~/.cleon-ui/`.

### Known Limitations

- Single-server deployment (no clustering).
- SQLite database (not suitable for high concurrency).
- File-based session storage.

## Production Deployment

### PM2 (recommended)

```bash
npm install -g pm2
pm2 start ecosystem.config.cjs   # uses cwd: __dirname, only sets NODE_ENV; everything else comes from .env
pm2 save
pm2 startup                      # enable auto-start on reboot
```

Convenience scripts:

```bash
npm run pm2          # start or restart with ecosystem config
npm run pm2:restart  # restart only
npm run pm2:logs     # tail logs
npm run pm2:stop     # stop
```

### Reverse Proxy (HTTPS)

For production, run behind a reverse proxy like Caddy or nginx for HTTPS:

**Caddy (recommended — automatic HTTPS):**
```
your-domain.com {
    reverse_proxy localhost:3015
}
```

**Nginx (WebSocket-aware):**
```nginx
server {
    listen 443 ssl;
    server_name your-domain.com;

    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    location / {
        proxy_pass http://localhost:3015;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 120s;
    }
}
```

The SSE stream sends a heartbeat every 10 seconds; the WebSocket pings every 30 seconds. Set proxy idle timeouts above both.

## Development

### Running in Development

```bash
npm run dev   # node --watch
```

Server runs on `http://localhost:3015` and reloads on file changes.

### Testing

```bash
npm test      # vitest
```

### Adding New Features

1. Update specs in `specs/` (or `openspec/changes/` for tracked proposals).
2. Implement backend changes in `server/`.
3. Update frontend in `public/`.
4. Document durable decisions via the LLM Wiki (`/wiki-update`).
5. Update this README if user-facing behavior changes.

### Debugging

- Server logs: `pm2 logs cleon-ui-pi` (or stdout in dev).
- Client logs: Browser DevTools console.
- Database: SQLite files in `~/.cleon-ui/`.
- Pi SDK sessions: `~/.pi/agent/cleon-sessions.json`.

## Troubleshooting

### EADDRINUSE / "Address already in use"

Usually another process (often the original `cleon-ui` on port 3010) is holding the port, or PM2 is fighting a stale env. Reset:

```bash
pm2 delete cleon-ui-pi
pm2 start ecosystem.config.cjs
```

### "Not allowed by CORS"

Add the requesting origin to `ALLOWED_ORIGINS` in `.env`, then:

```bash
npm run pm2:restart
```

### "[Pi] Model xxx not found in registry, using default model"

`config/models.json` has drifted from `~/.pi/agent/models.json`. Align the IDs exactly.

### Shell env vars overriding `.env`

The server now uses `dotenv.config({ override: true })`, so `.env` should win. If you still see ghost values:

```bash
env | grep -E '^(PORT|ALLOWED_ORIGINS)='
unset PORT ALLOWED_ORIGINS
npm run pm2:restart
```

### "Connection lost. Reconnecting…"

Almost always a PM2 crash loop. Check logs first:

```bash
pm2 logs cleon-ui-pi --lines 30
```

Common causes: port conflict, CORS rejection, missing dependencies (`npm install`).

### "Failed to connect to Pi"

Pi runs in-process via `@mariozechner/pi-coding-agent` — there is no `pi` subprocess. If chat fails:

- Verify `ANTHROPIC_API_KEY` is set in `.env` (or `~/.pi/agent/auth.json` is valid).
- Confirm `~/.pi/agent/models.json` exists and contains the model IDs referenced by `config/models.json`.
- Check `pm2 logs cleon-ui-pi` for Pi SDK errors.

## Contributing

This is a personal/experimental project, but suggestions and improvements are welcome:

1. Document issues with clear reproduction steps.
2. Include relevant logs and screenshots.
3. Specify browser/OS versions.
4. Test changes thoroughly before submitting.

## License

MIT License

## Credits

Built with:
- [Pi Coding Agent SDK](https://www.npmjs.com/package/@mariozechner/pi-coding-agent) — in-process AI agent harness
- [Express.js](https://expressjs.com/)
- [`ws`](https://github.com/websockets/ws) — WebSocket dispatcher
- [better-sqlite3](https://github.com/WiseLibs/better-sqlite3)
- Retro neon aesthetic inspired by 80s arcade culture

---

**Cleon UI Pi** — A lightweight, beautiful interface for the Pi Coding Agent
