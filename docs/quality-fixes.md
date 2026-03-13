# Quality Fixes

Tiny runbook for recurring quality failures we hit while exercising Browser Bridge on real sites. Keep entries short, symptom-first, and easy to grep against Beads IDs, changelog entries, and git history.

When adding an entry:

- Name the failure pattern, not the implementation.
- Keep it to 2-3 sentences.
- Point future agents at the relevant Bead or commit if known.

## 2026-03-13 ManaVault follow-up

### Popup trigger pointer-vs-keyboard mismatch

Some popup triggers open on `pointerdown` but collapse again if the first click also causes focus churn. Check `browser-vision-d26.1`; the current fix path is to focus the resolved trigger before dispatching the verified CDP click, not to relax the popup-open verification.

### extract_content falls apart on deck pages

`inspect.extract_content` still duplicates large sections on deck view pages and can collapse to shallow helper text in edit mode. Check `browser-vision-d26.2` before trusting extract output on interactive SPA routes just because the DOM snapshot looks healthy.
