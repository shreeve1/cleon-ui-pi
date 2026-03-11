#!/usr/bin/env node

import 'dotenv/config';
import express from 'express';
import { WebSocketServer } from 'ws';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import multer from 'multer';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';

import { authRoutes, authenticateToken, authenticateWebSocket } from './auth.js';
import { projectRoutes } from './projects.js';
import { fileRoutes } from './files.js';
import { handleChat, handleAbort, handleQuestionResponse, handlePlanResponse, isSessionActive } from './pi-agent.js';
import { getAllCommands } from './commands.js';
import { processUpload, validateFile } from './uploads.js';
import logger from './logger.js';
import { loadModelsConfig } from './models.js';
import { subscribe, publish } from './bus.js';
import { getSessionsForUser, getSession as getRegistrySession, isStreaming as isSessionStreaming, remove as removeSession, setStatus } from './session-registry.js';
import { replayBufferToSSE, replayBufferToCallback, hasActiveBuffer } from './broadcast.js';
import { errorHandler, notFoundHandler } from './errors.js';
import sdkSessionManager from './session-manager-instance.js';
import { attachToCliSession, isWatching, stopAll as stopAllWatchers, checkLastMessageTurnState } from './session-watcher.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Express app
const app = express();
app.set('trust proxy', 1);
const server = http.createServer(app);

// Security middleware
app.use(helmet({
  hsts: false, // Disable HSTS for local network HTTP access
  crossOriginOpenerPolicy: false, // Disable COOP for HTTP (requires HTTPS)
  crossOriginResourcePolicy: false, // Disable CORP for HTTP
  contentSecurityPolicy: {
    directives: {
      styleSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net"],
      scriptSrc: ["'self'", "https://cdn.jsdelivr.net"],
      connectSrc: ["'self'", "ws:", "wss:", "https://cdn.jsdelivr.net"],
      imgSrc: ["'self'", "data:", "blob:", "https://cdn.jsdelivr.net"],
      upgradeInsecureRequests: null // Disable for HTTP local network access
    }
  }
}));

// CORS configuration
const configuredOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',')
  : [];

function isAllowedOrigin(origin) {
  if (!origin) return true; // Same-origin, Postman, mobile apps
  if (configuredOrigins.includes(origin)) return true;
  // Always allow local development
  try {
    const url = new URL(origin);
    const hostname = url.hostname;
    if (hostname === 'localhost' || hostname === '127.0.0.1') return true;
    // Allow local network IPs (192.168.x.x, 10.x.x.x, 172.16-31.x.x)
    if (/^(192\.168\.|10\.|172\.(1[6-9]|2[0-9]|3[01])\.)/.test(hostname)) return true;
  } catch {}
  return false;
}

app.use(cors({
  origin: (origin, callback) => {
    if (isAllowedOrigin(origin)) return callback(null, true);
    callback(new Error('Not allowed by CORS'));
  },
  credentials: true
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: { error: 'Too many requests, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
  validate: { xForwardedForHeader: false }
});
app.use('/api/', limiter);

// Stricter rate limit for auth endpoints
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10, // only 10 login/register attempts per 15 min
  message: { error: 'Too many authentication attempts, please try again later' },
  validate: { xForwardedForHeader: false }
});
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/register', authLimiter);

// Body parsing with size limit
app.use(express.json({ limit: '1mb' }));

// Request logging
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    logger.info(`${req.method} ${req.path}`, {
      status: res.statusCode,
      duration: `${duration}ms`,
      ip: req.ip
    });
  });
  next();
});

// Configure multer for file uploads (memory storage)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB
});

// Static files (frontend)
app.use(express.static(path.join(__dirname, '../public'), {
  etag: false,
  lastModified: false,
  maxAge: 0,
  setHeaders: (res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  }
}));

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/projects', authenticateToken, projectRoutes);
app.use('/api/files', authenticateToken, fileRoutes);

// Health check
const serverStartTime = Date.now();
app.get('/api/health', (req, res) => {
  const uptime = Math.floor((Date.now() - serverStartTime) / 1000);
  res.json({
    status: 'ok',
    uptime,
    timestamp: new Date().toISOString()
  });
});

