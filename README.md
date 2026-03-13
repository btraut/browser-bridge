<img src="https://raw.githubusercontent.com/btraut/browser-bridge/main/docs/assets/readme-header.png" alt="Browser Bridge header graphic" width="720" />

[![npm version](https://img.shields.io/npm/v/@btraut/browser-bridge.svg)](https://www.npmjs.com/package/@btraut/browser-bridge) [![npm downloads](https://img.shields.io/npm/dm/@btraut/browser-bridge.svg)](https://www.npmjs.com/package/@btraut/browser-bridge) [![CI](https://github.com/btraut/browser-bridge/actions/workflows/ci.yml/badge.svg)](https://github.com/btraut/browser-bridge/actions/workflows/ci.yml) [![License](https://img.shields.io/github/license/btraut/browser-bridge.svg)](LICENSE)

# Browser Bridge

**Reliable local Chrome control for coding agents.**

Browser Bridge drives your real, local Chrome (not headless) and inspects page state through a Chrome extension plus a local daemon. You stay in the loop with your existing tabs and login state.

## 🏁 Install + Quickstart (Do This First)

You need Node.js 20+ and Chrome (stable). Browser Bridge is local-only (binds to 127.0.0.1).

1. Install the CLI:

```bash
npm i -g @btraut/browser-bridge
browser-bridge --help
```

zsh gotcha:

- If `browser-bridge` is not installed or not on `PATH` and you run it from inside a directory also named `browser-bridge`, zsh can print a misleading `permission denied` by trying to execute the directory itself. Check `command -v browser-bridge` before treating that error as a packaging failure.

2. Run the installer:

```bash
browser-bridge install
```

Select your client(s) (Codex, Claude, Cursor, etc).

3. Install the Chrome extension:

- Chrome Web Store listing is pending. For now, install manually.
- Download the latest pre-built extension zip from [GitHub Releases](https://github.com/btraut/browser-bridge/releases) (Assets), unzip it.
- Chrome -> `chrome://extensions` -> enable **Developer mode** -> **Load unpacked** -> select the folder with `manifest.json`.

<details>
<summary>Build the extension from source (instead of using a release zip)</summary>

```bash
npm install
npm run build
```

Then load the unpacked extension from `packages/extension/`.

</details>

Repo contributors: run `npm run hooks:install` once after clone. This repo expects `core.hooksPath=.githooks` so local `pre-commit` and `pre-push` block the same format/lint/typecheck failures that CI enforces.

4. Try it:

```text
Use Browser Bridge to navigate to https://example.com.
```

If Chrome shows a Browser Bridge permissions prompt, approve it, then tell the agent to retry.

<details>
<summary>CLI sanity check (debugging)</summary>

```bash
browser-bridge drive navigate --url https://example.com --json
# Copy result.session_id from the response for subsequent session-scoped calls.
browser-bridge inspect dom-snapshot --session-id <id> --max-nodes 2000
browser-bridge session close --session-id <id>
```

Notes:

- `inspect dom-snapshot` defaults to `--format ax`; `--max-nodes` is only supported for AX snapshots.

</details>

## ✨ What You Get

What makes it different:

- **Real browser state**: operate on your actual Chrome profile (tabs, cookies, logins, extensions).
- **Two-plane architecture**: a **drive** plane that does what a user does (click, type, navigate), plus an **inspect** plane that reads state (DOM, console, screenshots). This separation makes runs less flaky and lets inspection happen in parallel.
- **Safe-by-default drive permissions**: `drive.*` actions are blocked on new sites until you approve them. You can allow once, always allow (per-site allowlist you can audit/revoke), or enable a clearly-labeled bypass mode if you want zero guardrails.
- **Token-efficient inspection**: stable element refs like `@e1` (find once, reuse everywhere) plus knobs to bound output (`--max-nodes`, `--compact`, `--interactive`, `--selector`).
- **Structured errors for agents**: stable error codes with a `retryable` flag (no more guessing whether to retry).
- **Recovery-first**: sessions have an explicit state machine with `session.recover()` and `diagnostics doctor`.
- **Inspect beyond screenshots**: DOM snapshots (AX + HTML) and `inspect dom-diff` to detect page changes.

## Input Semantics

Drive input actions are CDP-first (Chrome DevTools Protocol `Input.*`) so click, hover, drag, key, and type behavior follows Chrome's native input pipeline instead of synthetic DOM event dispatch.

High-level helpers (`drive.select`, `drive.fill_form`) still use explicit fallback branches for control-specific operations that CDP does not model directly (for example selecting by option value/text/index).

See `docs/cdp-input-model.md` for details and smoke verification.

## 🆚 Feature Comparison

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

## 🔒 Site Permissions (Drive Actions)

Browser Bridge is intentionally safe: **drive actions** (`drive.navigate`, click, type, etc.) require **per-site approval**. `inspect.*` is always available in current builds; if diagnostics reports missing inspect capability, that is stale runtime drift, not a separate permission toggle.

<details>
<summary>How approvals work (click to expand)</summary>

- The first time a `drive.*` action targets a new site, Chrome opens a small permissions prompt.
- Click **Allow this action** to allow once (no allowlist entry).
- Click **Always allow actions on this site** to add the site to your approved-sites allowlist.
- Click **Decline** to fail the command with `PERMISSION_DENIED` (non-retryable).
- If you ignore the prompt, the command fails with `PERMISSION_PROMPT_TIMEOUT` (retryable). Default wait is 30 seconds; approve the prompt, then retry the command.

Manage approvals (and bypass mode):

- Open the extension options page from `chrome://extensions` (Browser Bridge -> **Extension options**) or from the Extensions toolbar menu (Browser Bridge -> **Extension options**).
- The options page shows your **Approved sites** allowlist with revoke controls.
- Switch **Permission mode** to **Bypass (dangerous)** to skip the allowlist and prompts entirely.
- In bypass mode, the agent can take actions on any website without asking.
- Restricted URLs (for example `chrome://` and `file://`) are still blocked.
- `inspect.*` should already be enabled in current builds. Use `browser-bridge dev enable-inspect` as a diagnostics probe; if it reports missing inspect capability, treat that as stale runtime drift and reload or update the Browser Bridge extension.

</details>

## 🧰 Tools (MCP + CLI)

The CLI mirrors the MCP tool surface.

<details>
<summary>All MCP tools (click to expand)</summary>

**session**

- `session.create`
- `session.status`
- `session.recover`
- `session.close`

**drive**

- `drive.navigate`
- `drive.go_back`
- `drive.go_forward`
- `drive.back` (deprecated alias for `drive.go_back`)
- `drive.forward` (deprecated alias for `drive.go_forward`)
- `drive.click`
- `drive.hover`
- `drive.select`
- `drive.type`
- `drive.fill_form`
- `drive.drag`
- `drive.handle_dialog`
- `drive.key`
- `drive.key_press`
- `drive.scroll`
- `drive.wait_for`
- `drive.tab_list`
- `drive.tab_activate`
- `drive.tab_close`

**dialog**

- `dialog.accept` (deprecated alias for `drive.handle_dialog` with `action=accept`)
- `dialog.dismiss` (deprecated alias for `drive.handle_dialog` with `action=dismiss`)

**inspect**

- `inspect.dom_snapshot`
- `inspect.dom_diff`
- `inspect.find`
- `inspect.extract_content`
- `inspect.page_state`
- `inspect.console_list`
- `inspect.network_har`
- `inspect.evaluate`
- `inspect.performance_metrics`

**artifacts**

- `artifacts.screenshot`

**misc**

- `health_check`
- `diagnostics.doctor`

</details>

## 🧩 Skills (Agent Clients)

Browser Bridge skills work across many agent clients, including Codex and Claude Code.

Easiest option (recommended):

```bash
browser-bridge install
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

## 🧪 MCP Server (Optional)

The MCP server runs over stdio and forwards tool calls to Core. It is optional, since you can use the CLI directly. MCP clients launch it automatically when needed, so you typically do not run it yourself.

- Easiest option: `browser-bridge mcp install`
- Manual start (debugging): `browser-bridge mcp`
- Use your MCP client to call `tools/list`, then `session.create`
- Override Core host/port with `--host`, `--port`, or `BROWSER_BRIDGE_CORE_HOST` / `BROWSER_BRIDGE_CORE_PORT`.

<details>
<summary>Manual MCP setup (advanced)</summary>

Codex:

```bash
codex mcp add browser-bridge -- browser-bridge mcp
```

Optional custom host/port override (only if you intentionally run Core somewhere else):

```bash
codex mcp add browser-bridge \
  --env BROWSER_BRIDGE_CORE_HOST=127.0.0.1 \
  --env BROWSER_BRIDGE_CORE_PORT=<custom-port> \
  -- browser-bridge mcp
```

Claude Code:

```bash
claude mcp add --transport stdio browser-bridge -- browser-bridge mcp
```

Optional custom host/port override (only if you intentionally run Core somewhere else):

```bash
claude mcp add --transport stdio browser-bridge \
  --env BROWSER_BRIDGE_CORE_HOST=127.0.0.1 \
  --env BROWSER_BRIDGE_CORE_PORT=<custom-port> \
  -- browser-bridge mcp
```

</details>

## ✅ Default Runtime (Normal Usage)

Browser Bridge is now a single-runtime setup by default:

- Core, CLI, and extension target `127.0.0.1:3210`.
- You do not need any activation or routing step for normal use.
- After reboot/cold start, the first CLI or MCP request auto-starts Core (no manual daemon wake-up required).
- If Core is idle/offline, the extension popup may show `disconnected` or `backoff`; that just means Core is not reachable yet.

Optional status check:

```bash
browser-bridge dev info --json
```

Use `browser-bridge dev enable-inspect` only as a quick diagnostics probe when you want to sanity-check debugger-backed inspect on the live runtime:

```bash
browser-bridge dev enable-inspect
```

The helper verifies inspect capability against the live runtime and can also sanity-check a specific connected extension via `--extension-id <id>`. It does not flip inspect on through Core. The extension id may be cached in `.context/browser-bridge/dev.json` after a successful run, but that metadata is no longer a routing switch.

## 🧯 Runtime Troubleshooting

- Inspect capability still unavailable: restart the Browser Bridge core daemon, then reload or update the Browser Bridge extension and rerun `browser-bridge diagnostics doctor` plus `browser-bridge dev enable-inspect`.
- Extension id mismatch while verifying inspect: rerun with the correct `--extension-id <id>` or clear `BROWSER_BRIDGE_EXTENSION_ID` if you pinned the wrong unpacked install. You can copy the id from `chrome://extensions` (enable Developer mode to see ids).
- Logs and per-stream JSONL inspection: Logs are under `.context/logs/browser-bridge/`. Common streams: `cli.jsonl`, `core.jsonl`, `mcp-adapter.jsonl` (plus rotated files like `core.1.jsonl`).

```bash
ls -1 .context/logs/browser-bridge
tail -n 80 .context/logs/browser-bridge/cli.jsonl
tail -n 80 .context/logs/browser-bridge/core.jsonl
tail -n 80 .context/logs/browser-bridge/mcp-adapter.jsonl
```

- Default runtime is `127.0.0.1:3210`. If you are unsure, run `browser-bridge dev info` or pass explicit `--host` / `--port` overrides.

## 🩺 Diagnostics

- CLI: `browser-bridge diagnostics doctor [--session-id <id>]`
- Reports extension and debugger status alongside session state.
- Includes runtime context for caller, Core, and extension endpoints so mismatch causes are visible in one run.
- Popup shows a simple `Connected` indicator (`green` when connected, `red` otherwise).

### End-to-End Connection Troubleshooting Flow

Use this exact flow when commands fail after reboot or runtime changes:

1. Check runtime resolution:

```bash
browser-bridge dev info --json
```

2. Run diagnostics from CLI (captures caller + Core + extension runtime context):

```bash
browser-bridge diagnostics doctor --json
```

3. Open the extension popup and check `Connected`:
   - Green dot: extension is currently connected to Core.
   - Red dot: extension is disconnected or reconnecting.

4. If caller/core/extension endpoints differ in the diagnostics report:
   - Remove custom host/port env overrides and retry (`BROWSER_BRIDGE_CORE_HOST`, `BROWSER_BRIDGE_CORE_PORT`).
   - If inspect capability is the missing piece, run `browser-bridge dev enable-inspect --extension-id <id>`.

5. If the popup stays red and failures continue:
   - Inspect logs:

```bash
tail -n 80 .context/logs/browser-bridge/cli.jsonl
tail -n 80 .context/logs/browser-bridge/core.jsonl
tail -n 80 .context/logs/browser-bridge/mcp-adapter.jsonl
```

6. Retry the command once endpoint mismatch is corrected.

## 🔧 Recovery

If drive or inspect gets into a bad state, recovery is explicit:

- `browser-bridge session recover --session-id <id>`
- Then retry the failed operation once (tools report whether failures are `retryable`).

## 🧹 Session TTL (Core Daemon)

The Core daemon keeps sessions in memory. By default, it automatically cleans up idle sessions after 1 hour.

- `BROWSER_BRIDGE_SESSION_TTL_MS`: Idle session TTL in milliseconds. Set to `0` to disable cleanup.
- `BROWSER_BRIDGE_SESSION_CLEANUP_INTERVAL_MS`: Cleanup interval in milliseconds. Defaults to a small value relative to the TTL.
