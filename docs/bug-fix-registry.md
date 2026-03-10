# Bug Fix Registry

Short index of notable bug fixes. Keep entries symptom-first: bug label, one-line fix summary, and PR/commit reference.

- `activate-missing-extension-id` - `dev activate` can now discover a connected Browser Bridge extension id and wait for a confirmed bind instead of failing before metadata exists. Ref: PR #45, `a619da3`
- `activate-enable-inspect` - `dev activate --enable-inspect` now provides an automatable path to enable debugger-based inspect and exposes remediation metadata in diagnostics. Ref: PR #45, `a619da3`
- `screenshot-permission-remediation` - Screenshot capture failures now classify `captureVisibleTab` permission and rate-limit problems with actionable remediation instead of generic errors. Ref: PR #45, `a619da3`
- `activate-discovery-hardening` - Activation discovery now probes isolated and shared runtimes, retries connected health briefly, and scans broader Chrome profile roots before giving up on extension id lookup. Ref: `ec013b6`
- `enable-inspect-chrome-opener` - `dev enable-inspect` now opens extension settings in Google Chrome on macOS, avoiding a silent detour through the generic system opener that left inspect capability disabled. Ref: `c2ae860`
- `enable-inspect-bridge-toggle` - `dev enable-inspect` now flips debugger capability through the live core-extension bridge and only returns the options URL as a manual fallback instead of opening extension settings automatically. Ref: `3aff96a`
- `enable-inspect-invalid-core-response` - CLI core requests now surface empty or HTML setup responses as structured `UNAVAILABLE` errors instead of raw JSON parse blowups during `dev enable-inspect`. Ref: pending commit
- `inspect-always-on` - Debugger-based inspect is now always enabled; the options UI no longer presents a separate inspect toggle, and stale capability failures are treated as runtime drift instead of user permissions. Ref: pending commit
- `enable-inspect-runtime-rebind` - Activation now reconnects the extension when `corePort` changes so `--enable-inspect` actually binds to the runtime it just configured. Ref: `de91967`
- `cli-bin-executable-mode` - Build and prepack now preserve the executable bit on `dist/index.js`, so the packed CLI ships an actual runnable bin artifact instead of a `0644` script. Ref: `88f35d2`
- `screenshot-debugger-coupling` - Viewport, full-page, and element screenshots now prefer extension capture so `artifacts.screenshot` does not fail just because debugger-based inspect is disabled. Ref: `dc8d1ee`
- `native-role-control-matching` - Drive role matching now includes native interactive controls and exact accessible-name preference, fixing visible live-page buttons like `Sign in` and `Account menu`. Ref: `f9203bf`
- `inspect-explicit-tab-targeting` - Inspect routes now default to the session primary tab, still honor explicit `tab_id` hints end-to-end, and `drive.tab_activate` degrades focus verification failures to warnings once the requested tab is active. Ref: `cf19d7b`
- `inspect-session-tab-default` - Inspect now defaults to the session-selected primary tab when no target is provided, while explicit `target.tab_id` still overrides session affinity and heuristics. Ref: `30a767e`
- `interactive-ax-menu-roles` - AX snapshot interactive filtering now keeps `menu`, `menuitem`, `menuitemcheckbox`, and `menuitemradio` nodes so open overlay actions remain visible in `inspect.dom_snapshot`. Ref: `283de58`
- `deferred-click-settle-and-retry` - `drive.click` now waits for deferred CDP click dispatch to land and retries one transient locator miss, reducing racey menu-trigger and overlay-item failures on live pages. Ref: `07d8e26`
- `snapshot-ref-metadata-fallback` - Snapshot refs now persist link/name/role metadata in the page so `locator.ref` can recover after list rerenders instead of failing the moment the original `data-bv-ref` attribute disappears. Ref: `8169ceb`
- `session-tab-affinity` - Omitted-tab drive actions now return the resolved tab target and core stores it as the session primary tab so later actions stay pinned to the same browser context. Ref: `adb2d77`
- `snapshot-ref-truthfulness` - `inspect.dom_snapshot` now drops refs that failed to bind into the live DOM and only persists successfully applied refs in the registry. Ref: `0652a0d`
- `visible-href-link-targeting` - Exact href CSS locators now keep the visible anchor ahead of hidden duplicates, so ordinary link clicks match the anchor inspect can already see. Ref: `cf19d7b`
- `deck-actions-auth-misclick-guard` - `Deck actions` role targeting now has regression coverage against nearby auth buttons so routine deck flows do not wander into sign-in controls. Ref: `54259fd`
- `visible-css-locator-preference` - CSS/testid locator resolution now prefers visible matches before falling back to the first raw node, which avoids hidden duplicate quantity controls eating clicks in deck-builder UIs. Ref: `633bf89`
- `text-targeting-visible-match` - `locator.text` now prefers normalized visible exact/clickable matches over ancestor containers, longer substrings, and hidden duplicates. Ref: `c81d5a5`
- `wait-for-visible-text` - `drive.wait_for` now matches normalized visible text and covers immediate or delayed `url_matches` transitions, including split labels and delayed status updates. Ref: pending commit
- `navigate-wait-help-parity` - CLI `drive navigate --wait` help text now includes `networkidle`, matching the shared schema and route validation instead of underselling the supported modes. Ref: pending commit
- `single-runtime-doc-alignment` - Active docs now describe one runtime at `127.0.0.1:3210`, treat old worktree-routing guidance as superseded, and point inspect setup at `dev enable-inspect` instead of `dev activate`. Ref: `browser-vision-t1l.4`
- `zsh-same-name-permission-denied` - The README now calls out zsh's misleading `permission denied` when `browser-bridge` is run from inside a same-named directory without the command actually being on `PATH`. Ref: pending commit
- `dead-dev-activate-guidance` - Repo agent guidance now points live worktree tasks at `dev info` plus `dev enable-inspect`, with the emitted `optionsUrl` called out as the inspect-stall fallback. Ref: `a628e6e`
- `stale-bd-hook-shim` - Checked-in `.githooks/pre-commit` now calls `bd hooks run pre-commit`, matching modern beads installs instead of the removed `bd hook` command. Ref: pending commit
- `hook-path-validate-chaining` - `npm run hooks:install` now points Git at `.githooks`, and the shared pre-push shim runs repo validation even when beads is installed. Ref: `4772462`
- `ci-validate-regressions` - Fixed the current validate breakage by restoring Prettier formatting, removing an unused test callback arg, and aligning two typed payloads with their declared contracts. Ref: pending commit
- `validate-gate-cleanup` - Validate now passes again after removing an unused runtime metadata arg, fixing the typed fetch mock in readiness tests, and formatting the affected files. Ref: pending commit