// Commands API - get global and project slash commands
app.get('/api/commands', authenticateToken, async (req, res) => {
  try {
    const projectPath = req.query.projectPath || null;
    const commands = await getAllCommands(projectPath);
    res.json(commands);
  } catch (err) {
    logger.error('Error fetching commands', { error: err.message, projectPath: req.query.projectPath });
    res.status(500).json({ error: 'Failed to fetch commands' });
  }
});

// Models API - get configured models for dropdown
app.get('/api/models', authenticateToken, async (req, res) => {
  try {
    const config = await loadModelsConfig();
    res.json(config);
  } catch (err) {
    logger.error('Error fetching models config', { error: err.message });
    res.status(500).json({ error: 'Failed to fetch models config' });
  }
});

// File upload API - for PDF text extraction
app.post('/api/upload', authenticateToken, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file provided' });
    }

    validateFile(req.file);
    const result = await processUpload(req.file);

    res.json(result);
  } catch (err) {
    logger.error('File upload error', { error: err.message, filename: req.file?.originalname });
    res.status(400).json({ error: err.message });
  }
});

// Session attach — client calls this when navigating to a session
// to check if it's streaming and get replay data via SSE.
// Also detects CLI pi sessions by watching the session file.
app.post('/api/sessions/:sessionId/attach', authenticateToken, async (req, res) => {
  const { sessionId } = req.params;
  const username = req.user?.username;

  if (!username) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const registrySession = getRegistrySession(sessionId);

  // ── Pre-check: Detect stale 'streaming' status by checking session file ──
  // If registry says 'streaming' but the session file shows the turn is complete,
  // update the registry to 'idle' so the UI is unblocked.
  // Skip this check if the session is actively running (e.g. waiting for ask_user input).
  if (registrySession?.status === 'streaming' && !isSessionActive(sessionId)) {
    const sessionFile = registrySession.piSessionFile || sdkSessionManager.getSessionFile(sessionId);
    
    if (sessionFile) {
      const turnState = await checkLastMessageTurnState(sessionFile);
      
      // If last message is from assistant, timestamp is older than 3 seconds,
      // AND the turn ended normally (not mid-tool-call), treat as stale.
      // stopReason 'toolUse' means the agent is waiting for a tool result — not done!
      const isCompletedTurn = turnState.lastRole === 'assistant' 
        && turnState.stopReason !== 'toolUse'
        && turnState.stopReason !== null;

      if (isCompletedTurn && turnState.timestamp) {
        const timeSinceLastMessage = Date.now() - turnState.timestamp.getTime();
        if (timeSinceLastMessage >= 3000) { // 3 seconds
          // Update registry status to idle
          setStatus(sessionId, 'idle');
          // Publish status change event
          publish(username, { type: 'session-status', sessionId, status: 'idle' });
          // Send done event to unblock UI
          publish(username, { type: 'done', sessionId });
          
          logger.info('Session attach: detected stale streaming status, updated to idle', { 
            sessionId, 
            username, 
            timeSinceLastMessage 
          });
          
          // Re-fetch the updated session
          const updatedSession = getRegistrySession(sessionId);
          return res.json({
            status: 'idle',
            sessionId,
            replayed: 0,
            external: false,
            session: updatedSession || null,
          });
        }
      }
    }
  }

  // ── Case 1: Session is already streaming via RPC or has a buffer ──
  const streaming = isSessionStreaming(sessionId);
  const hasBuffer = hasActiveBuffer(sessionId);

  if (streaming || hasBuffer) {
    const replayed = replayBufferToCallback(sessionId, (event) => {
      publish(username, event);
    });

    // Use actual registry status (may be 'idle' if turn completed) and check if CLI session
    const actualStatus = registrySession?.status || 'streaming';
    const isCliSession = isWatching(sessionId);

    logger.info('Session attach: streaming (RPC)', { sessionId, username, replayed, actualStatus, isCliSession });
    return res.json({
      status: actualStatus,
      sessionId,
      replayed,
      external: isCliSession, // True if CLI file watcher is active
      session: registrySession || null,
    });
  }

  // ── Case 2: Check if this is a CLI pi session (file actively being written) ──
  try {
    const cliResult = await attachToCliSession(sessionId, username);

    if (cliResult.watching) {
      logger.info(`Session attach: ${cliResult.status} (CLI file watcher)`, { sessionId, username });
      return res.json({
        status: cliResult.status,
        sessionId,
        replayed: 0,
        external: true, // Tells client this is an external CLI session
        session: registrySession || null,
      });
    }
  } catch (err) {
    logger.warn('Session attach: CLI detection failed', { sessionId, error: err.message });
  }

  // ── Case 3: Idle ──
  logger.info('Session attach: idle', { sessionId, username });
  res.json({
    status: 'idle',
    sessionId,
    session: registrySession || null,
  });
});

