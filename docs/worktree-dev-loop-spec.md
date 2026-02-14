# Worktree-Isolated Dev Loop Spec

## Goal

Make Browser Bridge development safe and debuggable across multiple git worktrees.

## Outcomes

- Core/CLI/MCP can run in parallel across worktrees without port contention.
- The single Chrome extension can be switched to the active worktree in one command.
- Every process writes verbose local logs inside the current worktree.

## Decisions

- Default port is deterministic per worktree path (with bounded probe fallback if occupied).
- Runtime metadata is persisted in `.context/browser-bridge/dev.json`.
- Logs are JSONL in `.context/logs/browser-bridge/`.
- Log policy: verbose to file, concise stdout.
- Rotation policy: 10 MB max file size, keep 20 files per stream.
- Extension targeting is explicit via `browser-bridge dev activate`.
- New AGENTS guidance makes worktree runtime setup mandatory for Browser Bridge tasks.

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
3. If work includes extension-driving actions, run `browser-bridge dev activate [--extension-id <id>]`.
4. Run Core/CLI/MCP work in that same worktree/runtime.
5. Inspect `.context/logs/browser-bridge/` per stream before deeper debugging.

## Troubleshooting Playbook

- Extension id missing: run `browser-bridge dev activate --extension-id <id>`, or set `BROWSER_BRIDGE_EXTENSION_ID`.
- Activation URL does not open in Chrome: run `browser-bridge dev activate --json`, copy `result.activationUrl`, open it directly in Chrome.
- Logs: use `.context/logs/browser-bridge/` and inspect `cli.jsonl`, `core.jsonl`, `mcp-adapter.jsonl` (plus rotated `*.1.jsonl`, etc.).
- Port assumptions: do not assume `3210`; defaults are deterministic per worktree. Verify with `browser-bridge dev info`.

## Out of Scope

- Multi-extension orchestration.
- Cross-machine remote core routing.
- Centralized log aggregation.

## Acceptance Criteria

1. Two worktrees can run Core/CLI concurrently with no default-port conflict.
2. Deterministic port resolution works without manual config, while explicit overrides still win.
3. `browser-bridge dev activate` switches extension target to the current worktree.
4. Core/CLI/MCP write verbose structured logs under `.context/logs/browser-bridge/`.
5. Rotation enforces 10 MB max file size and 20-file retention per stream.
6. Existing command behavior remains backward compatible.
7. `AGENTS.md` contains mandatory worktree runtime + log-first debugging guidance.
8. Docs include usage and troubleshooting for the new dev loop.
