# Session Capture: Pi Auth Boundary Correction

- Date: 2026-05-28
- Purpose: Capture James's correction that Cleon UI Pi authentication is Pi-owned, not Anthropic-owned, after a PM2 log review misdiagnosed a chat failure as Anthropic account/API-key related.
- Scope: Durable auth/config rule for future debugging and documentation updates.

## Durable Facts

- Cleon UI Pi delegates agent/provider authentication to Pi's own configuration under `~/.pi/agent/`; the web app should not require provider API keys in its `.env`. Evidence: `README.md`, `CLAUDE.md`, `.env.example` documentation updates in this session.
- Runtime model selection is registry-driven: `config/models.json` must align with Pi's model registry at `~/.pi/agent/models.json`. Evidence: existing `wiki/CLAIMS.md` claim `C-0003` and `server/pi-agent.js` model registry use.
- A chat stall or empty response with provider/model wording in session logs should be investigated through Pi auth/config and Pi-supported model IDs, not by adding `ANTHROPIC_API_KEY` to Cleon UI Pi's `.env`. Evidence: James's correction in this session and the documentation updates.

## Decisions

- Remove stale `ANTHROPIC_API_KEY` setup guidance from live project docs. Evidence: `README.md`, `CLAUDE.md`, `.env.example` updates.
- Add future-facing guidance: do not diagnose chat failures as missing Anthropic credentials in Cleon UI Pi's `.env`; inspect Pi auth/config and the Pi model registry instead. Evidence: `CLAUDE.md` Pi SDK Integration note.

## Evidence

- `README.md` — updated prerequisites, environment sample, and Pi troubleshooting to say Pi auth/provider config is external to Cleon UI Pi.
- `CLAUDE.md` — updated `.env` key list and Pi SDK Integration note with the auth-boundary rule.
- `.env.example` — removed provider API key placeholder; now points at Pi-owned config under `~/.pi/agent/`.
- `wiki/CLAIMS.md` `C-0003` — existing model-registry coupling: `config/models.json` must match `~/.pi/agent/models.json`.

## Exclusions

- No secrets, provider credentials, token values, or contents of `~/.pi/agent/auth.json` were captured.
- Full chat transcript was not archived.

## Open Questions And Follow-Ups

- Consider adding UI/error handling so SDK `stopReason: error` messages surface visibly instead of appearing as a silent empty response.
