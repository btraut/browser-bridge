# Changelog

All notable changes to this project will be documented in this file.

The format is based on "Keep a Changelog", and this project adheres to Semantic Versioning.

## [Unreleased]

_TBD_

## [0.7.2] - 2026-02-12

### Fixed

- Core debugger bridge now self-heals stale attach state: when a command fails with "Debugger is not attached to the requested tab.", it marks the tab detached, re-attaches once, and retries the command once. It also clears cached attachment state after extension disconnects to avoid false "attached" assumptions that can trigger inspect recovery loops/timeouts.

## [0.7.1] - 2026-02-11

### Fixed

- Diagnostics doctor: stop failing by default when `session_id` is omitted, treat detached debugger as expected idle behavior, and downgrade stale drive/inspect errors to warnings.
- Core error latching: clear drive/inspect/debugger `last_error` state after successful operations so recovered sessions report healthy diagnostics.

## [0.7.0] - 2026-02-10

### Fixed

- MCP adapter: avoid SDK `_zod` crashes on tool calls by registering object-shaped output schemas and flagging `ok: false` envelopes as MCP errors.

## [0.6.1] - 2026-02-10

### Added

- README: competitor feature comparison table.

### Fixed

- Extension popup menu: Settings/About always open in a new tab/window (no more crushing the UI inside the popup).
- Extension options: default permissions mode to Granular when unset, and show a real empty state for the approved sites allowlist.
- Extension options: remove the nested-card empty state styling, simplify the copy, and always show the Approved sites disclosure + list in both Granular and Bypass modes.
- Extension options: add a drop shadow to the permission mode controls to match the rest of the settings containers.
- Extension options: remove the "Bypass mode is intentionally unsafe" warning box.
- Extension options: tighten and vertically align the Approved sites disclosure triangle.

### Changed

- Expand `scripts/cli-full-tool-smoke.sh` coverage (health-check, locator variants, ref reuse, more dom-snapshot modes, more screenshot options).

## [0.6.0] - 2026-02-09

### Added

- Extension options: permissions mode toggle (Granular per-site vs dangerous bypass), with bypass collapsing and ignoring the approved sites allowlist.

## [0.5.0] - 2026-02-09

### Added

- `PERMISSION_REQUIRED` error code for soft site-permissions gating.
- `PERMISSION_DENIED` error code for explicit user declines in the site-permissions prompt.
- `PERMISSION_PROMPT_TIMEOUT` error code for when a site-permissions approval prompt times out while waiting for user input.
- Soft site-permissions allowlist with a permission prompt window and an options page to review/revoke approved sites.
- Extension toolbar menu (Settings/About) for easier discovery of site permissions.

### Fixed

- Increase the default Core client timeout (CLI + MCP) so extension permission prompts do not time out prematurely.
- CLI: classify aborted Core requests as `TIMEOUT` (with timeout details) instead of a generic `INTERNAL` error.
- Increase the site-permissions prompt popup size to avoid clipping controls.
- Make permission-decline failures more actionable for agent clients by returning `PERMISSION_DENIED` with next-step guidance.
- Fix extension popup/options buttons by loading UI scripts as modules; simplify the popup styling (no gradients/ALL CAPS) and replace About ellipsis with an external-link icon.
- Fix a small extension popup bottom-clipping issue; add a subtle header icon for personality without gradients.
- Match the options page list drop shadow to the popup menu styling, and reduce shadow intensity.
- Options page: make Undo revoke more robust by verifying the allowlist restore.

### Changed

- When `tab_id` is omitted in drive commands, Browser Bridge now creates (and reuses) a dedicated Chrome window/tab so agent activity stays separate from the user's current window.
- The dedicated agent tab is grouped under a `🌉 Browser Bridge` tab group when created.
- Approved sites options page: switch to a settings-style list with right-aligned revoke actions and an Undo toast.
- Increase the default site-permissions prompt wait to 30 seconds.

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
