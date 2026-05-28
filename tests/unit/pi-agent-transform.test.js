import { describe, expect, it } from "vitest";
import { _transformEvent } from "../../server/pi-agent.js";

describe("pi-agent transformEvent", () => {
	it("surfaces assistant turn errors from message stopReason", () => {
		const transformed = _transformEvent({
			type: "turn_end",
			message: {
				stopReason: "error",
				errorMessage:
					"Error: Codex SSE response headers timed out after 10000ms",
			},
		});

		expect(transformed.type).toBe("_agent_error");
		expect(transformed.message).toBe(
			"Error: Codex SSE response headers timed out after 10000ms",
		);
	});

	it("extracts nested provider error messages from JSON payloads", () => {
		const transformed = _transformEvent({
			type: "turn_end",
			message: {
				stopReason: "error",
				errorMessage:
					'400 {"type":"error","error":{"type":"invalid_request_error","message":"Provider rejected request"}}',
			},
		});

		expect(transformed.type).toBe("_agent_error");
		expect(transformed.message).toBe("Provider rejected request");
	});
});
