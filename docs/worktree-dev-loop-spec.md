# Worktree-Isolated Dev Loop Spec

## Goal

Make Browser Bridge development safe and debuggable across multiple git worktrees.

## Outcomes

- Normal users can run Browser Bridge without activation (`127.0.0.1:3210` default).
- Core/CLI/MCP can run in parallel across worktrees without port contention.
- The single Chrome extension can be switched to an isolated worktree runtime in one command.
- Every process writes verbose local logs inside the current worktree.

## Decisions

- Default port is global `3210` (single-instance mode).
- Deterministic per-worktree ports are used only in explicit isolated mode.
- Runtime metadata is persisted in `.context/browser-bridge/dev.json`.
- Logs are JSONL in `.context/logs/browser-bridge/`.
- Log policy: verbose to file, concise stdout.
- Rotation policy: 10 MB max file size, keep 20 files per stream.
- Extension isolated routing is explicit via `browser-bridge dev activate`.

## Scope

- Shared runtime resolver module for host/port/worktree/log paths.
- CLI additions:
  - `browser-bridge dev info`
  - `browser-bridge dev activate`
- Core/CLI/MCP logging wiring to shared logger.
- Extension options integration for activation flow.
- Documentation updates for multi-worktree workflow and troubleshooting.

## End-to-End Worktree Loop

1. Enter the target worktree.
2. Run `browser-bridge dev info` and read resolved runtime (`port`, `worktreeId`, `metadataPath`, `logDir`).
3. For default mode, run CLI/MCP directly (no activation).
4. If you intentionally need isolated parallel worktrees, run `browser-bridge dev activate [--extension-id <id>]`.
5. Run Core/CLI/MCP work in that same worktree/runtime.
6. Inspect `.context/logs/browser-bridge/` per stream before deeper debugging.

## Troubleshooting Playbook

- Extension id missing: run `browser-bridge dev activate --extension-id <id>`, or set `BROWSER_BRIDGE_EXTENSION_ID`.
- Activation URL does not open in Chrome: run `browser-bridge dev activate --json`, copy `result.activationUrl`, open it directly in Chrome.
- Logs: use `.context/logs/browser-bridge/` and inspect `cli.jsonl`, `core.jsonl`, `mcp-adapter.jsonl` (plus rotated `*.1.jsonl`, etc.).
- Port assumptions: default mode is `3210`; isolated mode is worktree-specific. Verify with `browser-bridge dev info`.

## Out of Scope

- Multi-extension orchestration.
- Cross-machine remote core routing.
- Centralized log aggregation.

## Acceptance Criteria

1. Normal usage works without activation on default `127.0.0.1:3210`.
2. Two isolated worktrees can run Core/CLI concurrently with no port conflict.
3. Deterministic port resolution works in isolated mode, while explicit overrides still win.
4. `browser-bridge dev activate` switches extension target for isolated worktree routing.
5. Core/CLI/MCP write verbose structured logs under `.context/logs/browser-bridge/`.
6. Rotation enforces 10 MB max file size and 20-file retention per stream.
7. Existing command behavior remains backward compatible.
8. Docs separate default mode vs isolated mode guidance clearly.
