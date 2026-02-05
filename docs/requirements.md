# Hybrid Browser Control MCP (Drive + Inspect) Requirements

> **WARNING: THIS DOCUMENT IS OUT OF DATE**
>
> This requirements document was written during initial planning and has drifted from the actual implementation. Do not rely on it as an accurate description of the current system. Refer to the source code for ground truth.
>
> Key areas that may be inaccurate:
>
> - Architecture details and component responsibilities
> - API surface and endpoint specifications
> - Concurrency model and state machine behavior
>
> TODO: Reconcile this document with the implementation or archive it.

---

**Context and Goal**
Build a local, developer-focused browser control system used by coding agents (via MCP and CLI) for a development feedback loop. The system must control a real Chrome browser to navigate, click, type, log in, and submit forms, and it must also inspect DOM state, console errors, network requests, and performance to verify changes.

**Non-Goals**
This is not production automation, scraping, or cross-machine control. It is dev-only and local.

**Priority**
Reliability is the #1 priority. Speed and elegance are secondary.

**High-Level Design (Non-Negotiable)**
The system is a hybrid, two-plane browser controller operating against the same Chrome instance and tab.

Drive Plane (Human-Centric Control)

- Implemented via a Chrome extension.
- Responsibilities: clicking, typing, scrolling, navigating, tab management.
- Uses Chrome extension APIs.
- Feels like “a human using the browser.”
- Highly reliable.

Inspect Plane (Diagnostic / Introspection)

- Implemented via the Chrome extension debugger bridge (`chrome.debugger`).
- Responsibilities: DOM snapshots (AX preferred), console logs, network HAR, performance metrics, JS evaluation.
- Read-only by default.
- Can run in parallel with drive plane.

**Architecture Overview**
Required components:

1. Core Daemon (TypeScript, Node 20+)

- Single source of truth.
- Responsibilities: session lifecycle, extension connection management, debugger attach/detach management, drive/inspect routing, concurrency control, retry & recovery, artifact storage, diagnostics.
- Exposes a local HTTP API consumed by MCP adapter and CLI.
- No business logic in MCP or CLI.

2. Chrome Extension (Drive Plane)

- Connects to Core over localhost WebSocket.
- Executes: click, type, scroll, navigate, tab list/activate/close.
- Reports: active tabId, url, title, windowId, timestamps.
- No authentication required (dev tool).
- Bind only to 127.0.0.1.

3. MCP Adapter

- Exposes structured MCP tool surface.
- Thin wrapper over Core API.
- No state, no logic.

4. CLI

- Mirrors MCP capabilities.
- Always supports `--json`.
- Starts Core daemon if not running.
- Used for manual debugging, diagnostics, fallback recovery.

**Key Design Decisions (Locked In)**

Transport

- Extension <-> Core: WebSocket over localhost.
- No auth, no tokens (v1).
- Core binds only to 127.0.0.1.

Debugger Attach Strategy

- Goal: install the extension, then everything just works.
- Inspect attaches to existing tabs via `chrome.debugger`.
- No user flags, no remote-debugging setup required.
- Core does not launch or manage a separate Chrome profile.

Tab <-> Target Mapping (V1)

- Heuristic matching, not hard guarantees.
- Extension reports `{ tabId, url, title, lastActiveAt }`.
- Match by exact URL, title, and recency.
- Verify after match: compare `document.location.href` and `document.title`.
- If mismatch -> retry once, then proceed with warning.

Concurrency Model

- Only one drive operation at a time.
- Inspect operations may run in parallel.
- Some inspect calls may request quiescence.
- Implement a `drive_mutex`.
- Optional consistency modes for inspect ops: `best_effort` and `quiesce`.

Wait Semantics

- Conservative defaults.
- `drive.navigate` waits for `domcontentloaded`.
- `drive.click` has no implicit wait.
- Explicit waits via `drive.wait_for`.
- Do not hide waits inside actions.

Locator Strategy

- Locator union with deterministic fallback order.
- Fallback order: `testid`, `css`, `role` (optional v1), `text` (contains).
- V1 may skip role internally but must accept it in schema.

DOM Representation

- Primary: Accessibility Tree snapshot.
- Fallback: HTML snapshot.

Artifacts

- Persist to temp workspace directory, e.g. `$TMPDIR/browser-agent/<session_id>/`.
- Screenshots, HARs, traces saved to disk.
- Return `{ artifact_id, path, mime }`.
- CLI should allow opening the folder.

Errors

- All APIs return a standard envelope with stable error codes, retryable flag, and structured details.
- Debugger-specific codes: `DEBUGGER_IN_USE`, `ATTACH_DENIED`, `TAB_NOT_FOUND`, `NOT_SUPPORTED`, `TIMEOUT`.

Language Choice

- TypeScript / Node.js for v1.
- Reasons: extension is JS/TS, MCP ecosystem is Node-friendly, reliability depends on state machines not raw performance.

