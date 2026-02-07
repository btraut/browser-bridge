<img src="docs/assets/readme-header.png" alt="Browser Bridge header graphic" width="720" />

[![npm version](https://img.shields.io/npm/v/@btraut/browser-bridge.svg)](https://www.npmjs.com/package/@btraut/browser-bridge) [![npm downloads](https://img.shields.io/npm/dm/@btraut/browser-bridge.svg)](https://www.npmjs.com/package/@btraut/browser-bridge) [![CI](https://github.com/btraut/browser-bridge/actions/workflows/ci.yml/badge.svg)](https://github.com/btraut/browser-bridge/actions/workflows/ci.yml) [![License](https://img.shields.io/github/license/btraut/browser-bridge.svg)](LICENSE) ![Local only](https://img.shields.io/badge/local--only-127.0.0.1-0ea5e9) ![MCP optional](https://img.shields.io/badge/MCP-optional-2b6cb0)

# Browser Bridge

**Reliable local Chrome control for coding agents.**

Browser Bridge drives your real, local Chrome (not headless) and inspects page state through a Chrome extension plus a local daemon. You stay in the loop with your existing tabs and login state.

What makes it different:

- **Real browser state**: operate on your actual Chrome profile (tabs, cookies, logins, extensions).
- **Two-plane architecture**: serialized **drive plane** for deterministic input, plus an **inspect plane** that can run in parallel.
- **Structured errors for agents**: stable error codes with a `retryable` flag (no more guessing whether to retry).
- **Recovery-first**: sessions have an explicit state machine with `session.recover()` and `diagnostics doctor`.
- **Inspect beyond screenshots**: DOM snapshots (AX + HTML) and `inspect dom-diff` to detect page changes.

## Demos

Short clips are being added. In the meantime, the demo scripts are ready:

- `docs/demos.md`

If you record a clip, the convention is:

- Put assets under `docs/assets/demos/`
- Link them from `docs/demos.md`

## Competitive Positioning

Browser Bridge is built for agent reliability and "stay logged in" workflows, not for headless test automation.

Compared to Playwright/Puppeteer-style tooling:

- Browser Bridge targets the user's existing, interactive Chrome session by default (typical Playwright/Puppeteer flows spin up a separate browser/context).
- Browser Bridge surfaces retry guidance in the API (`retryable`) instead of forcing the agent to infer it from exceptions and timing.
- Browser Bridge ships a first-class inspect plane (DOM snapshots, diffs, diagnostics) designed for LLM consumption.

Compared to extension-first MCP tools (example: mcp-chrome):

- Browser Bridge puts a stateful local Core daemon behind the tools (sessions, recovery, diagnostics, artifacts).
- Drive is intentionally single-flight (mutex) for determinism; inspect is a separate plane that can keep producing structured state.
- CLI works everywhere; MCP is optional.

## How It Works

At a high level:

```text
Agent (CLI or MCP)
  |
  |  (HTTP + JSON envelopes; local-only)
  v
Core daemon (127.0.0.1)
  |                    |
  | drive plane        | inspect plane
  v                    v
Chrome extension  <->  Chrome debugger APIs
```

Core keeps a session state machine and exposes a small set of stable tools:

- `session.*` - lifecycle + recovery
- `drive.*` - navigation + input (single-flight)
- `inspect.*` - DOM snapshots/diffs + evaluation
- `diagnostics.*` - health checks
- `artifacts.*` - screenshots

## Requirements

- Node.js 20+
- Chrome (stable)
- Browser Bridge extension (Chrome Web Store listing pending; see manual install below)
- Local-only usage (all services bind to 127.0.0.1)

## Install (CLI)

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
2. (Optional) Run `browser-bridge install` (skill + optional MCP).
3. Run a quick CLI check (Core auto-starts by default):

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

## Recovery

If drive or inspect gets into a bad state, recovery is explicit:

- `browser-bridge session recover --session-id <id>`
- Then retry the failed operation once (tools report whether failures are `retryable`).

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
