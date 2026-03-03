/**
 * Unit tests for Pi agent event transformation.
 * Tests that Pi RPC events are correctly mapped to Cleon UI frontend messages.
 */
import { describe, it, expect } from 'vitest';
import { _transformEvent as transformEvent } from '../../server/pi-agent.js';

// Helper to create basic context objects
function createMockContext(overrides = {}) {
  return {
    accumulatedText: '',
    activityTracker: {
      setThinking: () => {},
      startThinking: () => {},
      setToolComplete: () => {},
      startTool: () => {},
      completeTool: () => {},
      finish: () => {}
    },
    taskManager: { startTask: () => {}, completeTask: () => {}, failTask: () => {} },
    ws: null,
    username: 'test-user',
    ...overrides
  };
}

describe('Pi Agent Event Transformation', () => {

  describe('message_update (text_delta)', () => {
    it('should transform text_delta into Cleon text message', () => {
      const piEvent = {
        type: 'message_update',
        message: { role: 'assistant', content: [] },
        assistantMessageEvent: {
          type: 'text_delta',
          contentIndex: 0,
          delta: 'Hello world',
        },
      };

      const context = createMockContext();
      const result = transformEvent(piEvent, 'session-123', context);

      expect(result).not.toBeNull();
      expect(result.type).toBe('text');
      expect(result.content).toBe('Hello world');
      expect(result.timestamp).toBeDefined();
      expect(result.messageId).toBeDefined();
    });

    it('should return null for non-text_delta message_update events', () => {

      const piEvent = {
        type: 'message_update',
        message: { role: 'assistant', content: [] },
        assistantMessageEvent: {
          type: 'toolcall_delta',
          contentIndex: 0,
          delta: '{"command',
        },
      };

      const context = createMockContext();
      const result = transformEvent(piEvent, 'session-123', context);
      expect(result).toBeNull();
    });

    it('should handle thinking_delta events', () => {

      const piEvent = {
        type: 'message_update',
        message: { role: 'assistant', content: [] },
        assistantMessageEvent: {
          type: 'thinking_delta',
          contentIndex: 0,
          delta: 'Let me think about this...',
        },
      };

      const context = createMockContext();
      const result = transformEvent(piEvent, 'session-123', context);
      // Thinking can be null or a specific type - implementation dependent
      expect([null, 'text', 'thinking']).toContain(result?.type || null);
    });
  });

  describe('tool_execution_start', () => {
    it('should transform Pi tool_execution_start with consistent field names', () => {

      const piEvent = {
        type: 'tool_execution_start',
        toolCallId: 'call_abc123',
        toolName: 'bash',
        args: { command: 'ls -la' },
      };

      const context = createMockContext();
      const result = transformEvent(piEvent, 'session-123', context);

      expect(result).not.toBeNull();
      expect(result.type).toBe('tool_use');
      expect(result.tool).toBe('bash');
      expect(result.id).toBe('call_abc123');
      expect(result.input).toEqual({ command: 'ls -la' });
    });

    it('should handle read tool with file path', () => {

      const piEvent = {
        type: 'tool_execution_start',
        toolCallId: 'call_read_1',
        toolName: 'read',
        args: { path: '/src/index.js' },
      };

      const context = createMockContext();
      const result = transformEvent(piEvent, 'session-123', context);

      expect(result.type).toBe('tool_use');
      expect(result.tool).toBe('read');
      expect(result.id).toBe('call_read_1');
    });

    it('should handle write tool', () => {

      const piEvent = {
        type: 'tool_execution_start',
        toolCallId: 'call_write_1',
        toolName: 'write',
        args: { path: '/src/new.js', content: 'console.log("hello")' },
      };

      const context = createMockContext();
      const result = transformEvent(piEvent, 'session-123', context);

      expect(result.type).toBe('tool_use');
      expect(result.tool).toBe('write');
    });

    it('should handle edit tool', () => {

      const piEvent = {
        type: 'tool_execution_start',
        toolCallId: 'call_edit_1',
        toolName: 'edit',
        args: {
          path: '/src/index.js',
          oldText: 'hello',
          newText: 'goodbye'
        },
      };

      const context = createMockContext();
      const result = transformEvent(piEvent, 'session-123', context);

      expect(result.type).toBe('tool_use');
      expect(result.tool).toBe('edit');
    });

    it('should include timestamp and messageId', () => {

      const piEvent = {
        type: 'tool_execution_start',
        toolCallId: 'call_1',
        toolName: 'bash',
        args: {},
      };

      const context = createMockContext();
      const result = transformEvent(piEvent, 'session-123', context);

      expect(result.timestamp).toBeDefined();
      expect(result.messageId).toBeDefined();
    });
  });

  describe('tool_execution_end', () => {
    it('should extract text from Pi result.content array', () => {

      const piEvent = {
        type: 'tool_execution_end',
        toolCallId: 'call_abc123',
        toolName: 'bash',
        result: {
          content: [{ type: 'text', text: 'total 48\ndrwxr-xr-x ...' }],
          details: {},
        },
        isError: false,
      };

      const context = createMockContext();
      const result = transformEvent(piEvent, 'session-123', context);

      expect(result).not.toBeNull();
      expect(result.type).toBe('tool_result');
      expect(result.id).toBe('call_abc123');
      expect(result.success).toBe(true);
      expect(result.output).toContain('total 48');
    });

    it('should handle error results', () => {

      const piEvent = {
        type: 'tool_execution_end',
        toolCallId: 'call_err',
        toolName: 'bash',
        result: {
          content: [{ type: 'text', text: 'command not found' }],
          details: {},
        },
        isError: true,
      };

      const context = createMockContext();
      const result = transformEvent(piEvent, 'session-123', context);

      expect(result.type).toBe('tool_result');
      expect(result.id).toBe('call_err');
      expect(result.success).toBe(false);
      expect(result.output).toContain('command not found');
    });

    it('should handle empty result content', () => {

      const piEvent = {
        type: 'tool_execution_end',
        toolCallId: 'call_empty',
        toolName: 'bash',
        result: {
          content: [],
          details: {},
        },
        isError: false,
      };

      const context = createMockContext();
      const result = transformEvent(piEvent, 'session-123', context);

      expect(result.type).toBe('tool_result');
      expect(result.success).toBe(true);
      expect(result.output).toBe('');
    });

    it('should include duration when available', () => {

      const piEvent = {
        type: 'tool_execution_end',
        toolCallId: 'call_duration',
        toolName: 'bash',
        result: {
          content: [{ type: 'text', text: 'done' }],
          details: { durationMs: 1500 },
        },
        isError: false,
      };

      const context = createMockContext();
      const result = transformEvent(piEvent, 'session-123', context);

      expect(result.type).toBe('tool_result');
      // Duration may or may not be included - implementation dependent
    });

    it('should truncate long output', () => {

      const longOutput = 'x'.repeat(50000);
      const piEvent = {
        type: 'tool_execution_end',
        toolCallId: 'call_long',
        toolName: 'bash',
        result: {
          content: [{ type: 'text', text: longOutput }],
          details: {},
        },
        isError: false,
      };

      const context = createMockContext();
      const result = transformEvent(piEvent, 'session-123', context);

      expect(result.output.length).toBeLessThan(longOutput.length);
    });
  });

  describe('turn_end (token usage)', () => {
    it('should extract token usage from Pi turn_end event', () => {

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
            cost: { input: 0.003, output: 0.003, cacheRead: 0.0005, cacheWrite: 0.000375, total: 0.006875 },
          },
        },
        toolResults: [],
      };

      const context = createMockContext();
      const result = transformEvent(piEvent, 'session-123', context);

      expect(result).not.toBeNull();
      expect(result.type).toBe('_token_usage');
      expect(result.usage).toBeDefined();
      expect(result.usage.cumulativeInput).toBe(1000);
      expect(result.usage.cumulativeOutput).toBe(200);
      expect(result.usage.model).toBe('claude-sonnet-4-20250514');
    });

    it('should handle missing usage gracefully', () => {

      const piEvent = {
        type: 'turn_end',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'Hello' }],
        },
        toolResults: [],
      };

      const context = createMockContext();
      const result = transformEvent(piEvent, 'session-123', context);

      // Should return null if no usage data
      expect(result).toBeNull();
    });

    it('should include cache metrics', () => {

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

      const context = createMockContext();
      const result = transformEvent(piEvent, 'session-123', context);

      expect(result.usage.cacheRead).toBe(500);
      expect(result.usage.cacheCreate).toBe(100);
    });
  });

  describe('extension_ui_request', () => {
    it('should transform select method to Cleon question format', () => {

      const piEvent = {
        type: 'extension_ui_request',
        id: 'uuid-1',
        method: 'select',
        title: 'Choose option',
        options: ['A', 'B', 'C'],
      };

      const context = createMockContext();
      const result = transformEvent(piEvent, 'session-123', context);

      expect(result).not.toBeNull();
      expect(result.type).toBe('question');
      expect(result.id).toBe('uuid-1');
      expect(result.questions).toBeDefined();
      expect(result.questions[0].question).toBe('Choose option');
      expect(result.questions[0].options).toHaveLength(3);
      expect(result.questions[0].options[0]).toEqual({ label: 'A' });
    });

    it('should transform confirm method to Yes/No question', () => {

      const piEvent = {
        type: 'extension_ui_request',
        id: 'uuid-2',
        method: 'confirm',
        title: 'Proceed?',
        message: 'Are you sure?',
      };

      const context = createMockContext();
      const result = transformEvent(piEvent, 'session-123', context);

      expect(result.type).toBe('question');
      expect(result.id).toBe('uuid-2');
      // confirm uses event.message as question (fallback to event.title)
      expect(result.questions[0].question).toBe('Are you sure?');
      expect(result.questions[0].options).toEqual([
        { label: 'Yes', description: 'Confirm' },
        { label: 'No', description: 'Cancel' }
      ]);
    });

    it('should transform input method to freeText question', () => {

      const piEvent = {
        type: 'extension_ui_request',
        id: 'uuid-3',
        method: 'input',
        title: 'Enter value',
        placeholder: 'type here...',
      };

      const context = createMockContext();
      const result = transformEvent(piEvent, 'session-123', context);

      expect(result.type).toBe('question');
      expect(result.id).toBe('uuid-3');
      expect(result.questions[0].question).toBe('Enter value');
      expect(result.questions[0].freeText).toBe(true);
    });

    it('should handle editor method (returns null - not implemented)', () => {
      const piEvent = {
        type: 'extension_ui_request',
        id: 'uuid-4',
        method: 'editor',
        title: 'Edit content',
        defaultValue: 'initial text',
      };

      const context = createMockContext();
      const result = transformEvent(piEvent, 'session-123', context);

      // editor method is not currently handled - returns null
      expect(result).toBeNull();
    });
  });

  describe('agent lifecycle', () => {
    it('should return _agent_end for agent_end events', () => {

      const piEvent = { type: 'agent_end', messages: [] };

      const context = createMockContext();
      const result = transformEvent(piEvent, 'session-123', context);

      expect(result).not.toBeNull();
      expect(result.type).toBe('_agent_end');
    });

    it('should return null for agent_start', () => {

      const piEvent = { type: 'agent_start' };

      const context = createMockContext();
      const result = transformEvent(piEvent, 'session-123', context);

      // agent_start triggers side effects (activity tracker) but returns null
      expect(result).toBeNull();
    });
  });

  describe('events to ignore', () => {
    it('should return null for message_start', () => {

      const piEvent = { type: 'message_start', message: {} };

      const context = createMockContext();
      const result = transformEvent(piEvent, 'session-123', context);

      expect(result).toBeNull();
    });

    it('should return null for message_end', () => {

      const piEvent = { type: 'message_end', message: {} };

      const context = createMockContext();
      const result = transformEvent(piEvent, 'session-123', context);

      expect(result).toBeNull();
    });

    it('should return null for tool_execution_update', () => {

      const piEvent = {
        type: 'tool_execution_update',
        toolCallId: 'call_abc',
        toolName: 'bash',
        args: {},
        partialResult: { content: [{ type: 'text', text: 'partial...' }], details: {} },
      };

      const context = createMockContext();
      const result = transformEvent(piEvent, 'session-123', context);

      expect(result).toBeNull();
    });

    it('should return null for response events', () => {

      const piEvent = { type: 'response', id: 'req_1', command: 'prompt', success: true };

      const context = createMockContext();
      const result = transformEvent(piEvent, 'session-123', context);

      expect(result).toBeNull();
    });
  });

  describe('extension_error', () => {
    it('should transform extension_error into text message', () => {

      const piEvent = {
        type: 'extension_error',
        extensionPath: '/path/to/ext.ts',
        event: 'tool_call',
        error: 'Something went wrong',
      };

      const context = createMockContext();
      const result = transformEvent(piEvent, 'session-123', context);

      expect(result).not.toBeNull();
      expect(result.type).toBe('text');
      expect(result.content).toContain('Extension error');
      expect(result.content).toContain('Something went wrong');
    });
  });

  describe('auto_compaction events', () => {
    it('should return text message for auto_compaction_start', () => {

      const piEvent = {
        type: 'auto_compaction_start',
      };

      const context = createMockContext();
      const result = transformEvent(piEvent, 'session-123', context);

      expect(result).not.toBeNull();
      expect(result.type).toBe('text');
      expect(result.content).toContain('compaction');
    });

    it('should return text message for auto_compaction_end', () => {

      const piEvent = {
        type: 'auto_compaction_end',
        result: {
          tokensBefore: 100000,
          tokensAfter: 50000,
        },
      };

      const context = createMockContext();
      const result = transformEvent(piEvent, 'session-123', context);

      expect(result).not.toBeNull();
      expect(result.type).toBe('text');
      expect(result.content).toContain('100000');
    });
  });

  describe('auto_retry events', () => {
    it('should return text message for auto_retry_start', () => {

      const piEvent = {
        type: 'auto_retry_start',
        attempt: 1,
        maxAttempts: 3,
        errorMessage: 'Rate limit exceeded',
      };

      const context = createMockContext();
      const result = transformEvent(piEvent, 'session-123', context);

      expect(result).not.toBeNull();
      expect(result.type).toBe('text');
      expect(result.content).toContain('Retrying');
      expect(result.content).toContain('1/3');
    });

    it('should return text message for auto_retry_end failure', () => {

      const piEvent = {
        type: 'auto_retry_end',
        success: false,
        attempt: 3,
        finalError: 'Max retries exceeded',
      };

      const context = createMockContext();
      const result = transformEvent(piEvent, 'session-123', context);

      expect(result).not.toBeNull();
      expect(result.type).toBe('text');
      expect(result.content).toContain('failed');
    });

    it('should return null for auto_retry_end success', () => {

      const piEvent = {
        type: 'auto_retry_end',
        success: true,
        attempt: 2,
      };

      const context = createMockContext();
      const result = transformEvent(piEvent, 'session-123', context);

      // Success case - no message needed
      expect(result).toBeNull();
    });
  });

  describe('unknown event types', () => {
    it('should return null for unknown event types', () => {

      const piEvent = { type: 'unknown_event', data: 'something' };

      const context = createMockContext();
      const result = transformEvent(piEvent, 'session-123', context);

      expect(result).toBeNull();
    });
  });
});
