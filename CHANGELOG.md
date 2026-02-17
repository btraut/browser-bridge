# Changelog

All notable changes to this project will be documented in this file.

The format is based on "Keep a Changelog", and this project adheres to Semantic Versioning.

## [Unreleased]

### Changed

- Core runtime bootstrap: CLI and MCP adapter now share one Core readiness/runtime resolution path (default/env/metadata precedence + health/ensure-ready behavior), with new shared parity tests.
- MCP adapter now enables Core ensure-ready by default when constructing its client, so first tool calls auto-bootstrap Core after cold start.
- Diagnostics doctor payload/report now carries runtime endpoint/source/process context for caller, Core, and extension components so endpoint/version mismatches are explicit.
- Extension hello events now include the endpoint settings they are dialing (`core_host`, `core_port`, `core_port_source`) for mismatch diagnostics.
- Extension Drive socket now tracks explicit connection states (`connecting`, `connected`, `disconnected`, `backoff`) with a status surface (`drive.connection_status`) for UI diagnostics.
- Popup UI now includes a live connection health panel (state, endpoint/source, last success/failure, next retry) and a `Copy diagnostics` action for bug reports.

### Fixed

- MCP adapter now returns bounded retryable `UNAVAILABLE` envelopes when Core ensure-ready cannot establish health, instead of opaque internal failures.
- Extension reconnect failures now use throttled warning logs to avoid disconnect spam while preserving exponential backoff behavior.

## [0.11.1] - 2026-02-16

### Fixed

- Extension: dedicated agent windows now bootstrap with an extension-owned `agent-tab.html` page so the tab consistently shows the `Browser Bridge` title and robot favicon (instead of blank/new-tab styling).

## [0.11.0] - 2026-02-16

### Changed

- Runtime routing now defaults to single-instance mode on `127.0.0.1:3210`; deterministic per-worktree ports are used only in explicit isolated mode.
- Core startup now probes fallback ports only in isolated mode and preserves existing runtime metadata fields (including `extension_id`) when persisting host/port updates.
- `browser-bridge dev activate` is now explicitly an isolated-worktree workflow command and persists `isolated_mode: true` in runtime metadata.

### Fixed

- Eliminated normal-workflow extension disconnects caused by hidden default port drift between Core/CLI and extension routing.

## [0.10.0] - 2026-02-15

### Added

- CLI: support `-v` as a short alias for `--version`, with the value resolved from the installed package metadata.

### Fixed

- README: switch the header image to an absolute GitHub URL so it renders correctly on npm package pages.

## [0.9.0] - 2026-02-15

### Fixed

- Extension: restore the dedicated agent tab label by bootstrapping new agent windows with a branded `🌉 Browser Bridge` placeholder page and the extension's toolbar robot favicon instead of an untitled blank tab.
- CI: format `packages/extension/manifest.json` so `npm run format:check` passes again.
- Screenshot capture now queues and paces `chrome.tabs.captureVisibleTab` calls in the extension, retries Chrome quota hits with backoff, reports repeated quota failures as `RATE_LIMITED` (retryable), and allows full-page screenshot requests to fall back to CDP capture when extension capture is rate-limited.

## [0.8.1] - 2026-02-14

### Added

- CLI: `browser-bridge dev info` now prints resolved runtime details (host/port + source, deterministic port, worktree id, metadata path, log dir, and metadata snapshot).
- CLI: `browser-bridge dev activate` now resolves runtime, persists metadata for the current worktree, and opens extension options with activation query params.

### Changed

- Runtime metadata now supports persisted `extension_id` so extension targeting can survive across sessions/worktrees.
- Extension options activation flow now applies `corePort` from activation query params via `chrome.storage.local` and then clears the query string to prevent repeated re-application on refresh.

### Fixed

- `drive.go_back` / `drive.go_forward` no longer hang when history navigation unloads the page before content-script messaging completes; history dispatch is deferred, background completion waits for deterministic top-level navigation signals, and tab messaging now has an explicit timeout guard.

## [0.8.0] - 2026-02-14

### Changed

- `drive.click` now dispatches deferred clicks through CDP `Input.dispatchMouseEvent` in the extension background path, with locator point resolution coming from the content script.
- `drive.hover` and `drive.drag` now run through CDP mouse movement/press/release events in the extension background path, with HTML snapshot capture handled as a separate internal content action.
- `drive.key`, `drive.key_press`, and `drive.type` now route through CDP keyboard/text input commands in the extension background path, while content script target helpers only resolve/validate editable targets.
- `drive.select` and `drive.fill_form` now run CDP-backed focus/typing primitives first, with explicit content-script fallback for control-specific operations that CDP does not map directly.
- Added `docs/cdp-input-model.md` plus stronger assertions in `scripts/cli-full-tool-smoke.sh` to validate focus/value/drag side effects during CDP-input smoke runs.

## [0.7.3] - 2026-02-14

### Fixed

- `drive.click` now focuses the target element before dispatching the deferred click, so clicking inputs updates `document.activeElement` as expected.

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
