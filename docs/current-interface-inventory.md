# Browser Bridge Current Interface Inventory

Date: 2026-02-17 Status: Canonical snapshot of current externally observable behavior before major refactor (updated through `7b5053a`) Audience: Maintainers rebuilding internals while preserving intended interface contracts

## 1. Scope and Intent

This document records the current app interface across:

- `packages/shared` (schemas, protocol, error envelopes, runtime config, logging)
- `packages/core` (HTTP API, session lifecycle, diagnostics, bridge behavior)
- `packages/mcp-adapter` (MCP server tool surface and core proxy behavior)
- `packages/cli` (command surface, output/error shape, startup behavior)
- `packages/extension` (manifest permissions, websocket protocol, runtime messages, permission gating)

This is intentionally behavior-focused (what callers observe), not implementation-style-focused.

## 2. System Boundary and Components

Current runtime components:

- CLI process (`browser-bridge`)
- MCP adapter process (stdio MCP or HTTP MCP transport)
- Core daemon (HTTP API + websocket endpoint for extension bridge)
- Chrome extension (background service worker + content script + popup/options UIs)

High-level flow:

1. CLI or MCP adapter resolves runtime host/port/log paths using shared runtime config.
2. CLI/MCP ensures core readiness (spawning daemon unless disabled).
3. Core receives HTTP calls and routes to session/drive/inspect/artifacts/diagnostics services.
4. Core communicates with extension over websocket (`/drive`) using shared drive/debugger protocol.
5. Extension executes actions via content script and reports status/events back to core.

## 3. Runtime and Filesystem Contracts

### 3.1 Host/Port and Metadata Resolution

Runtime configuration resolution is centralized in `packages/shared/src/runtime-config.ts`.

Precedence model:

- Explicit options
- Environment variables
- Metadata file
- Defaults

Important defaults and artifacts:

- Default core host: `127.0.0.1`
- Default core port: `3210`
- Worktree metadata file: `.context/browser-bridge/dev.json`
- Default log directory: `.context/logs/browser-bridge`
- Deterministic isolated-mode port support exists (per worktree)
- Runtime `cwd` resolution fallback order is:
  - explicit `cwd` option
  - `BROWSER_BRIDGE_CWD`
  - `process.cwd()` (unless root `/`)
  - `PWD`
  - `INIT_CWD`
  - `HOME`

### 3.2 Log Contract

Shared JSONL logger contract in `packages/shared/src/logging.ts`:

- Per-stream JSONL files
- Redaction of sensitive keys
- Default rotation/retention behavior
- Structured event-style logging across CLI/core/mcp-adapter

MCP adapter specifically buffers logs until core initialization succeeds (deferred logger), then flushes.

## 4. Shared Envelope, Schema, and Error Contracts

### 4.1 Success/Error Envelope Shape

Shared API envelope model:

- Success: `{ ok: true, result: <payload> }`
- Error: `{ ok: false, error: { code, message, retryable, details? } }`

This shape is consumed across core, CLI, and MCP adapter.

### 4.2 Standardized Error Codes

Locked error code vocabulary (`packages/shared/src/errors.ts`):

- `UNKNOWN`
- `INVALID_ARGUMENT`
- `NOT_FOUND`
- `ALREADY_EXISTS`
- `FAILED_PRECONDITION`
- `UNAUTHORIZED`
- `FORBIDDEN`
- `PERMISSION_REQUIRED`
- `PERMISSION_DENIED`
- `PERMISSION_PROMPT_TIMEOUT`
- `CONFLICT`
- `TIMEOUT`
- `CANCELLED`
- `UNAVAILABLE`
- `RATE_LIMITED`
- `NOT_IMPLEMENTED`
- `INTERNAL`
- `SESSION_NOT_FOUND`
- `SESSION_CLOSED`
- `SESSION_BROKEN`
- `DRIVE_UNAVAILABLE`
- `INSPECT_UNAVAILABLE`
- `EXTENSION_DISCONNECTED`
- `DEBUGGER_IN_USE`
- `ATTACH_DENIED`
- `TAB_NOT_FOUND`
- `NOT_SUPPORTED`
- `LOCATOR_NOT_FOUND`
- `NAVIGATION_FAILED`
- `EVALUATION_FAILED`
- `ARTIFACT_IO_ERROR`

### 4.3 Retryability Semantics

