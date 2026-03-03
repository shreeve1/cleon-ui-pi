# Cleon UI

> **Historical Note:** This project was originally developed under the name "Claude Lite" and was rebranded to "Cleon UI" in February 2025.

A lightweight, mobile-first web interface for Claude Code featuring a retro 80s neon arcade aesthetic. Built with vanilla JavaScript for maximum simplicity and minimal dependencies.

## Features

- **Retro Neon Aesthetic**: Vibrant 80s-inspired design with cyan/magenta/yellow accents
- **Mobile-First**: Optimized for touch interfaces and small screens
- **Lightweight**: Vanilla JavaScript, no heavy frameworks
- **Real-Time Streaming**: Server-Sent Events for live Claude responses
- **Project Management**: Search, create, and organize Claude Code projects
- **File Upload**: Drag-and-drop support for images, text, PDFs, and markdown
- **Slash Commands**: Quick access to common actions
- **Mode Switching**: Toggle between default, plan, and bypass modes
- **Favorites System**: Pin frequently-used projects
- **User Authentication**: Multi-user support with JWT-based auth
- **Token Usage Tracking**: Monitor API usage per session

## Quick Start

### Prerequisites

- Node.js 18+ and npm
- Anthropic API key

### Installation

1. Clone the repository:
```bash
git clone https://github.com/shreeve1/cleon-ui.git
cd cleon-ui
```

2. Install dependencies:
```bash
npm install
```

3. Configure environment variables:
```bash
cp .env.example .env
# Edit .env and add your ANTHROPIC_API_KEY
```

4. Start the server:
```bash
npm start
```

5. Open your browser to `http://localhost:3010`

### First-Time Setup

1. Create an account on the welcome screen
2. Log in with your credentials
3. Create or search for a Claude Code project
4. Start chatting with Claude!

## Configuration

### Environment Variables

Create a `.env` file in the project root:

```bash
# Server Configuration
PORT=3010
HOST=0.0.0.0
NODE_ENV=production

# Security (REQUIRED for production)
JWT_SECRET=change-this-to-a-random-secure-string-at-least-32-chars

# CORS: Allowed origins (comma-separated)
ALLOWED_ORIGINS=https://your-domain.com

# Pi Coding Agent Configuration
# Path to Pi binary (defaults to 'pi' if not set)
PI_BINARY=pi

# Optional: Logging
LOG_LEVEL=info
```

### User Data Location

User accounts and session data are stored in:
- **Location**: `~/.cleon-ui/`
- **Files**: `users.db`, `sessions.db`, `messages.db`

**Data Migration**: If upgrading from Claude Lite, your data will be automatically migrated from `~/.claude-lite/` to `~/.cleon-ui/` on first startup.

## Architecture

### Project Structure

```
cleon-ui/
├── public/
│   ├── index.html          # Main UI (single-page app)
│   ├── style.css           # Neon aesthetic styling
│   └── app.js              # Client-side logic
├── server/
│   ├── index.js            # Express server & SSE
│   ├── auth.js             # User authentication
│   ├── projects.js         # Project management
│   ├── sessions.js         # Session handling
│   └── messages.js         # Message persistence
├── specs/                  # Technical specifications
├── sessions/               # Development session notes
├── package.json
├── .env.example
└── README.md
```

### Technology Stack

**Frontend:**
- Vanilla JavaScript (no frameworks)
- CSS Grid & Flexbox for layout
- Server-Sent Events (SSE) for streaming

**Backend:**
- Node.js + Express
- better-sqlite3 for data persistence
- JWT for authentication
- Pi Coding Agent RPC for AI interactions

### How It Works

1. **Authentication**: Users authenticate via JWT tokens stored in localStorage
2. **Project Management**: Search/create projects in `~/Documents/claude`
3. **Chat Sessions**: Each conversation creates a session with message history
4. **Streaming**: AI responses stream via SSE from server to client
5. **Persistence**: Messages, sessions, and projects stored in SQLite
6. **Pi Integration**: Spawns `pi --mode rpc --no-session` for each chat request

## API Endpoints

