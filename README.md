<img src="docs/assets/readme-header.png" alt="Browser Bridge header graphic" width="720" />

[![npm version](https://img.shields.io/npm/v/@btraut/browser-bridge.svg)](https://www.npmjs.com/package/@btraut/browser-bridge) [![CI](https://github.com/btraut/browser-bridge/actions/workflows/ci.yml/badge.svg)](https://github.com/btraut/browser-bridge/actions/workflows/ci.yml) [![License](https://img.shields.io/github/license/btraut/browser-bridge.svg)](LICENSE)

# Browser Bridge

Local Chrome control for coding agents. Browser Bridge provides a CLI and an optional MCP server that drive your real, local Chrome (not headless) and read page state through a Chrome extension. This keeps you in the loop, with your existing tabs and login state.

## Requirements

- Node.js 20+
- Chrome (stable)
- Browser Bridge extension (Chrome Web Store listing pending; see manual install below)
- Local-only usage (all services bind to 127.0.0.1)

## Install

```bash
npm i -g @btraut/browser-bridge
browser-bridge --help
```

## Chrome Extension (Manual Install)

Chrome Web Store listing is pending. For now, install the extension manually:

1. Clone this repo.
2. Install deps and build:

```bash
npm install
npm run build
```

3. Open Chrome and navigate to `chrome://extensions`.
4. Enable **Developer mode**, click **Load unpacked**, and select `packages/extension` (the folder with `manifest.json`).

## Quickstart

1. Install the extension.
2. Run `browser-bridge install` (skill + optional MCP).
3. Run a quick CLI check:

```bash
browser-bridge session create
# Use the session_id from the output for the next commands.
browser-bridge drive navigate --session-id <id> --url https://example.com
browser-bridge inspect dom-snapshot --session-id <id> --max-nodes 2000
browser-bridge session close --session-id <id>
```

Notes:

- `inspect dom-snapshot` defaults to `--format ax`; `--max-nodes` is only supported for AX snapshots.

## Skills (Codex + Claude Code)

Easiest option (recommended):

```bash
browser-bridge install
```

Skill only:

```bash
browser-bridge skill install
browser-bridge skill status
```

Or copy the Browser Bridge skill into your agent skills directory (advanced):

```bash
# From this repo:
# cp -R docs/skills/browser-bridge ~/.agents/skills/browser-bridge
# cp -R docs/skills/browser-bridge ~/.claude/skills/browser-bridge

# From npm (global install):
cp -R "$(npm root -g)/@btraut/browser-bridge/skills/browser-bridge" ~/.agents/skills/browser-bridge
cp -R "$(npm root -g)/@btraut/browser-bridge/skills/browser-bridge" ~/.claude/skills/browser-bridge
```

Restart your agent app if it does not pick up the new skill automatically.

## MCP Server (Optional)

The MCP server runs over stdio and forwards tool calls to Core. It is optional, since you can use the CLI directly. MCP clients launch it automatically when needed, so you typically do not run it yourself.

- Easiest option: `browser-bridge mcp install`
- Manual start (debugging): `browser-bridge mcp`
- Use your MCP client to call `tools/list`, then `session.create`
- Override Core host/port with `--host`, `--port`, or `BROWSER_BRIDGE_CORE_HOST` / `BROWSER_BRIDGE_CORE_PORT`.

## Manual MCP Setup (Advanced)

Codex:

```bash
codex mcp add browser-bridge -- browser-bridge mcp
```

Optional custom host/port:

```bash
codex mcp add browser-bridge \
  --env BROWSER_BRIDGE_CORE_HOST=127.0.0.1 \
  --env BROWSER_BRIDGE_CORE_PORT=3210 \
  -- browser-bridge mcp
```

Claude Code:

```bash
claude mcp add --transport stdio browser-bridge -- browser-bridge mcp
```

Optional custom host/port:

```bash
claude mcp add --transport stdio browser-bridge \
  --env BROWSER_BRIDGE_CORE_HOST=127.0.0.1 \
  --env BROWSER_BRIDGE_CORE_PORT=3210 \
  -- browser-bridge mcp
```

## Diagnostics

- CLI: `browser-bridge diagnostics doctor --session-id <id>`
- Reports extension and debugger status alongside session state.

## Session TTL (Core Daemon)

The Core daemon keeps sessions in memory. By default, it automatically cleans up idle sessions after 1 hour.

- `BROWSER_BRIDGE_SESSION_TTL_MS`: Idle session TTL in milliseconds. Set to `0` to disable cleanup.
- `BROWSER_BRIDGE_SESSION_CLEANUP_INTERVAL_MS`: Cleanup interval in milliseconds. Defaults to a small value relative to the TTL.

## Changelog

See `CHANGELOG.md`.

## Releasing

See `docs/releasing.md`.

## Security Model (v1)

- Extension <-> Core WebSocket has no authentication; trust local machine only.
- Do not expose the port or run the Core daemon on shared hosts.

## Development Notes

If you are contributing locally, load the extension unpacked:

1. Open Chrome and navigate to `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked** and select `packages/extension` (repo).
4. Confirm the extension's background service worker is running.
5. Start the Core daemon (or run `browser-bridge session create`) so the extension can connect to `127.0.0.1`.

Additional manual test flows live in `docs/manual-test.md`.
