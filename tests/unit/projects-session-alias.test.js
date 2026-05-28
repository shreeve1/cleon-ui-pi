import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import { promises as fs } from "fs";
import path from "path";
import os from "os";

let tmpHome;
let fakeManager;

beforeEach(async () => {
	tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), "projects-alias-"));
	fakeManager = {
		aliases: new Map(),
		files: new Map(),
		getSessionAliasesForProject(projectPath) {
			return this.aliases.get(projectPath) || new Map();
		},
		getSessionFile(sessionId, projectPath) {
			return this.files.get(`${projectPath}:${sessionId}`) || null;
		},
	};
});

afterEach(async () => {
	vi.resetModules();
	vi.unmock("os");
	vi.unmock("../../server/session-manager-instance.js");
	await fs.rm(tmpHome, { recursive: true, force: true });
});

async function loadProjectRoutes() {
	vi.resetModules();
	vi.doMock("os", () => ({
		default: {
			homedir: () => tmpHome,
			tmpdir: () => os.tmpdir(),
		},
		homedir: () => tmpHome,
		tmpdir: () => os.tmpdir(),
	}));
	vi.doMock("../../server/session-manager-instance.js", () => ({
		getSdkSessionManager: () => fakeManager,
	}));

	const { projectRoutes } = await import("../../server/projects.js");
	const app = express();
	app.use("/", projectRoutes);

	return app;
}

async function requestJson(app, route) {
	const server = app.listen(0);
	try {
		const { port } = server.address();
		const response = await fetch(`http://127.0.0.1:${port}${route}`);
		expect(response.status).toBe(200);
		return await response.json();
	} finally {
		await new Promise((resolve) => server.close(resolve));
	}
}

async function writeSession(projectDirName, sessionId, entries = []) {
	const sessionDir = path.join(
		tmpHome,
		".pi",
		"agent",
		"sessions",
		projectDirName,
	);
	await fs.mkdir(sessionDir, { recursive: true });
	const sessionFile = path.join(
		sessionDir,
		`2026-05-28T00-00-00-000Z_${sessionId}.jsonl`,
	);
	const lines = [
		{ type: "session", id: sessionId, cwd: "/tmp/project" },
		...entries,
	].map((entry) => JSON.stringify(entry));
	await fs.writeFile(sessionFile, lines.join("\n") + "\n", "utf8");
	return sessionFile;
}

describe("project session alias resolution", () => {
	it("lists Cleon logical session IDs when a manager alias points at a Pi session file", async () => {
		const piSessionId = "d70b850c-d37d-42de-a482-07ae6a810e8e";
		const logicalSessionId = "c9a3560e-3870-4557-aae9-f9e763e96fbe";
		const sessionFile = await writeSession("--tmp-project--", piSessionId, [
			{
				type: "message",
				timestamp: "2026-05-28T00:00:01Z",
				message: { role: "user", content: [{ type: "text", text: "hello" }] },
			},
		]);
		fakeManager.aliases.set(
			"/tmp/project",
			new Map([[path.resolve(sessionFile), logicalSessionId]]),
		);

		const app = await loadProjectRoutes();
		const sessions = await requestJson(app, "/--tmp-project--/sessions");

		expect(sessions[0].id).toBe(logicalSessionId);
		expect(sessions[0].source).toBe("pi");
	});

	it("resolves a Cleon logical session ID through the manager mapping", async () => {
		const piSessionId = "d70b850c-d37d-42de-a482-07ae6a810e8e";
		const logicalSessionId = "c9a3560e-3870-4557-aae9-f9e763e96fbe";
		const sessionFile = await writeSession("--tmp-project--", piSessionId, [
			{
				type: "message",
				timestamp: "2026-05-28T00:00:01Z",
				message: {
					role: "user",
					content: [{ type: "text", text: "mapped hello" }],
				},
			},
		]);
		fakeManager.files.set(`/tmp/project:${logicalSessionId}`, sessionFile);

		const app = await loadProjectRoutes();
		const data = await requestJson(
			app,
			`/--tmp-project--/sessions/${logicalSessionId}/messages`,
		);

		expect(data.messages).toHaveLength(1);
		expect(data.messages[0].content).toBe("mapped hello");
	});

	it("still resolves a raw Pi session UUID by filename", async () => {
		const piSessionId = "d70b850c-d37d-42de-a482-07ae6a810e8e";
		await writeSession("--tmp-project--", piSessionId, [
			{
				type: "message",
				timestamp: "2026-05-28T00:00:01Z",
				message: {
					role: "user",
					content: [{ type: "text", text: "raw hello" }],
				},
			},
		]);

		const app = await loadProjectRoutes();
		const data = await requestJson(
			app,
			`/--tmp-project--/sessions/${piSessionId}/messages`,
		);

		expect(data.messages).toHaveLength(1);
		expect(data.messages[0].content).toBe("raw hello");
	});

	it("rejects manager mappings outside the project session directory", async () => {
		const piSessionId = "d70b850c-d37d-42de-a482-07ae6a810e8e";
		const logicalSessionId = "c9a3560e-3870-4557-aae9-f9e763e96fbe";
		await writeSession("--tmp-project--", piSessionId);
		const outsideFile = path.join(tmpHome, "outside.jsonl");
		await fs.writeFile(
			outsideFile,
			JSON.stringify({
				type: "message",
				message: { role: "user", content: "outside" },
			}) + "\n",
		);
		fakeManager.files.set(`/tmp/project:${logicalSessionId}`, outsideFile);

		const app = await loadProjectRoutes();
		const data = await requestJson(
			app,
			`/--tmp-project--/sessions/${logicalSessionId}/messages`,
		);

		expect(data.messages).toEqual([]);
	});
});
