# Model Dropdown Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the hardcoded 3-model toggle with a configurable dropdown populated from `config/models.json`, with actual model switching via pi RPC `set_model`.

**Architecture:** Server reads `config/models.json` at startup, exposes `GET /api/models`. Frontend fetches on load, renders dropdown. On chat send, server calls `set_model` on the RPC process before prompting.

**Tech Stack:** Vanilla JS frontend, Express server, pi RPC protocol (JSONL over stdin/stdout).

---

### Task 1: Create config/models.json

**Files:**
- Create: `config/models.json`

**Step 1: Create the config file**

```json
{
  "models": [
    "anthropic/claude-sonnet-4-5",
    "anthropic/claude-sonnet-4-6",
    "anthropic/claude-opus-4-5",
    "openai/gpt-5",
    "google-gemini-cli/gemini-2.5-pro"
  ],
  "default": "anthropic/claude-sonnet-4-5"
}
```

**Step 2: Commit**

```bash
git add config/models.json
git commit -m "feat: add model config file"
```

---

### Task 2: Add server-side model config loader and REST endpoint

**Files:**
- Create: `server/models.js`
- Modify: `server/index.js:127-145` (add route after `/api/commands`)

**Step 1: Create `server/models.js`**

```js
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import logger from './logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = path.join(__dirname, '..', 'config', 'models.json');

let cachedConfig = null;

/**
 * Generate a human-readable display name from a model ID.
 * e.g. "claude-sonnet-4-5" -> "Claude Sonnet 4.5"
 *      "gpt-5" -> "GPT-5"
 *      "gemini-2.5-pro" -> "Gemini 2.5 Pro"
 */
function toDisplayName(modelId) {
  return modelId
    // Remove date suffixes like -20250514
    .replace(/-\d{8}$/, '')
    // Replace hyphens with spaces
    .replace(/-/g, ' ')
    // Capitalize words, special-case known prefixes
    .replace(/\b\w+/g, (word) => {
      const upper = word.toUpperCase();
      if (['gpt', 'glm'].includes(word)) return upper;
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    // Turn version-like sequences "4 5" at end into "4.5"
    .replace(/(\d+)\s+(\d+)$/, '$1.$2')
    // Turn "4 0" patterns into "4.0"  
    .replace(/(\d+)\s+(\d+)/g, '$1.$2');
}

/**
 * Load and cache the models config.
 */
export async function loadModelsConfig() {
  if (cachedConfig) return cachedConfig;

  try {
    const raw = await fs.readFile(CONFIG_PATH, 'utf-8');
    const config = JSON.parse(raw);

    if (!config.models || !Array.isArray(config.models)) {
      logger.warn('config/models.json missing "models" array');
      cachedConfig = { models: [], default: null };
      return cachedConfig;
    }

    const models = config.models.map((entry) => {
      const slashIdx = entry.indexOf('/');
      if (slashIdx === -1) {
        logger.warn(`Invalid model entry (missing provider/): ${entry}`);
        return null;
      }
      const provider = entry.slice(0, slashIdx);
      const id = entry.slice(slashIdx + 1);
      return {
        id,
        provider,
        key: entry,
        name: toDisplayName(id),
      };
    }).filter(Boolean);

    cachedConfig = {
      models,
      default: config.default || (models.length > 0 ? models[0].key : null),
    };

    logger.info(`Loaded ${models.length} models from config`, {
      models: models.map(m => m.key),
      default: cachedConfig.default,
    });

    return cachedConfig;
  } catch (err) {
    if (err.code === 'ENOENT') {
      logger.warn('config/models.json not found — model dropdown will be empty');
    } else {
      logger.error('Failed to load config/models.json', { error: err.message });
    }
    cachedConfig = { models: [], default: null };
    return cachedConfig;
  }
}
```

**Step 2: Add the route in `server/index.js`**

After the `/api/commands` route (around line 145), add:

```js
import { loadModelsConfig } from './models.js';
```

Add at top with other imports (line 17 area).

Then add the route:

```js
// Models API - get configured models for dropdown
app.get('/api/models', authenticateToken, async (req, res) => {
  try {
    const config = await loadModelsConfig();
    res.json(config);
  } catch (err) {
    logger.error('Error fetching models config', { error: err.message });
    res.status(500).json({ error: 'Failed to fetch models config' });
  }
});
```

**Step 3: Verify the endpoint works**

```bash
# Start the server, then test:
curl -H "Authorization: Bearer <token>" http://localhost:3015/api/models
```

Expected: JSON with `models` array and `default` field.

**Step 4: Commit**

```bash
git add server/models.js server/index.js
git commit -m "feat: add /api/models endpoint with config loader"
```

