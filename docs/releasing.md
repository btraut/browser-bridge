# Releasing

This repo publishes the CLI package `@btraut/browser-bridge` to npm from `packages/cli`.

## Versioning

- SemVer: `MAJOR.MINOR.PATCH`
- Git tags: `vMAJOR.MINOR.PATCH` (for example, `v0.2.0`)
- Update `CHANGELOG.md` for every release.

## Release Checklist

1. Start from an up-to-date `main`:

```bash
git pull --rebase
```

2. Start from a clean install/build baseline:

```bash
npm install
npm run build
```

If either command fails, stop there. Do not start a release from a dirty or half-built tree.

3. Update `CHANGELOG.md`:

- Move anything in `[Unreleased]` into a new version section with today's date.
- Keep `[Unreleased]` at the top for ongoing work.

4. Bump versions:

```bash
npm run bump:patch  # or bump:minor / bump:major
```

This updates `package.json` + all `packages/*/package.json` versions and refreshes `package-lock.json`.

5. Run quality gates:

```bash
npm test
npm run lint
npm run typecheck
npm run build
```

6. Commit the release:

```bash
git add -A
git commit -m "release: vX.Y.Z"
```

7. Create an annotated tag:

```bash
npm run tag:version
```

8. Publish to npm (may require `--otp=<code>`):

```bash
cd packages/cli
npm publish --access public --workspaces=false
```

9. Push commit + tag:

```bash
git push origin main --follow-tags
```

## Extension Zip (GitHub Releases)

When you push a `vX.Y.Z` tag, GitHub Actions will create/update the matching GitHub Release and attach a pre-built Chrome extension zip:

- `browser-bridge-extension-vX.Y.Z.zip`

Unzip it and load the unpacked folder via `chrome://extensions`.
