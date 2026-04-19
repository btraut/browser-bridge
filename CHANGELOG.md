# Changelog

All notable changes to this project will be documented in this file.

The format is based on "Keep a Changelog", and this project adheres to Semantic Versioning.

## [Unreleased]

### Added

### Changed

- Marked Browser Bridge as deprecated across the main README, packaged skill/install surfaces, CLI help text, npm package metadata, and extension manifest copy, and now point new users to Codex's browser plugin, `agent-browser`, or Playwright MCP.

### Fixed

## [0.15.0] - 2026-03-21

### Added

- Added first-class `permissions.*` support across Core, CLI, and MCP for reading allowlist/mode state and requesting allowlist/mode changes through a human approval flow in Chrome.
- Added a repo-local `dev:loop` helper plus a matching local `dev-loop` skill for Browser Bridge contributors, so extension rebuild/relaunch/bypass setup can run from one command instead of the usual Chrome nonsense.

### Changed

- The repo-local `bump-version` release skill and release doc now require a fresh `npm install` and `npm run build` before any version bumping, so releases start from a clean build instead of wishful thinking.
- External permission changes are now approval-gated end to end: CLI/MCP can request them, but the extension applies them only after a human approves a dedicated prompt, with extra friction for bypass mode.

### Fixed

- Cold-start extension attach is less brittle: Core now waits briefly for the extension handshake before failing drive and permissions calls with `EXTENSION_DISCONNECTED`, which cuts down false startup misses right after Chrome/runtime reconnects.
- `drive.click` now retries a few transient locator-resolution misses instead of giving up after one wobble, which makes toggle/action controls like ManaVault's `Edit list` less likely to fail during live rerenders.
- Interactive AX snapshots now prune hover-hidden controls that fail live DOM visibility and pointer-event checks, so inspect stops advertising inert ManaVault-style quantity buttons as actionable.
- `dev enable-inspect` now retries transient stale diagnostics before failing, which cuts down false "inspect unavailable" reports while the extension handshake and capability negotiation are still catching up.
- Locator ranking now prefers directly hittable exact matches over merely visible duplicates, so drive clicks are less likely to land on ghost controls that share an `aria-label` but are occluded or inert.
- Repo-local Codex skills now live under `.agents/skills`, and the CLI install/prepack flow now reads from that canonical repo path instead of the dead `skills/` directory.
- Existing tabs now recover their content script on demand after extension updates, so `drive.wait_for` and other tab actions stop dying with `Receiving end does not exist` just because the tab predates the current build.
- Inspect now evaluates in an isolated world on the top frame when available, which makes auth/passkey pages less likely to derail `extract_content`, `page_state`, and `evaluate` with extension-surface debugger context errors.
- Inspect reads are less flaky and less noisy: `extract_content` now defaults to quiesced capture, `page_state` is summary-first with redacted values by default, and `console_list` filters stale pre-session history unless you ask for older entries explicitly.

## [0.14.0] - 2026-03-13

### Added

- Added a project-local `bump-version` skill that walks an agent through the repo's release flow: explicit SemVer bump selection, changelog move, release commit/tag push, GitHub release verification, npm publish, and the final extension-update reminder.

### Changed

- Refactored the extension action path into smaller, clearer pieces: tab resolution, permission gating, debugger dispatch, click strategies, and locator scoring no longer all live inline in the same giant handlers.
- Refactored inspect internals into explicit subsystems for target selection, content extraction policy, and snapshot-ref lifecycle management, which makes the core behavior easier to follow and safer to change.

### Fixed

