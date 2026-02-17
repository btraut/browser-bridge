# Soft Site Permissions (Extension UI) - Spec + Plan

## Context

Browser Bridge's Chrome extension targets web pages (`http://*/*` + `https://*/*`) and can drive tabs/sites via `drive.*` actions handled in `packages/extension/src/background.ts`.

This document proposes and plans a "soft permissions" model, similar to the Claude extension UX shown in screenshots:

- The extension retains broad technical capability.
- The extension enforces a user-controlled allowlist (per site) before performing sensitive actions.
- First use prompts the user to allow once, deny, or always allow for that site.
- A settings page lists approved sites and allows revocation.

## Goals

- Gate agent actions on a per-site allowlist (soft permissions).
- Provide a clear user prompt at the moment the agent attempts a new site.
- Provide a settings UI to audit/revoke approved sites.
- Keep the system robust across timeouts and MV3 service worker lifecycle quirks.

## Non-goals

- Hard Chrome host permissions (`optional_host_permissions` + `chrome.permissions.request`).
- Fine-grained permissions beyond "allow actions on this site" (at least initially).
- Preventing all possible malicious behavior if the extension is compromised (this is user-consent UX, not a security sandbox).

## Key Decisions

1. Soft permissions only.
   - Keep host permissions scoped to web pages (`http://*/*`, `https://*/*`).
   - Enforce allowlist checks in the extension background before executing drive actions.

2. Gate at the background boundary (single chokepoint).
   - Primary enforcement lives in `packages/extension/src/background.ts` inside `handleRequest()`.
   - Rationale: every drive request flows through this switch, so gating is consistent for navigate, history, and DOM actions.

3. User prompt waits up to 10s, then returns a retryable error.
   - When a site is not yet approved:
     - Open a small prompt window.
     - Wait up to `permissionPromptWaitMs` (default 10000) for a response.
     - If approved in time, proceed with the original request.
     - If not, return a retryable "permission required" style error so the caller can retry later.
   - Rationale:
     - Improves UX (often approval is quick).
     - Avoids indefinite blocking and aligns with upstream timeouts (some clients default to short timeouts).
     - Works even if the user approves after the initial request times out: the next retry succeeds.

4. Permission scope: `hostname[:port]`.
   - Store and display `example.com` and `localhost:3000` style keys.
   - Treat `http` vs `https` as equivalent initially (host+port only).

5. Error semantics: introduce a distinct code.
   - Add a new error code to the shared enum, e.g. `PERMISSION_REQUIRED`.
   - Mark `retryable: true` when the prompt timed out and could succeed upon retry.
   - Mark `retryable: false` when user explicitly denies.
   - Include structured `details` to help clients display a useful message.

## Data Model

Stored in `chrome.storage.local`:

- `siteAllowlist` (key: `SITE_ALLOWLIST_KEY`)
  - Type: `Record<string, { createdAt: string; lastUsedAt: string }>`
  - Key: `hostname[:port]`

- `permissionPromptWaitMs` (key: `PERMISSION_PROMPT_WAIT_MS_KEY`)
  - Type: `number`
  - Default: `10000`

Notes:

- Update `lastUsedAt` on every successful gated action for that site (including "allow once").
- Revoke deletes the entry.

## UX Surfaces

1. Permission prompt window (best match to the screenshots)
   - Opened by background via `chrome.windows.create({ type: "popup", url: ... })`.
   - Displays:
     - Header: "New permissions required"
     - Body: "Browser Bridge wants to [navigate/click/type] on: <site>"
     - Buttons:
       - "Allow this action" (one-time)
       - "Decline"
       - "Always allow actions on this site" (persist)
     - Footnote text explaining limits (optional).

2. Options page: "Approved sites"
   - Lists allowlist entries with:
     - Site key
     - "Last used" timestamp
     - "Revoke" button

3. Optional action menu entry point
   - Add an extension action popup or click handler to open the options page.
   - Not required for core functionality but improves discoverability.

## Enforcement Surface (What Gets Gated)

Gate all drive actions that can result in site interaction:

- `drive.navigate`
  - Gate on destination URL hostname.

- Actions that operate on the current tab:
  - `drive.click`
  - `drive.type`
  - `drive.fill_form`
  - `drive.select`
  - `drive.hover`
  - `drive.drag`
  - `drive.key`
  - `drive.key_press`
  - `drive.scroll`
  - `drive.wait_for`
  - `drive.screenshot` (optional for v1, but consistent to include)
  - `drive.go_back`, `drive.go_forward` (optional; can be treated like navigation on current site)
  - `drive.back`/`drive.forward` are deprecated CLI/MCP aliases that forward to the canonical actions above.

Notes:

