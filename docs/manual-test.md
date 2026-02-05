# Manual Test Workflow

This checklist validates the Drive + Inspect planes and artifact handling end-to-end.

## Prerequisites

1. Install dependencies: `npm install`.
2. Build the workspace: `npm run build`.
3. Load the extension from `packages/extension` (repo) or
   `node_modules/@btraut/browser-bridge-extension` (npm install) in
   `chrome://extensions`.
4. Open a Chrome tab to a real page (example: `https://example.com`).
5. Ensure DevTools is closed on the target tab (the debugger cannot attach while DevTools is open).

## Checklist (Core + CLI)

1. Start the Core daemon in a terminal (optional if you rely on CLI auto-start):
   `npm run start`
2. Create a session:
   `node packages/cli/dist/index.js session create --json`
3. Copy the `session_id` from the JSON output.
4. Navigate the active tab:
   `node packages/cli/dist/index.js drive navigate --session-id <id> --url https://example.com`
5. Confirm drive plane connectivity:
   `node packages/cli/dist/index.js drive tab-list --session-id <id>`
6. Inspect the DOM (requires the debugger-based inspect bridge):
   `node packages/cli/dist/index.js inspect dom-snapshot --session-id <id> --format html --consistency best_effort --json > /tmp/browser-bridge-dom.json`
7. Inspect console logs:
   `node packages/cli/dist/index.js inspect console-list --session-id <id>`
8. Capture a screenshot artifact:
   `node packages/cli/dist/index.js artifacts screenshot --session-id <id> --target viewport`
9. Run diagnostics to confirm reliability status:
   `node packages/cli/dist/index.js diagnostics doctor --session-id <id>`
10. Open the artifact folder:
    `node packages/cli/dist/index.js open-artifacts --session-id <id>`

## Optional Full-Tool CLI Smoke

This optional script exercises every CLI tool against a deterministic fixture
page. It requires the extension to be loaded and the workspace to be built.

1. Open `docs/fixtures/smoke-page.html` in Chrome.
2. Build the workspace: `npm run build`.
3. Run the smoke script:
   `scripts/cli-full-tool-smoke.sh`

## MCP Adapter Sanity Check

1. Start the MCP adapter (stdio transport):
   `node -e "require('@btraut/browser-bridge').startMcpServer()"`
2. Connect with your MCP client and run `tools/list` to confirm `session.*`, `drive.*`, `inspect.*`, `artifacts.*`, `diagnostics.*`.
3. Run `session.create` to verify end-to-end Core routing.

## Expected Results

- `drive tab-list` returns one or more tabs with URL/title metadata.
- `inspect dom-snapshot` writes a snapshot JSON file.
- `artifacts screenshot` returns an artifact path on disk.
- `diagnostics doctor` reports extension connection status, debugger status, and session state.