`retryable` is behaviorally meaningful and currently consumed in several places:

- Core drive execution retries once only when `retryable=true` and first attempt failed.
- Extension bridge timeout/disconnect errors are marked retryable.
- Inspect screenshot path can fallback to alternate capture path when failures are retryable.
- MCP adapter readiness failures are emitted as retryable `UNAVAILABLE` envelopes.
- CLI timeout failures are surfaced as retryable `TIMEOUT` errors.
- Core drive returns retryable `EXTENSION_DISCONNECTED` immediately when extension bridge is disconnected.
- `drive.navigate` performs loopback preflight (`HEAD`) for `localhost`/`127.0.0.1`/`::1` and can return retryable `NAVIGATION_FAILED` before extension dispatch.

## 5. Session State Machine Contract

Core session state transitions (`packages/core/src/state.ts`):

| From               | Event                  | To                 |
| ------------------ | ---------------------- | ------------------ |
| `INIT`             | `DRIVE_CONNECTED`      | `DRIVE_READY`      |
| `INIT`             | `INSPECT_CONNECTED`    | `INSPECT_READY`    |
| `DRIVE_READY`      | `INSPECT_CONNECTED`    | `READY`            |
| `DRIVE_READY`      | `DRIVE_DISCONNECTED`   | `INIT`             |
| `INSPECT_READY`    | `DRIVE_CONNECTED`      | `READY`            |
| `READY`            | `DRIVE_DISCONNECTED`   | `DEGRADED_DRIVE`   |
| `READY`            | `INSPECT_DISCONNECTED` | `DEGRADED_INSPECT` |
| `DEGRADED_DRIVE`   | `RECOVER_SUCCEEDED`    | `READY`            |
| `DEGRADED_INSPECT` | `RECOVER_SUCCEEDED`    | `READY`            |
| any non-`CLOSED`   | `RECOVER_FAILED`       | `BROKEN`           |
| any                | `CLOSE`                | `CLOSED`           |

All other transitions are invalid and throw `InvalidSessionTransition`.

## 6. Core HTTP API Contract

Core server mounts session/drive/inspect/artifacts/diagnostics routes and primarily returns envelope-shaped responses. `GET /health` is a readiness exception that returns `{ ok: true }` directly.

Readiness endpoint:

- `GET /health` -> `{ ok: true }`

### 6.1 Session Routes

- `POST /session/create`
- `POST /session/status`
- `POST /session/recover`
- `POST /session/close`

Behavioral notes:

- `status` returns session state and optional plane status metadata.
- `recover` returns `{ recovered, state, message? }`.
- session lifecycle errors map to standardized error envelopes.

### 6.2 Drive/Dialog Routes

Drive and dialog endpoints include:

- `/drive/navigate`
- `/drive/go_back`
- `/drive/go_forward`
- `/drive/back` (legacy alias)
- `/drive/forward` (legacy alias)
- `/drive/click`
- `/drive/hover`
- `/drive/select`
- `/drive/type`
- `/drive/fill_form`
- `/drive/drag`
- `/drive/handle_dialog`
- `/dialog/accept`
- `/dialog/dismiss`
- `/drive/key`
- `/drive/key_press`
- `/drive/scroll`
- `/drive/wait_for`
- `/drive/tab_list`
- `/drive/tab_activate`
- `/drive/tab_close`

Behavioral notes:

- `POST /drive/navigate` accepts optional `session_id`.
- When `session_id` is omitted on `drive.navigate`, core creates a session and returns canonical `result.session_id`.
- `drive.navigate` can fail fast on unreachable loopback targets with retryable `NAVIGATION_FAILED` and preflight details.

### 6.3 Inspect Routes

- `/inspect/dom_snapshot`
- `/inspect/dom_diff`
- `/inspect/find`
- `/inspect/extract_content`
- `/inspect/page_state`
- `/inspect/console_list`
- `/inspect/network_har`
- `/inspect/evaluate`
- `/inspect/performance_metrics`

### 6.4 Artifacts and Diagnostics Routes

- `/artifacts/screenshot`
- `/health`
- `/health_check`
- `/diagnostics/doctor`

Diagnostics doctor returns a structured report with runtime/session/extension/debugger/recovery/artifact context.

## 7. MCP Tool Surface Contract

MCP tool catalog is defined by shared tool map and consumed by adapter (`packages/shared/src/tooling.ts`, `packages/mcp-adapter/src/tools.ts`).

