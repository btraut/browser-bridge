# Browser Vision

Hybrid Browser Control MCP (Drive + Inspect) for a local developer feedback loop. The system controls a real Chrome instance for reliable drive actions and uses CDP for read-only inspection.

## Docs
- Requirements: docs/requirements.md
- Spec and plan: docs/spec.md

## Requirements
- Node.js 20+
- Chrome (stable)
- Local-only usage (all services bind to 127.0.0.1)

## Setup and Commands
These commands are provided by the workspace scaffolding at the repo root. If the script names change, update this list to match `package.json`.

- Install dependencies: `npm install`
- Build: `npm run build`
- Lint: `npm run lint`
- Test: `npm test`

## Demo
- Manual checklist: `docs/manual-test.md`
- Scripted run: `scripts/demo.sh` (requires build output and extension loaded)

## MCP Adapter
The MCP adapter runs over stdio and forwards tool calls to Core.

- Start the adapter: `node -e "require('@browser-vision/mcp-adapter').startMcpServer()"`
- Use your MCP client to call `tools/list`, then `session.create`

## Diagnostics
- CLI: `node packages/cli/dist/index.js diagnostics doctor --session-id <id>`

## Extension (Drive Plane) - Load Unpacked
1. Open Chrome and navigate to `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked** and select `packages/extension`.
4. Confirm the extension's background service worker is running.
5. Start the Core daemon (or CLI) so the extension can connect to `127.0.0.1`.

## Drive Plane Manual Check
1. Build the workspace: `npm run build`.
2. Start Core (default `127.0.0.1:3210`, override with `BROWSER_VISION_CORE_PORT`).
3. Load the extension as above and open any page.
4. Create a session: `curl -s localhost:3210/session/create -X POST -H 'content-type: application/json' -d '{}'`.
5. Call a drive route (for example `drive.tab_list`) and verify a tab list is returned.

## Workspace Layout (Planned)
```
packages/
  core/         # daemon + session state machine + HTTP API
  shared/       # schemas, types, constants
  mcp-adapter/  # MCP server wrapping core API
  cli/          # CLI wrapping core API
  extension/    # Chrome extension (drive plane)
```

## Versioning and Release
All packages are private and intended for local development use in v1. Build artifacts are emitted to `dist/` via `npm run build`.
