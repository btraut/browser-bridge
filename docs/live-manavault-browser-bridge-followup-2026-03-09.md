# Live ManaVault Browser Bridge Follow-up (2026-03-09)

## Context

A live Browser Bridge session drove `manavault.gg` through a real authenticated deck flow:

1. Open home page
2. Confirm signed-in state
3. Open account menu
4. Follow `My decks`
5. Open a deck
6. Enter `Edit cards`
7. Add one copy of `Jace, the Mind Sculptor`
8. Return to deck view and verify the count increased from `3` to `4`

The flow completed, but only after working around several Browser Bridge failures. The biggest theme is ugly parity drift between the documented path, the drive plane, and the inspect/evaluate plane.

## Findings

### 1. Global CLI entrypoint can be present but unusable

- Running `browser-bridge dev info` from the shell failed with `zsh: permission denied: browser-bridge`.
- The local CLI still worked via `node packages/cli/dist/index.js ...`.
- This makes the recommended install path look healthy while being broken at the first command.

### 2. Repo runtime guidance still references a removed command

- The project guidance still says to run `browser-bridge dev activate`.
- The current CLI no longer has `dev activate`; it only exposes `dev info` and `dev enable-inspect`.
- This sends agents down a dead path before they even start a session.

### 3. `dev enable-inspect` did not complete end-to-end on its own

- `dev enable-inspect` timed out waiting for debugger capability.
- The generated options URL was valid, but the supported flow did not finish automatically.
- Manually opening `chrome-extension://<id>/options.html?bb_enable_inspect=1` in Chrome made inspect capability become available immediately.
- This means the remediation exists, but the advertised automation path is still not trustworthy enough for live use.

### 4. Screenshot behavior still does not match the docs

- `artifacts screenshot --target viewport` failed with `UNAVAILABLE` / missing `debugger.attach` while inspect capability was disabled.
- Current docs say viewport/full-page screenshots should prefer the extension path and work without debugger-based inspect.
- Either the runtime still falls through to the debugger path too early, or the docs/remediation text are wrong.

### 5. Drive locator resolution was much weaker than inspect visibility

- `drive click` could not resolve clearly visible controls like `Sign in` and `Account menu`.
- `inspect dom-snapshot` and `inspect find` could see those same elements.
- `inspect evaluate` could interact with the page reliably once inspect was enabled.
- That gap is bad: it means the drive plane cannot be trusted even after the inspect plane proves the target exists.

### 6. Window/tab handling is still awkward around setup pages

- `drive tab-activate` failed once with `Failed to focus window_id ... for tab_id ...`.
- `inspect dom-snapshot` has no `--tab-id`, so the only inspect target is whatever tab is currently active in the agent window.
- That gets especially annoying when setup flows open extension options in front of the site you are trying to inspect.

## Additional Findings From The Second 2026-03-09 Run

The later live run started from an already signed-in state and went through `My decks`, deck view, deck edit, add-card search, and back to deck view. It completed, but only after several new drive/inspect mismatches showed up.

### 7. Header buttons sometimes focus without actually opening their menu

- `drive.click` on visible header buttons like `Decks` and `Account menu` frequently moved focus without exposing the expected popover/menu state to the rest of the toolchain.
- Hover plus keyboard navigation worked more reliably than direct click for the account menu.
- This makes basic top-nav exploration feel nondeterministic even when the target control is clearly visible.

### 8. Floating menu contents are not surfaced consistently across inspect outputs

- After the account menu opened, `inspect extract-content` and `inspect dom-snapshot` did not reliably include `Profile`, `My decks`, `My collection`, and `Settings`.
- `inspect evaluate` could still see those menuitems in the DOM.
- That split makes the "inspect first, then drive" workflow weaker than it should be on popovers and menus.

### 9. Locator resolution fails on transient menu items even when inspect can see them

- `drive.click` failed with `NOT_FOUND` for `My decks` when targeted by role/name, visible text, and exact CSS href.
- Keyboard navigation through the open menu did work and successfully reached `My decks`.
- This suggests a resolver/actionability gap around transient overlays rather than a site-specific target issue.

### 10. Snapshot refs are too brittle on dynamic list content

- On the `My decks` page, the first deck link was present in the accessibility snapshot, but `drive.click` on the emitted ref failed with `NOT_FOUND`.
- Clicking the exact deck href via CSS succeeded immediately.
- If snapshot refs cannot survive one round-trip on a stable list row, they are not dependable enough for real browsing.

### 11. Action menus and repeated controls are easy to target incorrectly

- The deck actions menu exposed both `Edit details` and `Edit cards`.
- A broad selector matched the first edit target and landed on the wrong variant before the flow corrected itself.
- The API needs either better menuitem targeting ergonomics or stronger guidance about selecting among repeated actionable labels.

### 12. Quantity increment controls are less reliable than the add-card combobox flow

- The role-based locator for `Increase maindeck count for Jace, the Mind Sculptor` failed to resolve.
- A CSS-targeted click against that same control returned success but did not change the rendered quantity.
- The explicit add-card combobox flow (`Search cards to add to deck` -> search -> `Enter`) did work and persisted the mutation to deck view.
- That smells like duplicate/hidden increment buttons, weak actionability checks, or a mismatch between the clicked node and the live control.

## Proposed Work

### Epic

- Close the gap between Browser Bridge's documented live-browser workflow and the behavior observed during a real authenticated ManaVault deck-edit session.

### Child Tasks

1. Fix or harden the distributed CLI entrypoint so `browser-bridge ...` is executable in the supported global install shape.
2. Update runtime docs and skill guidance so they stop telling agents to use removed activation commands.
3. Make `dev enable-inspect` reliably complete the full inspect-enablement flow, or fail with more direct remediation that matches reality.
4. Fix screenshot capability routing/remediation so viewport capture behavior matches the current docs, or update the docs if debugger capability is in fact required.
5. Investigate and fix drive-plane locator resolution drift when inspect can already see the target element on live sites.
6. Improve active-tab targeting around setup flows so inspect and drive can explicitly target the intended tab without brittle window focus behavior.
7. Make header/menu button interaction deterministic enough that `drive.click` either opens the menu or returns an actionable failure instead of a focus-only no-op.
8. Improve inspect surfacing for transient menus/popovers so `extract-content` and `dom-snapshot` expose the same actionable menu items that `inspect evaluate` can already see.
9. Fix drive locator/actionability handling for transient menu items and dynamic list links so role/text/ref targeting works on live overlays and list rows without CSS fallback.
10. Investigate repeated quantity controls in the deck editor and make increment/decrement clicks act on the visible live control, not a stale twin.

## Acceptance Criteria

- A supported global install can run `browser-bridge dev info` without shell permission errors.
- Repo docs, manual test docs, and the Browser Bridge skill all point to the same current runtime/setup commands.
- `dev enable-inspect` either completes on a fresh live run or fails with remediation that immediately gets the user unstuck.
- Screenshot behavior and documentation agree on whether debugger capability is required.
- A live ManaVault session can click visible header controls through `drive.*` without falling back to `inspect evaluate`.
- Agents can inspect the intended site tab even if setup temporarily opens an extension options tab in front of it.
- A live ManaVault session can open account menus, follow `My decks`, open a deck from the list, and choose the intended edit action without CSS-only selectors.
- A live ManaVault session can add another copy of an existing card through visible increment controls, or the runtime/docs clearly steer agents toward the supported add-card workflow.

## User Dependency

- No immediate user action is required to file and implement this follow-up work.
- For future live tests before the fixes land, the only practical workaround is to open the generated extension options URL manually if `dev enable-inspect` stalls.
