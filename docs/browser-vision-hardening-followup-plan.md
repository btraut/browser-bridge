# Browser Vision Hardening Follow-Up Plan

## Goal

Address the highest-impact regressions found in post-merge review so runtime startup, diagnostics, and popup behavior are reliable under failure conditions.

## Scope

1. Retry-safe and bounded Core readiness
2. Accurate extension runtime diagnostics after disconnect
3. Popup state integrity and accessibility for status/copy feedback

## Out of Scope

- Broad docs/changelog tone rewrites not tied to behavior correctness
- Non-critical UI polish unrelated to diagnostics correctness

## Milestones

### M1: Retry-safe Core readiness

- Reset memoized readiness promise on rejection so next caller can retry.
- Reduce health probe timeout and enforce a bounded total readiness budget.
- Add tests for retry-after-failure and concurrent caller deduplication.

### M2: Runtime diagnostics truthfulness

- Ensure diagnostics mismatch checks do not evaluate stale extension runtime data after disconnect.
- Either clear runtime endpoint/version fields on disconnect or fully gate mismatch checks behind live connectivity.
- Add positive-path and disconnect-path diagnostics tests.

### M3: Popup stale-data and accessibility hardening

- Clear cached `latestStatus` on failed refresh so copied diagnostics cannot be stale.
- Clear retry metadata when transitioning out of backoff states.
- Add ARIA live semantics for connection/copy feedback messages.
- Add/expand tests for failure-path status refresh and copy behavior.

## Acceptance Criteria

- A transient Core startup failure does not permanently brick readiness; subsequent callers can recover automatically.
- Diagnostics do not report endpoint/version mismatch using stale extension runtime data after disconnect.
- Popup copy output reflects current fetch state; failed refresh does not expose stale status.
- Connection and copy feedback are announced reliably via assistive technologies.
