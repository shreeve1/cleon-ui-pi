---
title: Concept — Pi Auth Boundary
type: concept
status: candidate
created: 2026-05-28
updated: 2026-05-28
sources:
  - wiki/raw/sessions/2026-05-28-pi-auth-correction.md
  - README.md
  - CLAUDE.md
  - .env.example
confidence: medium
tags: [pi-sdk, auth, env, troubleshooting]
---

# Concept — Pi Auth Boundary

Cleon UI Pi does not own provider authentication for agent turns. It embeds the Pi SDK and delegates agent/provider auth and model availability to Pi's own configuration under `~/.pi/agent/`.

## Rule

- Keep Cleon UI Pi `.env` for the web app: port, host, CORS, JWT secret, logging, and SDK pool tuning.
- Do not require or troubleshoot provider API keys such as `ANTHROPIC_API_KEY` in Cleon UI Pi `.env`.
- For chat failures, inspect Pi auth/config under `~/.pi/agent/` and the Pi model registry at `~/.pi/agent/models.json`.
- Keep `config/models.json` aligned with Pi-supported model IDs exactly; mismatch falls back to the default model and logs `[Pi] Model xxx not found in registry`.

## Debugging Implication

If a PM2/session log shows provider/model wording while the UI appears to start thinking then emits no response, do not assume Cleon UI Pi needs an Anthropic key in `.env`. Treat that as a Pi SDK/auth/model-registry investigation unless server logs show a Cleon UI Pi env/config error.

## Documentation Updates

This correction was applied to live docs:

- `README.md` — prerequisites, env sample, and Pi troubleshooting now describe Pi-owned auth/config.
- `CLAUDE.md` — `.env` variable list no longer lists `ANTHROPIC_API_KEY`; Pi SDK notes warn not to diagnose missing Anthropic env keys.
- `.env.example` — provider API key placeholder removed.

## Notes

This candidate supersedes stale Anthropic-key setup guidance in earlier promoted source summaries based on 2026-05-27 snapshots. Those raw snapshots remain immutable historical sources; current live docs should be preferred for this auth-boundary rule.
