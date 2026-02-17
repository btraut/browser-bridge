# Tool Coverage Strategy

This repo keeps MCP and CLI tool coverage synchronized through shared fixtures, contract checks, and optional E2E smoke flows.

## Source of Truth

- MCP tool list: `packages/shared/src/tooling.ts`
- `drive.navigate` parity variants (explicit + missing session): `packages/shared/src/tooling.ts` (`DRIVE_NAVIGATE_PARITY_CASES`)

When adding or removing tools, update the shared list first, then keep the adapter and CLI fixtures aligned.

## MCP Adapter Coverage

- Fixtures + coverage matrix: `packages/mcp-adapter/src/tool-fixtures.ts`
- Contract checks: `packages/mcp-adapter/src/tools.contract.test.ts`

These ensure every MCP tool has a fixture, valid schemas, and tracked coverage, including both `drive.navigate` session variants. They intentionally guard semantic contract compatibility (tool names + schemas) without freezing exact internal Core route strings.

## CLI Coverage

- Fixtures + coverage matrix: `packages/cli/src/tool-fixtures.ts`
- Contract checks: `packages/cli/src/tools.contract.test.ts`
- Payload unit tests: `packages/cli/src/commands/commands.unit.test.ts`
- Integration tests (mock Core): `packages/cli/src/commands/commands.integration.test.ts`
- Local helper test: `packages/cli/src/commands/open-artifacts.test.ts`

The CLI fixture list mirrors the shared MCP tool list and also includes the local-only `open-artifacts` helper. CLI contract checks also validate both `drive.navigate` parity variants against shared input/output schemas. CLI contract checks also require routable `corePath` shape while allowing internal route refactors that preserve semantic behavior.

## Optional E2E Smoke

- MCP adapter smoke: `docs/mcp-e2e-smoke.md`
- CLI full-tool smoke: `scripts/cli-full-tool-smoke.sh`
  - Fixture page: `docs/fixtures/smoke-page.html`

## Adding a Tool Checklist

1. Update `packages/shared/src/tooling.ts`.
2. Update MCP adapter tool definitions + fixtures.
3. Add CLI command + CLI fixture entry.
4. Update the CLI coverage matrix if needed.
5. Extend the optional smoke flows as appropriate.
