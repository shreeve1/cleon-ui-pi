import { afterEach, describe, expect, it, vi } from "vitest";

let availableModels;
let configText;
let readFileError;
let authCreateError;
let registryError;
let readFileMock;
let authCreateMock;
let modelRegistryMock;
let getAvailableMock;

async function loadModelsModule() {
	vi.resetModules();

	readFileMock = vi.fn(async () => {
		if (readFileError) throw readFileError;
		return configText;
	});

	vi.doMock("fs/promises", () => ({
		readFile: readFileMock,
	}));

	vi.doMock("@mariozechner/pi-coding-agent", () => {
		authCreateMock = vi.fn(() => {
			if (authCreateError) throw authCreateError;
			return { kind: "auth" };
		});
		getAvailableMock = vi.fn(() => availableModels);
		modelRegistryMock = vi.fn();
		class ModelRegistry {
			constructor(authStorage) {
				modelRegistryMock(authStorage);
				if (registryError) throw registryError;
				return { getAvailable: getAvailableMock };
			}
		}

		return {
			AuthStorage: { create: authCreateMock },
			ModelRegistry,
		};
	});

	vi.doMock("../../server/logger.js", () => ({
		default: {
			info: vi.fn(),
			warn: vi.fn(),
			error: vi.fn(),
		},
	}));

	return import("../../server/models.js");
}

afterEach(() => {
	vi.resetModules();
	vi.unmock("fs/promises");
	vi.unmock("@mariozechner/pi-coding-agent");
	vi.unmock("../../server/logger.js");
	availableModels = undefined;
	configText = undefined;
	readFileError = undefined;
	authCreateError = undefined;
	registryError = undefined;
});

describe("loadModelsConfig", () => {
	it("maps authenticated SDK models to the frontend dropdown contract", async () => {
		availableModels = [
			{
				provider: "anthropic",
				id: "claude-sonnet-4-5",
				name: "Claude Sonnet 4.5",
			},
			{
				provider: "zai",
				id: "glm-5.1",
			},
		];
		configText = JSON.stringify({
			models: ["zai/glm-5.1"],
			default: "anthropic/claude-sonnet-4-5",
		});

		const { loadModelsConfig } = await loadModelsModule();
		const result = await loadModelsConfig();

		expect(authCreateMock).toHaveBeenCalledTimes(1);
		expect(modelRegistryMock).toHaveBeenCalledWith({ kind: "auth" });
		expect(getAvailableMock).toHaveBeenCalledTimes(1);
		expect(result).toEqual({
			models: [
				{
					id: "claude-sonnet-4-5",
					provider: "anthropic",
					key: "anthropic/claude-sonnet-4-5",
					name: "Claude Sonnet 4.5",
				},
				{
					id: "glm-5.1",
					provider: "zai",
					key: "zai/glm-5.1",
					name: "GLM 5.1",
				},
			],
			default: "anthropic/claude-sonnet-4-5",
		});
	});

	it("filters the configured default when it is not authenticated", async () => {
		availableModels = [
			{ provider: "zai", id: "glm-5.1", name: "GLM 5.1" },
		];
		configText = JSON.stringify({ default: "anthropic/claude-sonnet-4-5" });

		const { loadModelsConfig } = await loadModelsModule();
		const result = await loadModelsConfig();

		expect(result.models).toEqual([
			{
				id: "glm-5.1",
				provider: "zai",
				key: "zai/glm-5.1",
				name: "GLM 5.1",
			},
		]);
		expect(result.default).toBeNull();
	});

	it("reads authenticated models and configured default fresh each call", async () => {
		availableModels = [
			{ provider: "zai", id: "glm-5.1", name: "GLM 5.1" },
		];
		configText = JSON.stringify({ default: "zai/glm-5.1" });

		const { loadModelsConfig } = await loadModelsModule();
		await expect(loadModelsConfig()).resolves.toMatchObject({
			default: "zai/glm-5.1",
		});

		availableModels = [
			{
				provider: "openai-codex",
				id: "gpt-5-codex",
				name: "GPT-5 Codex",
			},
		];
		configText = JSON.stringify({ default: "openai-codex/gpt-5-codex" });

		await expect(loadModelsConfig()).resolves.toEqual({
			models: [
				{
					id: "gpt-5-codex",
					provider: "openai-codex",
					key: "openai-codex/gpt-5-codex",
					name: "GPT-5 Codex",
				},
			],
			default: "openai-codex/gpt-5-codex",
		});
		expect(readFileMock).toHaveBeenCalledTimes(2);
		expect(modelRegistryMock).toHaveBeenCalledTimes(2);
	});

	it("still returns authenticated models when config/models.json is missing", async () => {
		availableModels = [
			{ provider: "zai", id: "glm-5.1", name: "GLM 5.1" },
		];
		readFileError = Object.assign(new Error("missing"), { code: "ENOENT" });

		const { loadModelsConfig } = await loadModelsModule();
		const result = await loadModelsConfig();

		expect(result).toEqual({
			models: [
				{
					id: "glm-5.1",
					provider: "zai",
					key: "zai/glm-5.1",
					name: "GLM 5.1",
				},
			],
			default: null,
		});
	});

	it("returns an empty list when Pi SDK discovery fails", async () => {
		authCreateError = new Error("auth failed");
		configText = JSON.stringify({ default: "zai/glm-5.1" });

		const { loadModelsConfig } = await loadModelsModule();
		await expect(loadModelsConfig()).resolves.toEqual({
			models: [],
			default: null,
		});
	});
});
