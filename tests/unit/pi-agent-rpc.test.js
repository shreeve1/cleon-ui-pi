/**
 * Unit tests for Pi RPC client lifecycle and configuration.
 * Tests that the pi-agent module exports the expected interface.
 */
import { describe, it, expect } from 'vitest';
import * as piAgent from '../../server/pi-agent.js';

describe('Pi Agent Module', () => {
  describe('exports', () => {
    it('should export handleChat function', () => {
      expect(piAgent.handleChat).toBeDefined();
      expect(typeof piAgent.handleChat).toBe('function');
    });

    it('should export handleAbort function', () => {
      expect(piAgent.handleAbort).toBeDefined();
      expect(typeof piAgent.handleAbort).toBe('function');
    });

    it('should export handleQuestionResponse function', () => {
      expect(piAgent.handleQuestionResponse).toBeDefined();
      expect(typeof piAgent.handleQuestionResponse).toBe('function');
    });

    it('should export handlePlanResponse function', () => {
      expect(piAgent.handlePlanResponse).toBeDefined();
      expect(typeof piAgent.handlePlanResponse).toBe('function');
    });

    it('should export isSessionActive function', () => {
      expect(piAgent.isSessionActive).toBeDefined();
      expect(typeof piAgent.isSessionActive).toBe('function');
    });

    it('should export resubscribeSession function', () => {
      expect(piAgent.resubscribeSession).toBeDefined();
      expect(typeof piAgent.resubscribeSession).toBe('function');
    });

    it('should export _transformEvent for testing', () => {
      expect(piAgent._transformEvent).toBeDefined();
      expect(typeof piAgent._transformEvent).toBe('function');
    });
  });

  describe('isSessionActive', () => {
    it('should return false for non-existent session', () => {
      expect(piAgent.isSessionActive('non-existent-session-id')).toBe(false);
    });
  });

  describe('resubscribeSession', () => {
    it('should return false for non-existent session', () => {
      expect(piAgent.resubscribeSession('non-existent-session-id', {})).toBe(false);
    });
  });

  describe('handleAbort', () => {
    it('should return false for non-existent session', async () => {
      const result = await piAgent.handleAbort('non-existent-session-id');
      expect(result).toBe(false);
    });
  });

  describe('handlePlanResponse', () => {
    it('should return false (plan mode not applicable for Pi backend)', async () => {
      const result = await piAgent.handlePlanResponse('session-id', 'tool-id', true, 'feedback');
      expect(result).toBe(false);
    });
  });
});

describe('Pi event format differences from OMP', () => {
  describe('tool_execution_start', () => {
    it('should use toolCallId consistently (not toolUseId or id)', () => {
      const transformEvent = piAgent._transformEvent;
      const piEvent = {
        type: 'tool_execution_start',
        toolCallId: 'call_123',
        toolName: 'bash',
        args: { command: 'ls' },
      };

      const context = { activityTracker: { startTool: () => {} }, ws: {}, username: 'test' };
      const result = transformEvent(piEvent, 'session-123', context);

      expect(result).toBeDefined();
      expect(result.id).toBe('call_123');
    });

    it('should use toolName consistently (not tool or name)', () => {
      const transformEvent = piAgent._transformEvent;
      const piEvent = {
        type: 'tool_execution_start',
        toolCallId: 'call_123',
        toolName: 'read',
        args: { path: '/src/file.js' },
      };

      const context = { activityTracker: { startTool: () => {} }, ws: {}, username: 'test' };
      const result = transformEvent(piEvent, 'session-123', context);

      expect(result.tool).toBe('read');
    });

    it('should use args consistently (not input)', () => {
      const transformEvent = piAgent._transformEvent;
      const piEvent = {
        type: 'tool_execution_start',
        toolCallId: 'call_123',
        toolName: 'bash',
        args: { command: 'echo hello' },
      };

      const context = { activityTracker: { startTool: () => {} }, ws: {}, username: 'test' };
      const result = transformEvent(piEvent, 'session-123', context);

      expect(result.input).toEqual({ command: 'echo hello' });
    });
  });

  describe('tool_execution_end', () => {
    it('should have result.content array', () => {
      const transformEvent = piAgent._transformEvent;
      const piEvent = {
        type: 'tool_execution_end',
        toolCallId: 'call_123',
        toolName: 'bash',
        result: {
          content: [{ type: 'text', text: 'output here' }],
          details: {},
        },
        isError: false,
      };

      const result = transformEvent(piEvent, 'session-123', {});

      expect(result).toBeDefined();
      expect(result.output).toBe('output here');
      expect(result.success).toBe(true);
    });

    it('should use isError boolean (not error presence)', () => {
      const transformEvent = piAgent._transformEvent;
      const piEvent = {
        type: 'tool_execution_end',
        toolCallId: 'call_123',
        toolName: 'bash',
        result: {
          content: [{ type: 'text', text: 'error message' }],
          details: {},
        },
        isError: true,
      };

      const result = transformEvent(piEvent, 'session-123', {});

      expect(result.success).toBe(false);
    });
  });

  describe('turn_end', () => {
    it('should include token usage from message.usage', () => {
      const transformEvent = piAgent._transformEvent;
      const piEvent = {
        type: 'turn_end',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'Hello' }],
          model: 'claude-sonnet-4-20250514',
          usage: {
            input: 1000,
            output: 200,
            cacheRead: 500,
            cacheWrite: 100,
          },
        },
        toolResults: [],
      };

      const result = transformEvent(piEvent, 'session-123', {});

      expect(result).toBeDefined();
      expect(result.type).toBe('_token_usage');
      expect(result.usage.cumulativeInput).toBe(1000);
      expect(result.usage.cumulativeOutput).toBe(200);
      expect(result.usage.cacheRead).toBe(500);
      expect(result.usage.cacheCreate).toBe(100);
      expect(result.usage.model).toBe('claude-sonnet-4-20250514');
    });
  });
});