// SSE Event Stream
app.get('/api/events', (req, res) => {
  const token = req.query.token;
  const user = authenticateWebSocket(token);
  if (!user) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  logger.info('SSE connected', { username: user.username });

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no'
  });

  if (res.socket) res.socket.setNoDelay(true);
  res.flushHeaders();
  res.write('retry: 2000\n\n');

  const userSessions = getSessionsForUser(user.username);
  res.write(`data: ${JSON.stringify({ type: 'state-snapshot', sessions: userSessions })}\n\n`);

  for (const s of userSessions.filter(s => s.status === 'streaming')) {
    replayBufferToSSE(s.sessionId, res);
  }

  const unsubscribe = subscribe(user.username, (event) => {
    try {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    } catch (err) {
      logger.error('SSE write error', { username: user.username, error: err.message });
    }
  });

  // Send heartbeats every 10s to keep reverse proxy connections alive
  // (Nginx Proxy Manager and similar proxies close idle SSE connections)
  const heartbeat = setInterval(() => {
    try {
      res.write(`data: ${JSON.stringify({ type: 'heartbeat' })}\n\n`);
    } catch (err) {
      clearInterval(heartbeat);
    }
  }, 10000);

  req.on('close', () => {
    logger.info('SSE disconnected', { username: user.username });
    unsubscribe();
    clearInterval(heartbeat);
  });
});

// SPA fallback - serve index.html for all non-API routes
app.get('*', (req, res) => {
  if (!req.path.startsWith('/api')) {
    res.sendFile(path.join(__dirname, '../public/index.html'));
  } else {
    res.status(404).json({ error: 'Not found' });
  }
});

// Global error handler (must be after all routes)
app.use(errorHandler);
// WebSocket server with origin validation
const wss = new WebSocketServer({
  server,
  verifyClient: (info) => {
    // Validate origin
    const origin = info.origin || info.req.headers.origin;
    if (!isAllowedOrigin(origin)) {
      logger.warn('WebSocket connection rejected: invalid origin', { origin });
      return false;
    }

    // Extract token from query string
    const url = new URL(info.req.url, 'http://localhost');
    const token = url.searchParams.get('token');

    const user = authenticateWebSocket(token);
    if (!user) {
      logger.warn('WebSocket connection rejected: invalid token');
      return false;
    }

    // Attach user to request for later use
    info.req.user = user;
    return true;
  }
});

// WebSocket connection handler
wss.on('connection', (ws, req) => {
  const user = req.user;
  logger.info('WebSocket connected', { username: user.username });

  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', async (data) => {
    try {
      const msg = JSON.parse(data.toString());

      switch (msg.type) {
        case 'chat':
          await handleChat(msg, ws, user.username);
          break;

        case 'abort':
          const success = await handleAbort(msg.sessionId);
          publish(user.username, {
            type: 'abort-result',
            sessionId: msg.sessionId,
            success
          });
          break;

        case 'question-response':
          const responseSuccess = await handleQuestionResponse(
            msg.sessionId,
            msg.toolUseId,
            msg.answers
          );
          publish(user.username, {
            type: 'question-response-result',
            sessionId: msg.sessionId,
            success: responseSuccess
          });
          break;

        case 'plan-response': {
          const planSuccess = await handlePlanResponse(
            msg.sessionId,
            msg.toolUseId,
            msg.approved,
            msg.feedback
          );
          publish(user.username, {
            type: 'plan-response-result',
            sessionId: msg.sessionId,
            success: planSuccess
          });
          break;
        }

        case 'close-session': {
          if (msg.sessionId) {
            removeSession(msg.sessionId);
            // Broadcast to all user's connections so other tabs/devices can update
            publish(user.username, {
              type: 'session-closed',
              sessionId: msg.sessionId
            });
            logger.info('Session closed and removed from registry', { 
              sessionId: msg.sessionId, 
              username: user.username 
            });
          }
          break;
        }

        case 'ping':
          ws.send(JSON.stringify({ type: 'pong' }));
          break;

        default:
          logger.debug('Unknown WebSocket message type', { type: msg.type });
      }

    } catch (err) {
      logger.error('WebSocket message handling error', { error: err.message, username: user.username });
      ws.send(JSON.stringify({
        type: 'error',
        sessionId: msg.sessionId || null,
        message: err.message || 'Internal error'
      }));
    }
  });

  ws.on('close', () => {
    logger.info('WebSocket disconnected', { username: user.username });
  });

  ws.on('error', (err) => {
    logger.error('WebSocket error', { username: user.username, error: err.message });
  });
});

