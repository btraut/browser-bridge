---
name: browser-bridge
description: >
  Local Chrome control via Browser Bridge (CLI + optional MCP). Use when the task needs real browser interaction, reliable DOM inspection, or screenshots.
---

# Browser Bridge (CLI + MCP)

Browser Bridge drives and inspects a real local Chrome instance. You can use it either via the CLI (works everywhere) or via MCP (optional, for MCP-capable clients).

## Prerequisites

- Chrome (stable) with the Browser Bridge extension installed and running
- `browser-bridge` available on PATH (required for both CLI usage and MCP)

## Install

```bash
npm i -g @btraut/browser-bridge
browser-bridge --help
```

## CLI Usage (No MCP Required)

Global option (works on every command):

- `--json`: machine-readable output envelopes

Quickstart:

```bash
browser-bridge session create
# Use the session_id from the output for subsequent commands.

browser-bridge drive navigate --session-id <id> --url https://example.com
browser-bridge drive wait-for --session-id <id> --kind url_matches --value example.com

browser-bridge inspect dom-snapshot --session-id <id> --format ax --interactive --compact
browser-bridge artifacts screenshot --session-id <id> --full-page --format png

browser-bridge diagnostics doctor --session-id <id>
browser-bridge open-artifacts --session-id <id>

browser-bridge session close --session-id <id>
```

Element targeting:

- Find elements to get stable refs (like `@e1`):
  - `browser-bridge inspect find --session-id <id> role button --name "Sign in"`
- Reuse the ref in drive commands:
  - `browser-bridge drive click --session-id <id> --locator-ref @e1`
- Or target directly with locators:
  - `--locator-testid <id>`
  - `--locator-css <selector>`
  - `--locator-text <text>`
  - `--locator-role <role>` + `--locator-role-value <value>`

Wait conditions (`drive wait-for`):

- `--kind locator_visible --value "<css-selector>"`
- `--kind text_present --value "some text"`
- `--kind url_matches --value "regex (preferred) or substring"`

## MCP Server (Optional)

If your agent client supports MCP, configure it to launch:

```bash
browser-bridge mcp
```

The MCP server runs over stdio. MCP clients usually launch it automatically; you only run it manually for debugging.

Note: MCP still requires `browser-bridge` to be on PATH, since the client invokes `browser-bridge mcp`.

## Tool Groups (MCP)

- `session.*` - Session lifecycle
- `drive.*` - Navigation and input
- `inspect.*` - DOM snapshots and evaluation
- `artifacts.*` - Screenshots
- `diagnostics.*` - Health checks

## Practical Guidance (MCP or CLI)

- Always store and reuse the `session_id` for subsequent calls.
- Drive operations are single-flight; do not overlap drive calls.
- After navigation/clicks that trigger page loads, wait for the page to settle:
  - MCP: `drive.wait_for`
  - CLI: `browser-bridge drive wait-for ...`
- Prefer DOM snapshots for broad reads instead of many tiny queries:
  - MCP: `inspect.dom_snapshot`
  - CLI: `browser-bridge inspect dom-snapshot ...`
- If drive/inspect fails, run diagnostics and include the output:
  - MCP: `diagnostics.doctor`
  - CLI: `browser-bridge diagnostics doctor`
