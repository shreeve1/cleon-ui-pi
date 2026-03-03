/**
 * Static code analysis tests for SSE Event Bus architecture
 * Verifies code structure without requiring runtime imports of heavy dependencies
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const piAgentJs = readFileSync(resolve('server/pi-agent.js'), 'utf8');
const indexJs = readFileSync(resolve('server/index.js'), 'utf8');
const appJs = readFileSync(resolve('public/app.js'), 'utf8');

// ─── server/pi-agent.js code analysis ──────────────────────────────
describe('server/pi-agent.js - code structure', () => {
  describe('exports', () => {
    it('should export handleChat function', () => {
      expect(piAgentJs).toMatch(/export async function handleChat\(/);
    });

    it('should export handleAbort function', () => {
      expect(piAgentJs).toMatch(/export async function handleAbort\(/);
    });

    it('should export handleQuestionResponse function', () => {
      expect(piAgentJs).toMatch(/export async function handleQuestionResponse\(/);
    });

    it('should export handlePlanResponse function', () => {
      expect(piAgentJs).toMatch(/export async function handlePlanResponse\(/);
    });

    it('should export isSessionActive function', () => {
      expect(piAgentJs).toMatch(/export function isSessionActive\(/);
    });

    it('should export resubscribeSession function', () => {
      expect(piAgentJs).toMatch(/export function resubscribeSession\(/);
    });
  });

  describe('Pi binary configuration', () => {
    it('should use PI_BINARY env var with default "pi"', () => {
      expect(piAgentJs).toMatch(/PI_BINARY.*process\.env\.PI_BINARY.*||.*['"]pi['"]/);
    });
  });

  describe('RpcClient spawn args', () => {
    it('should include --mode rpc flag', () => {
      expect(piAgentJs).toContain("'--mode'");
      expect(piAgentJs).toContain("'rpc'");
    });

    it('should support --session flag for session restoration', () => {
      expect(piAgentJs).toContain("'--session'");
    });
  });

  describe('bus and registry integration', () => {
    it('should import publish from bus.js', () => {
      expect(piAgentJs).toMatch(/import\s*\{[^}]*publish[^}]*\}\s*from\s*'\.\/bus\.js'/);
    });

    it('should import register and setStatus from session-registry.js', () => {
      expect(piAgentJs).toMatch(/import\s*\{[^}]*register[^}]*setStatus[^}]*\}\s*from\s*'\.\/session-registry\.js'/);
    });

    it('handleChat should accept username parameter', () => {
      expect(piAgentJs).toMatch(/export async function handleChat\(msg,\s*ws,\s*username\)/);
    });
  });

  describe('transformEvent handles Pi events', () => {
    it('should handle message_update events', () => {
      expect(piAgentJs).toMatch(/case\s*'message_update'/);
    });

    it('should handle tool_execution_start events', () => {
      expect(piAgentJs).toMatch(/case\s*'tool_execution_start'/);
    });

    it('should handle tool_execution_end events', () => {
      expect(piAgentJs).toMatch(/case\s*'tool_execution_end'/);
    });

    it('should handle extension_ui_request events', () => {
      expect(piAgentJs).toMatch(/case\s*'extension_ui_request'/);
    });

    it('should handle turn_end events', () => {
      expect(piAgentJs).toMatch(/case\s*'turn_end'/);
    });

    it('should handle agent_end events', () => {
      expect(piAgentJs).toMatch(/case\s*'agent_end'/);
    });

    it('should handle auto_compaction_start events (Pi-specific)', () => {
      expect(piAgentJs).toMatch(/case\s*'auto_compaction_start'/);
    });

    it('should handle auto_compaction_end events (Pi-specific)', () => {
      expect(piAgentJs).toMatch(/case\s*'auto_compaction_end'/);
    });

    it('should handle auto_retry_start events (Pi-specific)', () => {
      expect(piAgentJs).toMatch(/case\s*'auto_retry_start'/);
    });

    it('should handle auto_retry_end events (Pi-specific)', () => {
      expect(piAgentJs).toMatch(/case\s*'auto_retry_end'/);
    });
  });
});

// ─── server/index.js code analysis ───────────────────────────────
describe('server/index.js - code structure', () => {
  describe('imports', () => {
  it('should import handleChat, handleAbort, handleQuestionResponse, handlePlanResponse from pi-agent.js', () => {
    expect(indexJs).toMatch(/import\s*\{[^}]*handleChat[^}]*handleAbort[^}]*handleQuestionResponse[^}]*handlePlanResponse[^}]*\}\s*from\s*'\.\/pi-agent\.js'/);
  });
  it('should NOT import isSessionActive or resubscribeSession from pi-agent.js', () => {
    const piImport = indexJs.match(/import\s*\{[^}]*\}\s*from\s*'\.\/pi-agent\.js'/);
    expect(piImport).toBeTruthy();
    expect(piImport[0]).not.toContain('isSessionActive');
    expect(piImport[0]).not.toContain('resubscribeSession');
  });

    it('should import subscribe and publish from bus.js', () => {
      expect(indexJs).toMatch(/import\s*\{[^}]*subscribe[^}]*publish[^}]*\}\s*from\s*'\.\/bus\.js'/);
    });

    it('should import getSessionsForUser from session-registry.js', () => {
      expect(indexJs).toMatch(/import\s*\{[^}]*getSessionsForUser[^}]*\}\s*from\s*'\.\/session-registry\.js'/);
    });

    it('should import replayBufferToSSE from broadcast.js', () => {
      expect(indexJs).toMatch(/import\s*\{[^}]*replayBufferToSSE[^}]*\}\s*from\s*'\.\/broadcast\.js'/);
    });
  });

  describe('SSE endpoint', () => {
    it('should have GET /api/events endpoint', () => {
      expect(indexJs).toContain("app.get('/api/events'");
    });

    it('should send state-snapshot on SSE connect', () => {
      const sseStart = indexJs.indexOf("app.get('/api/events'");
      const sseEnd = indexJs.indexOf('\n});', sseStart);
      const sseBody = indexJs.slice(sseStart, sseEnd);

      expect(sseBody).toContain("type: 'state-snapshot'");
      expect(sseBody).toContain('getSessionsForUser');
    });

    it('should subscribe to bus for event delivery', () => {
      const sseStart = indexJs.indexOf("app.get('/api/events'");
      const sseEnd = indexJs.indexOf('\n});', sseStart);
      const sseBody = indexJs.slice(sseStart, sseEnd);

      expect(sseBody).toContain('subscribe(user.username');
    });
  });

  describe('WS handler uses publish for responses', () => {
    it('should NOT have check-active or subscribe cases', () => {
      expect(indexJs).not.toMatch(/case\s*'check-active'/);
      expect(indexJs).not.toMatch(/case\s*'subscribe'/);
    });

    it('abort uses publish(user.username, ...)', () => {
      const abortStart = indexJs.indexOf("case 'abort'");
      const abortEnd = indexJs.indexOf('break;', abortStart);
      const abortBody = indexJs.slice(abortStart, abortEnd);

      expect(abortBody).toContain('publish(user.username');
    });

    it('question-response uses publish(user.username, ...)', () => {
      const qrStart = indexJs.indexOf("case 'question-response'");
      const qrEnd = indexJs.indexOf('break;', qrStart);
      const qrBody = indexJs.slice(qrStart, qrEnd);

      expect(qrBody).toContain('publish(user.username');
    });

    it('plan-response uses publish(user.username, ...)', () => {
      const prStart = indexJs.indexOf("case 'plan-response'");
      const prEnd = indexJs.indexOf('break;', prStart);
      const prBody = indexJs.slice(prStart, prEnd);

      expect(prBody).toContain('publish(user.username');
    });
  });
});

// ─── public/app.js code analysis ─────────────────────────────────
describe('public/app.js - code structure', () => {
  describe('SSE client connection', () => {
    it('should define connectEventStream function', () => {
      expect(appJs).toMatch(/function connectEventStream\(\)/);
    });

    it('should define handleServerEvent function', () => {
      expect(appJs).toMatch(/function handleServerEvent\(event\)/);
    });

    it('connectEventStream should use EventSource API', () => {
      const fnStart = appJs.indexOf('function connectEventStream()');
      const fnEnd = appJs.indexOf('\n}', fnStart + 200);
      const fnBody = appJs.slice(fnStart, fnEnd);

      expect(fnBody).toContain('new EventSource(');
      expect(fnBody).toContain('/api/events');
    });
  });

  describe('handleServerEvent handles SSE event types', () => {
    it('should handle heartbeat events', () => {
      const fnStart = appJs.indexOf('function handleServerEvent(event)');
      const fnEnd = appJs.indexOf('\n}', fnStart);
      const fnBody = appJs.slice(fnStart, fnEnd);

      expect(fnBody).toContain("event.type === 'heartbeat'");
    });

    it('should handle state-snapshot events', () => {
      const fnStart = appJs.indexOf('function handleServerEvent(event)');
      const fnEnd = appJs.indexOf('\n}', fnStart);
      const fnBody = appJs.slice(fnStart, fnEnd);

      expect(fnBody).toContain("event.type === 'state-snapshot'");
    });

    it('should handle session-status events', () => {
      const fnStart = appJs.indexOf('function handleServerEvent(event)');
      const fnEnd = appJs.indexOf('\n}', fnStart);
      const fnBody = appJs.slice(fnStart, fnEnd);

      expect(fnBody).toContain("event.type === 'session-status'");
    });

    it('should delegate non-SSE events to handleWsMessage', () => {
      const fnStart = appJs.indexOf('function handleServerEvent(event)');
      const fnEnd = appJs.indexOf('\n}', fnStart);
      const fnBody = appJs.slice(fnStart, fnEnd);

      expect(fnBody).toContain('handleWsMessage(event)');
    });
  });

  describe('old WS subscription patterns removed', () => {
    it('should NOT have sessionsRestored in state', () => {
      expect(appJs).not.toMatch(/sessionsRestored:\s*false/);
    });

    it('should NOT define checkAndReconnectActiveSessions', () => {
      expect(appJs).not.toContain('function checkAndReconnectActiveSessions');
    });

    it('should NOT have session-active case in handleWsMessage', () => {
      expect(appJs).not.toMatch(/case\s*'session-active'/);
    });

    it('should NOT have subscribe-result case in handleWsMessage', () => {
      expect(appJs).not.toMatch(/case\s*'subscribe-result'/);
    });
  });

  describe('showMain connects both WS and SSE', () => {
    it('showMain should call connectWebSocket', () => {
      const fnStart = appJs.indexOf('function showMain()');
      const fnEnd = appJs.indexOf('\n}', fnStart);
      const fnBody = appJs.slice(fnStart, fnEnd);

      expect(fnBody).toContain('connectWebSocket()');
    });

    it('showMain should call connectEventStream', () => {
      const fnStart = appJs.indexOf('function showMain()');
      const fnEnd = appJs.indexOf('\n}', fnStart);
      const fnBody = appJs.slice(fnStart, fnEnd);

      expect(fnBody).toContain('connectEventStream()');
    });
  });

  describe('WS is command-only', () => {
    it('connectWebSocket should not set onmessage handler', () => {
      const fnStart = appJs.indexOf('function connectWebSocket()');
      const fnEnd = appJs.indexOf('\n}', fnStart);
      const fnBody = appJs.slice(fnStart, fnEnd);

      expect(fnBody).not.toContain('onmessage');
    });
  });
});
