# Deprecation Lifecycle Policy

Date: 2026-02-17 Status: Active for all public Browser Bridge interface changes (CLI, MCP, core routes, extension protocol)

## Purpose

Deprecations must be explicit, predictable, and machine-checkable. Every deprecated public surface needs metadata that tells users what changed, what to migrate to, and when removal happens.

## Required Lifecycle Metadata

For every deprecated public surface, include:

- `stage`: lifecycle stage. Current allowed value: `deprecated`.
- `deprecated_since`: date the old surface started deprecation (`YYYY-MM-DD`).
- `removal_target`: date the old surface is expected to be removed (`YYYY-MM-DD`).
- `replacement`: canonical surface to migrate to.
- `warning_behavior`: current allowed value: `warn-on-use`.
- `migration_notes`: docs path with migration guidance.

Current enforcement constants live in `packages/shared/src/tooling.ts` as `DEPRECATION_POLICY`.

## Timeline Rules

- Minimum notice window: 90 days between `deprecated_since` and `removal_target`.
- Do not schedule removals earlier than the notice window.
- If a removal date changes, update metadata and migration docs in the same change.

## Warning and Messaging Rules

- Deprecated paths must emit a warning on use before removal.
- Warnings must include the canonical replacement.
- CLI and MCP migration notes must point to this policy doc or a linked migration section.

## Current Deprecations

The current registry is in `packages/shared/src/tooling.ts` (`MCP_TOOL_DEFINITIONS`).

- `drive.back` -> `drive.go_back`
- `drive.forward` -> `drive.go_forward`
- `dialog.accept` -> `drive.handle_dialog` (`action: accept`)
- `dialog.dismiss` -> `drive.handle_dialog` (`action: dismiss`)

Both entries carry full lifecycle metadata and share migration notes here.

## Automated Contract Check

`packages/shared/src/tooling.test.ts` enforces:

- deprecated entries include required lifecycle metadata
- replacement points to a valid canonical tool
- removal target is after deprecation date
- removal notice window is at least 90 days
