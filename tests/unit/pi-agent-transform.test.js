import { describe, expect, it, vi } from "vitest";
import { createEventTransformer } from "../../server/event-transformer.js";

/**
 * Helper: create a transformer with mock adapters and return
 * the transform function plus the mock references for assertions.
 */
function setup() {
	const taskTracker = {
		trackStart: vi.fn(() => ({ taskId: "task-1" })),
		trackComplete: vi.fn(),
		trackFailed: vi.fn(),
	};
	const activityTracker = {
		startTool: vi.fn(),
		completeTool: vi.fn(),
		startThinking: vi.fn(),
	};
	const { transform } = createEventTransformer({
		taskTracker,
		activityTracker,
	});
	return { transform, taskTracker, activityTracker };
}

// ─── Text streaming ────────────────────────────────────────────────

describe("text streaming", () => {
	it("transforms text_delta events", () => {
		const { transform } = setup();
		const result = transform({
			type: "message_update",
			assistantMessageEvent: { type: "text_delta", delta: "Hello world" },
		});

		expect(result).toMatchObject({
			type: "text",
			content: "Hello world",
		});
		expect(result.timestamp).toBeTruthy();
		expect(result.messageId).toBeTruthy();
	});

	it("strips ANSI from text deltas", () => {
		const { transform } = setup();
		const result = transform({
			type: "message_update",
			assistantMessageEvent: {
				type: "text_delta",
				delta: "\x1b[32mgreen text\x1b[0m",
			},
		});

		expect(result.content).toBe("green text");
	});

	it("returns null for message_update without assistantMessageEvent", () => {
		const { transform } = setup();
		expect(transform({ type: "message_update" })).toBeNull();
	});

	it("returns null for non-text_delta assistant message events", () => {
		const { transform } = setup();
		expect(
			transform({
				type: "message_update",
				assistantMessageEvent: { type: "tool_call_delta" },
			}),
		).toBeNull();
	});
});

// ─── Tool execution lifecycle ──────────────────────────────────────

describe("tool execution", () => {
	it("emits tool_use on tool_execution_start", () => {
		const { transform } = setup();
		const result = transform({
			type: "tool_execution_start",
			toolName: "bash",
			toolCallId: "call-1",
			args: { command: "ls -la" },
		});

		expect(result).toMatchObject({
			type: "tool_use",
			tool: "bash",
			id: "call-1",
			input: { command: "ls -la" },
		});
		expect(result.startTime).toBeTruthy();
	});

	it("emits tool_result on tool_execution_end with array content", () => {
		const { transform } = setup();

		// Start first so timing state exists
		transform({
			type: "tool_execution_start",
			toolName: "bash",
			toolCallId: "call-1",
			args: { command: "echo hi" },
		});

		const result = transform({
			type: "tool_execution_end",
			toolCallId: "call-1",
			result: {
				content: [{ type: "text", text: "hi\n" }],
			},
		});

		expect(result).toMatchObject({
			type: "tool_result",
			id: "call-1",
			success: true,
			output: "hi\n",
		});
		expect(result.duration).toBeGreaterThanOrEqual(0);
		expect(result.startTime).toBeTruthy();
	});

	it("marks tool_result as failure when isError is true", () => {
		const { transform } = setup();

		transform({
			type: "tool_execution_start",
			toolName: "bash",
			toolCallId: "call-2",
			args: { command: "false" },
		});

		const result = transform({
			type: "tool_execution_end",
			toolCallId: "call-2",
			isError: true,
			result: {
				content: [{ type: "text", text: "command failed" }],
			},
		});

		expect(result.success).toBe(false);
		expect(result.output).toBe("command failed");
	});

	it("truncates long tool output", () => {
		const { transform } = setup();

		transform({
			type: "tool_execution_start",
			toolName: "bash",
			toolCallId: "call-3",
			args: { command: "cat huge-file" },
		});

		const longOutput = "x".repeat(5000);
		const result = transform({
			type: "tool_execution_end",
			toolCallId: "call-3",
			result: {
				content: [{ type: "text", text: longOutput }],
			},
		});

		expect(result.output.length).toBeLessThan(longOutput.length);
		expect(result.output).toContain("more chars");
	});

	it("handles tool_execution_end without prior start (orphan end)", () => {
		const { transform } = setup();

		const result = transform({
			type: "tool_execution_end",
			toolCallId: "orphan-call",
			result: {
				content: [{ type: "text", text: "output" }],
			},
		});

		expect(result).toMatchObject({
			type: "tool_result",
			id: "orphan-call",
			success: true,
			output: "output",
		});
		expect(result.duration).toBeNull();
		expect(result.startTime).toBeNull();
	});

	it("generates a toolCallId when missing from tool_execution_start", () => {
		const { transform } = setup();

		const result = transform({
			type: "tool_execution_start",
			toolName: "read",
			args: { file_path: "/tmp/test.txt" },
		});

		expect(result.id).toBeTruthy();
		expect(result.id.length).toBeGreaterThan(0);
	});
});

