# Remove Isolated Runtime Routing

## Goal

Delete Browser Bridge's isolated worktree routing system and make the product single-runtime by default and by implementation:

- Core/CLI/MCP target `127.0.0.1:3210` unless the user explicitly passes `--host` or `--port`.
- The extension also targets `127.0.0.1:3210`.
- There is no sticky extension routing state for alternate worktree ports.
- `browser-bridge dev activate` and its activation URL workflow are removed.

This is a deliberate simplification. The project no longer needs parallel worktree routing, and the activation/storage machinery is causing more pain than value.

## Context

The current architecture still carries isolated-mode plumbing across runtime resolution, CLI commands, extension storage, diagnostics, docs, and tests. In practice that means:

- the extension can silently point at the wrong Core port,
- `dev activate` can fail if the activation URL does not open in the live extension context,
- diagnostics can say "disconnected" when the real problem is stale routing state,
- users need to understand a multi-worktree workflow they do not actually use.

The live ManaVault test on 2026-03-08 confirmed the problem shape: the extension was disconnected until the activation URL was opened manually in Chrome, which immediately rebound the extension to the expected port.

## Non-Goals

- Reworking site-permission prompting.
- Changing the core drive/inspect protocol.
- Supporting multiple Browser Bridge runtimes in one Chrome profile.
- Removing debugger-based inspect as a capability.

## Decisions

1. Single runtime only
   - Runtime resolution always defaults to `127.0.0.1:3210`.
   - `BROWSER_BRIDGE_ISOLATED_MODE`, legacy isolated env aliases, deterministic worktree ports, and persisted `isolated_mode` metadata are removed.

2. No routing activation flow
   - Remove `browser-bridge dev activate`.
   - Remove extension-side handling of `bb_activate` / `corePort` activation query params.
   - Stop persisting extension routing via `chrome.storage.local.corePort`.

3. Keep inspect enablement, but decouple it
   - Replace `dev activate --enable-inspect` with a standalone command, `browser-bridge dev enable-inspect`.
   - That command may still open the extension options page, but only to toggle debugger capability. It must not change routing state.

4. Migrate stale state aggressively
   - Extension startup should ignore old alternate-port storage and self-heal back to `3210`.
   - Existing metadata fields that only exist for isolated routing should be removed or ignored.

## Assumptions and Constraints

- The extension id may still need discovery for `dev enable-inspect`; that is acceptable as a narrow, explicit setup path.
- Manual `--port` / `BROWSER_BRIDGE_CORE_PORT` overrides remain supported for direct debugging, but they are not persisted into extension routing state.
- Any docs/specs that still describe isolated worktree routing become historical documents and should either be removed or clearly marked obsolete.

## Work Items

### 1. Remove isolated runtime resolution and metadata plumbing

Scope:

- Delete isolated-mode behavior from shared runtime resolution and metadata persistence.
- Remove worktree-routing metadata fields from code paths that no longer need them.
- Keep explicit `--host` / `--port` overrides working.

Acceptance criteria:

- Default runtime resolution is always `127.0.0.1:3210` with no hidden worktree-based drift.
- `BROWSER_BRIDGE_ISOLATED_MODE` and legacy isolated env aliases no longer affect runtime selection.
- `.context/browser-bridge/dev.json` no longer stores or relies on `isolated_mode`, `worktree_id`, or persisted routing data for normal operation.

Implementation notes:

- Touch [packages/shared/src/runtime-config.ts](/Users/btraut/Development/browser-bridge/packages/shared/src/runtime-config.ts), [packages/core/src/server.ts](/Users/btraut/Development/browser-bridge/packages/core/src/server.ts), [packages/cli/src/core-client.ts](/Users/btraut/Development/browser-bridge/packages/cli/src/core-client.ts), and any shared schema/types that still expose isolated-only metadata.
- Audit tests that assert deterministic worktree ports or isolated metadata propagation.
- Prefer deleting dead paths over preserving "just in case" toggles.

Tests and verification:

- `npm test -- packages/shared/src/runtime-config.test.ts`
- `npm test -- packages/shared/src/core-readiness.test.ts`
- `npm test -- packages/cli/src/core-client.test.ts`
- Manual: from a fresh shell, `node packages/cli/dist/index.js dev info --json` reports port `3210` without any worktree-specific state.

### 2. Remove `dev activate` and replace inspect setup with a narrow command

Scope:

- Delete the isolated activation command and its CLI/doc/runtime contracts.
- Add `browser-bridge dev enable-inspect` as the only surviving extension-options helper.

Acceptance criteria:

- `browser-bridge dev activate` no longer exists.
- `browser-bridge dev enable-inspect` opens the options flow needed to enable debugger capability without changing runtime routing.
- Diagnostics remediation text points to `dev enable-inspect`, not `dev activate --enable-inspect`.

Implementation notes:

