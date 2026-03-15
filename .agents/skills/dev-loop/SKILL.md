---
name: dev-loop
description: >
  Rebuild and refresh Browser Bridge inside the user's existing Chrome profile. Use when a user wants to update the unpacked extension after local changes, avoid manual delete/reinstall loops, or request bypass mode for repeated local testing on macOS.
---

# Dev Loop

Use the repo helper instead of the manual Chrome dance.

## Command

From the repo root:

```bash
npm run dev:loop -- --open-options
```

Useful flags:

- `--install` if dependencies changed. Do not run `npm install` every edit like a maniac.
- `--url https://example.com` to start on a specific test page.
- `--no-ensure-bypass` if you do not want the helper to request bypass mode.
- `--open-options` if you want the Browser Bridge options page opened after reload.

## What It Does

1. Optionally runs `npm install`.
2. Runs `npm run build`.
3. Opens `chrome://extensions` in the user's existing Chrome profile.
4. Ensures Developer Mode is on and clicks the global `Update` button to reload unpacked extensions.
5. Waits for the Browser Bridge extension to reconnect.
6. Requests bypass mode if Chrome is still in granular mode.
7. Opens the extension options page when manual cleanup is still needed.

## Notes

- This is macOS-only right now because it uses AppleScript + accessibility to drive your real Chrome UI.
- The first bypass request may still need one human approval in Chrome. After that, the setting should stick in your normal profile.
- This assumes Browser Bridge is already installed as an unpacked extension in your normal Chrome profile. The helper reloads it; it does not install it from scratch.