// ─── Task tracker adapter ──────────────────────────────────────────

describe("task tracker adapter", () => {
	it("calls trackStart on tool_execution_start", () => {
		const { transform, taskTracker } = setup();

		transform(
			{
				type: "tool_execution_start",
				toolName: "bash",
				toolCallId: "call-1",
				args: { command: "echo hi" },
			},
			"sess-1",
		);

		expect(taskTracker.trackStart).toHaveBeenCalledOnce();
		expect(taskTracker.trackStart.mock.calls[0][0]).toMatchObject({
			title: "$ echo hi",
			progress: 0,
			metadata: { tool: "bash", toolUseId: "call-1" },
		});
	});

	it("calls trackComplete on successful tool_execution_end", () => {
		const { transform, taskTracker } = setup();

		transform(
			{
				type: "tool_execution_start",
				toolCallId: "call-1",
				toolName: "bash",
				args: { command: "ls" },
			},
			"sess-1",
		);
		transform(
			{
				type: "tool_execution_end",
				toolCallId: "call-1",
				result: { content: [{ type: "text", text: "file.txt" }] },
			},
			"sess-1",
		);

		expect(taskTracker.trackComplete).toHaveBeenCalledOnce();
		expect(taskTracker.trackComplete.mock.calls[0][0]).toBe("task-1");
		expect(taskTracker.trackComplete.mock.calls[0][1]).toBe("file.txt");
	});

	it("calls trackFailed on error tool_execution_end", () => {
		const { transform, taskTracker } = setup();

		transform(
			{
				type: "tool_execution_start",
				toolCallId: "call-1",
				toolName: "bash",
				args: { command: "bad-cmd" },
			},
			"sess-1",
		);
		transform(
			{
				type: "tool_execution_end",
				toolCallId: "call-1",
				isError: true,
				result: { content: [{ type: "text", text: "not found" }] },
			},
			"sess-1",
		);

		expect(taskTracker.trackFailed).toHaveBeenCalledOnce();
		expect(taskTracker.trackFailed.mock.calls[0][0]).toBe("task-1");
	});

	it("does not call task tracker when not provided", () => {
		const { transform } = createEventTransformer();
		// Should not throw
		transform({
			type: "tool_execution_start",
			toolCallId: "call-1",
			toolName: "bash",
			args: { command: "ls" },
		});
		transform({
			type: "tool_execution_end",
			toolCallId: "call-1",
			result: { content: [{ type: "text", text: "ok" }] },
		});
	});
});

// ─── Activity tracker adapter ──────────────────────────────────────

describe("activity tracker adapter", () => {
	it("calls startTool on tool_execution_start", () => {
		const { transform, activityTracker } = setup();

		transform({
			type: "tool_execution_start",
			toolCallId: "call-1",
			toolName: "bash",
			args: { command: "ls" },
		});

		expect(activityTracker.startTool).toHaveBeenCalledOnce();
		expect(activityTracker.startTool.mock.calls[0][0]).toBe("bash");
	});

	it("calls completeTool on tool_execution_end", () => {
		const { transform, activityTracker } = setup();

		transform({
			type: "tool_execution_start",
			toolCallId: "call-1",
			toolName: "bash",
			args: { command: "ls" },
		});
		transform({
			type: "tool_execution_end",
			toolCallId: "call-1",
			result: { content: [{ type: "text", text: "ok" }] },
		});

		expect(activityTracker.completeTool).toHaveBeenCalledOnce();
	});

	it("calls startThinking on agent_start", () => {
		const { transform, activityTracker } = setup();
		transform({ type: "agent_start" });
		expect(activityTracker.startThinking).toHaveBeenCalledOnce();
	});

	it("calls startThinking on turn_start", () => {
		const { transform, activityTracker } = setup();
		transform({ type: "turn_start" });
		expect(activityTracker.startThinking).toHaveBeenCalledOnce();
	});

	it("does not call activity tracker when not provided", () => {
		const { transform } = createEventTransformer();
		// Should not throw
		transform({ type: "agent_start" });
		transform({
			type: "tool_execution_start",
			toolCallId: "call-1",
			toolName: "bash",
			args: { command: "ls" },
		});
		transform({
			type: "tool_execution_end",
			toolCallId: "call-1",
			result: { content: [{ type: "text", text: "ok" }] },
		});
	});
});

