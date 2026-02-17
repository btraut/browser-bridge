# Manual Test Workflow

This checklist validates the Drive + Inspect planes and artifact handling end-to-end.

## Prerequisites

1. Install dependencies: `npm install`.
2. Build the workspace: `npm run build`.
   - If you're using the unpacked extension from this repo, reload it in `chrome://extensions` after rebuilding so Chrome picks up updated content scripts.
3. Load the extension from `packages/extension` (repo) or `node_modules/@btraut/browser-bridge/extension` (npm install) in `chrome://extensions`.
4. Open a dedicated Chrome tab you do not mind navigating (example: `about:blank` or `https://example.com`).
5. Ensure DevTools is closed on the target tab (the debugger cannot attach while DevTools is open).

## Runtime Setup

1. Default mode is zero-setup:
   - Core/CLI/extension use `127.0.0.1:3210` by default.
2. Resolve runtime details when needed:
   - `node packages/cli/dist/index.js dev info --json`
3. Only for isolated multi-worktree testing, activate this worktree:
   - `node packages/cli/dist/index.js dev activate --extension-id <id> --json`
4. In isolated mode, do not assume `3210`:
   - Use the `port` returned by `dev info` for manual host/port wiring.
5. Check logs before ad-hoc debugging:
   - `ls -1 .context/logs/browser-bridge`
   - `tail -n 80 .context/logs/browser-bridge/cli.jsonl`
   - `tail -n 80 .context/logs/browser-bridge/core.jsonl`
   - `tail -n 80 .context/logs/browser-bridge/mcp-adapter.jsonl`

### Quick Troubleshooting

- Missing extension id (isolated mode only): pass `--extension-id <id>`, set `BROWSER_BRIDGE_EXTENSION_ID`, or persist it once with `dev activate --extension-id`.
- Activation URL did not open in Chrome: rerun with `--json`, copy `result.activationUrl`, and paste it into Chrome.
- Stream log files: per-stream JSONL files live in `.context/logs/browser-bridge/` with rotations like `core.1.jsonl`.

## Checklist (Core + CLI)

1. Start the Core daemon in a terminal (optional if you rely on CLI auto-start): `npm run start`
2. Create a session: `node packages/cli/dist/index.js session create --json`
3. Copy the `session_id` from the JSON output.
4. Identify the target tab id (recommended, to avoid clobbering your current tab): `node packages/cli/dist/index.js drive tab-list --session-id <id> --json`
5. Navigate that tab: `node packages/cli/dist/index.js drive navigate --session-id <id> --tab-id <tabId> --url https://example.com`
6. Confirm drive plane connectivity: `node packages/cli/dist/index.js drive tab-list --session-id <id>`
7. Inspect the DOM (requires the debugger-based inspect bridge): `node packages/cli/dist/index.js inspect dom-snapshot --session-id <id> --format html --consistency best_effort --json > /tmp/browser-bridge-dom.json`
8. Inspect console logs: `node packages/cli/dist/index.js inspect console-list --session-id <id>`
9. Capture a screenshot artifact: `node packages/cli/dist/index.js artifacts screenshot --session-id <id> --target viewport`
10. Run diagnostics to confirm reliability status: `node packages/cli/dist/index.js diagnostics doctor --session-id <id>`
11. Open the artifact folder: `node packages/cli/dist/index.js open-artifacts --session-id <id>`

## Checklist (Site Permissions)

1. Open the extension options page:
   - Chrome: Extensions menu -> Browser Bridge -> Extension options
   - Or: `chrome://extensions` -> Browser Bridge -> Details -> Extension options
2. Revoke any previously-approved sites so the list is empty.
3. Trigger a permission prompt by navigating to a new site:
   - `node packages/cli/dist/index.js drive navigate --session-id <id> --tab-id <tabId> --url https://example.com`
4. Verify "Allow this action":
   - Click **Allow this action** within 10 seconds.
   - The command should succeed without persisting the site (a later action should prompt again).
5. Verify "Always allow actions on this site":
   - Trigger another prompt on a site you have not approved.
   - Click **Always allow actions on this site**.
   - Retry the command (if it already timed out); it should succeed without prompting on subsequent actions.
6. Verify "Decline":
   - Trigger a prompt and click **Decline**.
   - The command should return `PERMISSION_DENIED` with `retryable: false`.
7. Verify prompt timeout behavior:
   - Trigger a prompt, do not click anything for >10 seconds.
   - The command should return `PERMISSION_PROMPT_TIMEOUT` with `retryable: true`.
   - Click **Always allow actions on this site** in the prompt window.
   - Retry the same command; it should now succeed.
8. Verify revoke takes effect immediately:
   - Revoke the site in the options page.
   - Run a drive action on that site again; it should prompt again.

## Checklist (Popup Connection Indicator)

1. Open the extension toolbar popup.
2. Confirm the compact `Connected:` row is visible above Settings/About.
3. Verify color transitions:
   - While Core is unavailable, the dot should be red.
   - After Core comes online and extension reconnects, the dot should turn green.

## Optional Full-Tool CLI Smoke

This optional script exercises every CLI tool against a deterministic fixture page. It requires the extension to be loaded and the workspace to be built.

1. Open `docs/fixtures/smoke-page.html` in Chrome.
2. Build the workspace: `npm run build`.
3. Run the smoke script: `scripts/cli-full-tool-smoke.sh`

## MCP Adapter Sanity Check

1. Start the MCP adapter (stdio transport): `browser-bridge mcp`
2. Connect with your MCP client and run `tools/list` to confirm `session.*`, `drive.*`, `inspect.*`, `artifacts.*`, `diagnostics.*`.
3. Run `session.create` to verify end-to-end Core routing.

## Expected Results

- `drive tab-list` returns one or more tabs with URL/title metadata.
- `inspect dom-snapshot` writes a snapshot JSON file.
- `artifacts screenshot` returns an artifact path on disk.
- `diagnostics doctor` reports extension connection status, debugger status, session state, and caller/core/extension runtime context for mismatch diagnosis.