### 7.1 Exact Tool Names and Core Path Mapping

1. `session.create` -> `/session/create`
2. `session.status` -> `/session/status`
3. `session.recover` -> `/session/recover`
4. `session.close` -> `/session/close`
5. `drive.navigate` -> `/drive/navigate`
6. `drive.go_back` -> `/drive/go_back`
7. `drive.go_forward` -> `/drive/go_forward`
8. `drive.back` -> `/drive/back`
9. `drive.forward` -> `/drive/forward`
10. `drive.click` -> `/drive/click`
11. `drive.hover` -> `/drive/hover`
12. `drive.select` -> `/drive/select`
13. `drive.type` -> `/drive/type`
14. `drive.fill_form` -> `/drive/fill_form`
15. `drive.drag` -> `/drive/drag`
16. `drive.handle_dialog` -> `/drive/handle_dialog`
17. `dialog.accept` -> `/dialog/accept`
18. `dialog.dismiss` -> `/dialog/dismiss`
19. `drive.key` -> `/drive/key`
20. `drive.key_press` -> `/drive/key_press`
21. `drive.scroll` -> `/drive/scroll`
22. `drive.wait_for` -> `/drive/wait_for`
23. `drive.tab_list` -> `/drive/tab_list`
24. `drive.tab_activate` -> `/drive/tab_activate`
25. `drive.tab_close` -> `/drive/tab_close`
26. `inspect.dom_snapshot` -> `/inspect/dom_snapshot`
27. `inspect.dom_diff` -> `/inspect/dom_diff`
28. `inspect.find` -> `/inspect/find`
29. `inspect.extract_content` -> `/inspect/extract_content`
30. `inspect.page_state` -> `/inspect/page_state`
31. `inspect.console_list` -> `/inspect/console_list`
32. `inspect.network_har` -> `/inspect/network_har`
33. `inspect.evaluate` -> `/inspect/evaluate`
34. `inspect.performance_metrics` -> `/inspect/performance_metrics`
35. `artifacts.screenshot` -> `/artifacts/screenshot`
36. `health_check` -> `/health_check`
37. `diagnostics.doctor` -> `/diagnostics/doctor`

### 7.2 Input/Output Highlights by Tool Family

Session:

- `session.create`: empty input object, returns `{ session_id, state, created_at? }`.
- `session.status`: requires `session_id`, returns session + plane statuses.
- `session.recover`: requires `session_id`, returns `{ recovered, state, message? }`.
- `session.close`: requires `session_id`, returns `{ ok }`.

Drive/Dialog:

- Locator-based actions require `locator` schema.
- `drive.navigate.session_id` is optional (phase-1 scope), and output includes canonical `session_id`.
- `drive.navigate.wait` default is `domcontentloaded`.
- `drive.type.clear`/`submit` default false.
- `drive.drag.steps` default 12, bounded.
- `drive.scroll` requires either delta-based or absolute scroll fields.
- `drive.wait_for.condition.kind` enum: `locator_visible | text_present | url_matches`.
- when `tab_id` is omitted for drive actions, extension resolves/uses dedicated agent tab context.

Inspect:

- `inspect.dom_snapshot.format` default `ax`.
- `inspect.dom_snapshot.consistency` default `best_effort`.
- snapshot flags include `interactive`, `compact`, `max_nodes`, `selector`, `target`.
- `inspect.extract_content.format` default `markdown`, `include_metadata` default true.

Artifacts/Diagnostics:

- `artifacts.screenshot.target` default `viewport`, `format` default `png`, `fullPage` default false.
- `health_check` input is empty object.
- `diagnostics.doctor` accepts optional `session_id` and optional `caller` metadata.

### 7.3 MCP Adapter Lifecycle and Error Mapping

- Lazy core initialization on first tool invocation by default.
- Concurrency-safe single-flight initialization.
- Retry of failed initialization attempts.
- Optional eager initialization modes via options/env.
- Error envelopes are preserved and exposed through MCP call results.
- Non-envelope internal failures are wrapped to standardized retryable internal envelope.

## 8. CLI Contract

### 8.1 Root-Level Global Flags

Global flags available at root and inherited by command groups:

- `--host`
- `--port`
- `--json`
- `--no-daemon`

### 8.2 Top-Level Commands

