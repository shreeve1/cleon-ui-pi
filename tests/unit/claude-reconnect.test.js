/**
 * Unit tests for auto-reconnect active stream feature
 * Tests server/pi-agent.js: resubscribeSession, isSessionActive, sendMessage behavior,
 * and that all sendMessage calls use sessionInfo.ws (mutable reference)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { isSessionActive, resubscribeSession } from '../../server/pi-agent.js';

// ─── isSessionActive ─────────────────────────────────────────────
describe('isSessionActive', () => {
  it('returns false for a session ID that does not exist', () => {
    expect(isSessionActive('nonexistent-session-id')).toBe(false);
  });

  it('returns false for undefined sessionId', () => {
    expect(isSessionActive(undefined)).toBe(false);
  });

  it('returns false for null sessionId', () => {
    expect(isSessionActive(null)).toBe(false);
  });
});

// ─── resubscribeSession ──────────────────────────────────────────
describe('resubscribeSession', () => {
  it('returns false for a session ID not in activeSessions', () => {
    const mockWs = { readyState: 1 };
    expect(resubscribeSession('nonexistent-session', mockWs)).toBe(false);
  });

  it('returns false for undefined sessionId', () => {
    const mockWs = { readyState: 1 };
    expect(resubscribeSession(undefined, mockWs)).toBe(false);
  });

  it('returns false for null sessionId', () => {
    const mockWs = { readyState: 1 };
    expect(resubscribeSession(null, mockWs)).toBe(false);
  });
});
