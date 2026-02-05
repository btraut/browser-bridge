# Hybrid Browser Control MCP (Drive + Inspect) - Spec + Plan

> **WARNING: THIS DOCUMENT IS OUT OF DATE**
>
> This spec/plan was written during initial development and has drifted from the actual implementation. Do not rely on it as an accurate description of the current system. Refer to the source code for ground truth.
>
> Key areas that may be inaccurate:
>
> - Architecture details and component responsibilities
> - API surface and endpoint specifications
> - Concurrency model and state machine behavior
> - Implementation milestones (many are complete, some evolved differently)
>
> TODO: Reconcile this document with the implementation or archive it.

---

## Context

This project builds a local, developer-focused browser control system for coding agents. It exposes a hybrid Drive + Inspect controller via MCP and a CLI, backed by a single Core daemon. Requirements are captured in `docs/requirements.md`.

## Assumptions and Constraints

- Node.js 20+ and Chrome stable are available on the developer machine.
- V1 prioritizes reliability over speed; no production or remote automation.
- V1 uses the developer's normal Chrome profile with the extension installed (no managed profile launch).
- All network services bind only to 127.0.0.1.
- All APIs use a standard error envelope with stable error codes and retryable flag.

## Implementation Plan

1. Repository scaffolding and workspace setup
   Files to touch: `package.json`, `package-lock.json` or `pnpm-lock.yaml`, `tsconfig.json`, `tsconfig.base.json`, `docs/spec.md`, `docs/requirements.md`, `packages/`
   Code changes: initialize a workspace (npm workspaces or pnpm), set Node 20 engines, add TypeScript, ESLint, and a minimal build pipeline. Create workspace package folders (`core`, `shared`, `mcp-adapter`, `cli`, `extension`). Add root scripts for `build`, `lint`, `test`.
   Tests: add a placeholder `vitest` config and a single smoke test in `packages/core` to validate the test runner.
   Docs: update or add `README.md` with setup, build, and dev commands.
   Verify: `npm install`, `npm run lint`, `npm test`.

2. Shared package: schemas, types, and error envelope
   Files to touch: `packages/shared/src/index.ts`, `packages/shared/src/schemas.ts`, `packages/shared/src/errors.ts`, `packages/shared/src/types.ts`
   Code changes: implement Zod schemas for all MCP tools and common types (Locator, OpResult, SessionInfo, SessionStatus, RecoverResult, DiagnosticReport). Define stable error codes and a standard envelope (success, error, retryable, details). Export shared types for Core, CLI, MCP adapter.
   Tests: unit tests for schema validation and error envelope shapes.
   Docs: update `docs/spec.md` with references to shared package exports.
   Verify: `npm test -- -t shared`.

3. Core daemon skeleton (no Chrome yet)
   Files to touch: `packages/core/src/server.ts`, `packages/core/src/state.ts`, `packages/core/src/session.ts`, `packages/core/src/index.ts`, `packages/core/src/routes/*.ts`
   Code changes: build an HTTP server (Fastify or Express). Implement session state machine with required states and transitions. Provide in-memory session registry and lifecycle API (`session.create/status/recover/close`). Implement `drive_mutex` and stubs for drive/inspect endpoints returning structured “not implemented” errors.
   Tests: unit tests for the state machine transitions and retry rules. API tests for session endpoints using supertest.
   Docs: add API endpoint list to `README.md`.
   Verify: `npm run test -- -t core` and a manual `curl` to `session.create`.

4. Core artifact storage and diagnostics
   Files to touch: `packages/core/src/artifacts.ts`, `packages/core/src/diagnostics.ts`, `packages/core/src/routes/artifacts.ts`, `packages/core/src/routes/diagnostics.ts`
   Code changes: implement artifact directory management (`$TMPDIR/browser-agent/<session_id>/`). Add diagnostics `doctor` endpoint to report extension status and session state.
   Tests: unit tests for artifact path creation and cleanup behavior. API tests for diagnostics output.
   Docs: add a “Diagnostics” section to `README.md`.
   Verify: `npm run test -- -t diagnostics` and check created temp folders.

5. Chrome extension skeleton and WebSocket protocol
   Files to touch: `packages/extension/manifest.json`, `packages/extension/src/background.ts`, `packages/extension/src/content.ts`, `packages/extension/src/protocol.ts`
   Code changes: build MV3 extension with a background service worker. Implement a WebSocket client to the Core daemon on `127.0.0.1`. Define a simple protocol for drive commands and responses (request id, action, params, status). Content script executes DOM actions (click/type/scroll/navigate). Background manages tab events and reports `{ tabId, url, title, windowId, lastActiveAt }`.
   Tests: unit tests for protocol message validation; minimal manual test checklist for extension actions.
   Docs: add extension install/dev steps to `README.md`.
   Verify: load unpacked extension and confirm it connects to Core and can report tab info.

