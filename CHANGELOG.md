# Changelog

All notable changes to this project will be documented in this file.

The format is based on "Keep a Changelog", and this project adheres to Semantic Versioning.

## [Unreleased]

### Changed

- When `tab_id` is omitted in drive commands, Browser Bridge now creates (and reuses) a dedicated Chrome window/tab so agent activity stays separate from the user's current window.
- The dedicated agent tab is grouped under a `🌉 Browser Bridge` tab group when created.

## [0.4.3] - 2026-02-07

### Fixed

- Remove the unused `scripting` permission from the Chrome extension manifest (Chrome Web Store compliance).

## [0.4.2] - 2026-02-07

### Fixed

- Fix the GitHub release workflow tag/version verification step so tag pushes reliably create a GitHub Release and upload the extension zip.

## [0.4.1] - 2026-02-07

### Added

- `health_check` MCP tool and core endpoint (`/health_check`) for uptime/memory/session/extension status.
- Full-page scrolling screenshots for `artifacts.screenshot` via `fullPage: true` (scroll + stitch, up to ~50K px tall).
- MCP Streamable HTTP server transport (in addition to stdio).
- Pre-built Chrome extension zip attached to GitHub releases.
- Element-targeted screenshots for `artifacts.screenshot` via `selector`.

### Fixed

_TBD_

## [0.4.0] - 2026-02-06

### Added

- Core idle session TTL cleanup (configurable via `BROWSER_BRIDGE_SESSION_TTL_MS`).
- Diagnostics now include a session summary (count and max age/idle time).

### Fixed

- Sanitize Chrome extension error messages before forwarding them to clients (remove file paths and redact URLs to origin).
- Share the core <-> extension protocol types via `@btraut/browser-bridge-shared` (remove manual sync).
- Refactor InspectService internals into `packages/core/src/inspect/*` modules and expand unit test coverage (no API changes).
- Stabilize `scripts/cli-full-tool-smoke.sh` dialog steps by refreshing debugger attachment before opening JS dialogs.

## [0.3.0] - 2026-02-06

### Added

- `browser-bridge install` interactive installer for skills and MCP.
- `browser-bridge skill install` and `browser-bridge skill status`.
- `browser-bridge mcp install` for Codex, Claude, and Cursor.
- Skill version manifest (`skill.json`) to detect out-of-date installs.
- `browser-bridge mcp serve` (while keeping `browser-bridge mcp` working).

## [0.2.0] - 2026-02-05

### Added

- `browser-bridge inspect dom-snapshot --max-nodes <n>` (AX format only) to bound snapshot size for agent/LLM consumption.

## [0.1.1] - 2026-02-05

### Added

- Initial release.
