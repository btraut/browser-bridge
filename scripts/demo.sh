#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CLI="node ${ROOT_DIR}/packages/cli/dist/index.js"
TARGET_URL="${1:-https://example.com}"

if [ ! -f "${ROOT_DIR}/packages/cli/dist/index.js" ]; then
  echo "CLI build output not found. Run: npm run build" >&2
  exit 1
fi

echo "Browser Vision demo"
echo "- Ensure Chrome is open with the extension loaded."
echo "- Focus a tab you want to drive."
read -r -p "Press Enter to continue..." _

SESSION_JSON="$(${CLI} session create --json)"
SESSION_ID=$(printf '%s' "${SESSION_JSON}" | node -e "const fs=require('fs');const data=JSON.parse(fs.readFileSync(0,'utf8'));process.stdout.write(data.result?.session_id ?? '');")

if [ -z "${SESSION_ID}" ]; then
  echo "Failed to parse session_id from: ${SESSION_JSON}" >&2
  exit 1
fi

echo "Session: ${SESSION_ID}"

${CLI} diagnostics doctor --session-id "${SESSION_ID}"
${CLI} drive navigate --session-id "${SESSION_ID}" --url "${TARGET_URL}"
${CLI} drive tab-list --session-id "${SESSION_ID}"
${CLI} drive scroll --session-id "${SESSION_ID}" --delta-y 600

SNAPSHOT_PATH="${TMPDIR:-/tmp}/browser-vision-dom-${SESSION_ID}.json"
${CLI} inspect dom-snapshot --session-id "${SESSION_ID}" --format html --consistency best_effort --json > "${SNAPSHOT_PATH}"
echo "DOM snapshot written to ${SNAPSHOT_PATH}"

${CLI} inspect console-list --session-id "${SESSION_ID}"

SHOT_JSON="$(${CLI} artifacts screenshot --session-id "${SESSION_ID}" --target viewport --json)"
SHOT_PATH=$(printf '%s' "${SHOT_JSON}" | node -e "const fs=require('fs');const data=JSON.parse(fs.readFileSync(0,'utf8'));process.stdout.write(data.result?.path ?? '');")

if [ -n "${SHOT_PATH}" ]; then
  echo "Screenshot saved at ${SHOT_PATH}"
else
  echo "Screenshot response: ${SHOT_JSON}"
fi

${CLI} diagnostics doctor --session-id "${SESSION_ID}"

echo "Demo complete. Use open-artifacts if you want to reveal the artifacts folder."