6. Drive plane integration in Core
   Files to touch: `packages/core/src/drive.ts`, `packages/core/src/extension-bridge.ts`, `packages/core/src/routes/drive.ts`
   Code changes: Core tracks extension connection, sets state to DRIVE_READY, and forwards drive actions to extension. Enforce single in-flight drive operation via `drive_mutex`. Implement locator resolution order and `drive.wait_for` logic. Add retries per requirements.
   Tests: unit tests for locator selection and retry behavior. Integration tests using a mocked WebSocket client.
   Docs: document drive tool behaviors and wait semantics.
   Verify: run a local demo that navigates and clicks within a sample page.

7. Inspect integration (Debugger plane)
   Files to touch: `packages/core/src/inspect.ts`, `packages/core/src/routes/inspect.ts`
   Code changes: use the debugger bridge to attach to tabs. Maintain inspect connection, set state to INSPECT_READY, implement inspect operations (dom snapshot with AX/HTML, console list, network HAR, performance metrics, evaluate). Implement tab-to-target heuristic matching and verification steps.
   Tests: unit tests for target matching logic. Integration tests using a headless Chrome instance if feasible; otherwise add a manual verification script.
   Docs: document inspect endpoints and consistency modes (`best_effort`, `quiesce`).
   Verify: run `inspect.dom_snapshot` and confirm output on a known page.

8. Recovery and reliability
   Files to touch: `packages/core/src/recovery.ts`, `packages/core/src/session.ts`
   Code changes: implement `session.recover()` with clear transitions to DEGRADED states and back to READY. Apply retry rules on drive/inspect failures with no infinite loops. Emit structured diagnostic events for failures.
   Tests: state machine tests covering all transitions and retry paths.
   Docs: add a “Recovery” section to `README.md`.
   Verify: simulate extension/inspect disconnects and confirm recovery behavior.

9. MCP adapter
   Files to touch: `packages/mcp-adapter/src/index.ts`, `packages/mcp-adapter/src/server.ts`
   Code changes: implement an MCP server that exposes all tools in `packages/shared`. Each tool forwards to Core HTTP API with no additional logic. Provide configuration to point at Core host/port.
   Tests: mock Core API and validate MCP tool calls and error propagation.
   Docs: add MCP usage config to `README.md`.
   Verify: run MCP adapter and confirm tool list and basic call flow.

10. CLI
    Files to touch: `packages/cli/src/index.ts`, `packages/cli/src/commands/*.ts`, `packages/cli/src/core-client.ts`
    Code changes: implement CLI commands mirroring MCP tools, always supporting `--json`. Add bootstrap behavior to start Core daemon if not running. Add `diagnostics` and `open-artifacts` helpers.
    Tests: CLI smoke tests with mocked Core API responses.
    Docs: document CLI usage and examples.
    Verify: `cli session create`, `cli drive navigate`, `cli inspect dom-snapshot`.

11. End-to-end manual verification workflow
    Files to touch: `docs/manual-test.md`, `scripts/demo.sh`
    Code changes: add a reproducible manual workflow that uses CLI + MCP adapter to drive and inspect a local test page.
    Tests: manual checklist only.
    Docs: include a short “Demo” section in `README.md`.
    Verify: run the demo script end-to-end.

12. Packaging and release hygiene
    Files to touch: `package.json` files in each package, `LICENSE`, `README.md`
    Code changes: set package names, bin entry for CLI, and minimal publish config (private by default). Ensure builds output to `dist/` and work from fresh checkout.
    Tests: run `npm pack` dry run to verify packaging.
    Docs: add “Versioning and Release” notes (local-only v1).
    Verify: `npm run build` from clean repo.

## Testing Strategy and Checkpoints

- Unit tests for shared schemas, core state machine, recovery logic, locator resolution, and target matching.
- API tests for Core HTTP endpoints with mocked extension/inspect clients.
- Manual verification for extension-driven interactions and full end-to-end loop.
- Checkpoints after tasks 3, 6, 7, and 9 to ensure basic drive/inspect/mcp flows work before adding more surface area.

## Rollout and Risks

