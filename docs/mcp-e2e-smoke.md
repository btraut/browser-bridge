# MCP Adapter E2E Smoke (Optional)

This smoke flow validates the MCP adapter against a running Core + Chrome extension.
It is **not** part of CI because it requires a live browser environment.

## Prerequisites

1. Install dependencies: `npm install`.
2. Build the workspace: `npm run build`.
3. Load the extension from `packages/extension` (repo) or
   `node_modules/@btraut/browser-bridge/extension` (npm install) in
   `chrome://extensions`.
4. Open a dedicated Chrome tab you do not mind navigating (example: `about:blank` or `https://example.com`).
5. Ensure DevTools is closed on the target tab (the debugger cannot attach while DevTools is open).

## Run

1. Start the Core daemon:
   `npm run start`
2. Start the MCP adapter (stdio transport):
   `browser-bridge mcp`
3. Connect with your MCP client and run `tools/list`.
4. Run `session.create` and note the `session_id`.
5. With the `session_id`, run a minimal smoke set:
   - `drive.navigate` to a known URL (defaults to the active tab unless `tab_id` is provided)
   - `drive.tab_list`
   - `inspect.dom_snapshot`
   - `artifacts.screenshot`
   - `diagnostics.doctor`

## Expected Results

- Each call returns a valid MCP success envelope.
- `drive.tab_list` returns one or more tabs.
- `inspect.dom_snapshot` returns a snapshot payload.
- `artifacts.screenshot` returns an artifact path.
- `diagnostics.doctor` reports extension + debugger status.

## Notes

- If Core runs on a non-default host/port, set `BROWSER_BRIDGE_CORE_HOST` and
  `BROWSER_BRIDGE_CORE_PORT` before starting the adapter.
