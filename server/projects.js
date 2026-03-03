import express from 'express';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { glob } from 'glob';

const router = express.Router();
const CLAUDE_PROJECTS = path.join(os.homedir(), '.claude', 'projects');
const PI_SESSIONS = path.join(os.homedir(), '.pi', 'agent', 'sessions');

// Constants
const MAX_PROJECTS = 30;
const MAX_SESSIONS = 30;
const MAX_FILE_RESULTS = 20;
const SESSION_PREVIEW_LENGTH = 120;
const FILE_SEARCH_LIMIT = 50;

// ─── Pi session dir name encoding/decoding ──────────────────────────

/**
 * Encode a project path to Pi's session directory name format.
 * e.g. /Users/james/1-testytech/homelab → --Users-james-1-testytech-homelab--
 */
function encodePiDirName(projectPath) {
  return '--' + projectPath.slice(1).replace(/\//g, '-') + '--';
}

/**
 * Decode a Pi session directory name back to a project path.
 * e.g. --Users-james-1-testytech-homelab-- → /Users/james/1-testytech/homelab
 *
 * Note: This is lossy for paths with actual dashes — same limitation as Claude's encoding.
 */
function decodePiDirName(dirName) {
  return '/' + dirName.slice(2, -2).replace(/-/g, '/');
}

/**
 * GET /api/projects/search?q=/path/to/project
 * Search projects by path substring
 */
router.get('/search', async (req, res) => {
  const query = (req.query.q || '').toLowerCase().trim();

  try {
    // Collect projects from both sources, keyed by project path
    const projectMap = new Map(); // path → { name, path, displayName, claudeCount, piCount, source }

    // ── Read from Claude projects directory ──
    try {
      const entries = await fs.readdir(CLAUDE_PROJECTS, { withFileTypes: true });

      for (const entry of entries) {
        if (!entry.isDirectory()) continue;

        const projectDir = path.join(CLAUDE_PROJECTS, entry.name);
        const actualPath = await extractProjectPath(projectDir, entry.name);

        if (query && !actualPath.toLowerCase().includes(query)) continue;

        const files = await fs.readdir(projectDir);
        const sessions = files.filter(f => f.endsWith('.jsonl') && !f.startsWith('agent-'));

        projectMap.set(actualPath, {
          name: entry.name,
          path: actualPath,
          displayName: path.basename(actualPath),
          claudeCount: sessions.length,
          piCount: 0,
          source: 'claude',
        });
      }
    } catch (err) {
      if (err.code !== 'ENOENT') {
        console.error('[Projects] Error reading Claude projects:', err);
      }
    }

    // ── Read from Pi sessions directory ──
    try {
      const entries = await fs.readdir(PI_SESSIONS, { withFileTypes: true });

      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        // Pi dir names look like --Users-james-1-testytech-homelab--
        if (!entry.name.startsWith('--') || !entry.name.endsWith('--')) continue;

        const piDir = path.join(PI_SESSIONS, entry.name);
        const actualPath = await extractPiProjectPath(piDir, entry.name);

        if (query && !actualPath.toLowerCase().includes(query)) continue;

        let piFiles;
        try {
          piFiles = await fs.readdir(piDir);
        } catch { continue; }
        const piSessions = piFiles.filter(f => f.endsWith('.jsonl'));

        const existing = projectMap.get(actualPath);
        if (existing) {
          // Merge: project exists in both Claude and Pi
          existing.piCount = piSessions.length;
          existing.source = 'both';
        } else {
          projectMap.set(actualPath, {
            name: entry.name,
            path: actualPath,
            displayName: path.basename(actualPath),
            claudeCount: 0,
            piCount: piSessions.length,
            source: 'pi',
          });
        }
      }
    } catch (err) {
      if (err.code !== 'ENOENT') {
        console.error('[Projects] Error reading Pi sessions:', err);
      }
    }

    // Build response
    const projects = [];
    for (const proj of projectMap.values()) {
      projects.push({
        name: proj.name,
        path: proj.path,
        displayName: proj.displayName,
        sessionCount: proj.claudeCount + proj.piCount,
        source: proj.source,
      });
    }

    // Sort by path
    projects.sort((a, b) => a.path.localeCompare(b.path));

    res.json(projects.slice(0, MAX_PROJECTS));

  } catch (err) {
    console.error('[Projects] Search error:', err);
    res.status(500).json({ error: 'Failed to search projects' });
  }
});

