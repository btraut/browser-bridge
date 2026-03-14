---
name: bump-version
description: >
  Prepare and publish the next Browser Bridge release. Use when the user wants to bump the version, update the changelog, push the release commit and tag, verify the GitHub release, publish the npm package, and then remind them to update the local browser extension. This skill requires an explicit release type input of major, minor, or patch; if that input is missing or ambiguous, stop and ask.
---

# Bump Version

Use this skill when the user wants to cut and publish a new Browser Bridge release.

## Required input

Do not guess the bump type.

- Accepted inputs: `major`, `minor`, `patch`
- If the user does not provide one of those exact meanings, stop and ask one direct question.
- If the user says `patched`, confirm they mean `patch` before doing anything.
- If the repo is dirty before the release starts, stop and tell the user a release needs a clean working tree.

## Repo facts

- The canonical release doc is [../../docs/releasing.md](../../docs/releasing.md).
- Version bump commands already exist:
  - `npm run bump:patch`
  - `npm run bump:minor`
  - `npm run bump:major`
- Those commands update:
  - `/package.json`
  - `/package-lock.json`
  - `/packages/*/package.json`
  - `/packages/extension/manifest.json`
- Quality gates for a release:
  - `npm test`
  - `npm run lint`
  - `npm run typecheck`
  - `npm run build`
- Tag creation already exists: `npm run tag:version`
- GitHub Release creation is automated by `.github/workflows/release.yml` when a `v*` tag is pushed. Do not manually create a duplicate release with `gh release create`.
- npm publish happens from `/packages/cli` with `npm publish --access public --workspaces=false`
- The repo release doc publishes to npm before pushing the tag. This skill intentionally follows the user-requested order instead, so call out the risk: if npm publish fails, GitHub will already have the pushed tag and release.

## Workflow

1. Confirm the bump type is explicitly `major`, `minor`, or `patch`. If not, ask and stop.
2. Verify release preconditions:
   - `git status --short` must be empty
   - `git branch --show-current` should be `main`
   - `gh auth status` and `npm whoami` should succeed before doing release work
3. Pull latest `main`:
   - `git pull --rebase`
4. Bump the version with the matching script:
   - `npm run bump:<type>`
5. Update `CHANGELOG.md`:
   - Move everything from `[Unreleased]` into a new `## [x.y.z] - YYYY-MM-DD` section
   - Leave an empty `[Unreleased]` section at the top
   - Do not leave the release notes split across both sections
6. Run release verification:
   - `npm test`
   - `npm run lint`
   - `npm run typecheck`
   - `npm run build`
7. Commit only the release files. Do not stage broadly.
   - Stage the exact files changed by the release
   - Commit message: `release: vX.Y.Z`
8. Create the annotated tag:
   - `npm run tag:version`
9. Push commit and tag:
   - `git push origin main --follow-tags`
10. Verify the GitHub release exists for `vX.Y.Z`.

- Because this repo creates releases from the pushed tag, wait briefly and check with `gh release view vX.Y.Z`
- If the workflow has not finished yet, report that clearly instead of pretending it exists

11. Publish the npm package from `/packages/cli`:

- `npm publish --access public --workspaces=false`
- If npm requires OTP, pause and ask the user for it
- If publish fails here, say plainly that the repo is in a partial-release state because the tag and GitHub release are already public

12. Stop and tell the user to update their local browser extension.

- Compute the full absolute path from the repo root and show it as `/absolute/path/to/repo/packages/extension`
- Tell them that loading the old extension after a publish is how you end up debugging ghosts

## Staging guidance

Release commits should usually stage these paths and nothing else:

- `CHANGELOG.md`
- `package.json`
- `package-lock.json`
- `packages/cli/package.json`
- `packages/core/package.json`
- `packages/extension/manifest.json`
- `packages/extension/package.json`
- `packages/mcp-adapter/package.json`
- `packages/shared/package.json`

If the bump touched anything outside that list, inspect it before staging.

## Final response

When the release succeeds, report:

- new version
- release commit hash
- pushed tag
- npm publish result
- GitHub release status
- full absolute path to `packages/extension`

When the release stops early, say exactly why and what input or auth is missing.