- `session`
- `drive`
- `inspect`
- `artifacts`
- `diagnostics`
- `dialog`
- `dev`
- `open-artifacts`
- `mcp`
- `skill`
- `install`

### 8.3 Command Group Surface (Current)

`session`:

- `create`
- `status --session-id`
- `recover --session-id`
- `close --session-id`

`drive`:

- `navigate` (`--session-id` optional; auto-created by core when omitted)
- `go-back`
- `back` (legacy alias)
- `go-forward`
- `forward` (legacy alias)
- `click`
- `hover`
- `select`
- `type`
- `fill-form`
- `drag`
- `handle-dialog`
- `key`
- `key-press`
- `scroll`
- `wait-for`
- `tab-list`
- `tab-activate`
- `tab-close`

`inspect`:

- `dom-snapshot`
- `dom-diff`
- `find`
- `extract-content`
- `page-state`
- `console-list`
- `network-har`
- `evaluate`
- `performance-metrics`

`artifacts`:

- `screenshot` (supports `--full-page` alias semantics)

`diagnostics`:

- `health-check`
- `doctor`

`dialog`:

- `accept`
- `dismiss`

`dev`:

- `info`
- `activate`

`mcp`:

- `install`
- `serve`
- `serve-http`
- bare `mcp` invocation still starts server for legacy compatibility

`skill`:

- `install`
- `status`

### 8.4 CLI Output and Error Shape

Output contract via shared wrappers:

- `--json`: prints full envelope.
- non-json: prints result (string or formatted json).
- errors: printed as `CODE: message` plus optional details.
- non-ok sets process exit code to `1`.

Input validation contract:

- schema validation failures emit `INVALID_ARGUMENT` errors.
- locator parsing has explicit argument constraints (must provide at least one selector channel, etc.).

### 8.5 CLI Runtime Semantics

- Core readiness check runs before command execution unless daemon startup disabled.
- Runtime config resolution uses shared precedence rules.
- `drive navigate` no longer performs CLI-owned `session.create`; missing-session behavior is core-owned and shared with MCP.
- CLI core-client auto-injects `caller` runtime/process metadata for `diagnostics.doctor` (parity with MCP adapter core-client behavior).
- `dev activate` uses extension-id resolution priority:
  - CLI flag
  - `BROWSER_BRIDGE_EXTENSION_ID`
  - stored metadata
- `dev activate` persists metadata and opens extension options URL with activation parameters.

## 9. Extension Contract

### 9.1 Manifest-Level Surface

Manifest (`packages/extension/manifest.json`) currently includes:

- MV3 background service worker
- content script on `<all_urls>` at `document_idle`
- popup/options/permission/agent-tab pages
- permissions including debugger/tabs/storage/webNavigation/tabGroups
- host permission `<all_urls>`
- web-accessible icon resources for agent-tab branding (`assets/icons/icon-16|32|48.png`)

### 9.2 Extension <-> Core WebSocket Messages

Message envelope fields:

- `id`
- `action`
- `status` (`request | ok | error | event`)
- `params` or `result` or `error` as appropriate

Key event/request actions emitted by extension background:

- `drive.hello` (event): includes version/core identity and tab inventory
- `drive.keepalive` (event): periodic heartbeat (empty params)
- `drive.tab_report` (event): tab inventory updates
- `drive.ping` (request handling path returns `{ ok: true }`)
- `debugger.event` (event): includes tab id, method, params, timestamp

Background currently only processes `drive.*` and `debugger.*` action namespaces.

### 9.3 Runtime Message Action (`chrome.runtime.onMessage`) Contract

Runtime message action exposed by background:

- `{ action: 'drive.connection_status' }` -> returns connection state tracker status

### 9.4 Content Script Action Contract (`runDriveAction`)

Action names handled by content script include:

- `drive.agent_tab_branding` (extension-internal branding action)
- `drive.navigate`
- `drive.locator_point`
- `drive.snapshot_html`
- `drive.type_target_point`
- `drive.clear_active_editable`
- `drive.click`
- `drive.hover`
- `drive.select`
- `drive.type`
- `drive.detect_field_type`
- `drive.fill_form`
- `drive.drag`
- `drive.key_press`
- `drive.key`
- `drive.scroll`
- `drive.screenshot_meta`
- `drive.screenshot_element`
- `drive.wait_for`
- `drive.go_back`
- `drive.back`
- `drive.go_forward`
- `drive.forward`