---

### Task 3: Wire up RPC set_model in handleChat

**Files:**
- Modify: `server/pi-agent.js:887` (after `await rpc.start()`, before `await rpc.prompt()`)

**Step 1: Add set_model call in handleChat**

In `server/pi-agent.js`, find the block (around line 887):

```js
    await rpc.start();
```

After that line and before the event subscription block, add:

```js
    // Set the requested model before prompting
    if (msg.model && msg.model.includes('/')) {
      const slashIdx = msg.model.indexOf('/');
      const provider = msg.model.slice(0, slashIdx);
      const modelId = msg.model.slice(slashIdx + 1);
      try {
        const modelResp = await rpc.sendCommand({ type: 'set_model', provider, modelId });
        if (modelResp && modelResp.success) {
          console.log(`[Pi] Model set to ${msg.model}`);
        } else {
          console.warn(`[Pi] set_model failed for ${msg.model}:`, modelResp);
        }
      } catch (err) {
        console.error(`[Pi] Failed to set model ${msg.model}:`, err.message);
        // Don't fail the chat — continue with default model
      }
    }
```

**Step 2: Commit**

```bash
git add server/pi-agent.js
git commit -m "feat: send set_model RPC command before prompting"
```

---

### Task 4: Update frontend HTML — replace model button with dropdown

**Files:**
- Modify: `public/index.html:71-82` (replace model-btn-wrapper block)

**Step 1: Replace the model button HTML**

Find in `public/index.html` (lines 71-82):

```html
          <div id="model-btn-wrapper">
            <button type="button" id="model-btn" class="icon-btn model-default" title="Sonnet" disabled>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="3"/>
                <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/>
              </svg>
            </button>
            <div id="model-dropdown" class="dropdown-menu hidden">
              <button class="dropdown-item" data-model="haiku">Haiku</button>
              <button class="dropdown-item" data-model="sonnet">Sonnet</button>
              <button class="dropdown-item" data-model="opus">Opus</button>
            </div>
          </div>
```

Replace with:

```html
          <div id="model-btn-wrapper">
            <button type="button" id="model-btn" class="model-select-btn" title="Select model">
              <span id="model-btn-label">Loading...</span>
              <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
                <path d="M2 4l4 4 4-4"/>
              </svg>
            </button>
            <div id="model-dropdown" class="dropdown-menu hidden">
              <!-- Populated dynamically from /api/models -->
            </div>
          </div>
```

**Step 2: Commit**

```bash
git add public/index.html
git commit -m "feat: replace model icon button with text dropdown trigger"
```

---

### Task 5: Update frontend CSS — style the new model button

**Files:**
- Modify: `public/style.css:1967-2025` (replace model button styles)

**Step 1: Replace the model button CSS**

Find the `#model-btn` block (lines 1967-1989) and replace:

```css
#model-btn {
  width: 44px;
  height: 44px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-sm);
  border: 1px solid var(--neon-cyan);
  background: transparent;
  color: var(--neon-cyan);
  transition: all 0.2s ease;
}

#model-btn:hover:not(:disabled) {
  background: var(--bg-hover);
  box-shadow: 0 0 15px rgba(0, 240, 255, 0.3);
}

#model-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
```

With:

```css
.model-select-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 36px;
  padding: 0 12px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--neon-cyan);
  background: transparent;
  color: var(--neon-cyan);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
  white-space: nowrap;
  max-width: 180px;
  overflow: hidden;
  text-overflow: ellipsis;
}

.model-select-btn:hover {
  background: var(--bg-hover);
  box-shadow: 0 0 15px rgba(0, 240, 255, 0.3);
}

.model-select-btn svg {
  flex-shrink: 0;
  opacity: 0.7;
}
```

**Step 2: Commit**

```bash
git add public/style.css
git commit -m "style: update model button to text dropdown style"
```

---

### Task 6: Update frontend JS — fetch models and wire up dropdown

**Files:**
- Modify: `public/app.js:44` (state.selectedModel default)
- Modify: `public/app.js:688-752` (model dropdown logic)
- Modify: `public/app.js:848-851` (handleModelCommand)
- Modify: `public/app.js:3016-3020` (DOMContentLoaded init)

**Step 1: Update state initialization (line 44)**

Find:
```js
  selectedModel: localStorage.getItem('selectedModel') || 'sonnet',
```

Replace with:
```js
  selectedModel: localStorage.getItem('selectedModel') || null,
  availableModels: [],
  defaultModel: null,
```

**Step 2: Replace model selection functions (lines 688-752)**

Find the block starting at `const modelBtn = $('#model-btn');` through the `document.addEventListener('click'` closing for model dropdown. Replace the model-related code:

