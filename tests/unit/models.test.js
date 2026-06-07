import { describe, it, expect, vi, beforeEach } from "vitest";
import path from "path";

// Mock logger
vi.mock("../../server/logger.js", () => ({
	default: {
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
	},
}));

// Mock fs/promises for local config reading
vi.mock("fs/promises", () => ({
	readFile: vi.fn(),
}));

import { readFile } from "fs/promises";

const CONFIG_PATH = path.resolve("config/models.json");

const mockGetAvailable = vi.fn();
const mockRefresh = vi.fn();
const mockRegistry = {
	getAvailable: mockGetAvailable,
	refresh: mockRefresh,
};

async function freshImport() {
	vi.resetModules();
	const mod = await import("../../server/models.js?" + Date.now());
	return mod;
}

describe("loadModelsConfig", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		readFile.mockRejectedValue(
			Object.assign(new Error("ENOENT"), { code: "ENOENT" }),
		);
		mockGetAvailable.mockReturnValue([]);
		mockRefresh.mockReturnValue(undefined);
	});

	it("returns all models from Pi SDK registry when no local config exists", async () => {
		mockGetAvailable.mockReturnValue([
			{ id: "glm-5", provider: "zai", name: "GLM 5" },
			{ id: "glm-5.1", provider: "zai", name: "GLM 5.1" },
			{ id: "qwen3:8b", provider: "ollama", name: "Qwen 3 8B" },
		]);

		const { loadModelsConfig, _setRegistry } = await freshImport();
		_setRegistry(mockRegistry);
		const result = await loadModelsConfig();

		expect(result.models).toHaveLength(3);
		expect(result.models.map((m) => m.key)).toEqual(
			expect.arrayContaining(["zai/glm-5", "zai/glm-5.1", "ollama/qwen3:8b"]),
		);
		expect(result.default).toBe("zai/glm-5");
	});

	it("filters to allowlist when local config has models array", async () => {
		mockGetAvailable.mockReturnValue([
			{ id: "glm-5", provider: "zai", name: "GLM 5" },
			{ id: "glm-5.1", provider: "zai", name: "GLM 5.1" },
			{ id: "qwen3:8b", provider: "ollama", name: "Qwen 3 8B" },
		]);

		readFile.mockImplementation((fp) => {
			if (fp === CONFIG_PATH) {
				return Promise.resolve(
					JSON.stringify({
						models: ["zai/glm-5.1"],
						default: "zai/glm-5.1",
					}),
				);
			}
			return Promise.reject(
				Object.assign(new Error("ENOENT"), { code: "ENOENT" }),
			);
		});

		const { loadModelsConfig, _setRegistry } = await freshImport();
		_setRegistry(mockRegistry);
		const result = await loadModelsConfig();

		expect(result.models).toHaveLength(1);
		expect(result.models[0].key).toBe("zai/glm-5.1");
		expect(result.default).toBe("zai/glm-5.1");
	});

	it("does not collapse to single model when Pi registry has multiple providers", async () => {
		mockGetAvailable.mockReturnValue([
			{ id: "glm-4.7", provider: "zai", name: "GLM 4.7" },
			{ id: "glm-5", provider: "zai", name: "GLM 5" },
			{ id: "glm-5.1", provider: "zai", name: "GLM 5.1" },
			{ id: "qwen3:8b", provider: "ollama", name: "Qwen 3 8B" },
			{ id: "hermes", provider: "ollama", name: "Hermes" },
			{ id: "MiniMax-M2.7", provider: "minimax", name: "MiniMax M2.7" },
		]);

		const { loadModelsConfig, _setRegistry } = await freshImport();
		_setRegistry(mockRegistry);
		const result = await loadModelsConfig();

		expect(result.models).toHaveLength(6);
		expect(result.models.length).toBeGreaterThan(1);
	});

	it("includes OAuth models like openai-codex/gpt-5.5", async () => {
		mockGetAvailable.mockReturnValue([
			{ id: "glm-5.1", provider: "zai", name: "GLM 5.1" },
			{ id: "gpt-5.5", provider: "openai-codex", name: "GPT-5.5" },
		]);

		const { loadModelsConfig, _setRegistry } = await freshImport();
		_setRegistry(mockRegistry);
		const result = await loadModelsConfig();

		expect(result.models).toHaveLength(2);
		const codex = result.models.find((m) => m.key === "openai-codex/gpt-5.5");
		expect(codex).toBeDefined();
		expect(codex.name).toBe("GPT-5.5");
	});

	it("uses Pi model name from registry", async () => {
		mockGetAvailable.mockReturnValue([
			{ id: "glm-5.1", provider: "zai", name: "GLM 5.1 (z.ai)" },
		]);

		const { loadModelsConfig, _setRegistry } = await freshImport();
		_setRegistry(mockRegistry);
		const result = await loadModelsConfig();

		expect(result.models[0].name).toBe("GLM 5.1 (z.ai)");
	});

	it("returns empty list when registry is null", async () => {
		const { loadModelsConfig, _setRegistry } = await freshImport();
		_setRegistry(null);
		const result = await loadModelsConfig();

		expect(result.models).toEqual([]);
		expect(result.default).toBeNull();
	});
});
