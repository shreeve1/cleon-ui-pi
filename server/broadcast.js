/**
 * Broadcast module - handles message buffering for SSE replay
 * The event bus (server/bus.js) handles actual delivery to SSE clients
 */

// Message replay buffer for late-joining subscribers
// Map of sessionId -> Array of stringified messages
const sessionMessageBuffers = new Map();
// Map of sessionId -> number (current byte size of buffer)
const sessionBufferBytes = new Map();
// Map of sessionId -> number (count of overflow events for metrics)
const sessionOverflowCounts = new Map();

const MAX_BUFFER_SIZE = 1000;
const MAX_BUFFER_BYTES = 5 * 1024 * 1024; // 5MB
const SLIDING_WINDOW_SIZE = 500; // Keep last N messages on overflow

/**
 * Buffer a message for a session (for SSE replay to late-joining clients)
 * The event bus handles actual delivery to SSE clients
 * @param {string} sessionId - The session ID
 * @param {object} message - The message object to buffer
 * @returns {boolean} True if message was buffered, false if dropped due to overflow
 */
export function broadcastToSession(sessionId, message) {
  const messageStr = JSON.stringify(message);

  // Capture message into replay buffer if active for this session
  const buffer = sessionMessageBuffers.get(sessionId);
  if (!buffer) return false;

  const currentBytes = sessionBufferBytes.get(sessionId) || 0;
  
  // Check if we can add the message normally
  if (buffer.length < MAX_BUFFER_SIZE && currentBytes + messageStr.length <= MAX_BUFFER_BYTES) {
    buffer.push(messageStr);
    sessionBufferBytes.set(sessionId, currentBytes + messageStr.length);
    return true;
  }
  
  // Buffer is full - implement sliding window recovery (Task 4.2)
  // Drop oldest messages to make room for new ones
  const messagesToDrop = Math.max(1, Math.floor(SLIDING_WINDOW_SIZE / 2));
  const droppedMessages = buffer.splice(0, messagesToDrop);
  
  // Recalculate bytes after dropping
  let newBytes = 0;
  for (const msg of buffer) {
    newBytes += msg.length;
  }
  
  // Add the new message
  buffer.push(messageStr);
  newBytes += messageStr.length;
  sessionBufferBytes.set(sessionId, newBytes);
  
  // Track overflow count for metrics (Task 4.3)
  const overflowCount = (sessionOverflowCounts.get(sessionId) || 0) + 1;
  sessionOverflowCounts.set(sessionId, overflowCount);
  
  // Log overflow event with metrics (Task 4.3)
  console.log(`[Broadcast] Buffer overflow for session ${sessionId}: dropped ${messagesToDrop} messages, kept ${buffer.length}/${MAX_BUFFER_SIZE} messages (${newBytes} bytes), total overflows: ${overflowCount}`);
  
  // Emit buffer overflow event for frontend notification (Task 4.1)
  const droppedCount = droppedMessages.length;
  console.log(`[Broadcast] BUFFER_OVERFLOW event for session ${sessionId}: ${droppedCount} messages dropped`);
  
  // Note: Frontend can listen for BUFFER_OVERFLOW type messages if sent via event bus
  // The event bus will handle broadcasting this to connected clients
  
  return true;
}

/**
 * Start buffering messages for a session
 * Called when a session begins so late-joining subscribers can catch up
 * @param {string} sessionId - The session ID to buffer
 */
export function startSessionBuffer(sessionId) {
  sessionMessageBuffers.set(sessionId, []);
  sessionBufferBytes.set(sessionId, 0);
  sessionOverflowCounts.set(sessionId, 0);
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
  const overflowCount = sessionOverflowCounts.get(sessionId) || 0;
  if (buffer) {
    console.log(`[Broadcast] Cleared buffer for session ${sessionId} (${buffer.length} messages, ${overflowCount} overflows recorded)`);
  }
  sessionMessageBuffers.delete(sessionId);
  sessionBufferBytes.delete(sessionId);
  sessionOverflowCounts.delete(sessionId);
}

/**
 * Get buffer statistics for a session (for debugging/monitoring)
 * @param {string} sessionId - The session ID to get stats for
 * @returns {object|null} Stats object with buffer info, or null if no buffer
 */
export function getBufferStats(sessionId) {
  const buffer = sessionMessageBuffers.get(sessionId);
  if (!buffer) return null;
  
  return {
    messageCount: buffer.length,
    maxMessages: MAX_BUFFER_SIZE,
    byteSize: sessionBufferBytes.get(sessionId) || 0,
    maxBytes: MAX_BUFFER_BYTES,
    overflowCount: sessionOverflowCounts.get(sessionId) || 0,
    slidingWindowSize: SLIDING_WINDOW_SIZE
  };
}