/**
 * GET /api/projects/:name/sessions?source=auto
 * List sessions for a project, sorted by most recent.
 * source: 'claude' | 'pi' | 'auto' (default: auto — checks both)
 */
router.get('/:name/sessions', async (req, res) => {
  const projectName = req.params.name;
  const source = req.query.source || 'auto';

  try {
    const sessions = [];

    // ── Claude sessions ──
    if (source === 'claude' || source === 'auto') {
      const claudeDir = path.join(CLAUDE_PROJECTS, projectName);
      try {
        const files = await fs.readdir(claudeDir);
        const jsonlFiles = files.filter(f => f.endsWith('.jsonl') && !f.startsWith('agent-'));

        const claudeSessions = await Promise.all(jsonlFiles.map(async (file) => {
          const filePath = path.join(claudeDir, file);
          const stats = await fs.stat(filePath);
          const preview = await getSessionPreview(filePath, 'claude');
          const sessionId = path.basename(file, '.jsonl');

          return {
            id: sessionId,
            file,
            lastModified: stats.mtime.toISOString(),
            preview,
            source: 'claude',
          };
        }));

        sessions.push(...claudeSessions);
      } catch (err) {
        if (err.code !== 'ENOENT') {
          console.error('[Projects] Error reading Claude sessions:', err);
        }
      }
    }

    // ── Pi sessions ──
    if (source === 'pi' || source === 'auto') {
      // Determine Pi dir name: if the project name already looks like a Pi dir, use it directly.
      // Otherwise, we need to find the Pi dir that matches this project.
      const piDirName = await resolvePiDirName(projectName);
      if (piDirName) {
        const piDir = path.join(PI_SESSIONS, piDirName);
        try {
          const files = await fs.readdir(piDir);
          const jsonlFiles = files.filter(f => f.endsWith('.jsonl'));

          const piSessions = await Promise.all(jsonlFiles.map(async (file) => {
            const filePath = path.join(piDir, file);
            const stats = await fs.stat(filePath);
            const preview = await getSessionPreview(filePath, 'pi');

            // Extract UUID from filename: 2026-03-03T00-24-17-226Z_e824d2d4-297b-4b26-86ba-4d927e7a376b.jsonl
            const basename = path.basename(file, '.jsonl');
            const uuidMatch = basename.match(/_([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/);
            const sessionId = uuidMatch ? uuidMatch[1] : basename;

            return {
              id: sessionId,
              file,
              lastModified: stats.mtime.toISOString(),
              preview,
              source: 'pi',
            };
          }));

          sessions.push(...piSessions);
        } catch (err) {
          if (err.code !== 'ENOENT') {
            console.error('[Projects] Error reading Pi sessions:', err);
          }
        }
      }
    }

    // Sort by most recent first
    sessions.sort((a, b) => new Date(b.lastModified) - new Date(a.lastModified));

    res.json(sessions.slice(0, MAX_SESSIONS));

  } catch (err) {
    console.error('[Projects] Sessions error:', err);
    res.status(500).json({ error: 'Failed to load sessions' });
  }
});

/**
 * GET /api/projects/:name/sessions/:sessionId/messages
 * Get messages for a specific session
 */
router.get('/:name/sessions/:sessionId/messages', async (req, res) => {
  const { name, sessionId } = req.params;
  const limit = parseInt(req.query.limit) || 100;
  const source = req.query.source || 'auto';
  
  try {
    const messages = await getSessionMessages(name, sessionId, limit, source);
    res.json({ messages });
  } catch (err) {
    console.error('[Projects] Messages error:', err);
    res.status(500).json({ error: 'Failed to load messages' });
  }
});

/**
 * GET /api/projects/:name/path
 * Get the actual filesystem path for a project
 */
router.get('/:name/path', async (req, res) => {
  const projectName = req.params.name;

  // Try Claude directory first
  const claudeDir = path.join(CLAUDE_PROJECTS, projectName);
  try {
    const actualPath = await extractProjectPath(claudeDir, projectName);
    return res.json({ path: actualPath });
  } catch { /* fall through */ }

  // Try Pi directory
  if (projectName.startsWith('--') && projectName.endsWith('--')) {
    const piDir = path.join(PI_SESSIONS, projectName);
    try {
      const actualPath = await extractPiProjectPath(piDir, projectName);
      return res.json({ path: actualPath });
    } catch { /* fall through */ }
  }

  // Fallback to decoded name
  res.json({ path: decodeProjectName(projectName) });
});

// ─── Helpers: Project path extraction ───────────────────────────────

/**
 * Extract actual project path from Claude session files (cwd field).
 * Falls back to decoding the directory name.
 */
async function extractProjectPath(projectDir, projectName) {
  try {
    const files = await fs.readdir(projectDir);
    const jsonlFiles = files.filter(f => f.endsWith('.jsonl') && !f.startsWith('agent-'));

    for (const jsonlFile of jsonlFiles) {
      try {
        const content = await fs.readFile(path.join(projectDir, jsonlFile), 'utf8');
        const lines = content.split('\n').filter(Boolean);

        for (const line of lines.slice(0, 30)) {
          try {
            const entry = JSON.parse(line);
            if (entry.cwd) {
              return entry.cwd;
            }
          } catch { /* skip malformed */ }
        }
      } catch { /* skip unreadable files */ }
    }

    return decodeProjectName(projectName);

  } catch {
    return decodeProjectName(projectName);
  }
}

/**
 * Extract actual project path from Pi session files.
 * Pi session header has { type: "session", cwd: "/path/to/project" }.
 * Falls back to decoding the directory name.
 */
async function extractPiProjectPath(piDir, dirName) {
  try {
    const files = await fs.readdir(piDir);
    const jsonlFiles = files.filter(f => f.endsWith('.jsonl'));

    for (const jsonlFile of jsonlFiles) {
      try {
        const content = await fs.readFile(path.join(piDir, jsonlFile), 'utf8');
        // Only need the first line (session header)
        const firstLine = content.split('\n')[0];
        if (!firstLine) continue;

        const entry = JSON.parse(firstLine);
        if (entry.type === 'session' && entry.cwd) {
          return entry.cwd;
        }
      } catch { /* skip malformed */ }
    }

    return decodePiDirName(dirName);

  } catch {
    return decodePiDirName(dirName);
  }
}

/**
 * Decode Claude project name back to path.
 * Note: This is lossy for paths with actual dashes.
 */
function decodeProjectName(name) {
  if (name.startsWith('-')) {
    return '/' + name.slice(1).replace(/-/g, '/');
  }
  return name.replace(/-/g, '/');
}

/**
 * Resolve the Pi directory name for a given project name.
 * If the name is already a Pi dir name (--..--), use it directly.
 * Otherwise, try to find a matching Pi dir by decoding the Claude project name
 * to a path and encoding it as a Pi dir name.
 */
async function resolvePiDirName(projectName) {
  // Already a Pi dir name
  if (projectName.startsWith('--') && projectName.endsWith('--')) {
    return projectName;
  }

  // Get the ACTUAL project path from Claude session files (not lossy decode)
  const claudeDir = path.join(CLAUDE_PROJECTS, projectName);
  let actualPath = null;
  try {
    actualPath = await extractProjectPath(claudeDir, projectName);
  } catch { /* ignore */ }

  // If we got a real path, encode it as Pi dir name and check
  if (actualPath) {
    const piDirName = encodePiDirName(actualPath);
    try {
      await fs.access(path.join(PI_SESSIONS, piDirName));
      return piDirName;
    } catch { /* not found, try scanning */ }
  }

  // Also try the lossy decode path (for projects without Claude sessions)
  const decodedPath = decodeProjectName(projectName);
  if (decodedPath !== actualPath) {
    const piDirName = encodePiDirName(decodedPath);
    try {
      await fs.access(path.join(PI_SESSIONS, piDirName));
      return piDirName;
    } catch { /* not found, try scanning */ }
  }

  // Fallback: scan Pi dirs for a cwd match
  const targetPath = actualPath || decodedPath;
  try {
    const entries = await fs.readdir(PI_SESSIONS, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (!entry.name.startsWith('--') || !entry.name.endsWith('--')) continue;

      const piDir = path.join(PI_SESSIONS, entry.name);
      const resolvedPath = await extractPiProjectPath(piDir, entry.name);
      if (resolvedPath === targetPath) {
        return entry.name;
      }
    }
  } catch { /* ignore */ }

  return null;
}

// ─── Helpers: Session preview extraction ────────────────────────────

/**
 * Extract first meaningful user message as session preview.
 * Handles both Claude and Pi JSONL formats.
 */
async function getSessionPreview(filePath, format = 'claude') {
  try {
    const content = await fs.readFile(filePath, 'utf8');
    const lines = content.split('\n').filter(Boolean);

    for (const line of lines.slice(0, 50)) {
      try {
        const entry = JSON.parse(line);

        if (format === 'pi') {
          // Pi format: { type: "message", message: { role: "user", content: [...] } }
          if (entry.type !== 'message') continue;
          if (entry.message?.role !== 'user') continue;

          const text = extractPiTextContent(entry.message.content);
          if (text && !text.startsWith('<') && !text.startsWith('{') && !text.includes('CRITICAL:')) {
            const preview = text.slice(0, SESSION_PREVIEW_LENGTH);
            return preview + (text.length > SESSION_PREVIEW_LENGTH ? '...' : '');
          }
        } else {
          // Claude format: { type: "user", ... } or { message: { role: "user", ... } }
          if (entry.type === 'user' || entry.message?.role === 'user') {
            let text = entry.message?.content || entry.content;

            if (Array.isArray(text)) {
              text = text.find(t => t.type === 'text')?.text || text[0]?.text;
            }

            if (typeof text === 'string' &&
                text.length > 0 &&
                !text.startsWith('<') &&
                !text.startsWith('{') &&
                !text.includes('CRITICAL:')) {
              const preview = text.slice(0, SESSION_PREVIEW_LENGTH);
              return preview + (text.length > SESSION_PREVIEW_LENGTH ? '...' : '');
            }
          }
        }
      } catch { /* skip malformed */ }
    }

    return 'New session';

  } catch {
    return 'New session';
  }
}

/**
 * Extract text from Pi message content.
 * Content can be a string or an array of { type: "text", text: "..." } blocks.
 */
function extractPiTextContent(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    const textBlocks = content.filter(c => c.type === 'text');
    if (textBlocks.length > 0) {
      return textBlocks.map(c => c.text).join('\n');
    }
  }
  return null;
}

// ─── Helpers: Session messages ──────────────────────────────────────

async function getSessionMessages(projectName, sessionId, limit = 100, source = 'auto') {
  let messages = [];

  // ── Try Claude format ──
  if (source === 'claude' || source === 'auto') {
    const claudeMessages = await getClaudeSessionMessages(projectName, sessionId, limit);
    if (claudeMessages.length > 0) {
      messages = claudeMessages;
    }
  }

  // ── Try Pi format ──
  if ((source === 'pi' || source === 'auto') && messages.length === 0) {
    const piMessages = await getPiSessionMessages(projectName, sessionId, limit);
    if (piMessages.length > 0) {
      messages = piMessages;
    }
  }

  messages.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  return messages.slice(-limit);
}

/**
 * Get messages from a Claude session file.
 * Claude entries have a sessionId field to filter by.
 */
async function getClaudeSessionMessages(projectName, sessionId, limit) {
  try {
    const projectDir = path.join(CLAUDE_PROJECTS, projectName);
    const files = await fs.readdir(projectDir);
    const jsonlFiles = files.filter(f => f.endsWith('.jsonl') && !f.startsWith('agent-'));

    const messages = [];

    for (const file of jsonlFiles) {
      const content = await fs.readFile(path.join(projectDir, file), 'utf8');
      const lines = content.split('\n').filter(Boolean);

      for (const line of lines) {
        try {
          const entry = JSON.parse(line);
          if (entry.sessionId !== sessionId) continue;

          const msg = parseClaudeMessageEntry(entry);
          if (msg) messages.push(msg);
        } catch { /* skip malformed */ }
      }
    }

    return messages;
  } catch {
    return [];
  }
}

/**
 * Get messages from a Pi session file.
 * Pi sessions: each .jsonl file IS a session. The session ID is the UUID from the filename
 * or the header's id field. All entries in the file belong to that session.
 */
async function getPiSessionMessages(projectName, sessionId, limit) {
  try {
    const piDirName = await resolvePiDirName(projectName);
    if (!piDirName) return [];

    const piDir = path.join(PI_SESSIONS, piDirName);
    const files = await fs.readdir(piDir);
    const jsonlFiles = files.filter(f => f.endsWith('.jsonl'));

    // Find the file matching this session ID
    let targetFile = null;
    for (const file of jsonlFiles) {
      // Check if UUID in filename matches
      if (file.includes(sessionId)) {
        targetFile = file;
        break;
      }
    }

    // Also check session headers if no filename match
    if (!targetFile) {
      for (const file of jsonlFiles) {
        try {
          const content = await fs.readFile(path.join(piDir, file), 'utf8');
          const firstLine = content.split('\n')[0];
          if (!firstLine) continue;
          const header = JSON.parse(firstLine);
          if (header.type === 'session' && header.id === sessionId) {
            targetFile = file;
            break;
          }
        } catch { /* skip */ }
      }
    }

    if (!targetFile) return [];

    const content = await fs.readFile(path.join(piDir, targetFile), 'utf8');
    const lines = content.split('\n').filter(Boolean);
    const messages = [];

    for (const line of lines) {
      try {
        const entry = JSON.parse(line);
        const msg = parsePiMessageEntry(entry);
        if (msg) messages.push(msg);
      } catch { /* skip malformed */ }
    }

    return messages;
  } catch {
    return [];
  }
}

// ─── Message parsing: Claude format ─────────────────────────────────

function parseClaudeMessageEntry(entry) {
  const timestamp = entry.timestamp || new Date().toISOString();
  const messageId = entry.messageId || entry.id || null;
  const model = entry.model || null;

  if (entry.type === 'user' || entry.message?.role === 'user') {
    let text = entry.message?.content;
    if (Array.isArray(text)) {
      text = text.filter(t => t.type === 'text').map(t => t.text).join('\n');
    }
    if (typeof text === 'string' && text.length > 0 && !text.startsWith('<') && !text.startsWith('{')) {
      return { role: 'user', content: text, timestamp, messageId };
    }
  }

  if (entry.type === 'assistant' || entry.message?.role === 'assistant') {
    const content = entry.message?.content;
    if (Array.isArray(content)) {
      const textParts = content.filter(c => c.type === 'text').map(c => c.text);
      if (textParts.length > 0) {
        return { role: 'assistant', content: textParts.join('\n'), timestamp, messageId, model };
      }

      const toolUse = content.find(c => c.type === 'tool_use');
      if (toolUse) {
        const summary = buildToolSummary(toolUse.name, toolUse.input);
        return {
          role: 'tool',
          tool: toolUse.name,
          input: toolUse.input,
          timestamp,
          messageId,
          model,
          summary
        };
      }
    }
    if (typeof content === 'string') {
      return { role: 'assistant', content, timestamp, messageId, model };
    }
  }

  return null;
}

// ─── Message parsing: Pi format ─────────────────────────────────────

function parsePiMessageEntry(entry) {
  // Only process message-type entries
  if (entry.type !== 'message') return null;

  const timestamp = entry.timestamp || new Date().toISOString();
  const messageId = entry.id || null;
  const message = entry.message;
  if (!message) return null;

  const role = message.role;
  const content = message.content;

  // ── User message ──
  if (role === 'user') {
    const text = extractPiTextContent(content);
    if (text && text.length > 0 && !text.startsWith('<') && !text.startsWith('{')) {
      return { role: 'user', content: text, timestamp, messageId };
    }
    return null;
  }

  // ── Assistant message ──
  if (role === 'assistant') {
    if (Array.isArray(content)) {
      // Extract text parts
      const textParts = content.filter(c => c.type === 'text').map(c => c.text);
      if (textParts.length > 0) {
        const model = message.model || entry.message?.model || null;
        return { role: 'assistant', content: textParts.join('\n'), timestamp, messageId, model };
      }

      // If only tool calls, report the first one
      const toolCall = content.find(c => c.type === 'toolCall');
      if (toolCall) {
        const summary = buildToolSummary(toolCall.name, toolCall.arguments);
        return {
          role: 'tool',
          tool: toolCall.name,
          input: toolCall.arguments,
          timestamp,
          messageId,
          summary,
        };
      }
    }
    if (typeof content === 'string' && content.length > 0) {
      return { role: 'assistant', content, timestamp, messageId };
    }
    return null;
  }

  // ── Tool result ──
  if (role === 'toolResult') {
    const toolName = message.toolName || 'unknown';
    const isError = message.isError === true;
    const resultText = extractPiTextContent(content);

    return {
      role: 'tool_result',
      tool: toolName,
      toolCallId: message.toolCallId || null,
      success: !isError,
      output: resultText ? resultText.slice(0, 1500) : '',
      timestamp,
      messageId,
    };
  }

  return null;
}

// ─── Shared helpers ─────────────────────────────────────────────────

/**
 * Build enhanced tool summary with full command details.
 * Returns object with summary string and full command details.
 */
function buildToolSummary(tool, input) {
  if (!input) return { summary: tool };

  const result = { summary: tool };

  switch (tool) {
    case 'Bash':
      result.summary = `$ ${(input.command || '').slice(0, 80)}`;
      result.fullCommand = input.command || '';
      break;
    case 'Read':
    case 'read':
      result.summary = `Read ${input.file_path || input.path || ''}`;
      result.fullCommand = input.file_path || input.path || '';
      result.filePath = input.file_path || input.path || '';
      break;
    case 'Write':
    case 'write':
      result.summary = `Write ${input.file_path || input.path || ''}`;
      result.fullCommand = input.file_path || input.path || '';
      result.filePath = input.file_path || input.path || '';
      break;
    case 'Edit':
    case 'edit':
      result.summary = `Edit ${input.file_path || input.path || ''}`;
      result.fullCommand = input.file_path || input.path || '';
      result.filePath = input.file_path || input.path || '';
      break;
    case 'Glob':
    case 'glob':
    case 'find':
      result.summary = `Find ${input.pattern || ''}`;
      result.fullCommand = input.pattern || '';
      result.pattern = input.pattern || '';
      break;
    case 'Grep':
    case 'grep':
      result.summary = `Search ${input.pattern || ''}`;
      result.fullCommand = input.pattern || '';
      result.pattern = input.pattern || '';
      result.fullQuery = input.query || '';
      break;
    default:
      result.summary = tool;
  }

  return result;
}

/**
 * GET /api/projects/:name/files/search?q=query
 * Search files within a project using glob patterns
 */
router.get('/:name/files/search', async (req, res) => {
  const { name } = req.params;
  const query = (req.query.q || '').trim();

  try {
    // Get the actual project path — try Claude then Pi
    let actualPath;
    const claudeDir = path.join(CLAUDE_PROJECTS, name);
    try {
      actualPath = await extractProjectPath(claudeDir, name);
    } catch {
      // Try Pi
      if (name.startsWith('--') && name.endsWith('--')) {
        const piDir = path.join(PI_SESSIONS, name);
        actualPath = await extractPiProjectPath(piDir, name);
      } else {
        actualPath = decodeProjectName(name);
      }
    }

    // Check if project path exists and is absolute
    if (!actualPath || !path.isAbsolute(actualPath)) {
      return res.status(400).json({ error: 'Invalid project path' });
    }

    // Resolve and normalize the path to prevent traversal attacks
    const resolvedPath = path.resolve(actualPath);

    // Verify the resolved path doesn't escape to sensitive directories
    const homeDir = os.homedir();
    const sensitivePatterns = ['/etc', '/var', '/usr', '/bin', '/sbin', '/root'];
    if (sensitivePatterns.some(p => resolvedPath.startsWith(p))) {
      return res.status(403).json({ error: 'Access to this path is not allowed' });
    }

    // Check if directory exists
    try {
      const stats = await fs.stat(resolvedPath);
      if (!stats.isDirectory()) {
        return res.status(400).json({ error: 'Project path is not a directory' });
      }
    } catch (err) {
      return res.status(404).json({ error: 'Project directory not found' });
    }

    // Sanitize query to prevent path traversal in search
    const sanitizedQuery = query.replace(/\.\./g, '').replace(/[<>:"|?*]/g, '');

    // Build glob pattern based on query
    let pattern;
    if (sanitizedQuery.includes('/') || sanitizedQuery.includes('\\')) {
      pattern = path.join(resolvedPath, '**', `*${sanitizedQuery}*`);
    } else if (sanitizedQuery) {
      pattern = path.join(resolvedPath, '**', `*${sanitizedQuery}*`);
    } else {
      pattern = path.join(resolvedPath, '**', '*');
    }

    // Execute glob search
    const files = await glob(pattern, {
      cwd: resolvedPath,
      absolute: false,
      nodir: true,
      ignore: [
        '**/node_modules/**',
        '**/.git/**',
        '**/dist/**',
        '**/build/**',
        '**/.claude/**',
        '**/coverage/**',
        '**/*.log',
        '**/.DS_Store'
      ],
      limit: MAX_FILE_RESULTS
    });

    // Verify each file path stays within the project directory
    const safeFiles = files.filter(file => {
      const fullPath = path.resolve(resolvedPath, file);
      return fullPath.startsWith(resolvedPath);
    });

    // Sort by relevance (exact matches first, then alphabetical)
    const lowerQuery = sanitizedQuery.toLowerCase();
    safeFiles.sort((a, b) => {
      const aLower = a.toLowerCase();
      const bLower = b.toLowerCase();
      const aExact = aLower.includes(lowerQuery);
      const bExact = bLower.includes(lowerQuery);

      if (aExact && !bExact) return -1;
      if (!aExact && bExact) return 1;
      return a.localeCompare(b);
    });

    res.json({ files: safeFiles.slice(0, MAX_FILE_RESULTS) });

  } catch (err) {
    console.error('[Projects] File search error:', err);
    res.status(500).json({ error: 'Failed to search files' });
  }
});

export { router as projectRoutes };
