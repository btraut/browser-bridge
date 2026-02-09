<img src="docs/assets/readme-header.png" alt="Browser Bridge header graphic" width="720" />

[![npm version](https://img.shields.io/npm/v/@btraut/browser-bridge.svg)](https://www.npmjs.com/package/@btraut/browser-bridge) [![npm downloads](https://img.shields.io/npm/dm/@btraut/browser-bridge.svg)](https://www.npmjs.com/package/@btraut/browser-bridge) [![CI](https://github.com/btraut/browser-bridge/actions/workflows/ci.yml/badge.svg)](https://github.com/btraut/browser-bridge/actions/workflows/ci.yml) [![License](https://img.shields.io/github/license/btraut/browser-bridge.svg)](LICENSE)

# Browser Bridge

**Reliable local Chrome control for coding agents.**

Browser Bridge drives your real, local Chrome (not headless) and inspects page state through a Chrome extension plus a local daemon. You stay in the loop with your existing tabs and login state.

What makes it different:

- **Real browser state**: operate on your actual Chrome profile (tabs, cookies, logins, extensions).
- **Two-plane architecture**: a **drive** plane that does what a user does (click, type, navigate), plus an **inspect** plane that reads state (DOM, console, screenshots). This separation makes runs less flaky and lets inspection happen in parallel.
- **Safe-by-default drive permissions**: `drive.*` actions are blocked on new sites until you approve them. You can allow once, always allow (per-site allowlist you can audit/revoke), or enable a clearly-labeled bypass mode if you want zero guardrails.
- **Token-efficient inspection**: stable element refs like `@e1` (find once, reuse everywhere) plus knobs to bound output (`--max-nodes`, `--compact`, `--interactive`, `--selector`).
- **Structured errors for agents**: stable error codes with a `retryable` flag (no more guessing whether to retry).
- **Recovery-first**: sessions have an explicit state machine with `session.recover()` and `diagnostics doctor`.
- **Inspect beyond screenshots**: DOM snapshots (AX + HTML) and `inspect dom-diff` to detect page changes.

## Feature Comparison

| Category | Browser Bridge | Playwright MCP | agent-browser | mcp-chrome | Claude Code + Chrome |
| --- | --- | --- | --- | --- | --- |
| Uses your real, already-logged-in Chrome (tabs/cookies) | ✅ | ❌ | ❌ | ✅ | ✅ |
| Visible browser (not headless) | ✅ | ✅ | ❌ | ✅ | ✅ |
| Per-site permission prompts / allowlist | ✅ | ❌ | ❌ | ❌ | ✅ |
| Drive/Inspect split (inspect without racing input) | ✅ | ❌ | ❌ | ❌ | ❌ |
| Token-efficient inspection (element refs, bounded output, cleanup) | ✅ | ❌ | ❌ | ❌ | ❌ |
| Structured errors + retry hints | ✅ | ❌ | ❌ | ❌ | ❌ |
| Explicit recovery + doctor-style diagnostics | ✅ | ❌ | ❌ | ❌ | ❌ |
| DOM diff (change detection) | ✅ | ❌ | ❌ | ❌ | ❌ |
| HAR / network export | ✅ | ✅ | ✅ | ✅ | ❌ |
| Open source | ✅ | ✅ | ✅ | ✅ | ❌ |

## Why Browser Bridge

Browser Bridge is built for agent reliability and "stay logged in" workflows in your real Chrome, not for headless test automation.

If you're coming from Playwright/Puppeteer-style tooling:

- Browser Bridge targets the user's existing, interactive Chrome session (typical Playwright/Puppeteer flows spin up a separate browser/context).
- Browser Bridge surfaces retry guidance in the API (`retryable`) instead of forcing the agent to infer it from exceptions and timing.
- Browser Bridge ships a first-class inspect plane (DOM snapshots, diffs, diagnostics) designed for LLM consumption, with output-bounding options to keep agent context small.

If you're coming from an extension-only MCP tool:

- Browser Bridge puts a stateful local Core daemon behind the tools (sessions, recovery, diagnostics, artifacts).
- Drive actions are serialized for determinism; inspect is a separate plane that can keep producing structured state.
- CLI works everywhere; MCP is optional.

## How It Works

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

1. Download the latest pre-built extension zip from [GitHub Releases](https://github.com/btraut/browser-bridge/releases) (Assets), unzip it, and use the unzipped folder for step 3.

Alternative (build from source):

1. Clone this repo.
2. Install deps and build:

```bash
npm install
npm run build
```

3. Open Chrome and navigate to `chrome://extensions`.
4. Enable **Developer mode**, click **Load unpacked**, and select the extension folder (the folder with `manifest.json`).

### Site Permissions (Drive Actions)

Browser Bridge is intentionally safe: **drive actions** (`drive.navigate`, click, type, etc.) require **per-site approval**.

This is the big differentiator versus most "agent browser" tools: once installed, a lot of them effectively grant blanket click/type powers everywhere. That's convenient right up until an agent starts poking around the wrong account, the wrong tab, or prod. Browser Bridge forces an explicit "yes, on this site" and keeps an audit/revoke list.

How it works:

- The first time a `drive.*` action targets a new site, Chrome opens a small permissions prompt.
- Click **Allow this action** to allow once (no allowlist entry).
- Click **Always allow actions on this site** to add the site to your approved-sites allowlist.
- Click **Decline** to fail the command with `PERMISSION_DENIED` (non-retryable).
- If you ignore the prompt, the command fails with `PERMISSION_PROMPT_TIMEOUT` (retryable). Default wait is 30 seconds; approve the prompt, then retry the command.
- `inspect.*` is not gated, so agents can inspect first and only ask for permission when it's time to click/type.

Manage approvals (and bypass mode):

- Open the extension options page from `chrome://extensions` (Browser Bridge -> **Extension options**) or from the Extensions toolbar menu (Browser Bridge -> **Extension options**).
- The options page shows your **Approved sites** allowlist with revoke controls.
- Switch **Permission mode** to **Bypass (dangerous)** to skip the allowlist and prompts entirely.
- In bypass mode, the agent can take actions on any website without asking.
- Restricted URLs (for example `chrome://` and `file://`) are still blocked.

## Quickstart

1. Install the extension.
2. (Optional) Run `browser-bridge install` (skill + optional MCP).
3. Run a quick CLI check (Core auto-starts):

```bash
browser-bridge session create
# Use the session_id from the output for the next commands.
browser-bridge drive navigate --session-id <id> --url https://example.com
browser-bridge inspect dom-snapshot --session-id <id> --max-nodes 2000
browser-bridge session close --session-id <id>
```

Notes:

- `inspect dom-snapshot` defaults to `--format ax`; `--max-nodes` is only supported for AX snapshots.

## Skills (Agent Clients)

Browser Bridge skills work across many agent clients, including Codex and Claude Code.

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
