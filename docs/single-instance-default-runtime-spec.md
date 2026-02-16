# Single-Instance Default Runtime Spec

## Problem

Browser Bridge currently requires `dev activate` in many normal workflows because the CLI/Core default to worktree-deterministic ports while the extension defaults to `3210` unless activation writes a matching `corePort` into extension storage. That makes the extension appear disconnected for users who expect one global Browser Bridge instance.

## Goal

Make normal usage zero-setup:

- One global default runtime (`127.0.0.1:3210`)
- One extension instance that connects without `dev activate`
- `dev activate` kept only for explicit multi-worktree/multi-instance testing

## Non-Goals

- Removing isolated worktree testing support
- Supporting multiple extension instances in one Chrome profile

## Design

1. Runtime resolver defaults to global mode:
   - Default port becomes `3210` when no explicit port override is present.
   - Deterministic worktree ports remain available only in explicit isolated mode.
2. Isolated mode is explicit and persisted:
   - Add metadata signal (or equivalent) that indicates worktree-isolated mode.
   - Only honor metadata deterministic port when isolated mode is enabled.
3. Core startup preserves metadata and avoids implicit drift:
   - Merge existing metadata when persisting runtime so `extension_id` is not lost.
   - Port probe sequence runs only in isolated mode; global mode stays pinned to `3210`.
4. `dev activate` becomes advanced workflow:
   - Keep command for local multi-worktree testing.
   - Update help/docs so normal users are not instructed to run it.
5. Migration guard:
   - Legacy metadata with deterministic port but no isolated-mode signal should not force non-default routing.

## Acceptance Criteria

1. Fresh checkout with extension installed can run CLI commands without `dev activate`.
2. Default CLI/Core runtime resolves to `127.0.0.1:3210` unless env/flag overrides.
3. Extension connects successfully in default mode (`diagnostics doctor` reports connected after startup).
4. Explicit isolated mode still supports parallel worktrees without port conflicts.
5. `dev activate` docs are positioned as optional/advanced.
6. Existing metadata does not silently break default mode.
