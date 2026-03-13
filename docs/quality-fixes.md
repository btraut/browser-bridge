# Quality Fixes

Tiny runbook for recurring quality failures we hit while exercising Browser Bridge on real sites. Keep entries short, symptom-first, and easy to grep against Beads IDs, changelog entries, and git history.

When adding an entry:

- Name the failure pattern, not the implementation.
- Keep it to 2-3 sentences.
- Point future agents at the relevant Bead or commit if known.

## 2026-03-13 ManaVault follow-up

### Popup trigger pointer-vs-keyboard mismatch

`drive.click` can still leave a real popup trigger closed even when the same control opens immediately via keyboard activation. Check `browser-vision-d26.1`, plus the recent popup-click verification and click-targeting commits, before assuming a no-op pointer click is already solved.

### extract_content falls apart on deck pages

`inspect.extract_content` still duplicates large sections on deck view pages and can collapse to shallow helper text in edit mode. Check `browser-vision-d26.2` before trusting extract output on interactive SPA routes just because the DOM snapshot looks healthy.
