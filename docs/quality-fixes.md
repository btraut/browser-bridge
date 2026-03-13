# Quality Fixes

Tiny runbook for recurring quality failures we hit while exercising Browser Bridge on real sites. Keep entries short, symptom-first, and easy to grep against Beads IDs, changelog entries, and git history.

When adding an entry:

- Name the failure pattern, not the implementation.
- Keep it to 2-3 sentences.
- Point future agents at the relevant Bead or commit if known.

## 2026-03-13 ManaVault follow-up

### Popup trigger pointer-vs-keyboard mismatch

Some popup triggers wrap live child chrome that is "inside" the button but still a lousy click surface for verified CDP clicks. Check `browser-vision-d26.1`; the landed fixes are `7ec8d7c` (prefocus popup triggers before the verified click) and `e811021` (prefer hit points that land on the trigger itself before falling back to descendants), not weakening the popup-open verification.

### extract_content falls apart on deck pages

Readability can grab the wrong sliver of an app-shell page and then happily duplicate repeated deck sections into markdown. Check `browser-vision-d26.2`; the landed fix is `9a0b507`, which falls back to the semantic main region when Readability is too thin and collapses adjacent repeated markdown sections before returning the extract.