```js
const modelBtn = $('#model-btn');
const modelBtnLabel = $('#model-btn-label');
const modelDropdown = $('#model-dropdown');
```

Then find and replace the `setModel` function and its event listeners (lines 730-752):

```js
// Model selection
function setModel(modelKey) {
  state.selectedModel = modelKey;
  if (modelKey) {
    localStorage.setItem('selectedModel', modelKey);
  }
  // Update button label
  const model = state.availableModels.find(m => m.key === modelKey);
  if (modelBtnLabel) {
    modelBtnLabel.textContent = model ? model.name : (modelKey || 'No model');
  }
  if (modelBtn) {
    modelBtn.title = model ? `${model.provider}/${model.id}` : '';
  }
  // Update active state in dropdown
  modelDropdown.querySelectorAll('.dropdown-item').forEach(item => {
    item.classList.toggle('active', item.dataset.model === modelKey);
  });
  modelDropdown.classList.add('hidden');
}

// Fetch models from server and populate dropdown
async function fetchAndPopulateModels() {
  try {
    const token = localStorage.getItem('token');
    const resp = await fetch('/api/models', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const config = await resp.json();

    state.availableModels = config.models || [];
    state.defaultModel = config.default || null;

    // Clear existing dropdown items
    modelDropdown.innerHTML = '';

    // Populate dropdown
    state.availableModels.forEach(model => {
      const btn = document.createElement('button');
      btn.className = 'dropdown-item';
      btn.dataset.model = model.key;
      btn.textContent = model.name;
      btn.addEventListener('click', () => setModel(model.key));
      modelDropdown.appendChild(btn);
    });

    // Set initial model: use localStorage if valid, else default
    const saved = localStorage.getItem('selectedModel');
    const isValid = saved && state.availableModels.some(m => m.key === saved);
    setModel(isValid ? saved : state.defaultModel);

  } catch (err) {
    console.error('[Models] Failed to fetch models:', err);
    if (modelBtnLabel) modelBtnLabel.textContent = 'Error';
  }
}

modelBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  modelDropdown.classList.toggle('hidden');
});

document.addEventListener('click', () => {
  modelDropdown.classList.add('hidden');
});
```

**Step 3: Update handleModelCommand (line 848-851)**

Find:
```js
function handleModelCommand() {
  appendCommandMessage('Model: Claude (via Claude Code SDK)\nModel switching is not yet supported in the web UI.');
}
```

Replace with:
```js
function handleModelCommand() {
  const model = state.availableModels.find(m => m.key === state.selectedModel);
  const name = model ? model.name : state.selectedModel || 'None';
  const provider = model ? model.provider : 'unknown';
  appendCommandMessage(`Current model: ${name}\nProvider: ${provider}\nFull ID: ${state.selectedModel || 'none'}`);
}
```

**Step 4: Update DOMContentLoaded init (lines 3016-3020)**

Find:
```js
  // Initialize model selection
  if (modelBtn && modelDropdown) {
    setModel(state.selectedModel);
  }
```

Replace with:
```js
  // Initialize model selection - fetch from server
  if (modelBtn && modelDropdown) {
    fetchAndPopulateModels();
  }
```

**Step 5: Verify the model value is sent correctly in chat messages**

Check line 2348 — it already sends `model: state.selectedModel`. Now it will send the full `provider/modelId` string instead of `"sonnet"`. No change needed here.

**Step 6: Commit**

```bash
git add public/app.js
git commit -m "feat: fetch models from server and populate dropdown dynamically"
```

---

### Task 7: Manual integration test

**Step 1: Start the server**

```bash
npm start
```

**Step 2: Test the /api/models endpoint**

```bash
curl -s http://localhost:3015/api/models -H "Authorization: Bearer <token>" | jq
```

Expected: JSON with models array and default.

**Step 3: Test the UI**

1. Open the web UI in a browser
2. Verify the model dropdown shows in the header with the default model name
3. Click it — verify dropdown opens with all configured models
4. Select a different model — verify it updates the button label
5. Refresh the page — verify the selection persists from localStorage
6. Send a chat message — check server logs for `[Pi] Model set to <provider/model>`

**Step 4: Test the /model command**

Type `/model` in the chat input. Verify it shows the current model name, provider, and full ID.

**Step 5: Test error cases**

- Remove `config/models.json` and restart — verify the app still loads (empty/disabled dropdown)
- Add an invalid model to config — verify chat still works (logs a warning, falls back to default)

**Step 6: Final commit**

```bash
git add -A
git commit -m "feat: complete model dropdown with server config and RPC switching"
```
