import { readFile } from "fs/promises";
import path from "path";
import os from "os";
import { fileURLToPath } from "url";
import logger from "./logger.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = path.join(__dirname, "../config/models.json");

const CACHE_TTL_MS = 60_000; // 1 minute
let cachedConfig = null;
let cacheTime = 0;
let registry = null;
let registryDisabled = false;

/**
 * Get or create a Pi ModelRegistry instance.
 * Uses Pi's built-in model discovery (built-in + custom from models.json)
 * which correctly resolves models like openai-codex/gpt-5.5 that aren't
 * in the static models.json but are available via OAuth providers.
 */
async function getRegistry() {
	if (registry) return registry;
	if (registryDisabled) return null;

	try {
		const piPkg =
			os.homedir() + "/.pi/agent/node_modules/@earendil-works/pi-coding-agent";

		const { ModelRegistry, AuthStorage } = await import(
			path.join(piPkg, "dist/index.js")
		);

		const authStorage = AuthStorage.create();
		registry = ModelRegistry.create(authStorage);
		logger.info("Created Pi ModelRegistry", {
			available: registry.getAvailable().length,
		});
		return registry;
	} catch (err) {
		logger.error("Failed to create Pi ModelRegistry", {
			error: err.message,
		});
		return null;
	}
}

/**
 * Read the local config allowlist/default override.
 * @returns {Promise<{allowlist: string[]|null, default: string|null}>}
 */
async function readLocalConfig() {
	let raw;
	try {
		raw = await readFile(CONFIG_PATH, "utf-8");
	} catch (err) {
		if (err.code === "ENOENT") {
			logger.info("No local models.json config, using Pi registry directly");
		} else {
			logger.error("Error reading models config", {
				error: err.message,
				path: CONFIG_PATH,
			});
		}
		return { allowlist: null, default: null };
	}

	const parsed = JSON.parse(raw);
	return {
		allowlist: Array.isArray(parsed.models) ? parsed.models : null,
		default: parsed.default || null,
	};
}

/**
 * Load models from Pi SDK ModelRegistry (built-in + custom + OAuth),
 * optionally filtered by local config allowlist.
 * Caches for CACHE_TTL_MS so config changes propagate within ~1 minute.
 *
 * @returns {Promise<{models: Array<{id, provider, key, name}>, default?: string}>}
 */
/**
 * Inject a registry instance (for testing only).
 * @param {{ getAvailable: Function, refresh: Function } | null} reg
 */
export function _setRegistry(reg) {
	if (reg === null) {
		registry = null;
		registryDisabled = true;
	} else {
		registry = reg;
		registryDisabled = false;
	}
	cachedConfig = null;
	cacheTime = 0;
}

/**
 * Load models from Pi SDK ModelRegistry (built-in + custom + OAuth),
 * optionally filtered by local config allowlist.
 * Caches for CACHE_TTL_MS so config changes propagate within ~1 minute.
 *
 * @returns {Promise<{models: Array<{id, provider, key, name}>, default?: string}>}
 */
export async function loadModelsConfig() {
	const now = Date.now();
	if (cachedConfig && now - cacheTime < CACHE_TTL_MS) {
		return cachedConfig;
	}

	const reg = await getRegistry();
	let piModels = [];

	if (reg) {
		// Refresh to pick up any auth/config changes since startup
		reg.refresh();
		const available = reg.getAvailable();
		piModels = available.map((m) => ({
			id: m.id,
			provider: m.provider,
			key: `${m.provider}/${m.id}`,
			name: m.name || m.id,
		}));
	}

	const localConfig = await readLocalConfig();
	let models = piModels;

	// If local config has an allowlist, filter to only those models
	if (localConfig.allowlist && localConfig.allowlist.length > 0) {
		const allowedKeys = new Set(localConfig.allowlist);
		models = piModels.filter((m) => allowedKeys.has(m.key));

		// Warn about allowlist entries not found in Pi registry
		const foundKeys = new Set(models.map((m) => m.key));
		for (const key of allowedKeys) {
			if (!foundKeys.has(key)) {
				logger.warn("Config allowlist model not found in Pi registry", {
					key,
				});
			}
		}
	}

	const defaultModel =
		localConfig.default || (models.length > 0 ? models[0].key : null);

	cachedConfig = { models, default: defaultModel };
	cacheTime = now;

	logger.info("Loaded models from Pi SDK registry", {
		total: piModels.length,
		shown: models.length,
		filtered: localConfig.allowlist ? "yes" : "no",
		default: defaultModel,
	});

	return cachedConfig;
}
