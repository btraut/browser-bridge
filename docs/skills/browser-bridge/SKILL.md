---
name: browser-bridge
description: >
  Local Chrome control via Browser Bridge MCP (Drive + Inspect). Use when the
  task needs real browser interaction, reliable DOM inspection, or screenshots.
---

# Browser Bridge MCP

Use the MCP tools exposed by Browser Bridge to drive and inspect a real Chrome
instance on the local machine.

## Prerequisites

- Core daemon reachable on `127.0.0.1:3210` (default).
- Browser Bridge extension installed and running.
- MCP server configured in your client (it will launch `browser-bridge mcp`).

## Core Workflow

1. `session.create` - Start a session and capture `session_id`.
2. `drive.*` - Navigate and interact (single-flight; wait for each call to finish).
3. `inspect.*` - Read-only inspection (DOM snapshots, evaluate, network).
4. `artifacts.screenshot` - Capture visuals when needed.
5. `diagnostics.doctor` - Troubleshoot when drive/inspect fail.
6. `session.close` - Clean up when done.

## Tool Groups (MCP)

- `session.*` - Session lifecycle
- `drive.*` - Navigation and input
- `inspect.*` - DOM snapshots and evaluation
- `artifacts.*` - Screenshots
- `diagnostics.*` - Health checks

## Practical Guidance

- Always store and reuse the `session_id` for subsequent calls.
- Drive operations are single-flight; do not overlap drive calls.
- Use `drive.wait_for` after navigation or clicks that trigger page loads.
- Prefer `inspect.dom_snapshot` for large DOM reads instead of many `inspect.find`
  calls.
- If inspection fails, run `diagnostics.doctor` and report the error details.