// ─── Session lifecycle events ──────────────────────────────────────

describe("session lifecycle", () => {
	it("returns _agent_end on agent_end", () => {
		const { transform } = setup();
		expect(transform({ type: "agent_end" })).toEqual({ type: "_agent_end" });
	});

	it("returns null on agent_start (side-effect only)", () => {
		const { transform } = setup();
		expect(transform({ type: "agent_start" })).toBeNull();
	});

	it("returns null on turn_start (side-effect only)", () => {
		const { transform } = setup();
		expect(transform({ type: "turn_start" })).toBeNull();
	});

	it("returns null on message_start", () => {
		const { transform } = setup();
		expect(transform({ type: "message_start" })).toBeNull();
	});

	it("returns null on message_end", () => {
		const { transform } = setup();
		expect(transform({ type: "message_end" })).toBeNull();
	});

	it("returns null on tool_execution_update", () => {
		const { transform } = setup();
		expect(transform({ type: "tool_execution_update" })).toBeNull();
	});
});

// ─── Turn end: token usage ─────────────────────────────────────────

describe("turn_end — token usage", () => {
	it("emits _token_usage with computed fields", () => {
		const { transform } = setup();

		const result = transform({
			type: "turn_end",
			message: {
				stopReason: "end_turn",
				usage: {
					input: 1000,
					output: 500,
					cacheRead: 200,
					cacheWrite: 100,
				},
				model: "claude-3-sonnet",
			},
		});

		expect(result.type).toBe("_token_usage");
		expect(result.usage).toMatchObject({
			cumulativeTotal: 1800,
			cumulativeInput: 1000,
			cumulativeOutput: 500,
			cacheRead: 200,
			cacheCreate: 100,
			contextWindow: 200000,
			model: "claude-3-sonnet",
			used: 1800,
		});
	});

	it("returns null on turn_end with no error and no usage", () => {
		const { transform } = setup();
		expect(
			transform({
				type: "turn_end",
				message: { stopReason: "end_turn" },
			}),
		).toBeNull();
	});
});

// ─── Turn end: errors ──────────────────────────────────────────────

describe("turn_end — errors", () => {
	it("surfaces errors from message stopReason", () => {
		const { transform } = createEventTransformer();

		const result = transform({
			type: "turn_end",
			message: {
				stopReason: "error",
				errorMessage: "Connection timed out",
			},
		});

		expect(result.type).toBe("_agent_error");
		expect(result.message).toBe("Connection timed out");
	});

	it("extracts nested provider error from JSON payload", () => {
		const { transform } = createEventTransformer();

		const result = transform({
			type: "turn_end",
			message: {
				stopReason: "error",
				errorMessage:
					'400 {"type":"error","error":{"type":"invalid_request_error","message":"Provider rejected request"}}',
			},
		});

		expect(result.type).toBe("_agent_error");
		expect(result.message).toBe("Provider rejected request");
	});

	it("handles error as direct error field", () => {
		const { transform } = createEventTransformer();

		const result = transform({
			type: "turn_end",
			message: {
				stopReason: "error",
				error: { message: "Rate limited" },
			},
		});

		expect(result.type).toBe("_agent_error");
		expect(result.message).toBe("Rate limited");
	});
});

// ─── Compaction events ─────────────────────────────────────────────

describe("compaction", () => {
	it("emits text on auto_compaction_start", () => {
		const { transform } = setup();
		const result = transform({ type: "auto_compaction_start" });
		expect(result.type).toBe("text");
		expect(result.content).toContain("compaction in progress");
	});

	it("emits text on auto_compaction_end with result", () => {
		const { transform } = setup();
		const result = transform({
			type: "auto_compaction_end",
			result: { tokensBefore: 150000 },
		});
		expect(result.type).toBe("text");
		expect(result.content).toContain("150000");
	});

	it("returns null on auto_compaction_end without result", () => {
		const { transform } = setup();
		expect(transform({ type: "auto_compaction_end" })).toBeNull();
	});
});

