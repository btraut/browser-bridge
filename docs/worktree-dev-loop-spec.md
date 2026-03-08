# Single-Runtime Dev Loop Spec

Historical filename retained for continuity. This file supersedes the old worktree-routing story; current Browser Bridge behavior is one runtime on `127.0.0.1:3210`.

## Goal

Make Browser Bridge development boring in the good way: one runtime, one port, predictable inspect setup.

## Outcomes

- Normal users can run Browser Bridge without activation on `127.0.0.1:3210`.
- Core/CLI/MCP all point at the same default runtime unless the caller explicitly overrides host or port.
- Debugger-based inspect has a narrow setup command that does not change runtime routing.
- Every process writes verbose local logs inside the current worktree.

## Decisions

- Default runtime is `127.0.0.1:3210`.
- No isolated or per-worktree routing guidance is part of the supported dev loop.
- Runtime metadata is persisted in `.context/browser-bridge/dev.json`.
- Logs are JSONL in `.context/logs/browser-bridge/`.
- Log policy: verbose to file, concise stdout.
- Rotation policy: 10 MB max file size, keep 20 files per stream.
- Inspect setup is explicit via `browser-bridge dev enable-inspect`.

## Scope

- Shared runtime resolver module for host/port/worktree/log paths.
- CLI additions:
  - `browser-bridge dev info`
  - `browser-bridge dev enable-inspect`
- Core/CLI/MCP logging wiring to shared logger.
- Extension options integration for inspect enablement.
- Documentation updates for the single-runtime workflow and troubleshooting.

## End-to-End Dev Loop

1. Enter the target worktree.
2. Run `browser-bridge dev info` and read resolved runtime (`host`, `port`, `metadataPath`, `logDir`).
3. Run CLI/MCP directly against the default runtime (`127.0.0.1:3210`).
4. If you need debugger-based inspect, run `browser-bridge dev enable-inspect [--extension-id <id>]`.
5. Inspect `.context/logs/browser-bridge/` per stream before deeper debugging.

## Troubleshooting Playbook

- Extension id missing while enabling inspect: run `browser-bridge dev enable-inspect --extension-id <id>`, or set `BROWSER_BRIDGE_EXTENSION_ID`.
- Options page does not open in Chrome: run `browser-bridge dev enable-inspect --json`, copy `result.optionsUrl`, open it directly in Chrome.
- Logs: use `.context/logs/browser-bridge/` and inspect `cli.jsonl`, `core.jsonl`, `mcp-adapter.jsonl` (plus rotated `*.1.jsonl`, etc.).
- Port assumptions: default runtime is `127.0.0.1:3210`. Verify with `browser-bridge dev info` if you have env overrides in play.

## Out of Scope

- Multi-extension orchestration.
- Cross-machine remote core routing.
- Centralized log aggregation.

## Acceptance Criteria

1. Normal usage works without activation on default `127.0.0.1:3210`.
2. Explicit host/port overrides still win when a caller intentionally needs them.
3. `browser-bridge dev enable-inspect` enables debugger-based inspect without changing runtime routing.
4. Core/CLI/MCP write verbose structured logs under `.context/logs/browser-bridge/`.
5. Rotation enforces 10 MB max file size and 20-file retention per stream.
6. Docs consistently describe one default runtime instead of a split default-vs-isolated model.
