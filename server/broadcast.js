/**
 * Broadcast module - handles message buffering for SSE replay
 * The event bus (server/bus.js) handles actual delivery to SSE clients
 */

// Message replay buffer for late-joining subscribers
// Map of sessionId -> Array of stringified messages
const sessionMessageBuffers = new Map();
// Map of sessionId -> number (current byte size of buffer)
const sessionBufferBytes = new Map();

const MAX_BUFFER_SIZE = 1000;
const MAX_BUFFER_BYTES = 5 * 1024 * 1024; // 5MB

/**
 * Buffer a message for a session (for SSE replay to late-joining clients)
 * The event bus handles actual delivery to SSE clients
 * @param {string} sessionId - The session ID
 * @param {object} message - The message object to buffer
 */
export function broadcastToSession(sessionId, message) {
  const messageStr = JSON.stringify(message);

  // Capture message into replay buffer if active for this session
  const buffer = sessionMessageBuffers.get(sessionId);
  if (!buffer) return;

  const currentBytes = sessionBufferBytes.get(sessionId) || 0;
  if (buffer.length < MAX_BUFFER_SIZE && currentBytes + messageStr.length <= MAX_BUFFER_BYTES) {
    buffer.push(messageStr);
    sessionBufferBytes.set(sessionId, currentBytes + messageStr.length);
  } else if (!buffer.overflowed) {
    buffer.overflowed = true;
    console.log(`[Broadcast] Buffer overflow for session ${sessionId} (${buffer.length} messages, ${currentBytes} bytes) - stopped buffering`);
  }
}

/**
 * Start buffering messages for a session
 * Called when a session begins so late-joining subscribers can catch up
 * @param {string} sessionId - The session ID to buffer
 */
export function startSessionBuffer(sessionId) {
  sessionMessageBuffers.set(sessionId, []);
  sessionBufferBytes.set(sessionId, 0);
  console.log(`[Broadcast] Started message buffer for session ${sessionId}`);
}

/**
 * Replay buffered messages to a late-joining client
 * @param {string} sessionId - The session ID to replay
 * @param {WebSocket} ws - The WebSocket connection to replay to
 */
export function replayBufferToClient(sessionId, ws) {
  const buffer = sessionMessageBuffers.get(sessionId);
  if (!buffer || buffer.length === 0) {
    return;
  }

  if (ws.readyState !== 1) {
    return;
  }

  ws.send(JSON.stringify({ type: 'replay-start', sessionId }));

  for (const messageStr of buffer) {
    if (ws.readyState === 1) {
      ws.send(messageStr);
    }
  }

  ws.send(JSON.stringify({ type: 'replay-end', sessionId }));
  console.log(`[Broadcast] Replayed ${buffer.length} buffered messages to client for session ${sessionId}`);
}

/**
 * Replay buffered messages to an SSE client (Express response)
 * @param {string} sessionId - The session ID to replay
 * @param {object} res - Express response object (SSE stream)
 */
export function replayBufferToSSE(sessionId, res) {
  const buffer = sessionMessageBuffers.get(sessionId);
  if (!buffer || buffer.length === 0) return;

  res.write(`data: ${JSON.stringify({ type: 'replay-start', sessionId })}\n\n`);
  for (const messageStr of buffer) {
    res.write(`data: ${messageStr}\n\n`);
  }
  res.write(`data: ${JSON.stringify({ type: 'replay-end', sessionId })}\n\n`);
  console.log(`[Broadcast] Replayed ${buffer.length} buffered messages via SSE for session ${sessionId}`);
}

/**
 * Replay buffered messages via a callback function (for publishing through event bus)
 * @param {string} sessionId - The session ID to replay
 * @param {Function} callback - Function called with each message object: (message) => void
 * @returns {number} Number of messages replayed, or 0 if no buffer
 */
export function replayBufferToCallback(sessionId, callback) {
  const buffer = sessionMessageBuffers.get(sessionId);
  if (!buffer || buffer.length === 0) return 0;

  callback({ type: 'replay-start', sessionId });
  for (const messageStr of buffer) {
    try {
      callback(JSON.parse(messageStr));
    } catch { /* skip unparseable */ }
  }
  callback({ type: 'replay-end', sessionId });
  console.log(`[Broadcast] Replayed ${buffer.length} buffered messages via callback for session ${sessionId}`);
  return buffer.length;
}

/**
 * Check if a session has an active message buffer (i.e., is being buffered because it's streaming)
 * @param {string} sessionId - The session ID to check
 * @returns {boolean} True if there's an active buffer for this session
 */
export function hasActiveBuffer(sessionId) {
  return sessionMessageBuffers.has(sessionId);
}

/**
 * Clear the message buffer for a session
 * @param {string} sessionId - The session ID to clear buffer for
 */
export function clearSessionBuffer(sessionId) {
  const buffer = sessionMessageBuffers.get(sessionId);
  if (buffer) {
    console.log(`[Broadcast] Cleared buffer for session ${sessionId} (${buffer.length} messages)`);
  }
  sessionMessageBuffers.delete(sessionId);
  sessionBufferBytes.delete(sessionId);
}