- Touch [packages/cli/src/commands/dev.ts](/Users/btraut/Development/browser-bridge/packages/cli/src/commands/dev.ts), [packages/cli/src/extension-id-discovery.ts](/Users/btraut/Development/browser-bridge/packages/cli/src/extension-id-discovery.ts), [packages/core/src/diagnostics.ts](/Users/btraut/Development/browser-bridge/packages/core/src/diagnostics.ts), and command tests under [packages/cli/src/commands/dev.test.ts](/Users/btraut/Development/browser-bridge/packages/cli/src/commands/dev.test.ts).
- Keep extension-id discovery only if needed for `dev enable-inspect`; otherwise delete more.
- Replace activation URL query parameters with a single inspect-enablement flag if possible.

Tests and verification:

- `npm test -- packages/cli/src/commands/dev.test.ts`
- `npm test -- packages/core/src/diagnostics.test.ts`
- Manual: with inspect disabled, `diagnostics doctor` remediation points to `dev enable-inspect`; after running it, `inspect.capability` becomes true.

### 3. Remove extension-side alternate-port routing and migrate stale storage

Scope:

- Stop reading/writing extension routing state from storage.
- Ensure stale `corePort` values from old installs do not keep the extension pointed at dead ports.

Acceptance criteria:

- Extension background always targets `127.0.0.1:3210` unless a command explicitly overrides the Core endpoint for that process.
- Old stored `corePort` values do not affect extension connection after upgrade.
- Connection UI/diagnostics stop implying there are multiple persistent runtime targets.

Implementation notes:

- Touch [packages/extension/src/background.ts](/Users/btraut/Development/browser-bridge/packages/extension/src/background.ts), [packages/extension/src/options-ui.ts](/Users/btraut/Development/browser-bridge/packages/extension/src/options-ui.ts), [packages/extension/src/connection-state.ts](/Users/btraut/Development/browser-bridge/packages/extension/src/connection-state.ts), and any popup/options copy that references routing activation.
- Add a one-time cleanup or outright stop honoring the storage key.
- Confirm restricted-url help text no longer suggests `dev activate`.

Tests and verification:

- `npm test -- packages/extension/src/connection-state.test.ts`
- `npm test -- packages/extension/src/restricted-url.test.ts`
- Add/update background/options tests for stale storage cleanup.
- Manual: set an old `corePort` in storage, reload extension, and verify it reconnects to `3210` rather than the stale port.

### 4. Clean docs, inventories, and changelog to match reality

Scope:

- Remove or rewrite docs that mention isolated worktree routing as a supported workflow.
- Update changelog and bug-fix registry to reflect the simplification.

Acceptance criteria:

- README, manual test docs, troubleshooting, and diagnostics guidance describe a single-runtime model.
- Obsolete design docs are either removed or clearly marked superseded by this spec.
- `CHANGELOG.md` gets an `[Unreleased]` entry for the simplification.

Implementation notes:

- Touch [README.md](/Users/btraut/Development/browser-bridge/README.md), [docs/manual-test.md](/Users/btraut/Development/browser-bridge/docs/manual-test.md), [docs/current-interface-inventory.md](/Users/btraut/Development/browser-bridge/docs/current-interface-inventory.md), [docs/worktree-dev-loop-spec.md](/Users/btraut/Development/browser-bridge/docs/worktree-dev-loop-spec.md), [docs/single-instance-default-runtime-spec.md](/Users/btraut/Development/browser-bridge/docs/single-instance-default-runtime-spec.md), [docs/bug-fix-registry.md](/Users/btraut/Development/browser-bridge/docs/bug-fix-registry.md), and [CHANGELOG.md](/Users/btraut/Development/browser-bridge/CHANGELOG.md).
- Prefer deleting stale workflow advice instead of stacking caveats on top of it.

Tests and verification:

- `npm run format:check`
- `npm run lint`
- Manual grep: `rg -n "dev activate|isolated mode|worktree-specific" README.md docs packages`

## Delivery Order

1. Remove runtime/metadata plumbing.
2. Replace CLI/diagnostics activation semantics with `dev enable-inspect`.
3. Remove extension storage routing and self-heal stale installs.
4. Clean docs/tests/changelog after behavior is stable.

## Risks and De-risking

- Risk: inspect enablement accidentally regresses when `dev activate` is removed.
  - De-risk by landing `dev enable-inspect` in the same change set as diagnostics remediation updates.
- Risk: stale extension storage keeps breaking upgraded users.
  - De-risk by ignoring/removing the stored routing key on startup, not by trusting users to clean it manually.
- Risk: hidden docs/tests still encode isolated assumptions.
  - De-risk with targeted grep and by deleting obsolete specs instead of letting them rot.

## Beads Mapping

Epic:

- Remove isolated runtime routing and activation from Browser Bridge

Child tasks:

1. Remove isolated runtime resolution and metadata plumbing.
2. Replace `dev activate` with standalone inspect enablement.
3. Remove extension alternate-port routing and migrate stale storage.
4. Rewrite docs/tests/changelog to match the single-runtime model.

Dependencies:

- Task 2 depends on Task 1.
- Task 3 depends on Task 2.
- Task 4 depends on Tasks 1-3.
