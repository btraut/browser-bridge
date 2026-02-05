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

extract_tab_id_for_url() {
  node -e "const fs=require('fs');const data=JSON.parse(fs.readFileSync(0,'utf8'));const url=process.argv[1];const tabs=(data.result?.tabs ?? data.tabs ?? []);const exact=tabs.find((t)=>t.url===url);if(exact){console.log(exact.tab_id);process.exit(0);}const active=tabs.find((t)=>t.active);if(active){console.log(active.tab_id);process.exit(0);}const first=tabs[0];if(first){console.log(first.tab_id);process.exit(0);}process.exit(1);" "$1"
}

run_json() {
  "${cli_cmd[@]}" --json "$@"
}

retry_json() {
  local tries=$1
  shift
  local attempt=1
  while [[ $attempt -le $tries ]]; do
    set +e
    run_json "$@"
    local rc=$?
    set -e
    if [[ $rc -eq 0 ]]; then
      return 0
    fi
    sleep 0.2
    attempt=$((attempt + 1))
  done
  return 1
}

session_id=${BV_SMOKE_SESSION_ID:-""}
if [[ -z "$session_id" ]]; then
  session_id=$(run_json session create | extract_session_id)
fi

echo "Using session_id: $session_id"

run_json session status --session-id "$session_id"
run_json session recover --session-id "$session_id"

tab_id=${BV_SMOKE_TAB_ID:-""}
if [[ -z "$tab_id" ]]; then
  tab_id=$(run_json drive tab-list --session-id "$session_id" | extract_tab_id_for_url "$smoke_url")
fi

echo "Using tab_id: $tab_id"

run_json drive tab-activate --session-id "$session_id" --tab-id "$tab_id"

run_json drive navigate --session-id "$session_id" --tab-id "$tab_id" --url "https://example.com" --wait domcontentloaded
run_json drive navigate --session-id "$session_id" --tab-id "$tab_id" --url "$smoke_url" --wait domcontentloaded

# Ensure the debugger is attached before triggering any blocking JS dialogs.
# Attaching after a dialog opens can result in "No dialog is showing".
run_json inspect evaluate --session-id "$session_id" --expression "1"

run_json drive go-back --session-id "$session_id" --tab-id "$tab_id"
run_json drive go-forward --session-id "$session_id" --tab-id "$tab_id"
run_json drive back --session-id "$session_id" --tab-id "$tab_id"
run_json drive forward --session-id "$session_id" --tab-id "$tab_id"

run_json drive wait-for --session-id "$session_id" --tab-id "$tab_id" --kind text_present --value "Smoke Ready" --timeout-ms 5000

run_json drive click --session-id "$session_id" --tab-id "$tab_id" --locator-css "#click-target"
run_json drive hover --session-id "$session_id" --tab-id "$tab_id" --locator-css "#hover-target" --delay-ms 100
run_json drive type --session-id "$session_id" --tab-id "$tab_id" --locator-css "#text-input" --text "hello" --clear
run_json drive fill-form --session-id "$session_id" --tab-id "$tab_id" --fields '[{"selector":"#text-input","value":"smoke"}]'
run_json drive select --session-id "$session_id" --tab-id "$tab_id" --locator-css "#select-input" --value "beta"
run_json drive key-press --session-id "$session_id" --tab-id "$tab_id" --key Enter --ctrl
run_json drive key --session-id "$session_id" --tab-id "$tab_id" --key Enter --modifier shift --repeat 2
run_json drive scroll --session-id "$session_id" --tab-id "$tab_id" --delta-y 200 --behavior smooth
run_json drive drag --session-id "$session_id" --tab-id "$tab_id" --from-locator-css "#drag-source" --to-locator-css "#drag-target" --steps 5

run_json drive click --session-id "$session_id" --tab-id "$tab_id" --locator-css "#open-prompt"
sleep 0.2
retry_json 10 drive handle-dialog --session-id "$session_id" --tab-id "$tab_id" --action accept --prompt-text "ok"

run_json drive click --session-id "$session_id" --tab-id "$tab_id" --locator-css "#open-prompt"
sleep 0.2
retry_json 10 dialog accept --session-id "$session_id" --tab-id "$tab_id" --prompt-text "yep"

run_json drive click --session-id "$session_id" --tab-id "$tab_id" --locator-css "#open-confirm"
sleep 0.2
retry_json 10 dialog dismiss --session-id "$session_id" --tab-id "$tab_id"

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

run_json drive tab-activate --session-id "$session_id" --tab-id "$tab_id"
run_json drive tab-close --session-id "$session_id" --tab-id "$tab_id"

run_json open-artifacts --session-id "$session_id"
run_json session close --session-id "$session_id"

echo "Smoke complete."
