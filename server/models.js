import { readFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { AuthStorage, ModelRegistry } from '@mariozechner/pi-coding-agent';
import logger from './logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = path.join(__dirname, '../config/models.json');

/**
 * Generate a human-readable display name from a model ID.
 * Examples:
 *   claude-sonnet-4-5 → Claude Sonnet 4.5
 *   gpt-5 → GPT-5
 *   gemini-2.5-pro → Gemini 2.5 Pro
 *
 * @param {string} modelId - The model ID (e.g., "claude-sonnet-4-5")
 * @returns {string} - Human-readable display name
 */
function generateDisplayName(modelId) {
  // Remove date suffixes like -20250514
  let name = modelId.replace(/-\d{8}$/, '');
  
  // Replace hyphens with spaces
  name = name.replace(/-/g, ' ');
  
  // Capitalize each word
  name = name.split(' ').map(word => {
    if (word.length === 0) return word;
    return word.charAt(0).toUpperCase() + word.slice(1);
  }).join(' ');
  
  // Special-case 'gpt' and 'glm' to uppercase
  name = name.replace(/\bGpt\b/g, 'GPT');
  name = name.replace(/\bGlm\b/g, 'GLM');
  
  // Turn trailing digit pairs like "4 5" into "4.5"
  name = name.replace(/(\d) (\d)(?=\s|$)/g, '$1.$2');
  
  return name;
}

async function loadConfiguredDefault() {
  try {
    const fileContent = await readFile(CONFIG_PATH, 'utf-8');
    const parsed = JSON.parse(fileContent);

    if (parsed.default && typeof parsed.default !== 'string') {
      logger.warn('Models config default must be a string', {
        default: parsed.default
      });
      return null;
    }

    return parsed.default || null;
  } catch (err) {
    if (err.code === 'ENOENT') {
      logger.warn('Models config file not found; no configured default available', {
        path: CONFIG_PATH
      });
    } else {
      logger.error('Error reading models config default', {
        error: err.message,
        path: CONFIG_PATH
      });
    }

    return null;
  }
}

function isValidRegistryModel(model) {
  return (
    model &&
    typeof model.provider === 'string' &&
    model.provider.length > 0 &&
    typeof model.id === 'string' &&
    model.id.length > 0
  );
}

function toDropdownModel(model) {
  return {
    id: model.id,
    provider: model.provider,
    key: `${model.provider}/${model.id}`,
    name: model.name || generateDisplayName(model.id)
  };
}

/**
 * Load authenticated Pi SDK models for the frontend dropdown.
 * Availability is intentionally fresh per request; only the configured default
 * is read from config/models.json, and only returned when authenticated.
 *
 * @returns {Promise<{models: Array<{id, provider, key, name}>, default: string|null}>}
 */
export async function loadModelsConfig() {
  try {
    const authStorage = AuthStorage.create();
    const modelRegistry = new ModelRegistry(authStorage);
    const availableModels = await modelRegistry.getAvailable();

    const models = (Array.isArray(availableModels) ? availableModels : [])
      .filter(isValidRegistryModel)
      .map(toDropdownModel);

    const configuredDefault = await loadConfiguredDefault();
    const defaultModel = configuredDefault && models.some(model => model.key === configuredDefault)
      ? configuredDefault
      : null;

    if (configuredDefault && !defaultModel) {
      logger.warn('Configured default model is not authenticated; returning no default', {
        default: configuredDefault
      });
    }

    logger.info('Loaded authenticated Pi models', {
      count: models.length,
      default: defaultModel
    });

    return { models, default: defaultModel };
  } catch (err) {
    logger.error('Error loading authenticated Pi models', { error: err.message });
    return { models: [], default: null };
  }
}
