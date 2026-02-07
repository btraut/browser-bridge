# Demos (Scripts + Clips)

This page is an index of short, real-world Browser Bridge demos.

Status:

- Scripts: available now (copy/pasteable).
- Clips: in progress. When you record a clip, put it under `docs/assets/demos/` and link it from the relevant section below.

## Conventions

- Keep clips short: 10-30 seconds.
- Prefer `mp4` for GitHub rendering; use `gif` only when necessary.
- Name files like `01-quickstart.mp4`, `02-find-and-click.mp4`, etc.
- If a demo uses a page, prefer `docs/fixtures/smoke-page.html` or a stable public URL.

## 01. Quickstart: Navigate + Snapshot

What it shows:

- Session lifecycle
- Drive navigation
- Inspect DOM snapshot

Script:

```bash
browser-bridge session create
# Use the session_id from output for the next commands.

browser-bridge drive navigate --session-id <id> --url https://example.com
browser-bridge inspect dom-snapshot --session-id <id> --format ax --max-nodes 2000

browser-bridge session close --session-id <id>
```

Clip:

- TBD: `docs/assets/demos/01-quickstart.mp4`

## 02. Targeting: Find Then Click (Stable Refs)

What it shows:

- Getting stable element refs via `inspect find`
- Clicking by ref (less fragile than CSS selectors)

Script:

```bash
browser-bridge session create

browser-bridge drive navigate --session-id <id> --url https://example.com
browser-bridge inspect find --session-id <id> role link --name "More information"
browser-bridge drive click --session-id <id> --locator-ref @e1

browser-bridge session close --session-id <id>
```

Clip:

- TBD: `docs/assets/demos/02-find-and-click.mp4`

## 03. Waiting: URL Matches, Locator Visible, Text Present

What it shows:

- Reliable waiting after actions that trigger navigation / dynamic loading

Script:

```bash
browser-bridge session create

browser-bridge drive navigate --session-id <id> --url https://example.com
browser-bridge drive wait-for --session-id <id> --kind url_matches --value example.com
browser-bridge drive wait-for --session-id <id> --kind text_present --value "Example Domain"

browser-bridge session close --session-id <id>
```

Clip:

- TBD: `docs/assets/demos/03-wait-for.mp4`

## 04. DOM Diff: Detect Page Changes Over Time

What it shows:

- Taking successive HTML snapshots
- Diffing to detect what changed (added/removed/changed nodes)

Script:

```bash
browser-bridge session create

browser-bridge drive navigate --session-id <id> --url https://example.com
browser-bridge inspect dom-snapshot --session-id <id> --format html

# Trigger a change (click, form fill, navigation, etc.), then take another snapshot:
browser-bridge inspect dom-snapshot --session-id <id> --format html

browser-bridge inspect dom-diff --session-id <id>

browser-bridge session close --session-id <id>
```

Clip:

- TBD: `docs/assets/demos/04-dom-diff.mp4`

## 05. Diagnostics Doctor: "Why Is This Failing?"

What it shows:

- Extension connectivity
- Debugger attach status
- Session state, recovery metrics, artifact dir

Script:

```bash
browser-bridge session create
browser-bridge diagnostics doctor --session-id <id>
browser-bridge session close --session-id <id>
```

Clip:

- TBD: `docs/assets/demos/05-diagnostics-doctor.mp4`

## 06. Recovery: Explicit Session Repair

What it shows:

- Recovering from a degraded/broken session without guesswork

Script:

```bash
browser-bridge session create

# If a command fails (drive/inspect), run recovery:
browser-bridge session recover --session-id <id>

# Then retry the failed command once.

browser-bridge session close --session-id <id>
```

Clip:

- TBD: `docs/assets/demos/06-session-recover.mp4`

## 07. Artifacts: Full-Page Screenshot

What it shows:

- Capturing a screenshot artifact to a stable, per-session directory

Script:

```bash
browser-bridge session create

browser-bridge drive navigate --session-id <id> --url https://example.com
browser-bridge artifacts screenshot --session-id <id> --full-page --format png
browser-bridge open-artifacts --session-id <id>

browser-bridge session close --session-id <id>
```

Clip:

- TBD: `docs/assets/demos/07-screenshot.mp4`

## 08. "Stay Logged In" Demo (Real Product Workflow)

What it shows:

- Using your existing Chrome profile and tabs
- Working with sites that require login state

Suggested flow:

1. Open the site in Chrome and sign in normally.
2. Create a Browser Bridge session.
3. Drive/inspect the already-logged-in tab (navigate within the app, take an AX snapshot, perform a click).

Script (replace URL with your app's URL):

```bash
browser-bridge session create
browser-bridge drive navigate --session-id <id> --url https://your-app.example.com
browser-bridge inspect dom-snapshot --session-id <id> --format ax --max-nodes 2000
browser-bridge session close --session-id <id>
```

Clip:

- TBD: `docs/assets/demos/08-stay-logged-in.mp4`
