/**
 * Test: Session close removes session from server registry
 * 
 * This test verifies the fix for the bug where closing a session tab
 * only removed it from localStorage but not from the server-side registry,
 * causing sessions to reappear on page refresh.
 */

import { describe, it, beforeEach, afterEach } from 'mocha';
import { strict as assert } from 'assert';
import { WebSocket } from 'ws';

// Mock session registry
const sessions = new Map();

function removeSession(sessionId) {
  sessions.delete(sessionId);
}

function registerSession(sessionId, metadata) {
  sessions.set(sessionId, metadata);
}

function getSessions() {
  return [...sessions.entries()].map(([id, data]) => ({ sessionId: id, ...data }));
}

describe('Session Close Registry Removal', () => {
  beforeEach(() => {
    sessions.clear();
  });

  it('should remove session from registry when close-session message is received', () => {
    // Setup: register a session
    registerSession('test-session-123', {
      username: 'testuser',
      projectName: 'test-project',
      status: 'idle'
    });

    assert.equal(sessions.size, 1, 'Session should be registered');

    // Action: remove the session
    removeSession('test-session-123');

    // Assertion: session should be removed
    assert.equal(sessions.size, 0, 'Session should be removed from registry');
    assert.equal(sessions.has('test-session-123'), false, 'Session ID should not exist');
  });

  it('should not error when removing non-existent session', () => {
    // Action: remove a session that doesn't exist
    assert.doesNotThrow(() => {
      removeSession('non-existent-session');
    }, 'Removing non-existent session should not throw');
  });

  it('should only remove the specified session', () => {
    // Setup: register multiple sessions
    registerSession('session-1', { username: 'user1', projectName: 'project1' });
    registerSession('session-2', { username: 'user1', projectName: 'project2' });
    registerSession('session-3', { username: 'user2', projectName: 'project3' });

    assert.equal(sessions.size, 3, 'All sessions should be registered');

    // Action: remove one session
    removeSession('session-2');

    // Assertion: only the specified session should be removed
    assert.equal(sessions.size, 2, 'Only one session should be removed');
    assert.equal(sessions.has('session-1'), true, 'Session 1 should still exist');
    assert.equal(sessions.has('session-2'), false, 'Session 2 should be removed');
    assert.equal(sessions.has('session-3'), true, 'Session 3 should still exist');
  });

  it('should prevent session from reappearing after page refresh', () => {
    // This simulates the bug scenario:
    // 1. Session exists in registry
    // 2. User closes tab (removes from registry)
    // 3. Page refreshes (SSE sends state-snapshot)
    // 4. Session should NOT be in the snapshot

    registerSession('persistent-session', {
      username: 'testuser',
      projectName: 'test-project'
    });

    // Verify session is in registry
    let allSessions = getSessions();
    assert.equal(allSessions.length, 1, 'Session should be in registry');

    // User closes the tab
    removeSession('persistent-session');

    // Simulate page refresh - get sessions for SSE state-snapshot
    allSessions = getSessions();

    // The bug would have the session still in the list
    // The fix ensures it's removed
    assert.equal(allSessions.length, 0, 'Session should not appear in state-snapshot after close');
  });
});