// Heartbeat to detect broken connections
const heartbeatInterval = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) {
      return ws.terminate();
    }
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);

wss.on('close', () => {
  clearInterval(heartbeatInterval);
});

// Start server
const PORT = process.env.PORT || 3010;
const HOST = process.env.HOST || '0.0.0.0';

server.listen(PORT, HOST, () => {
  logger.info('Cleon UI started', {
    local: `http://localhost:${PORT}`,
    network: `http://${HOST}:${PORT}`
  });
});

// Graceful shutdown
async function gracefulShutdown(signal) {
  logger.info(`${signal} received, shutting down gracefully...`);

  const shutdownStartTime = Date.now();

  // 1. Clear heartbeat interval immediately to prevent interference
  clearInterval(heartbeatInterval);

  // 2. Stop CLI session file watchers
  stopAllWatchers();

  // 3. Close all WebSocket connections gracefully (code 1001 = Going Away)
  // Give WebSocket clients 500ms to acknowledge close before terminating
  const wsClosePromise = new Promise((resolve) => {
    const clients = Array.from(wss.clients);
    if (clients.length === 0) {
      resolve();
      return;
    }

    logger.info(`Closing ${clients.length} WebSocket connection(s)...`);
    let closed = 0;

    clients.forEach((ws) => {
      ws.close(1001, 'Server shutting down');
      ws.on('close', () => {
        closed++;
        if (closed >= clients.length) resolve();
      });
      // Terminate any that don't close gracefully within 300ms
      setTimeout(() => {
        if (ws.readyState === ws.OPEN) {
          ws.terminate();
        }
        closed++;
        if (closed >= clients.length) resolve();
      }, 300);
    });
  });

  // Wait for WebSocket close with timeout (max 500ms)
  await Promise.race([
    wsClosePromise,
    new Promise((resolve) => setTimeout(resolve, 500))
  ]);

  // 4. Destroy all SDK sessions (lets Pi flush session files)
  // Timeout: 800ms to stay within PM2's ~1600ms window
  try {
    await Promise.race([
      sdkSessionManager.destroyAll(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('SDK shutdown timed out')), 800)
      ),
    ]);
    logger.info('All SDK sessions stopped');
  } catch (err) {
    logger.warn('SDK shutdown did not complete cleanly', { error: err.message });
  }

  // 5. Close HTTP server
  // Timeout: 300ms for server close
  const serverClosePromise = new Promise((resolve, reject) => {
    server.close((err) => {
      if (err) reject(err);
      else resolve();
    });
  });

  try {
    await Promise.race([
      serverClosePromise,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Server close timed out')), 300)
      ),
    ]);
    logger.info('Server closed');
  } catch (err) {
    logger.warn('Server close did not complete cleanly', { error: err.message });
  }

  // 6. Final cleanup verification and explicit exit
  const shutdownDuration = Date.now() - shutdownStartTime;
  logger.info(`Graceful shutdown completed in ${shutdownDuration}ms`);

  // Explicit process.exit(0) to prevent hanging and ensure PM2 sees clean exit
  process.exit(0);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
