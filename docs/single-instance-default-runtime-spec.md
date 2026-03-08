# Single-Instance Default Runtime Spec

## Problem

Browser Bridge docs and helper flows were still carrying isolated-routing baggage after the runtime had already converged on one sane default: `127.0.0.1:3210`. That mismatch kept teaching users to reach for activation when the real product model is simpler.

## Goal

Make normal usage zero-setup:

- One global default runtime (`127.0.0.1:3210`)
- One extension instance that connects without activation
- `dev enable-inspect` as the only narrow helper for debugger-based inspect setup

## Non-Goals

- Reintroducing isolated routing guidance in user-facing docs
- Supporting multiple extension instances in one Chrome profile

## Design

1. Runtime resolver stays fixed on the default runtime:
   - Default host/port are `127.0.0.1:3210` when no explicit override is present.
   - Docs should not imply there is a supported per-worktree routing mode.
2. Metadata remains lightweight:
   - `.context/browser-bridge/dev.json` can persist extension discovery state.
   - Metadata should not be described as a routing switchboard.
3. Inspect setup is decoupled from runtime routing:
   - `browser-bridge dev enable-inspect` is the supported CLI helper.
   - It opens extension options and waits for debugger capability without rewriting runtime state.
4. Migration guard:
   - Stale docs or examples must not teach users to run `dev activate` for normal operation.
   - Historical worktree-routing docs should be treated as superseded, not active setup guidance.

## Acceptance Criteria

1. Fresh checkout with extension installed can run CLI commands without any activation step.
2. Default CLI/Core runtime resolves to `127.0.0.1:3210` unless env/flag overrides.
3. Extension connects successfully in default mode (`diagnostics doctor` reports connected after startup).
4. Inspect remediation points to `browser-bridge dev enable-inspect`, not `dev activate`.
5. Existing metadata does not silently break default mode.
