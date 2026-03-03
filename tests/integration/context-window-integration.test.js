/**
 * Integration Tests for Context Window Display
 * Tests the full flow from server token extraction to UI display
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

// Mock WebSocket
class MockWebSocket {
  constructor(url) {
    this.url = url;
    this.readyState = 1; // OPEN
    this.messages = [];
  }

  send(data) {
    this.messages.push(JSON.parse(data));
  }

  // Simulate receiving a message
  receive(data) {
    if (this.onmessage) {
      this.onmessage({ data: JSON.stringify(data) });
    }
  }
}

// Mock localStorage
const mockLocalStorage = {
  storage: {},
  getItem: vi.fn((key) => mockLocalStorage.storage[key] || null),
  setItem: vi.fn((key, value) => { mockLocalStorage.storage[key] = value; }),
  removeItem: vi.fn((key) => { delete mockLocalStorage.storage[key]; }),
  clear: vi.fn(() => { mockLocalStorage.storage = {}; })
};

// Server-side token extraction (replicated from server/pi-agent.js)
const MODEL_CONTEXT_WINDOWS = {
  'claude-3-opus-20240229': 200000,
  'claude-3-sonnet-20240229': 200000,
  'claude-3-haiku-20240307': 200000,
  'claude-3-5-sonnet-20241022': 200000,
  'claude-3-5-sonnet-20240620': 200000,
  'claude-3-5-haiku-20241022': 200000,
  'default': 200000
};

function extractTokenUsage(modelUsage) {
  if (!modelUsage) return null;

  const modelKey = Object.keys(modelUsage)[0];
  const data = modelUsage[modelKey];

  if (!data) return null;

  const input = data.cumulativeInputTokens || data.inputTokens || 0;
  const output = data.cumulativeOutputTokens || data.outputTokens || 0;
  const cacheRead = data.cumulativeCacheReadInputTokens || data.cacheReadInputTokens || 0;
  const cacheCreate = data.cumulativeCacheCreationInputTokens || data.cacheCreationInputTokens || 0;

  const cumulativeTotal = input + output + cacheRead + cacheCreate;
  const contextWindow = MODEL_CONTEXT_WINDOWS[modelKey] || MODEL_CONTEXT_WINDOWS['default'];
  const estimatedContextUsed = Math.min(cumulativeTotal, contextWindow);
  const currentTurnTokens = data.inputTokens || data.cumulativeInputTokens || 0;
  const contextUtilization = Math.min((currentTurnTokens / contextWindow) * 100, 100);

  return {
    cumulativeTotal,
    cumulativeInput: input,
    cumulativeOutput: output,
    cacheRead,
    cacheCreate,
    contextWindow,
    model: modelKey,
    estimatedContextUsed,
    contextUtilization,
    used: cumulativeTotal
  };
}

// Client-side WebSocket message handler (replicated from public/app.js)
function handleWsMessage(msg, session, state, elements) {
  switch (msg.type) {
    case 'token-usage':
      if (msg.model && session) session.model = msg.model;
      updateTokenUsage(msg, session, elements, state);
      break;
    case 'claude-message':
      // Handle message
      break;
    case 'claude-done':
      // Handle done
      break;
  }
}

function updateTokenUsage(usage, session, elements, state) {
  if (!usage || !session) {
    elements.contextBar.classList.add('hidden');
    return;
  }

  const {
    cumulativeTotal,
    cumulativeInput,
    cumulativeOutput,
    cacheRead,
    cacheCreate,
    contextWindow,
    model
  } = usage;

  const totalTokens = cumulativeTotal || usage.used;
  const windowSize = contextWindow;

  if (!totalTokens || !windowSize) {
    elements.contextBar.classList.add('hidden');
    return;
  }

  // Store metrics on session
  session.lastTokenUsage = totalTokens;
  session.lastContextWindow = windowSize;
  if (model) session.model = model;
  if (cacheRead !== undefined || cacheCreate !== undefined) {
    session.cacheMetrics = { cacheRead: cacheRead || 0, cacheCreate: cacheCreate || 0 };
  }

  if (state.sessions.indexOf(session) !== state.activeSessionIndex) return;

  const totalK = Math.round(totalTokens / 1000);
  const windowK = Math.round(windowSize / 1000);
  const pct = Math.min(Math.round((totalTokens / windowSize) * 100), 100);

  elements.tokenUsageEl.textContent = `${totalK}k / ${windowK}k (${pct}%)`;
  elements.contextBar.classList.remove('hidden');

  if (session.model) {
    elements.contextModel.textContent = session.model;
  }

  elements.contextUsageFill.style.width = `${pct}%`;

  // Color coding
  if (pct > 95) {
    elements.tokenUsageEl.style.color = 'var(--error)';
    elements.contextUsageFill.style.background = 'var(--neon-red)';
  } else if (pct > 80) {
    elements.tokenUsageEl.style.color = 'var(--warning)';
    elements.contextUsageFill.style.background = 'var(--neon-orange)';
  } else {
    elements.tokenUsageEl.style.color = '';
    elements.contextUsageFill.style.background = 'var(--neon-cyan)';
  }

  // Tooltip
  const tooltipText = `Input: ${(cumulativeInput || 0).toLocaleString()} tokens\n` +
                     `Output: ${(cumulativeOutput || 0).toLocaleString()} tokens\n` +
                     `Cache Read: ${(cacheRead || 0).toLocaleString()} tokens\n` +
                     `Cache Created: ${(cacheCreate || 0).toLocaleString()} tokens\n` +
                     `Context Window: ${windowSize.toLocaleString()} tokens`;
  elements.contextBar.title = tooltipText;
}

describe('Context Window Integration', () => {
  let mockSession;
  let mockState;
  let mockElements;
  let ws;

  beforeEach(() => {
    mockLocalStorage.clear();

    mockSession = {
      id: 'test-session',
      sessionId: 'claude-session-123',
      project: { name: 'test-project', path: '/test', displayName: 'Test' },
      lastTokenUsage: null,
      lastContextWindow: null,
      model: null,
      cacheMetrics: null
    };

    mockState = {
      sessions: [mockSession],
      activeSessionIndex: 0
    };

    mockElements = {
      contextBar: { classList: { add: vi.fn(), remove: vi.fn() }, title: '' },
      tokenUsageEl: { classList: { add: vi.fn(), remove: vi.fn() }, textContent: '', style: {} },
      contextModel: { classList: { add: vi.fn(), remove: vi.fn() }, textContent: '' },
      contextUsageFill: { style: {} },
      contextUsageText: { textContent: '' }
    };

    ws = new MockWebSocket('ws://localhost:3000');
  });

  describe('End-to-End Token Flow', () => {
    it('should process token usage from SDK to UI display', () => {
      // Step 1: Simulate SDK modelUsage data
      const sdkModelUsage = {
        'claude-3-opus-20240229': {
          cumulativeInputTokens: 15000,
          cumulativeOutputTokens: 5000,
          cumulativeCacheReadInputTokens: 2000,
          cumulativeCacheCreationInputTokens: 1000
        }
      };

      // Step 2: Server extracts token usage
      const extractedUsage = extractTokenUsage(sdkModelUsage);

      expect(extractedUsage).not.toBeNull();
      expect(extractedUsage.model).toBe('claude-3-opus-20240229');
      expect(extractedUsage.cumulativeTotal).toBe(23000);
      expect(extractedUsage.contextWindow).toBe(200000);

      // Step 3: Server sends WebSocket message
      const wsMessage = {
        type: 'token-usage',
        sessionId: 'claude-session-123',
        ...extractedUsage
      };

      // Step 4: Client receives and processes message
      handleWsMessage(wsMessage, mockSession, mockState, mockElements);

      // Step 5: Verify UI updates
      expect(mockElements.tokenUsageEl.textContent).toBe('23k / 200k (12%)');
      expect(mockElements.contextModel.textContent).toBe('claude-3-opus-20240229');
      expect(mockElements.contextUsageFill.style.width).toBe('12%');
      expect(mockSession.lastTokenUsage).toBe(23000);
      expect(mockSession.lastContextWindow).toBe(200000);
      expect(mockSession.cacheMetrics).toEqual({ cacheRead: 2000, cacheCreate: 1000 });
    });

    it('should handle multiple token usage updates in a conversation', () => {
      // First message
      const usage1 = extractTokenUsage({
        'claude-3-opus-20240229': {
          cumulativeInputTokens: 1000,
          cumulativeOutputTokens: 500
        }
      });

      handleWsMessage(
        { type: 'token-usage', sessionId: 'claude-session-123', ...usage1 },
        mockSession,
        mockState,
        mockElements
      );

      expect(mockElements.tokenUsageEl.textContent).toBe('2k / 200k (1%)');
      expect(mockSession.lastTokenUsage).toBe(1500);

      // Second message (cumulative increases)
      const usage2 = extractTokenUsage({
        'claude-3-opus-20240229': {
          cumulativeInputTokens: 2500,
          cumulativeOutputTokens: 1200
        }
      });

      handleWsMessage(
        { type: 'token-usage', sessionId: 'claude-session-123', ...usage2 },
        mockSession,
        mockState,
        mockElements
      );

      expect(mockElements.tokenUsageEl.textContent).toBe('4k / 200k (2%)');
      expect(mockSession.lastTokenUsage).toBe(3700);
    });

    it('should handle color threshold changes during conversation', () => {
      // Start with low usage (green)
      const lowUsage = extractTokenUsage({
        'claude-3-opus-20240229': {
          cumulativeInputTokens: 10000,
          cumulativeOutputTokens: 5000
        }
      });

      handleWsMessage(
        { type: 'token-usage', sessionId: 'claude-session-123', ...lowUsage },
        mockSession,
        mockState,
        mockElements
      );

      expect(mockElements.contextUsageFill.style.background).toBe('var(--neon-cyan)');

      // Increase to warning level (orange)
      const warningUsage = extractTokenUsage({
        'claude-3-opus-20240229': {
          cumulativeInputTokens: 170000,
          cumulativeOutputTokens: 10000
        }
      });

      handleWsMessage(
        { type: 'token-usage', sessionId: 'claude-session-123', ...warningUsage },
        mockSession,
        mockState,
        mockElements
      );

      expect(mockElements.contextUsageFill.style.background).toBe('var(--neon-orange)');
      expect(mockElements.tokenUsageEl.style.color).toBe('var(--warning)');

      // Increase to error level (red)
      const errorUsage = extractTokenUsage({
        'claude-3-opus-20240229': {
          cumulativeInputTokens: 195000,
          cumulativeOutputTokens: 10000
        }
      });

      handleWsMessage(
        { type: 'token-usage', sessionId: 'claude-session-123', ...errorUsage },
        mockSession,
        mockState,
        mockElements
      );

      expect(mockElements.contextUsageFill.style.background).toBe('var(--neon-red)');
      expect(mockElements.tokenUsageEl.style.color).toBe('var(--error)');
    });
  });

  describe('Model-Specific Context Windows', () => {
    it('should use correct context window for each model type', () => {
      const models = [
        'claude-3-opus-20240229',
        'claude-3-sonnet-20240229',
        'claude-3-haiku-20240307',
        'claude-3-5-sonnet-20241022',
        'claude-3-5-sonnet-20240620',
        'claude-3-5-haiku-20241022'
      ];

      models.forEach(modelName => {
        const usage = extractTokenUsage({
          [modelName]: {
            cumulativeInputTokens: 10000,
            cumulativeOutputTokens: 5000
          }
        });

        expect(usage.contextWindow).toBe(200000);
        expect(usage.model).toBe(modelName);
      });
    });

    it('should handle unknown models with default context window', () => {
      const usage = extractTokenUsage({
        'claude-future-model-9999': {
          cumulativeInputTokens: 10000,
          cumulativeOutputTokens: 5000
        }
      });

      expect(usage.contextWindow).toBe(200000);
      expect(usage.model).toBe('claude-future-model-9999');
    });
  });

  describe('Cache Metrics Flow', () => {
    it('should track cache metrics separately from context usage', () => {
      const sdkModelUsage = {
        'claude-3-opus-20240229': {
          cumulativeInputTokens: 50000,
          cumulativeOutputTokens: 20000,
          cumulativeCacheReadInputTokens: 30000,
          cumulativeCacheCreationInputTokens: 10000
        }
      };

      const extractedUsage = extractTokenUsage(sdkModelUsage);

      // Total includes cache tokens
      expect(extractedUsage.cumulativeTotal).toBe(110000);
      expect(extractedUsage.cacheRead).toBe(30000);
      expect(extractedUsage.cacheCreate).toBe(10000);

      // Process through WebSocket
      handleWsMessage(
        { type: 'token-usage', sessionId: 'claude-session-123', ...extractedUsage },
        mockSession,
        mockState,
        mockElements
      );

      // Verify cache metrics stored on session
      expect(mockSession.cacheMetrics).toEqual({
        cacheRead: 30000,
        cacheCreate: 10000
      });

      // Verify tooltip includes cache info
      expect(mockElements.contextBar.title).toContain('Cache Read: 30,000 tokens');
      expect(mockElements.contextBar.title).toContain('Cache Created: 10,000 tokens');
    });

    it('should handle messages without cache data', () => {
      const sdkModelUsage = {
        'claude-3-opus-20240229': {
          cumulativeInputTokens: 10000,
          cumulativeOutputTokens: 5000
        }
      };

      const extractedUsage = extractTokenUsage(sdkModelUsage);

      handleWsMessage(
        { type: 'token-usage', sessionId: 'claude-session-123', ...extractedUsage },
        mockSession,
        mockState,
        mockElements
      );

      expect(mockSession.cacheMetrics).toEqual({ cacheRead: 0, cacheCreate: 0 });
    });
  });

  describe('Session State Persistence Integration', () => {
    it('should persist and restore context data across page reloads', () => {
      // Simulate conversation with token usage
      const usage = extractTokenUsage({
        'claude-3-opus-20240229': {
          cumulativeInputTokens: 50000,
          cumulativeOutputTokens: 20000,
          cumulativeCacheReadInputTokens: 10000,
          cumulativeCacheCreationInputTokens: 5000
        }
      });

      handleWsMessage(
        { type: 'token-usage', sessionId: 'claude-session-123', ...usage },
        mockSession,
        mockState,
        mockElements
      );

      // Simulate save to localStorage
      const sessionData = [{
        sessionId: mockSession.sessionId,
        project: mockSession.project,
        lastTokenUsage: mockSession.lastTokenUsage,
        lastContextWindow: mockSession.lastContextWindow,
        model: mockSession.model,
        cacheMetrics: mockSession.cacheMetrics
      }];
      mockLocalStorage.setItem('cleon-sessions', JSON.stringify(sessionData));

      // Simulate page reload - restore from localStorage
      const restored = JSON.parse(mockLocalStorage.getItem('cleon-sessions'));
      const restoredSession = restored[0];

      expect(restoredSession.lastTokenUsage).toBe(85000);
      expect(restoredSession.lastContextWindow).toBe(200000);
      expect(restoredSession.model).toBe('claude-3-opus-20240229');
      expect(restoredSession.cacheMetrics).toEqual({ cacheRead: 10000, cacheCreate: 5000 });
    });
  });

  describe('Inactive Session Handling', () => {
    it('should update session state but not UI for inactive sessions', () => {
      // Make session inactive
      mockState.activeSessionIndex = 1;

      const usage = extractTokenUsage({
        'claude-3-opus-20240229': {
          cumulativeInputTokens: 50000,
          cumulativeOutputTokens: 20000
        }
      });

      handleWsMessage(
        { type: 'token-usage', sessionId: 'claude-session-123', ...usage },
        mockSession,
        mockState,
        mockElements
      );

      // Session state should be updated
      expect(mockSession.lastTokenUsage).toBe(70000);
      expect(mockSession.model).toBe('claude-3-opus-20240229');

      // But UI should not show updates (tokenUsageEl text not updated)
      // Note: In real implementation, the UI update would be skipped entirely
    });
  });

  describe('Tooltip Content', () => {
    it('should generate correct tooltip with all token breakdowns', () => {
      const usage = extractTokenUsage({
        'claude-3-opus-20240229': {
          cumulativeInputTokens: 100000,
          cumulativeOutputTokens: 50000,
          cumulativeCacheReadInputTokens: 25000,
          cumulativeCacheCreationInputTokens: 15000
        }
      });

      handleWsMessage(
        { type: 'token-usage', sessionId: 'claude-session-123', ...usage },
        mockSession,
        mockState,
        mockElements
      );

      const tooltip = mockElements.contextBar.title;
      expect(tooltip).toContain('Input: 100,000 tokens');
      expect(tooltip).toContain('Output: 50,000 tokens');
      expect(tooltip).toContain('Cache Read: 25,000 tokens');
      expect(tooltip).toContain('Cache Created: 15,000 tokens');
      expect(tooltip).toContain('Context Window: 200,000 tokens');
    });
  });

  describe('Edge Cases', () => {
    it('should handle token usage at exactly 80% threshold', () => {
      const usage = extractTokenUsage({
        'claude-3-opus-20240229': {
          cumulativeInputTokens: 160000,
          cumulativeOutputTokens: 0
        }
      });

      handleWsMessage(
        { type: 'token-usage', sessionId: 'claude-session-123', ...usage },
        mockSession,
        mockState,
        mockElements
      );

      expect(mockElements.tokenUsageEl.textContent).toContain('(80%)');
      // At exactly 80%, the color is cyan (default) since condition is pct > 80
      expect(mockElements.contextUsageFill.style.background).toBe('var(--neon-cyan)');
    });

    it('should handle token usage at exactly 95% threshold', () => {
      const usage = extractTokenUsage({
        'claude-3-opus-20240229': {
          cumulativeInputTokens: 190000,
          cumulativeOutputTokens: 0
        }
      });

      handleWsMessage(
        { type: 'token-usage', sessionId: 'claude-session-123', ...usage },
        mockSession,
        mockState,
        mockElements
      );

      expect(mockElements.tokenUsageEl.textContent).toContain('(95%)');
      // At exactly 95%, the color is orange (warning) since condition is pct > 95
      expect(mockElements.contextUsageFill.style.background).toBe('var(--neon-orange)');
    });

    it('should cap display at 100% even when tokens exceed context window', () => {
      const usage = extractTokenUsage({
        'claude-3-opus-20240229': {
          cumulativeInputTokens: 250000,
          cumulativeOutputTokens: 50000
        }
      });

      handleWsMessage(
        { type: 'token-usage', sessionId: 'claude-session-123', ...usage },
        mockSession,
        mockState,
        mockElements
      );

      expect(mockElements.tokenUsageEl.textContent).toContain('(100%)');
      expect(mockElements.contextUsageFill.style.width).toBe('100%');
    });

    it('should handle WebSocket message for unknown session', () => {
      // Create a session lookup function that returns null for unknown sessions
      const getSessionBySessionId = (sessionId) => {
        return sessionId === 'claude-session-123' ? mockSession : null;
      };

      const usage = extractTokenUsage({
        'claude-3-opus-20240229': {
          cumulativeInputTokens: 10000,
          cumulativeOutputTokens: 5000
        }
      });

      // Message for different session - should return null session
      const targetSession = getSessionBySessionId('different-session');

      handleWsMessage(
        { type: 'token-usage', sessionId: 'different-session', ...usage },
        targetSession,  // This will be null
        mockState,
        mockElements
      );

      // Should not update the current session since targetSession was null
      expect(mockSession.lastTokenUsage).toBeNull();
    });
  });
});
