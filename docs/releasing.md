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

2. Update `CHANGELOG.md`:

- Move anything in `[Unreleased]` into a new version section with today's date.
- Keep `[Unreleased]` at the top for ongoing work.

3. Bump versions:

```bash
npm run bump:patch  # or bump:minor / bump:major
```

This updates `package.json` + all `packages/*/package.json` versions and refreshes `package-lock.json`.

4. Run quality gates:

```bash
npm test
npm run lint
npm run typecheck
npm run build
```

5. Commit the release:

```bash
git add -A
git commit -m "release: vX.Y.Z"
```

6. Create an annotated tag:

```bash
npm run tag:version
```

7. Publish to npm (may require `--otp=<code>`):

```bash
cd packages/cli
npm publish --access public --workspaces=false
```

8. Push commit + tag:

```bash
git push origin main --follow-tags
```

9. Create a GitHub Release for the tag:

- Create a release for `vMAJOR.MINOR.PATCH` on GitHub.
- The `Release Extension Asset` workflow will build and attach `browser-bridge-extension-vMAJOR.MINOR.PATCH.zip` automatically.
