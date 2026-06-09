# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- Source model dropdown from Pi SDK registry instead of static config
- Load only authenticated Pi models
- Extract `event-transformer` from `pi-agent`, expand tests to 58
- Extract `pi-path` codec module

### Fixed

- Prune stale Pi session mappings to prevent crash loop
- Surface Pi skills in slash menu
- Call `finishStreaming` on streaming→idle reconnect
- Surface Pi turn errors to frontend
- Pin CDN scripts with SRI hashes

### Added

- `event-transformer` module with factory pattern and 58 tests
- `pi-path` codec module for Pi directory name encoding/decoding
- Slash command discovery for Pi skills
- `question-utils` module for structured question handling

## [1.0.0] - 2025-05-30

### Added

- Initial release
- Express + WebSocket server with JWT auth
- Pi SDK integration via `@mariozechner/pi-coding-agent`
- Retro neon mobile-first UI
- Session management with idle timeout and concurrent cap
- File browser with tree view and lazy loading
- SSE event bus for real-time updates
- PM2 process management
- SQLite-based auth storage