### Authentication
- `POST /api/auth/register` - Create new account
- `POST /api/auth/login` - Authenticate user
- `GET /api/auth/validate` - Verify JWT token

### Projects
- `GET /api/projects/search?q=query` - Search projects
- `POST /api/projects/create` - Create new project
- `GET /api/projects/:id` - Get project details

### Sessions
- `GET /api/sessions` - List user sessions
- `POST /api/sessions` - Create new session
- `GET /api/sessions/:id/messages` - Get session history

### Chat
- `POST /api/chat` - Send message to Claude (returns SSE stream)

## Browser Support

- Chrome/Edge 90+
- Firefox 88+
- Safari 14+
- Mobile browsers (iOS Safari, Chrome Android)

Requires support for:
- ES6+ JavaScript
- CSS Grid
- Server-Sent Events
- Fetch API
- localStorage

## Security Notes

### Production Deployment

**Required:**
1. Set strong `JWT_SECRET` in production
2. Use HTTPS (never HTTP in production)
3. Protect `.env` file (never commit to git)
4. Configure CORS appropriately
5. Set secure cookie flags if using cookies

**User Data:**
- Passwords are hashed with bcrypt (10 rounds)
- JWTs expire (check auth.js for duration)
- User data stored locally in `~/.cleon-ui/`

### Known Limitations

- Single-server deployment (no clustering)
- SQLite database (not suitable for high concurrency)
- File-based session storage
- No rate limiting (implement if needed)

## Production Deployment

### Running in Production

1. Set environment to production:
```bash
NODE_ENV=production node server/index.js
```

2. Or use PM2 for process management:
```bash
npm install -g pm2
pm2 start server/index.js --name cleon-ui
pm2 save
pm2 startup  # Enable auto-start on reboot
```

### Reverse Proxy (HTTPS)

For production, run behind a reverse proxy like nginx or Caddy for HTTPS:

**Caddy (recommended - automatic HTTPS):**
```
your-domain.com {
    reverse_proxy localhost:3010
}
```

**Nginx:**
```nginx
server {
    listen 443 ssl;
    server_name your-domain.com;

    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    location / {
        proxy_pass http://localhost:3010;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

## Development

### Running in Development

```bash
npm start
```

Server runs on `http://localhost:3010` with auto-restart via nodemon.

### Project Directory Structure

Projects are expected in:
```
~/Documents/claude/
├── project-name/
│   ├── .claude/
│   │   └── sessions/
│   └── ... (project files)
```

### Adding New Features

1. Update specs in `specs/` directory
2. Implement backend changes in `server/`
3. Update frontend in `public/`
4. Document in session notes under `sessions/`
5. Update this README if needed

### Debugging

- Server logs: Console output
- Client logs: Browser DevTools console
- Database: SQLite files in `~/.cleon-ui/`
- Session notes: Check `sessions/` for implementation details

## Troubleshooting

### "Authentication failed"
- Check JWT_SECRET matches between restarts
- Clear localStorage and log in again
- Verify `.cleon-ui/users.db` exists

### "Cannot find project directory"
- Ensure `~/Documents/claude/` exists
- Check project directory structure
- Verify read permissions

### "Failed to connect to Claude"
- Verify Pi is installed and accessible (`pi --version`)
- Check PI_BINARY env var if using custom path
- Review server logs for RPC errors

### Data Migration Issues
- Check `~/.claude-lite/` exists before migration
- Verify write permissions for `~/.cleon-ui/`
- Check server startup logs for migration messages

## Contributing

This is a personal/experimental project, but suggestions and improvements are welcome:

1. Document issues with clear reproduction steps
2. Include relevant logs and screenshots
3. Specify browser/OS versions
4. Test changes thoroughly before submitting

## License

MIT License

## Credits

Built with:
- [Pi Coding Agent](https://github.com/mariozechner/pi) - AI agent harness
- [Express.js](https://expressjs.com/)
- [better-sqlite3](https://github.com/WiseLibs/better-sqlite3)
- Retro neon aesthetic inspired by 80s arcade culture

---

**Cleon UI** - A lightweight, beautiful interface for Claude Code