describe('Pi new events not in OMP', () => {
  it('should handle tool_execution_update (returns null)', () => {
    const transformEvent = piAgent._transformEvent;
    const piEvent = {
      type: 'tool_execution_update',
      toolCallId: 'call_abc',
      toolName: 'bash',
      args: {},
      partialResult: { content: [{ type: 'text', text: 'partial...' }], details: {} },
    };

    const result = transformEvent(piEvent, 'session-123', {});
    expect(result).toBeNull();
  });

  it('should handle message_start (returns null)', () => {
    const transformEvent = piAgent._transformEvent;
    const piEvent = { type: 'message_start', message: {} };

    const result = transformEvent(piEvent, 'session-123', {});
    expect(result).toBeNull();
  });

  it('should handle message_end (returns null)', () => {
    const transformEvent = piAgent._transformEvent;
    const piEvent = { type: 'message_end', message: {} };

    const result = transformEvent(piEvent, 'session-123', {});
    expect(result).toBeNull();
  });

  it('should handle auto_compaction_start (returns text message)', () => {
    const transformEvent = piAgent._transformEvent;
    const piEvent = { type: 'auto_compaction_start' };

    const result = transformEvent(piEvent, 'session-123', {});
    expect(result).not.toBeNull();
    expect(result.type).toBe('text');
    expect(result.content).toContain('compaction');
  });

  it('should handle auto_compaction_end (returns text message)', () => {
    const transformEvent = piAgent._transformEvent;
    const piEvent = {
      type: 'auto_compaction_end',
      result: { tokensBefore: 100000, tokensAfter: 50000 },
    };

    const result = transformEvent(piEvent, 'session-123', {});
    expect(result).not.toBeNull();
    expect(result.type).toBe('text');
    expect(result.content).toContain('100000');
  });

  it('should handle auto_retry_start (returns text message)', () => {
    const transformEvent = piAgent._transformEvent;
    const piEvent = {
      type: 'auto_retry_start',
      attempt: 1,
      maxAttempts: 3,
      errorMessage: 'Rate limit exceeded',
    };

    const result = transformEvent(piEvent, 'session-123', {});
    expect(result).not.toBeNull();
    expect(result.type).toBe('text');
    expect(result.content).toContain('Retrying');
  });

  it('should handle auto_retry_end failure (returns text message)', () => {
    const transformEvent = piAgent._transformEvent;
    const piEvent = {
      type: 'auto_retry_end',
      success: false,
      attempt: 3,
      finalError: 'Max retries exceeded',
    };

    const result = transformEvent(piEvent, 'session-123', {});
    expect(result).not.toBeNull();
    expect(result.type).toBe('text');
    expect(result.content).toContain('failed');
  });

  it('should handle auto_retry_end success (returns null)', () => {
    const transformEvent = piAgent._transformEvent;
    const piEvent = {
      type: 'auto_retry_end',
      success: true,
      attempt: 2,
    };

    const result = transformEvent(piEvent, 'session-123', {});
    expect(result).toBeNull();
  });
});
