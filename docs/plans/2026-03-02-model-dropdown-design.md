# Model Dropdown Design

Replace the hardcoded Anthropic model toggle button with a proper dropdown populated from a server-side config file. The selected model is sent to the pi RPC backend via `set_model` before each prompt.

## Config File

**`config/models.json`**

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

- Each entry is a `provider/modelId` string matching pi's model identifiers.
- The `default` field sets the pre-selected model for new users (before any localStorage selection).
- The server reads this file once at startup and caches it in memory.
- At startup, the server optionally validates entries against `pi --list-models` and logs warnings for unrecognized models (does not block startup).

## Server

### REST Endpoint: `GET /api/models`

Returns the allowed models list to the frontend:

```json
{
  "models": [
    { "id": "claude-sonnet-4-5", "provider": "anthropic", "name": "Claude Sonnet 4.5" },
    { "id": "claude-sonnet-4-6", "provider": "anthropic", "name": "Claude Sonnet 4.6" },
    { "id": "claude-opus-4-5", "provider": "anthropic", "name": "Claude Opus 4.5" },
    { "id": "gpt-5", "provider": "openai", "name": "GPT-5" },
    { "id": "gemini-2.5-pro", "provider": "google-gemini-cli", "name": "Gemini 2.5 Pro" }
  ],
  "default": "anthropic/claude-sonnet-4-5"
}
```

The `name` field is derived by cleaning up the model ID into a human-readable display name (capitalize, strip date suffixes).

### RPC Model Switching in `handleChat`

After `rpc.start()` and before `rpc.prompt()`, the server sends a `set_model` RPC command using the `model` field from the WebSocket message:

```js
if (msg.model) {
  const [provider, ...rest] = msg.model.split('/');
  const modelId = rest.join('/');
  await rpc.sendCommand({ type: 'set_model', provider, modelId });
}
await rpc.prompt(prompt);
```

The frontend sends the full `provider/modelId` string (e.g., `"anthropic/claude-sonnet-4-5"`) instead of the old short names (`"sonnet"`, `"haiku"`).

## Frontend

### Dropdown UI

Replace the current `#model-btn` icon button and `#model-dropdown` with hardcoded items:

- A **compact text button** in the same header position showing the model's display name (e.g., "Sonnet 4.5").
- Clicking opens a **dropdown list** populated from the `GET /api/models` response.
- The active model gets a highlighted style using `--neon-cyan`.
- Clicking outside or selecting a model closes the dropdown.
- Selection persisted to `localStorage` as the full `provider/modelId` string.

### Page Load Sequence

1. Fetch `GET /api/models`.
2. Populate dropdown items.
3. Check `localStorage` for a previous selection — if it matches an allowed model, use it; otherwise fall back to `default` from the server response.

### Slash Command

The `/model` command is updated to show the current model name instead of the "not yet supported" message.

## Error Handling

- **Invalid model in config:** `set_model` RPC returns an error. Server catches it and sends an error message to the frontend. No crash.
- **Missing config file:** Server logs a warning at startup. `GET /api/models` returns an empty list. Frontend shows a disabled dropdown.
- **Model unavailable mid-session:** Each chat spawns a fresh RPC, so `set_model` runs every time. Failure is per-message, not global.
- **Stale localStorage value:** If the saved model is no longer in the config, the frontend falls back to `default`.

## Non-Changes

No changes to session persistence, token usage tracking, context window display, or any other existing functionality. The `context-model` badge continues to display the model reported by the RPC in `turn_end` events.