// ─── Retry events ──────────────────────────────────────────────────

describe("retry", () => {
	it("emits text on auto_retry_start", () => {
		const { transform } = setup();
		const result = transform({
			type: "auto_retry_start",
			attempt: 2,
			maxAttempts: 5,
			errorMessage: "timeout",
		});
		expect(result.type).toBe("text");
		expect(result.content).toContain("attempt 2/5");
		expect(result.content).toContain("timeout");
	});

	it("emits text on auto_retry_end when not successful", () => {
		const { transform } = setup();
		const result = transform({
			type: "auto_retry_end",
			success: false,
			attempt: 3,
			finalError: "still failing",
		});
		expect(result.type).toBe("text");
		expect(result.content).toContain("3 attempts");
	});

	it("returns null on successful auto_retry_end", () => {
		const { transform } = setup();
		expect(transform({ type: "auto_retry_end", success: true })).toBeNull();
	});
});

// ─── Dropped tools ─────────────────────────────────────────────────

describe("dropped tools", () => {
	it("emits text on first unknown_tool per session", () => {
		const { transform } = setup();
		const result = transform(
			{ type: "unknown_tool", toolName: "mcp__server__customTool" },
			"sess-1",
		);
		expect(result.type).toBe("text");
		expect(result.content).toContain("customTool");
	});

	it("strips mcp prefix from tool name", () => {
		const { transform } = setup();
		const result = transform(
			{ type: "tool_dropped", toolName: "mcp__myServer__myTool" },
			"sess-1",
		);
		expect(result.content).toContain("myTool");
	});

	it("suppresses duplicate dropped tool per session", () => {
		const { transform } = setup();

		const first = transform(
			{ type: "unknown_tool", toolName: "myTool" },
			"sess-1",
		);
		expect(first).not.toBeNull();

		const second = transform(
			{ type: "unknown_tool", toolName: "myTool" },
			"sess-1",
		);
		expect(second).toBeNull();
	});

	it("allows same tool name in different sessions", () => {
		const { transform } = setup();

		const r1 = transform(
			{ type: "unknown_tool", toolName: "myTool" },
			"sess-1",
		);
		const r2 = transform(
			{ type: "unknown_tool", toolName: "myTool" },
			"sess-2",
		);
		expect(r1).not.toBeNull();
		expect(r2).not.toBeNull();
	});

	it("returns null when no sessionId provided", () => {
		const { transform } = setup();
		const result = transform(
			{ type: "unknown_tool", toolName: "myTool" },
			undefined,
		);
		expect(result).toBeNull();
	});
});

// ─── Extension errors ──────────────────────────────────────────────

describe("extension errors", () => {
	it("handles Error objects", () => {
		const { transform } = setup();
		const result = transform({
			type: "extension_error",
			error: new Error("bridge failed"),
		});
		expect(result.type).toBe("text");
		expect(result.content).toContain("Error: bridge failed");
	});

	it("handles plain objects", () => {
		const { transform } = setup();
		const result = transform({
			type: "extension_error",
			error: { message: "something broke", name: "CustomError" },
		});
		expect(result.type).toBe("text");
		expect(result.content).toContain("CustomError");
		expect(result.content).toContain("something broke");
	});

	it("handles string errors", () => {
		const { transform } = setup();
		const result = transform({
			type: "extension_error",
			error: "plain string error",
		});
		expect(result.type).toBe("text");
		expect(result.content).toContain("plain string error");
	});
});

// ─── Unknown events ────────────────────────────────────────────────

describe("unknown events", () => {
	it("returns null for unrecognized event types", () => {
		const { transform } = setup();
		expect(transform({ type: "future_event_type" })).toBeNull();
	});

	it("returns null for events with no type", () => {
		const { transform } = setup();
		expect(transform({})).toBeNull();
	});
});

// ─── Tool summary formatters ───────────────────────────────────────

