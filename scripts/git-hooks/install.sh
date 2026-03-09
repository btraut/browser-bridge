#!/usr/bin/env sh
set -eu

repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"

git config core.hooksPath .githooks

chmod +x .githooks/pre-commit .githooks/pre-push
chmod +x scripts/git-hooks/pre-commit.sh scripts/git-hooks/pre-push.sh scripts/validate-pre-push.sh

printf '%s\n' "Git hooks installed: core.hooksPath=$(git config --get core.hooksPath)"