- Risk: extension and inspect target mismatch. Mitigation: strict heuristic matching and post-attach verification with warnings.
- Risk: WebSocket instability. Mitigation: explicit reconnection handling and `session.recover()`.
- Risk: debugger attach can fail when DevTools is open or pages are restricted. Mitigation: return `DEBUGGER_IN_USE`/`NOT_SUPPORTED` with clear messaging and keep the session stable.

## Beads Handoff

This plan should be translated into Beads epics and issues. Suggested epics align to milestones A-F and supporting infrastructure. After filing, use `beads-review` to polish.

## Appendix: Commands

- `npm install`
- `npm run build`
- `npm test`
- `npm run lint`

## Refactor Plan: Debugger-Based Inspect (2026-02-04)

### Context

Replace the Core's external inspect integration with a debugger-mode inspect plane implemented inside the Chrome extension via `chrome.debugger`. The inspect plane must run against the user's normal Chrome profile with no special launch flags, no separate Chrome instance, and no second extension install. The Drive plane remains extension-based and must keep its single-operation mutex, while inspect calls can run concurrently. MCP tool schemas and CLI commands should keep changes minimal while shifting to debugger-only behavior.

### Assumptions and Constraints

- No Chrome launch flags (no `--remote-debugging-port`), no external DevTools websocket clients.
- Inspect runs against normal Chrome tabs; `chrome.debugger` must handle attach/detach and restricted pages.
- Drive and inspect concurrency rules remain: one drive op at a time; inspect in parallel; `inspect.dom_snapshot` supports `consistency: "best_effort" | "quiesce"`.
- Maintain artifact behavior and standard error envelope.

### Implementation Tasks

1. Remove legacy inspect dependencies and config
   Files to touch: `packages/core/package.json`, `package.json`, `package-lock.json`, `packages/core/src/inspect.ts`, `packages/core/src/index.ts`, `docs/requirements.md`, `docs/manual-test.md`, `README.md`
   Code changes: delete legacy inspect wiring, remove env var knobs for remote-debugging endpoints, and strip any “launch Chrome” logic. Remove inspect-only exports from Core.
   Tests: update or remove unit tests tied to the legacy inspect client; keep inspect tests but re-target them to the new debugger bridge.
   Docs: remove references to legacy inspect clients, remote debugging flags, and managed Chrome profiles.
   Verify: `npm run lint`, `npm test` (or targeted tests) and ensure Core compiles without legacy inspect dependencies.

2. Define the debugger protocol between Core and extension
   Files to touch: `packages/core/src/drive-protocol.ts`, `packages/extension/src/protocol.ts`, `packages/core/src/extension-bridge.ts`, `packages/core/src/index.ts`
   Code changes: extend the existing WS protocol with `debugger.attach`, `debugger.detach`, `debugger.command`, `debugger.event`, `debugger.attached`, `debugger.detached`, `debugger.error`. Add a shared type for debugger messages and keep drive messages intact. Add a dedicated handler in the Core bridge to route debugger responses and events.
   Tests: add protocol unit tests for message validation and event routing.
   Docs: note the protocol additions in `docs/requirements.md` and `docs/spec.md`.
   Verify: run a local extension build and ensure it can connect and send a `debugger.attached` event without errors.

3. Add `chrome.debugger` support in the extension
   Files to touch: `packages/extension/manifest.json`, `packages/extension/src/background.ts`, `packages/extension/src/protocol.ts`
   Code changes: add `"debugger"` permission, implement attach/detach lifecycle per tab, and implement a `sendCommand` wrapper with timeouts and standard error mapping. Maintain a per-tab attach state machine with idle auto-detach. Subscribe to `chrome.debugger.onEvent` and forward `{ tabId, method, params, timestamp }` to Core.
   Tests: add unit tests for state transitions and timeout handling where feasible; otherwise add a manual test checklist for attaching and detaching.
   Docs: update extension dev instructions if needed (permissions and infobar behavior).
   Verify: load extension, attach to an active tab, run `Runtime.evaluate`, confirm `debugger.event` flows to Core.

4. Build the Core debugger bridge and ring buffers
   Files to touch: `packages/core/src/extension-bridge.ts`, `packages/core/src/inspect.ts`, `packages/core/src/diagnostics.ts`, `packages/core/src/routes/inspect.ts`
   Code changes: add a debugger bridge that sends `debugger.attach/detach/command` via the extension socket, handles timeouts, and normalizes errors. Maintain per-session/per-tab ring buffers for console and network events fed by `debugger.event`. Add an "inspection session" idle timeout to avoid re-attaching for repeated inspect calls.
   Tests: add unit tests for ring buffer behavior, idle detach, and error normalization.
   Docs: update diagnostics description to include debugger availability and buffer sizes.
   Verify: start Core, attach to a tab, and confirm `inspect.console_list` returns buffered entries.

