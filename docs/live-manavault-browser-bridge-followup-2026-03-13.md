# Live ManaVault Browser Bridge Follow-up (2026-03-13)

## Context

A live Browser Bridge MCP session drove `manavault.gg` through a signed-in deck flow:

1. Open home page
2. Confirm signed-in state
3. Reach `My decks`
4. Open a deck
5. Enter edit mode
6. Add another copy of `Jace, the Mind Sculptor`
7. Return to deck view and verify the updated list

The flow completed, but only after repeated fallbacks to `inspect.evaluate`. That is not acceptable for a tool whose job is to make `drive.*` reliable on ordinary live-site controls.

## What Failed

### 1. `drive.click` misclassified normal controls as broken popup triggers

- `Account menu`, `Edit list`, and `View list` all produced `FAILED_PRECONDITION` with `click_state_unchanged`.
- The failure message claimed the click only focused the trigger and did not change popup state.
- In practice, these were the correct visible controls and keyboard or DOM-level fallback could still move the flow forward.

### 2. Locator resolution still drifted from the inspect plane

- `drive.click` returned `NOT_FOUND` for controls that `inspect.evaluate` could see immediately.
- This happened on visible controls including `Open menu` and `Increase maindeck count for Jace, the Mind Sculptor`.
- The edit page also exposed hidden and visible duplicates of card quantity controls, which made naive selectors target the wrong node.

### 3. `drive.wait_for` still produced false negatives on successful transitions

- Waiting for `url_matches` after following `My decks` timed out even though the page state had changed.
- Waiting for page text after opening a deck also timed out despite the deck view having already loaded.
- This smells like observer drift between Browser Bridge's wait layer and the actual rendered page state.

### 4. Successful `drive.click` responses did not guarantee effect

- A CSS-targeted click on the visible `Increase maindeck count for Jace, the Mind Sculptor` button returned success.
- The rendered quantity remained `9`.
- Running `element.click()` through `inspect.evaluate` against the same visible button changed the quantity to `10` immediately.
- That means Browser Bridge can report a successful click without actually delivering an interaction that mutates app state.

## Why This Needs Follow-up

- These are not one-off site quirks. They line up with previously claimed fixes around popup-trigger handling, visible locator preference, and wait reliability.
- The live run proved there is still a gap between "element was found" and "the user interaction actually worked."
- If `drive.*` cannot be trusted on a fairly normal React app, the tool is still too brittle for real browsing.

## Proposed Work

### Epic

- Close the remaining gap between Browser Bridge's drive plane and the live DOM behavior observed on ManaVault.

### Child Tasks

1. Reproduce and fix false `popup_trigger` precondition failures on visible controls that should be clickable without menu-state confusion.
2. Fix locator/actionability resolution so `drive.click` consistently targets the visible live control that inspect can already see, especially when hidden duplicates exist.
3. Fix click completion semantics so a successful `drive.click` means the intended interaction was actually dispatched to the visible target and not swallowed by a stale twin.
4. Fix `drive.wait_for` false timeouts on live client-side navigation and content transitions after successful actions.
5. Add regression coverage for the ManaVault-style failure pattern: visible nav/menu controls, duplicated quantity buttons, and waits after SPA transitions.

## Acceptance Criteria

- A live ManaVault session can use `drive.click` to open or activate `Account menu`, `Edit list`, and `View list` without falling back to keyboard or DOM eval.
- `drive.click` can resolve the visible increment control for `Jace, the Mind Sculptor` on the edit page without CSS ids injected at runtime.
- A successful click on the visible increment control increases the visible maindeck quantity from `9` to `10`.
- `drive.wait_for` does not time out after successful navigation to `My decks` or after opening a deck view that already rendered.
- The new regressions fail before the fix and pass after it.

## Notes For Implementers

- Compare this run against the March 7 and March 9 follow-up docs first.
- The most suspicious areas are popup-trigger postconditions, visibility/duplicate-node preference, and whether CDP click delivery is verified against the actual target.
- Do not paper over this with more CSS fallback guidance. The bug is in the runtime, not the operator.