describe("tool summary formatters", () => {
	it("formats bash commands with $ prefix", () => {
		const { transform } = setup();
		const result = transform({
			type: "tool_execution_start",
			toolName: "bash",
			toolCallId: "c1",
			args: { command: "npm test" },
		});
		expect(result.summary.summary).toBe("$ npm test");
	});

	it("formats read with file path", () => {
		const { transform } = setup();
		const result = transform({
			type: "tool_execution_start",
			toolName: "read",
			toolCallId: "c2",
			args: { file_path: "/src/index.js" },
		});
		expect(result.summary.summary).toBe("Reading /src/index.js");
	});

	it("formats write with file path", () => {
		const { transform } = setup();
		const result = transform({
			type: "tool_execution_start",
			toolName: "write",
			toolCallId: "c3",
			args: { file_path: "/src/new.js" },
		});
		expect(result.summary.summary).toBe("Writing /src/new.js");
	});

	it("formats edit with file path", () => {
		const { transform } = setup();
		const result = transform({
			type: "tool_execution_start",
			toolName: "edit",
			toolCallId: "c4",
			args: { file_path: "/src/fix.js", old_string: "bug", new_string: "fix" },
		});
		expect(result.summary.summary).toBe("Editing /src/fix.js");
	});

	it("formats glob with pattern", () => {
		const { transform } = setup();
		const result = transform({
			type: "tool_execution_start",
			toolName: "glob",
			toolCallId: "c5",
			args: { pattern: "**/*.test.js" },
		});
		expect(result.summary.summary).toBe("Finding **/*.test.js");
	});

	it("formats grep with pattern", () => {
		const { transform } = setup();
		const result = transform({
			type: "tool_execution_start",
			toolName: "grep",
			toolCallId: "c6",
			args: { pattern: "TODO" },
		});
		expect(result.summary.summary).toBe("Searching: TODO");
	});

	it("uses tool name for unknown tools", () => {
		const { transform } = setup();
		const result = transform({
			type: "tool_execution_start",
			toolName: "custom_tool",
			toolCallId: "c7",
			args: {},
		});
		expect(result.summary.summary).toBe("custom_tool");
	});
});

// ─── Input sanitization ────────────────────────────────────────────

describe("input sanitization", () => {
	it("redacts Authorization headers from bash commands", () => {
		const { transform } = setup();
		const result = transform({
			type: "tool_execution_start",
			toolName: "bash",
			toolCallId: "c1",
			args: {
				command:
					'curl -H "Authorization: Bearer sk-secret-token-12345" https://api.example.com',
			},
		});
		expect(result.input.command).not.toContain("sk-secret-token-12345");
		expect(result.input.command).toContain("[REDACTED]");
	});

	it("redacts API keys from bash commands", () => {
		const { transform } = setup();
		const result = transform({
			type: "tool_execution_start",
			toolName: "bash",
			toolCallId: "c1",
			args: { command: "export API_KEY=supersecret123" },
		});
		expect(result.input.command).not.toContain("supersecret123");
		expect(result.input.command).toContain("[REDACTED]");
	});

	it("strips content from write operations", () => {
		const { transform } = setup();
		const result = transform({
			type: "tool_execution_start",
			toolName: "write",
			toolCallId: "c1",
			args: { file_path: "/src/new.js", content: "const x = 1;" },
		});
		expect(result.input).toEqual({ file_path: "/src/new.js" });
	});

	it("truncates old_string/new_string in edit operations", () => {
		const { transform } = setup();
		const result = transform({
			type: "tool_execution_start",
			toolName: "edit",
			toolCallId: "c1",
			args: {
				file_path: "/src/app.js",
				old_string: "a".repeat(100),
				new_string: "b".repeat(100),
			},
		});
		expect(result.input.old_string.length).toBeLessThan(100);
		expect(result.input.new_string.length).toBeLessThan(100);
	});
});

// ─── Per-turn isolation ────────────────────────────────────────────

describe("per-turn isolation", () => {
	it("each createEventTransformer call has independent state", () => {
		const { transform: t1 } = createEventTransformer();
		const { transform: t2 } = createEventTransformer();

		// t1 sees a dropped tool
		const r1 = t1({ type: "unknown_tool", toolName: "myTool" }, "sess-1");
		expect(r1).not.toBeNull();

		// t2 also sees it as first occurrence (independent state)
		const r2 = t2({ type: "unknown_tool", toolName: "myTool" }, "sess-1");
		expect(r2).not.toBeNull();
	});
});
