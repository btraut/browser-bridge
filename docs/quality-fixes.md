# Quality Fixes

Tiny runbook for recurring quality failures we hit while exercising Browser Bridge on real sites. Keep entries short, symptom-first, and easy to grep against Beads IDs, changelog entries, and git history.

When adding an entry:

- Name the failure pattern, not the implementation.
- Keep it to 2-3 sentences.
- Point future agents at the relevant Bead or commit if known.

## 2026-03-13 ManaVault follow-up

### Data-state popup misclassification

Buttons with styling state like `data-state="closed"` can look popup-ish to Browser Bridge without actually controlling a menu. Check `browser-vision-8hj.2` and the `does not treat data-state-only buttons as popup triggers` regression before touching popup verification again.

### Off-screen duplicate target selection

Locator resolution can still drift when the DOM keeps an off-screen twin ahead of the live on-screen control. Check `browser-vision-8hj.3` and the on-screen duplicate regressions before assuming a locator bug is in role matching alone.

### Center-point clicks that lie

A locator can resolve the right element while still producing a bad click point or reporting success before the CDP click finishes. Check `browser-vision-8hj.4`, the hittable locator-point regression, and the background click path before blaming the app for a no-op click.