- For restricted URLs (chrome://, chrome webstore, etc), return existing `NOT_SUPPORTED` style errors before any prompt.
- If tab URL is missing or unparsable, return `FAILED_PRECONDITION` or `INVALID_ARGUMENT` with a clear hint.

## Architecture Sketch

Background components:

- `SitePermissionStore`
  - `isAllowed(siteKey): Promise<boolean>`
  - `allowAlways(siteKey): Promise<void>`
  - `touchLastUsed(siteKey): Promise<void>`
  - `revoke(siteKey): Promise<void>`
  - Pure helper `siteKeyFromUrl(url): string | null`

- `PermissionPromptController`
  - Dedup prompt requests by `siteKey`.
  - Uses `chrome.runtime.connect()` port from prompt page to deliver decisions.
  - Offers `requestPermission({ siteKey, reason }): Promise<Decision>`
  - Implements the 10s wait and returns `timed_out` if no decision.

Prompt page components:

- Simple HTML page + script that:
  - Reads `siteKey` and `reason` from query params.
  - Establishes a port (`chrome.runtime.connect({ name: "permission_prompt" })`).
  - Sends decision messages on button clicks.
  - Closes the window on decision.

Options page components:

- Simple HTML page + script that:
  - Reads allowlist from storage.
  - Renders list sorted by `lastUsedAt` desc.
  - Calls revoke and re-renders.

Build system:

- Extend `scripts/build-extension.mjs` to bundle:
  - `src/permission-prompt.ts` -> `dist/permission-prompt.js`
  - `src/options.ts` -> `dist/options.js`
- Add static HTML/CSS files under `packages/extension/` and include them in `packages/extension/package.json` `files` list so they ship with the extension build output.

## Implementation Tasks (Ordered)

1. Spec and docs wiring
   - Files:
     - `docs/site-permissions.md` (this doc)
     - `README.md` (link to settings + describe behavior)
     - `docs/manual-test.md` (add manual verification steps)
   - Verify:
     - Documented UX and error behavior is unambiguous.

2. Shared error code for permission gating
   - Files:
     - `packages/shared/src/errors.ts` (add `PERMISSION_REQUIRED`)
     - Any schema tests or downstream error mapping tests that rely on enum exhaustiveness
   - Notes:
     - Use `details.reason = "site_not_approved" | "prompt_timed_out" | "user_denied"`.
     - Include `details.site = "<hostname[:port]>"` and `details.action = "drive.navigate" | ...`.
   - Verify:
     - `npm test` passes with updated enum.

3. Storage utilities for allowlist
   - Files:
     - `packages/extension/src/site-permissions.ts` (new)
   - Changes:
     - Implement storage read/write helpers, key normalization, timestamp updates.
   - Tests:
     - Unit tests for `siteKeyFromUrl` and allowlist update logic (no real `chrome.*` required if helpers are pure).
   - Verify:
     - `vitest run packages/extension/src/site-permissions.test.ts` (new test file).

4. Permission prompt controller (background)
   - Files:
     - `packages/extension/src/permission-prompt.ts` (new, background-side controller)
     - `packages/extension/src/background.ts` (wire in)
   - Changes:
     - Create prompt window with a stable URL `permission.html?site=...&reason=...&requestId=...`.
     - Establish a channel for responses (recommended: `chrome.runtime.onConnect` with port name).
     - Deduplicate prompts per site (map `siteKey -> pending`).
     - Implement wait logic: `Promise.race(decisionPromise, delay(permissionPromptWaitMs))`.
   - Tests:
     - Unit test the prompt dedupe and timeout behavior by injecting a fake prompt transport (do not attempt to create real Chrome windows in tests).
   - Verify:
     - Manual: trigger a permission-required action and confirm prompt appears and decision is received.

5. Gate drive actions in background
   - Files:
     - `packages/extension/src/background.ts`
   - Changes:
     - Before executing a drive action, resolve `siteKey`:
       - Navigate: from destination URL
       - Other actions: from active tab's URL
     - If allowlisted:
       - Touch `lastUsedAt`
       - Proceed
     - If not allowlisted:
       - Open prompt and wait up to 10s
       - On allow once: proceed without persisting, but touch `lastUsedAt` in memory or skip
       - On allow always: persist allowlist, then proceed
       - On deny: return non-retryable error
       - On timeout: return retryable `PERMISSION_PROMPT_TIMEOUT`
   - Verify:
     - Manual: `drive.navigate` to an unapproved site blocks and prompts.
     - Manual: approval allows action; revoke removes access.

6. Build and ship UI pages
   - Files:
     - `packages/extension/permission.html` (new)
     - `packages/extension/options.html` (new)
     - `packages/extension/assets/ui.css` (new, optional)
     - `packages/extension/src/permission-prompt-ui.ts` (new)
     - `packages/extension/src/options-ui.ts` (new)
     - `scripts/build-extension.mjs` (bundle new entrypoints)
     - `packages/extension/manifest.json` (add `options_ui`)
     - `packages/extension/package.json` (include html/css in `files`)
   - Verify:
     - `npm run build` produces the expected `dist/*.js`.
     - Loading unpacked extension shows options page and prompt window renders.

7. Manual test coverage and regression checks
   - Files:
     - `docs/manual-test.md`
     - Optional: add a dedicated manual test section for permissions.
   - Verify:
     - Check allow once, allow always, deny, prompt timeout.
     - Check last-used updates and revoke behavior.
     - Check behavior on restricted URLs.

## Testing Strategy

- Unit tests for pure URL->siteKey normalization.
- Unit tests for permission prompt state machine (dedupe, timeout, decision).
- Manual browser test for UI (MV3 window creation and port messaging).

## Rollout Notes and Risks

- MV3 lifecycle: keep prompt-response path resilient to background suspends.
  - Use `chrome.runtime.connect()` port from the prompt page.
  - Keep a retryable error fallback so callers can retry after approval.

- Upstream timeouts: some clients default to short timeouts (as low as 4s in this repo's CLI).
  - Returning a retryable "permission required" error is more reliable than hanging indefinitely.
