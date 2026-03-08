# Live ManaVault Browser Bridge Follow-up (2026-03-07)

## Context

A live Browser Bridge test drove `manavault.gg` through a real deck-edit flow. The run succeeded only by working around multiple runtime gaps:

- `browser-bridge dev activate` failed with a missing extension id even though a Browser Bridge extension was connected.
- `inspect.*` and `artifacts_screenshot` failed because debugger capabilities were disabled.
- `drive.navigate` MCP validation rejected unsupported wait values early.
- `drive_wait_for` on editor save status timed out despite the deck mutation persisting.
- Text-based click targeting for `View deck` was flaky; exact CSS targeting worked.

## Comparison To Recent History

### Intended solved by PR #45 but still not actually solved end-to-end

1. Activation extension-id discovery
   - PR #45 (`Stabilize Browser Bridge vision and activation workflows`) explicitly claims `dev activate` can auto-discover the Browser Bridge extension id.
   - In the live run, `dev activate` still failed immediately with `Missing extension id`.
   - This is either a regression or an uncovered install shape, but not a brand-new class of problem.

2. Inspect enablement workflow
   - PR #45 also explicitly claims `dev activate --enable-inspect` provides an automatable path to enable debugger-based inspect.
   - Because activation still failed, that remediation path was unusable in practice.
   - The default-off debugger capability is intentional, but the promised setup path is not reliable enough yet.

### Probably new or at least not covered by the last PR's actual fixes

1. Screenshot capability coupling
   - PR #45 fixed screenshot permission failures.
   - The live failure was different: `artifacts_screenshot` failed with `INSPECT_UNAVAILABLE` / missing debugger capability.
   - That suggests screenshot execution is still coupled to inspect/debugger in at least one path, or the error classification/remediation is wrong.

2. Text-based click reliability
   - Clicking `View deck` by text did not navigate reliably, while exact CSS targeting did.
   - This looks like locator-resolution or click-target ambiguity, not something PR #45 addressed.

3. Save-status wait reliability
   - Waiting for visible `Saved` text timed out even though the edit persisted and was visible on the deck view page.
   - This may be a Browser Bridge `text_present` issue, a site rendering nuance, or both.

### Not a product bug

1. `drive.navigate` with `wait: "interactive"`
   - This was invalid input, not an application regression.
   - No follow-up issue is needed unless we decide tool/docs should steer agents away from invalid wait values more aggressively.

## Follow-up Work

### Epic

- Close the gap between the claimed Browser Bridge activation/inspect workflow and a real-world live site session.

### Tasks

1. ✅ Fix `dev activate` auto-discovery so a connected extension can be activated without manually supplying `--extension-id` in supported install shapes. - Landed in `ec013b6`; activation now probes isolated + shared runtimes, retries connected health briefly, and scans broader Chrome profile roots before giving up.
2. ✅ Add an end-to-end regression test for `dev activate --enable-inspect` that proves inspect becomes usable after activation. - Landed in `de91967`; activation now reconnects the extension after `corePort` changes and diagnostics points users at the working remediation path.
3. ✅ Fix screenshot routing or capability checks so `artifacts_screenshot` either works without debugger capability where intended, or returns remediation that matches the real requirement. - Landed in `dc8d1ee`; screenshot capture now prefers the extension path for viewport/full/element targets and preserves the right error when only debugger fallback fails.
4. ✅ Investigate locator and wait reliability from the live flow (`View deck` text click and `Saved` wait timeout) and turn the findings into targeted fixes/tests. - Landed in `c81d5a5`; text matching now normalizes visible rendered text, prefers exact/clickable targets, and adds regressions for split labels, hidden duplicates, and async status waits.
5. ✅ Restore the missing `docs/bug-fix-registry.md` file and backfill recent Browser Bridge bug entries so future comparisons do not depend on memory. - Restored the file in-repo, removed the stale ignore entry, and backfilled PR `#45` plus the current live-follow-up fixes.

## Acceptance Criteria

- A fresh live session can follow the documented worktree flow without manual extension-id hunting.
- `dev activate --enable-inspect` makes `inspect.*` usable on the next live session.
- Screenshot behavior and docs match the runtime's actual capability requirements.
- The live ManaVault flow can use stable targeting/waits without brittle CSS-only fallbacks.
- The bug-fix registry exists in-repo and includes the fixes that land from this follow-up work.
