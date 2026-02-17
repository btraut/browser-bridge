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
- [ ] Keep response envelope stable and explicit.

### Milestone B - Adapter parity and docs

- [ ] Remove CLI-only behavior branches that bypass shared contracts.
- [ ] Ensure MCP and CLI produce identical shape/semantics for the same call.
- [ ] Align docs/manual test/spec references with the new single policy.

### Milestone C - Drift guardrails

- [ ] Update fixture coverage to include optional-session cases.
- [ ] Add contract tests that fail if CLI and MCP disagree on required args/output shape.
- [ ] Add one smoke assertion proving equal behavior.

## Acceptance Criteria

- `drive.navigate` works with and without `session_id` via both CLI and MCP with equivalent semantics.
- Shared schema is the source of truth for both request and response shape.
- CLI and MCP fixtures cover identical success/error contract variants for `drive.navigate`.
- Docs and manual test flow no longer show contradictory session requirements.