5. Implement inspect capabilities via debugger domains
   Files to touch: `packages/core/src/inspect.ts`, `packages/core/src/routes/inspect.ts`, `packages/core/src/artifacts.ts`
   Code changes: implement the mapping below using `debugger.command` and buffered events:

- `inspect.console_list`: enable `Runtime`/`Log` domains, return entries since timestamp.
- `inspect.network_har`: enable `Network` events, aggregate request/response/timing, optionally fetch response bodies with size limits and truncation metadata.
- `inspect.evaluate`: use `Runtime.evaluate` with `returnByValue`; handle unserializable values.
- `inspect.dom_snapshot`: use `DOM.getDocument` + `DOM.getOuterHTML` for HTML; attempt `Accessibility.getFullAXTree` for `format: "ax"` and return `NOT_SUPPORTED` if unavailable.
- `inspect.performance_metrics`: `Performance.enable` + `Performance.getMetrics`.
- `artifacts.screenshot`: prefer `Page.captureScreenshot` and fallback to `chrome.tabs.captureVisibleTab` when debugger capture fails.
  Tests: add unit tests for response shaping and error handling; add integration tests behind a manual flag if browser access is needed.
  Docs: document truncation behavior, size limits, and `NOT_SUPPORTED` behavior for AX snapshots.
  Verify: run a manual flow to capture a screenshot, list console logs, and fetch network entries on a simple page.

6. Enforce concurrency and consistency semantics
   Files to touch: `packages/core/src/drive.ts`, `packages/core/src/inspect.ts`, `packages/core/src/state.ts`
   Code changes: keep the drive mutex intact; allow inspect to run concurrently. Implement `consistency: "quiesce"` by acquiring the drive mutex around the DOM snapshot request. `best_effort` must not block drive.
   Tests: add unit tests ensuring drive lock is held only for `quiesce` snapshots.
   Docs: clarify this behavior in `docs/requirements.md` and `README.md`.
   Verify: run parallel drive + inspect calls and confirm `best_effort` does not block drive.

7. Update diagnostics and error codes
   Files to touch: `packages/shared/src/errors.ts`, `packages/shared/src/schemas.ts`, `packages/shared/src/schemas.test.ts`, `packages/core/src/diagnostics.ts`, `packages/core/src/routes/diagnostics.ts`
   Code changes: add standardized error codes (`DEBUGGER_IN_USE`, `ATTACH_DENIED`, `TAB_NOT_FOUND`, `NOT_SUPPORTED`, `TIMEOUT`). Update diagnostics to report debugger permission, attach capability, last error, and buffer sizes. Keep the error envelope stable.
   Tests: update schema tests and diagnostics output tests to include new fields.
   Docs: update `docs/requirements.md` with the new error codes and debugger checks.
   Verify: run `diagnostics.doctor` with DevTools open and confirm `DEBUGGER_IN_USE` reporting.

8. Update MCP adapter, CLI, and docs for debugger-only behavior
   Files to touch: `packages/mcp-adapter/src/tools.ts`, `packages/cli/src/commands/*.ts`, `docs/manual-test.md`, `README.md`
   Code changes: keep tool names and inputs coherent with debugger-only inspect. Ensure CLI outputs and JSON envelopes match current schemas.
   Tests: run CLI smoke tests and MCP adapter tool list checks.
   Docs: update manual test steps to target normal Chrome + extension debugger.
   Verify: run the manual smoke script in `docs/manual-test.md` and confirm end-to-end behavior.

### Testing Strategy and Checkpoints

- Unit tests for debugger protocol parsing, ring buffer behavior, and error mapping.
- Core inspect tests for response shaping and timeout/retry handling.
- Manual browser verification for attach/detach, console, network, DOM snapshot, evaluate, and screenshot.
- Checkpoints after tasks 1, 4, 5, and 8 to keep the repo green.

### Rollout and Risks

- Risk: DevTools already attached prevents `chrome.debugger` attach. Mitigation: return `DEBUGGER_IN_USE` with a clear message and do not break the session.
- Risk: restricted pages cannot be inspected. Mitigation: detect and return `NOT_SUPPORTED` with retryable=false.
- Risk: large snapshots or bodies exceed limits. Mitigation: truncate with warnings and document limits.

### Beads Handoff

Translate this plan into Beads epics and issues once approved. Prefer a single epic with child tasks for each implementation milestone above, with clear dependencies and parallelizable items.