- Clicks and locator resolution are much more reliable on real sites, especially for popup/menu triggers, duplicate controls, exact text matches, and visible-vs-hidden targets.
- Inspect is more stable and useful on dynamic pages: AX snapshots keep the right interactive nodes, `extract_content` handles SPA layouts better, and snapshot refs recover more cleanly after rerenders.
- Drive and inspect targeting are more predictable: session tab affinity is preserved by default, explicit `tab_id` targeting works end-to-end, and tab-activation failures degrade more gracefully when the right tab is already active.
- The inspect/setup story is much cleaner: current builds treat inspect as always-on, `dev enable-inspect` behaves like a diagnostics/remediation command, and the docs/runtime guidance now match reality.
- CLI and runtime plumbing got tougher around packaging and failure handling, including cleaner startup errors, better executable/shebang preservation, and less debugger coupling for screenshots.
- Repo tooling and validation were cleaned up too, including hook fixes, docs cleanup, and follow-up CI/lint/typecheck regressions on `main`.
- Plus 35 other bug fixes and polish items across diagnostics, docs, test coverage, and developer tooling.

## [0.13.2] - 2026-02-18

### Changed

- Maintenance patch release for `0.13.2`.

### Fixed

- MCP adapter readiness tests now model POST/GET health probing correctly, preventing false failures when daemon auto-start is enabled.

## [0.13.1] - 2026-02-18

### Fixed

- Extension packaging now resolves `@btraut/browser-bridge-shared/dist/*` imports from workspace source during zip builds, so release packaging works from clean CI checkouts without prebuilt shared artifacts.
- Core startup now handles shared-port collisions more clearly (POST/GET health compatibility probe + actionable occupied-port fallback), drive tab messaging retries transient post-navigation channel-closure races more aggressively, `drive.navigate` avoids false timeouts when URL commit succeeds without a DOM event, and diagnostics now surfaces inspect capability + shared-core metadata mismatch checks in one pass.

## [0.13.0] - 2026-02-18

### Changed

- `drive.navigate` now supports omitted `session_id` through both CLI and MCP; Core auto-creates the session and returns canonical `result.session_id` in the success payload.
- CLI and MCP now share parity guardrails for `drive.navigate` contracts via shared explicit/missing-session fixture variants and contract checks.
- Diagnostics caller runtime context is now normalized across CLI and MCP, with both clients attaching equivalent endpoint/process metadata for `diagnostics.doctor`.
- Deprecation lifecycle policy is now explicit and machine-checked: shared tool metadata includes `deprecated_since`/`removal_target`/replacement fields and `packages/shared/src/tooling.test.ts` enforces notice window + migration metadata requirements.
- Navigation naming is now canonicalized end-to-end on `drive.go_back`/`drive.go_forward`: Core routes and extension actions removed legacy alias actions, while CLI/MCP keep temporary deprecated alias shims that forward to canonical routes and emit explicit warnings.
- Public contract version signaling is now explicit across HTTP and websocket surfaces: Core enforces/echoes `x-browser-bridge-contract-version`, CLI/MCP send the version header by default, extension `drive.hello` now includes websocket `protocol_version`, and core rejects handshake mismatches deterministically.
- Public error taxonomy is now canonicalized: legacy/internal codes are normalized to a smaller non-overlapping public set, with typed migration details (`legacy_code`, `reason`, and structured context fields) attached to mapped responses.
- Retry semantics now use centralized structured hints: shared `retry` metadata (`retryable`, `reason`, `retry_after_ms`, `max_attempts`) and shared retry policy logic replace boolean-only retry decisions in core drive flows, while preserving compatibility via `retryable`.
- API route style is now explicitly RPC-over-HTTP POST: canonical health diagnostics route is `/health/check` (with legacy `/health_check` alias), and readiness supports canonical `POST /health` while retaining `GET /health` compatibility.
- Dialog operations are now canonicalized to `drive.handle_dialog`; `dialog.accept`/`dialog.dismiss` are deprecated aliases that map to canonical payloads and emit explicit warnings.
- Extension-core handshake now negotiates capabilities explicitly: `drive.hello` includes capability map metadata, and core gates non-negotiated or unsupported actions with deterministic errors.
- Extension defaults are now tighter and explicit: host/content-script scope is limited to `http://*/*` + `https://*/*`, unused `tabGroups` permission is removed, and `debugger.*` inspect actions are gated behind an options toggle (`debuggerCapabilityEnabled`, default off) with deterministic `ATTACH_DENIED` guidance.
- Refactor guardrails now explicitly separate semantic contracts from internal wiring details: inventory/tool-coverage docs define must-preserve behavior vs allowed internal evolution, and CLI/MCP contract tests now enforce semantic/schema parity without freezing exact internal route strings.

