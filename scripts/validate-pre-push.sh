#!/usr/bin/env bash
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"

if command -v mise >/dev/null 2>&1; then
  mise install
fi

npm run format:check
npm run lint
npm run typecheck
