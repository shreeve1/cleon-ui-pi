import { readFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import logger from './logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = path.join(__dirname, '../config/models.json');

let cachedConfig = null;

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

/**
 * Load and parse the models configuration file.
 * Caches the result in memory for subsequent calls.
 * 
 * @returns {Promise<{models: Array<{id, provider, key, name}>, default?: string}>}
 */
export async function loadModelsConfig() {
  if (cachedConfig) {
    return cachedConfig;
  }
  
  try {
    const fileContent = await readFile(CONFIG_PATH, 'utf-8');
    const parsed = JSON.parse(fileContent);
    
    if (!parsed.models || !Array.isArray(parsed.models)) {
      logger.warn('Models config missing "models" array, returning empty list');
      cachedConfig = { models: [], default: parsed.default };
      return cachedConfig;
    }
    
    const models = [];
    
    for (const entry of parsed.models) {
      if (typeof entry !== 'string') {
        logger.warn('Skipping invalid model entry (not a string)', { entry });
        continue;
      }
      
      const parts = entry.split('/');
      if (parts.length < 2) {
        logger.warn('Skipping invalid model entry (missing provider)', { entry });
        continue;
      }
      
      const provider = parts[0];
      const modelId = parts.slice(1).join('/');
      
      if (!provider || !modelId) {
        logger.warn('Skipping invalid model entry (empty provider or model)', { entry });
        continue;
      }
      
      models.push({
        id: modelId,
        provider,
        key: entry,
        name: generateDisplayName(modelId)
      });
    }
    
    cachedConfig = {
      models,
      default: parsed.default
    };
    
    logger.info('Loaded models config', { count: models.length });
    return cachedConfig;
    
  } catch (err) {
    if (err.code === 'ENOENT') {
      logger.warn('Models config file not found, returning empty list', { path: CONFIG_PATH });
    } else {
      logger.error('Error reading models config', { error: err.message, path: CONFIG_PATH });
    }
    
    cachedConfig = { models: [] };
    return cachedConfig;
  }
}