Project Structure (Recommended)

```
browser-agent/
  packages/
    core/          # daemon + session state machine + HTTP API
    mcp-adapter/   # MCP server wrapping core API
    cli/           # CLI wrapping core API
    extension/     # Chrome extension (drive plane)
    shared/        # schemas, types, zod, constants
```

**Session State Machine (Required)**
States

```
enum SessionState {
  INIT,
  DRIVE_READY,
  INSPECT_READY,
  READY,                // both planes connected
  DEGRADED_DRIVE,       // inspect ok, drive down
  DEGRADED_INSPECT,     // drive ok, inspect down
  BROKEN,               // neither usable
  CLOSED
}
```

Transitions (Simplified)

- INIT -> DRIVE_READY (extension connects)
- INIT -> INSPECT_READY (debugger attaches)
- DRIVE_READY + INSPECT_READY -> READY
- READY -> DEGRADED_DRIVE (extension disconnect)
- READY -> DEGRADED_INSPECT (debugger disconnect)
- DEGRADED\_\* -> READY (recover succeeds)
- any -> BROKEN (recover fails)
- any -> CLOSED (explicit close)

Retry Rules

- Drive op failure: if retryable -> `session.recover()` -> retry once.
- Inspect op failure: retry once if debugger reconnect succeeds.
- Never infinite retry.

**MCP Tool Schema (Zod)**
Common types

```ts
const Locator = z.object({
  testid: z.string().optional(),
  css: z.string().optional(),
  text: z.string().optional(),
  role: z
    .object({
      name: z.string(),
      value: z.string().optional(),
    })
    .optional(),
});
```

session.\*

```ts
session.create: {
  input: z.object({}),
  output: SessionInfo
}

session.status: {
  input: z.object({ session_id: z.string() }),
  output: SessionStatus
}

session.recover: {
  input: z.object({ session_id: z.string() }),
  output: RecoverResult
}

session.close: {
  input: z.object({ session_id: z.string() }),
  output: z.object({ ok: z.boolean() })
}
```

drive.\*

```ts
drive.navigate: {
  input: z.object({
    session_id: z.string(),
    url: z.string(),
    wait: z.enum(["none", "domcontentloaded"]).default("domcontentloaded"),
  }),
  output: OpResult
}

drive.click: {
  input: z.object({
    session_id: z.string(),
    locator: Locator,
    click_count: z.number().optional(),
  }),
  output: OpResult
}

drive.type: {
  input: z.object({
    session_id: z.string(),
    locator: Locator.optional(),
    text: z.string(),
    clear: z.boolean().default(false),
    submit: z.boolean().default(false),
  }),
  output: OpResult
}

drive.wait_for: {
  input: z.object({
    session_id: z.string(),
    condition: z.object({
      kind: z.enum(["locator_visible", "text_present", "url_matches"]),
      value: z.string(),
    }),
    timeout_ms: z.number().optional(),
  }),
  output: OpResult
}

drive.tab_list
drive.tab_activate
drive.tab_close
```

inspect.\*

```ts
inspect.dom_snapshot: {
  input: z.object({
    session_id: z.string(),
    format: z.enum(["ax", "html"]).default("ax"),
    consistency: z.enum(["best_effort", "quiesce"]).default("best_effort"),
  }),
  output: DomSnapshot
}

inspect.console_list
inspect.network_har
inspect.evaluate
inspect.performance_metrics
```

artifacts.\*

```ts
artifacts.screenshot: {
  input: z.object({
    session_id: z.string(),
    target: z.enum(["viewport", "full"]).default("viewport"),
  }),
  output: {
    artifact_id: string,
    path: string,
    mime: string
  }
}
```

diagnostics.\*

```ts
diagnostics.doctor: {
  input: z.object({ session_id: z.string().optional() }),
  output: DiagnosticReport
}
```

**Milestones (Parallelizable)**

- Milestone A: Core skeleton (HTTP API, session state machine, no Chrome yet)
- Milestone B: Extension (WS protocol, click/type/navigate, tab reporting)
- Milestone C: Debugger-based inspect integration (attach/detach, inspect APIs)
- Milestone D: MCP adapter (tool schemas, mapping to Core)
- Milestone E: CLI (JSON output, daemon bootstrap, diagnostics)
- Milestone F: Recovery & Reliability (reconnect logic, retries, DEGRADED states)

**Final Instructions to the Coding Agent**

- Do not invent new product goals.
- Favor explicitness over magic.
- Document every assumption.
- Prefer boring, reliable defaults.
- Treat this as infrastructure, not a demo.
- Start by creating the repo structure, implementing the Core daemon + session state machine, and stubbing MCP schemas and CLI commands. Only then build Chrome integration.
- If anything in this spec feels ambiguous, document the ambiguity in comments rather than guessing silently.
