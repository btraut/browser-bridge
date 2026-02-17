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

Install this skill into your agent client:

```bash
browser-bridge skill install
```

Or use the guided installer (skill + optional MCP):

```bash
browser-bridge install
```

## CLI Usage (No MCP Required)

Global option (works on every command):

- `--json`: machine-readable output envelopes

Quickstart:

```bash
browser-bridge drive navigate --url https://example.com --json
# Use result.session_id from the navigate output for subsequent session-scoped commands.

browser-bridge drive wait-for --session-id <id> --kind url_matches --value example.com

browser-bridge inspect dom-snapshot --session-id <id> --format ax --interactive --compact --max-nodes 2000
browser-bridge artifacts screenshot --session-id <id> --full-page --format png

browser-bridge diagnostics doctor --session-id <id>
browser-bridge open-artifacts --session-id <id>

browser-bridge session close --session-id <id>
```

Notes:

- `--max-nodes` only applies to `--format ax` snapshots. For `--format html`, the snapshot succeeds and the flag is ignored with a warning.
- When `tab_id` is omitted, drive commands target a dedicated agent window/tab that Browser Bridge creates and reuses automatically.

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

- `drive.navigate` accepts optional `session_id`; omit it to let Core auto-create a session, then store/reuse the returned `session_id` for subsequent calls.
- Drive operations are single-flight; do not overlap drive calls.
- Drive actions are permission-gated per site (safe-by-default). The first time you target a new site, Chrome will open a permission prompt that the user must approve.
- After navigation/clicks that trigger page loads, wait for the page to settle:
  - MCP: `drive.wait_for`
  - CLI: `browser-bridge drive wait-for ...`
- Prefer DOM snapshots for broad reads instead of many tiny queries:
  - MCP: `inspect.dom_snapshot`
  - CLI: `browser-bridge inspect dom-snapshot ...`
- If drive/inspect fails, run diagnostics and include the output:
  - MCP: `diagnostics.doctor`
  - CLI: `browser-bridge diagnostics doctor`

### Site Permissions (Drive Actions)

Browser Bridge gates `drive.*` actions on a per-site allowlist.

- `inspect.*` is not gated, so you can inspect freely and only ask for permission when it is time to click/type.
- The first time a `drive.*` action targets a new site, Chrome opens a small permission prompt.
  - **Allow this action**: allow once (does not add to allowlist)
  - **Always allow actions on this site**: adds the site to the allowlist
  - **Decline**: command fails with `PERMISSION_DENIED` (non-retryable)
- If the prompt is ignored, the command fails with `PERMISSION_PROMPT_TIMEOUT` (retryable). Default wait is 30 seconds; approve the prompt, then retry the command.

Manage approvals (and bypass mode):

- Open the extension options page (via `chrome://extensions` -> Browser Bridge -> Extension options, or from the Extensions toolbar menu).
- Review/revoke sites under **Approved sites**.
- Switch **Permission mode** to **Bypass (dangerous)** to skip prompts/allowlist entirely.
  - Restricted URLs (for example `chrome://` and `file://`) are still blocked.

### Error Handling (Structured Envelopes)

When you use JSON output (CLI `--json`, or MCP tool results), errors have stable codes and an explicit retry hint:

- `ok: false` with `{ error: { code, message, retryable, details? } }`
- Handle permission-gating errors explicitly:
  - `PERMISSION_PROMPT_TIMEOUT` (retryable): user needs to approve the prompt; then retry.
  - `PERMISSION_DENIED` (not retryable): user declined; ask them to allow/always-allow (or add the site in extension options), then retry.