Content script return shape:

- success: `{ ok: true, result? }`
- failure: `{ ok: false, error: DriveErrorInfo }`

### 9.5 Permissions and Prompting Model

Permission gating in background layer:

- sensitive actions require permission checks
- restricted URL checks exist
- allowlist storage model exists (`allow_once`/`allow_always` flow)
- site permissions mode supports `granular` and `bypass`
- permission prompt timeout is configurable (default 30s)

### 9.6 Connection State Tracker Contract

Connection-state model (`connection-state.ts`) tracks:

- states: `connecting`, `backoff`, `connected`, `disconnected`
- metadata: endpoint, retry schedule, last error metadata, consecutive failures
- log throttling behavior for repeated failures

## 10. Diagnostics Contract

Diagnostics routes and report model include:

- `health_check` summary with uptime/memory/sessions/extension status
- `diagnostics.doctor` with checks/warnings/notes and runtime/session/recovery/artifact context
- stale-vs-fresh error interpretation appears in diagnostics logic/tests
- caller metadata (CLI and MCP identity + resolved host/port/worktree context) may be included and is injected by both core clients

## 11. Legacy and Compatibility Behaviors Currently Present

Current compatibility and legacy behaviors worth explicitly deciding whether to preserve:

- Both `drive.back` and `drive.go_back` are live.
- Both `drive.forward` and `drive.go_forward` are live.
- Deprecation lifecycle metadata is now tracked in `packages/shared/src/tooling.ts` and documented in `docs/deprecation-lifecycle-policy.md`.
- Bare `browser-bridge mcp` still behaves as server start path.
- `artifacts screenshot --full-page` acts as alias-like UX behavior.
- Interactive install flows reject `--json` and require TTY.
- `skill install` supports both `--client` and `--harness` semantics.

## 12. Contract Tests that Currently Guard Interface Shape

The following tests currently behave as de-facto interface guards:

Shared package:

- `packages/shared/src/schemas.test.ts`
- `packages/shared/src/runtime-config.test.ts`
- `packages/shared/src/logging.test.ts`
- `packages/shared/src/core-readiness.test.ts`
- `packages/shared/src/tooling.test.ts`

MCP adapter:

- `packages/mcp-adapter/src/tools.contract.test.ts`
- `packages/mcp-adapter/src/tools.test.ts`
- `packages/mcp-adapter/src/tool-handler.test.ts`
- `packages/mcp-adapter/src/core-client.test.ts`
- `packages/mcp-adapter/src/server.test.ts`
- `packages/mcp-adapter/src/adapter.integration.test.ts`

Core:

- `packages/core/src/state.test.ts`
- `packages/core/src/session.test.ts`
- `packages/core/src/routes/drive.test.ts`
- `packages/core/src/inspect-service.test.ts`
- `packages/core/src/diagnostics.test.ts`
- `packages/core/src/extension-bridge.test.ts`

CLI:

- `packages/cli/src/commands/commands.integration.test.ts`
- `packages/cli/src/commands/commands.unit.test.ts`
- `packages/cli/src/commands/drive.test.ts`
- `packages/cli/src/commands/dev.test.ts`
- `packages/cli/src/core-client.test.ts`
- `packages/cli/src/tools.contract.test.ts`

Extension:

- `packages/extension/src/content.test.ts`
- `packages/extension/src/connection-state.test.ts`
- `packages/extension/src/permission-prompt.test.ts`
- `packages/extension/src/site-permissions.test.ts`
- `packages/extension/src/popup-ui.test.ts`
- `packages/extension/src/error-sanitizer.test.ts`

## 13. Refactor Guardrail Notes (Forward-Only Rebuild Context)

If preserving interface intent while rebuilding internals, the highest-value invariants to keep stable are:

- Shared envelope shape and standardized error code vocabulary.
- Session state machine transition semantics.
- MCP tool names and schema-level field contracts.
- Core route paths and request/response schema behavior.
- Extension websocket action namespaces and event intent (`drive.hello`, heartbeat, tab report, debugger event).
- CLI envelope output behavior and global host/port/runtime flags.

The largest accidental-complexity hotspots today are:

- duplicate/legacy command and tool aliases
- distributed retry logic spread across bridge/core/adapter/client
- mixed transport lifecycle concerns in startup/readiness/logging layers
- extension permission and connection behavior spread across background/content/popup and storage helpers
