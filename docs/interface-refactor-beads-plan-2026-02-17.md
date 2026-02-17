# Interface Refactor Plan for Beads (2026-02-17)

## Source

- Baseline inventory: `docs/current-interface-inventory.md`
- Decision input: maintainer review session on 2026-02-17

## Goal

Reduce accidental complexity in Browser Bridge's public interface while preserving stable behavior for MCP consumers during migration.

## Scope

1. ✅ Remove legacy alias churn (`back/go_back`, `forward/go_forward`) across HTTP, MCP, CLI, and extension action layers. (Core/extension now use canonical `go_*` actions/routes; CLI/MCP aliases remain as temporary shims that forward to canonical routes and emit explicit deprecation warnings.)
2. ✅ Add explicit contract versioning for public interfaces (HTTP and extension websocket handshake). (Core now enforces/surfaces `x-browser-bridge-contract-version` on HTTP; websocket `drive.hello` now carries `protocol_version`, and core rejects mismatches deterministically.)
3. ✅ Replace boolean-only retry semantics with structured retry guidance and centralized retry policy. (Added shared retry metadata schema + policy helpers, wired core drive retries to shared policy hints, and preserved backward compatibility with `retryable`.)
4. ✅ Simplify and normalize error code taxonomy; move granularity into typed details. (Added canonical public code set + legacy mapping in `packages/shared/src/errors.ts`, normalized route responses via `normalizeErrorInfo`, and added migration tests/docs for `legacy_code` + typed detail fields.)
5. ✅ Resolve route-shape inconsistency and define canonical API style (RPC-style POST or mixed REST with GET reads). (Adopted RPC-over-HTTP POST style with canonical `/health/check` route and compatibility aliases/tests for legacy health paths.)
6. ✅ Unify dialog operation model to one canonical action family. (Canonicalized to `drive.handle_dialog`; `dialog.accept`/`dialog.dismiss` now map to canonical payloads as deprecated aliases with explicit warnings.)
7. ✅ Introduce least-privilege permission posture in extension defaults and capability escalation path. (Manifest scope now defaults to `http://*/*` + `https://*/*`, `tabGroups` permission removed, debugger capability is explicit via options toggle/default-off storage gate, and `debugger.*` requests now fail deterministically with `ATTACH_DENIED` guidance when disabled.)
8. ✅ Add explicit capability negotiation in extension-core handshake for feature/version drift detection. (Handshake now carries a capability map, core tracks negotiated capabilities, and unsupported/non-negotiated actions fail deterministically.)
9. ✅ Update refactor guardrails to preserve semantic contracts without freezing accidental internal paths. (Guardrail docs now split must-preserve semantics vs allowed internal evolution, and CLI/MCP contract tests now enforce semantic/schema compatibility plus routable path shape without exact internal route string freezing.)
10. ✅ Define and enforce a deprecation policy with lifecycle metadata and removal timelines. (Implemented via `docs/deprecation-lifecycle-policy.md`, `packages/shared/src/tooling.ts` metadata, and `packages/shared/src/tooling.test.ts` contract checks.)

## Non-Goals

- Rebuilding all internals in one pass.
- Breaking MCP tool names without a migration bridge.
- Expanding tool surface area beyond existing families.

## Delivery Strategy

- Use one epic with tightly scoped child tasks.
- Preserve backward compatibility via staged deprecations where needed.
- Ship contract tests first for each changed surface before implementation changes.

## Acceptance Criteria

- Every changed contract has documented canonical form and migration guidance.
- Legacy aliases are either removed or gated behind explicit deprecation behavior and timeline.
- Retry and error semantics are deterministic and tested in one policy layer.
- Extension handshake includes protocol version and capability map.
- Deprecation policy is documented and wired into CLI/MCP/tool docs.
