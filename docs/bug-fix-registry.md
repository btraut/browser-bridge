# Bug Fix Registry

Short index of notable bug fixes. Keep entries symptom-first: bug label, one-line fix summary, and PR/commit reference.

- `activate-missing-extension-id` - `dev activate` can now discover a connected Browser Bridge extension id and wait for a confirmed bind instead of failing before metadata exists. Ref: PR #45, `a619da3`
- `activate-enable-inspect` - `dev activate --enable-inspect` now provides an automatable path to enable debugger-based inspect and exposes remediation metadata in diagnostics. Ref: PR #45, `a619da3`
- `screenshot-permission-remediation` - Screenshot capture failures now classify `captureVisibleTab` permission and rate-limit problems with actionable remediation instead of generic errors. Ref: PR #45, `a619da3`
- `activate-discovery-hardening` - Activation discovery now probes isolated and shared runtimes, retries connected health briefly, and scans broader Chrome profile roots before giving up on extension id lookup. Ref: `ec013b6`
- `enable-inspect-runtime-rebind` - Activation now reconnects the extension when `corePort` changes so `--enable-inspect` actually binds to the runtime it just configured. Ref: `de91967`
- `screenshot-debugger-coupling` - Viewport, full-page, and element screenshots now prefer extension capture so `artifacts.screenshot` does not fail just because debugger-based inspect is disabled. Ref: `dc8d1ee`
- `text-targeting-visible-match` - `locator.text` now prefers normalized visible exact/clickable matches over ancestor containers, longer substrings, and hidden duplicates. Ref: `c81d5a5`
- `wait-for-visible-text` - `drive.wait_for` `text_present` now matches normalized visible text, including split labels and delayed status updates. Ref: `c81d5a5`
- `single-runtime-doc-alignment` - Active docs now describe one runtime at `127.0.0.1:3210`, treat old worktree-routing guidance as superseded, and point inspect setup at `dev enable-inspect` instead of `dev activate`. Ref: `browser-vision-t1l.4`
