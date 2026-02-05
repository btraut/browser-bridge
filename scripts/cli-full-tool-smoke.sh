#!/usr/bin/env bash
set -euo pipefail

# Optional full-tool smoke for the CLI. Requires a built workspace and the
# extension loaded in Chrome.

repo_root=$(git rev-parse --show-toplevel)
cli_bin=${BV_SMOKE_CLI_BIN:-"$repo_root/packages/cli/dist/index.js"}
cli_cmd=(node "$cli_bin")

smoke_url=${BV_SMOKE_URL:-"file://$repo_root/docs/fixtures/smoke-page.html"}

extract_session_id() {
  node -e "const fs=require('fs');const data=JSON.parse(fs.readFileSync(0,'utf8'));console.log(data.result.session_id);"
}

extract_tab_id() {
  node -e "const fs=require('fs');const data=JSON.parse(fs.readFileSync(0,'utf8'));const tab=data.result.tabs[0];console.log(tab.tab_id);"
}

run_json() {
  "${cli_cmd[@]}" --json "$@"
}

session_id=${BV_SMOKE_SESSION_ID:-""}
if [[ -z "$session_id" ]]; then
  session_id=$(run_json session create | extract_session_id)
fi

echo "Using session_id: $session_id"

run_json session status --session-id "$session_id"
run_json session recover --session-id "$session_id"

run_json drive navigate --session-id "$session_id" --url "https://example.com" --wait domcontentloaded
run_json drive navigate --session-id "$session_id" --url "$smoke_url" --wait domcontentloaded

run_json drive go-back --session-id "$session_id"
run_json drive go-forward --session-id "$session_id"
run_json drive back --session-id "$session_id"
run_json drive forward --session-id "$session_id"

run_json drive wait-for --session-id "$session_id" --kind text_present --value "Smoke Ready" --timeout-ms 5000

run_json drive click --session-id "$session_id" --locator-css "#click-target"
run_json drive hover --session-id "$session_id" --locator-css "#hover-target" --delay-ms 100
run_json drive type --session-id "$session_id" --locator-css "#text-input" --text "hello" --clear
run_json drive fill-form --session-id "$session_id" --fields '[{"selector":"#text-input","value":"smoke"}]'
run_json drive select --session-id "$session_id" --locator-css "#select-input" --value "beta"
run_json drive key-press --session-id "$session_id" --key Enter --ctrl
run_json drive key --session-id "$session_id" --key Enter --modifier shift --repeat 2
run_json drive scroll --session-id "$session_id" --delta-y 200 --behavior smooth
run_json drive drag --session-id "$session_id" --from-locator-css "#drag-source" --to-locator-css "#drag-target" --steps 5

run_json drive click --session-id "$session_id" --locator-css "#open-prompt"
run_json drive handle-dialog --session-id "$session_id" --action accept --prompt-text "ok"

run_json drive click --session-id "$session_id" --locator-css "#open-prompt"
run_json dialog accept --session-id "$session_id" --prompt-text "yep"

run_json drive click --session-id "$session_id" --locator-css "#open-confirm"
run_json dialog dismiss --session-id "$session_id"

run_json artifacts screenshot --session-id "$session_id" --target viewport
run_json diagnostics doctor --session-id "$session_id"

run_json inspect dom-snapshot --session-id "$session_id" --format html --consistency best_effort
run_json inspect dom-diff --session-id "$session_id"
run_json inspect find role button --session-id "$session_id" --name "Click Target"
run_json inspect extract-content --session-id "$session_id" --format markdown --include-metadata
run_json inspect page-state --session-id "$session_id"
run_json inspect console-list --session-id "$session_id"
run_json inspect network-har --session-id "$session_id"
run_json inspect evaluate --session-id "$session_id" --expression "2 + 2"
run_json inspect performance-metrics --session-id "$session_id"

tab_id=$(run_json drive tab-list --session-id "$session_id" | extract_tab_id)
run_json drive tab-activate --session-id "$session_id" --tab-id "$tab_id"
run_json drive tab-close --session-id "$session_id" --tab-id "$tab_id"

run_json open-artifacts --session-id "$session_id"
run_json session close --session-id "$session_id"

echo "Smoke complete."