### Fixed

- MCP adapter integration coverage now disambiguates fixtures that share core routes (for example, dialog aliases), preventing false failures from path-only fixture collisions.
- Filled test/doc gaps for deprecated aliases: added missing `dialog.dismiss` core route coverage, added MCP coverage for `drive.forward` warnings and `dialog.dismiss` input transform, and clarified deprecation/error-code docs.
- Extension now re-applies the `Browser Bridge` tab-group title for reused dedicated agent tabs, so stale groups no longer stay untitled.
- Extension now reapplies the toolbar robot icon as the dedicated agent tab favicon after agent-driven navigations.
- Core drive preflight now fails fast with an explicit `EXTENSION_DISCONNECTED` error when the extension is offline, instead of attempting a drive call first.
- Core `drive.navigate` now preflights loopback targets (`localhost`/`127.0.0.1`/`::1`) and returns `NAVIGATION_FAILED` quickly when the local app is unreachable.
- Runtime path resolution now honors `BROWSER_BRIDGE_CWD` and safer cwd fallbacks, preventing broken launch contexts from writing logs/metadata under `/.context`.

## [0.12.1] - 2026-02-17

### Changed

- Extension popup now shows a compact `Connected` indicator (green/red) instead of the verbose connection diagnostics panel.

### Fixed

- Extension background now preflights Core `/health` before dialing websocket, avoiding noisy `ERR_CONNECTION_REFUSED` extension errors while Core is offline.

## [0.12.0] - 2026-02-17

### Changed

- Core runtime bootstrap: CLI and MCP adapter now share one Core readiness/runtime resolution path (default/env/metadata precedence + health/ensure-ready behavior), with new shared parity tests.
- MCP adapter now enables Core ensure-ready by default when constructing its client, so first tool calls auto-bootstrap Core after cold start.
- Diagnostics doctor payload/report now carries runtime endpoint/source/process context for caller, Core, and extension components so endpoint/version mismatches are explicit.
- Extension hello events now include the endpoint settings they are dialing (`core_host`, `core_port`, `core_port_source`) for mismatch diagnostics.
- Extension Drive socket now tracks explicit connection states (`connecting`, `connected`, `disconnected`, `backoff`) with a status surface (`drive.connection_status`) for UI diagnostics.
- Popup UI now includes a live connection health panel (state, endpoint/source, last success/failure, next retry) and a `Copy diagnostics` action for bug reports.
- README/manual docs now include post-reboot startup semantics and an end-to-end endpoint mismatch troubleshooting flow.
- MCP startup is now lazy; no startup filesystem writes unless initialized by first tool call.

### Fixed

- MCP adapter now returns bounded retryable `UNAVAILABLE` envelopes when Core ensure-ready cannot establish health, instead of opaque internal failures.
- Extension reconnect failures now use throttled warning logs to avoid disconnect spam while preserving exponential backoff behavior.
- Shared Core readiness now resets failed ensure-ready attempts for next-caller retry, adds bounded health probe timeouts/budget, and covers retry/dedupe behavior with regression tests.
- Diagnostics now ignores disconnected extension runtime identity for endpoint/version mismatch checks, and extension bridge disconnect clears cached runtime identity fields to prevent stale mismatch reporting.
- Popup diagnostics now clears cached status on refresh failure (blocking stale copy payloads), resets retry metadata outside backoff state, and announces async connection/copy feedback via live regions.

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
