import { describe, expect, it } from "vitest";
import {
	broadcastToSession,
	clearSessionBuffer,
	getBroadcastStats,
	startSessionBuffer,
} from "../../server/broadcast.js";

describe("broadcast buffer lifecycle", () => {
	it("does not let an old delayed clear remove a newer buffer", () => {
		const sessionId = "broadcast-generation-test";
		const firstGeneration = startSessionBuffer(sessionId);
		broadcastToSession(sessionId, { type: "message", sessionId, data: "old" });

		const secondGeneration = startSessionBuffer(sessionId);
		broadcastToSession(sessionId, { type: "message", sessionId, data: "new" });

		expect(clearSessionBuffer(sessionId, firstGeneration)).toBe(false);
		expect(getBroadcastStats().buffers).toBe(1);

		expect(clearSessionBuffer(sessionId, secondGeneration)).toBe(true);
		expect(getBroadcastStats().buffers).toBe(0);
	});
});
