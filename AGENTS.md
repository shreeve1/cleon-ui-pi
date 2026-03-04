# Cleon UI

Lightweight, mobile-first web interface for Claude Code with retro 80s neon arcade aesthetics.

## Tech Stack

- **Runtime**: Node.js 18+ (ES Modules)
- **Frontend**: Vanilla JavaScript, CSS (no frameworks)
- **Backend**: Express.js, better-sqlite3, JWT auth
- **AI Integration**: Pi Coding Agent (RPC mode)
- **Testing**: Vitest (unit), Playwright (e2e)

## Commands

- `npm start`: Start server (http://localhost:3010)
- `npm run dev`: Start with auto-reload (`node --watch`)
- `npm test`: Run Vitest unit tests
- `npm run pm2`: Start with PM2 process manager
- `npm run pm2:restart`: Restart PM2 instance
- `npm run pm2:stop`: Stop PM2 instance

## Project Structure

- `/public`: Frontend (index.html, app.js, style.css)
- `/server`: Backend (Express, auth, sessions, Pi agent integration)
- `/tests`: Unit, integration, and e2e tests
- `/docs`: Development notes, bugfixes, plans
- `/specs`: Technical specifications
- `/config`: Configuration files
- `/artifacts`: Generated artifacts and plans
- `~/.cleon-ui/`: User data (SQLite databases for users, sessions, messages)

## Code Style

- **Imports**: ES modules (`import`/`export`)
- **Naming**: camelCase for variables/functions, PascalCase for classes
- **Exports**: Named exports preferred (e.g., `export const`, `export function`)
- **Async**: Async/await pattern throughout
- **Logging**: Use `logger` module (Winston-based) in server code

## Testing

- **Unit tests**: `tests/unit/` - Vitest framework
- **Integration tests**: `tests/integration/` - Playwright
- **E2E tests**: `tests/e2e/` - Playwright
- Run all: `npm test`
- Test files follow pattern: `*.test.js`

## Important Notes

### Security
- NEVER commit `.env` files (already in `.gitignore`)
- Set strong `JWT_SECRET` (32+ chars) for production
- Passwords hashed with bcrypt (10 rounds)
- Data stored locally in `~/.cleon-ui/`

### Pi Agent Integration
- Server spawns `pi --mode rpc --no-session` for each chat request
- Pi binary must be installed: `npm install -g @mariozechner/pi-coding-agent`
- Configure API keys in `~/.pi/agent/auth.json` or via `ANTHROPIC_API_KEY` env var
- See `server/pi-agent.js` for RPC integration details

### Session Management
- Max 5 concurrent sessions per user
- Sessions stored in SQLite (`~/.cleon-ui/sessions.db`)
- Real-time updates via Server-Sent Events (SSE)
- WebSocket used for multi-tab sync

### Development
- Projects expected in `~/Documents/claude/`
- Each project has `.claude/sessions/` for Claude Code session history
- See `docs/` for development notes and bugfix documentation

### Production Deployment
- Use PM2 for process management
- Run behind reverse proxy (nginx/Caddy) for HTTPS
- Set `NODE_ENV=production`
- Configure CORS via `ALLOWED_ORIGINS` env var
- See README.md for detailed deployment instructions

### Known Limitations
- Single-server deployment (no clustering)
- SQLite database (not for high concurrency)
- No built-in rate limiting
