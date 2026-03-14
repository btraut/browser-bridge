# CLI/MCP Parity Plan: Session Semantics and Contract Alignment

## Problem

Browser Bridge currently drifts between CLI and MCP behavior for session handling and output contracts. The worst case is `drive.navigate`: CLI can auto-create sessions and return `session_id`, while MCP still requires `session_id` and the shared output schema does not include `session_id`.

## Goals

1. Define one session policy for both interfaces.
2. Enforce that policy in shared schemas and Core behavior, not adapter-specific glue.
3. Restore test and docs parity so drift is caught automatically.

## Non-Goals

- Reworking the session state machine itself.
- Redesigning all tool UX in one pass.

## Design Decisions

1. Session ownership remains in Core.
2. For first-pass parity, support optional `session_id` for `drive.navigate` in shared schema and resolve missing IDs in Core (auto-create + return ID).
3. CLI and MCP remain thin forwarders over shared contracts.
4. Tool fixtures and contract tests are the hard gate for parity.

## Scope Decision (2026-02-17)

- ✅ `session_id` optionality is **phase-1 scoped to `drive.navigate` only**; every other session-scoped tool still requires `session_id` in this epic to avoid broad session lifecycle churn.
- ✅ Migration boundary: only shared `drive.navigate` request/response contracts + Core route semantics change in this epic; widening optional-session behavior to other tools is follow-up work after parity guardrails settle.

## Work Breakdown

### Milestone A - Contract and Core semantics

- [x] ✅ Update shared schemas for `drive.navigate` request/response parity. - `DriveNavigateInputSchema` now accepts missing `session_id`; `DriveNavigateOutputSchema` now requires canonical `session_id`.
- [x] ✅ Implement Core-side missing-session resolution for `drive.navigate`. - Core `registerDriveRoutes` now auto-creates a session when `session_id` is omitted and always emits canonical `session_id` in success payloads.
- [x] ✅ Keep response envelope stable and explicit. - `drive.navigate` continues using the standard `{ ok, result }` envelope while making `result.session_id` explicit and canonical.

### Milestone B - Adapter parity and docs

- [x] ✅ Remove CLI-only behavior branches that bypass shared contracts. - CLI `drive navigate` no longer creates sessions locally and now forwards directly to Core like MCP.
- [x] ✅ Ensure MCP and CLI produce identical shape/semantics for the same call. - Both adapters now forward shared `drive.navigate` contracts, and parity contract tests validate required args/output shape against shared schemas.
- [x] ✅ Align docs/manual test/spec references with the new single policy. - Updated `README.md`, `skills/browser-bridge/SKILL.md`, `docs/manual-test.md`, and `docs/tool-coverage.md` to reflect optional-session `drive.navigate` parity and shared contract guardrails.

### Milestone C - Drift guardrails

- [x] ✅ Update fixture coverage to include optional-session cases. - Added shared `DRIVE_NAVIGATE_PARITY_CASES` plus CLI/MCP parity fixture exports for explicit-session and missing-session variants.
- [x] ✅ Add contract tests that fail if CLI and MCP disagree on required args/output shape. - CLI and MCP contract tests now validate parity fixtures against shared `DriveNavigateInputSchema` and `DriveNavigateOutputSchema`.
- [x] ✅ Add one smoke assertion proving equal behavior. - Core route tests assert `drive.navigate` returns the same canonical success shape (`{ ok: true, session_id }`) for both omitted and explicit `session_id` calls.

## Acceptance Criteria

- `drive.navigate` works with and without `session_id` via both CLI and MCP with equivalent semantics.
- Shared schema is the source of truth for both request and response shape.
- CLI and MCP fixtures cover identical success/error contract variants for `drive.navigate`.
- Docs and manual test flow no longer show contradictory session requirements.
