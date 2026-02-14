#!/usr/bin/env bash
set -euo pipefail

# Optional full-tool smoke for the CLI. Requires a built workspace and the
# extension loaded in Chrome.

repo_root=$(git rev-parse --show-toplevel)
cli_bin=${BV_SMOKE_CLI_BIN:-"$repo_root/packages/cli/dist/index.js"}
cli_cmd=(node "$cli_bin")

smoke_url=${BV_SMOKE_URL:-""}
smoke_timeout_ms=${BV_SMOKE_TIMEOUT_MS:-15000}

# The CLI defaults to a small HTTP timeout which is fine for most operations,
# but dialog flows and debugger attach can take longer on real machines.
export BROWSER_BRIDGE_CORE_TIMEOUT_MS=${BROWSER_BRIDGE_CORE_TIMEOUT_MS:-$smoke_timeout_ms}
export BROWSER_VISION_CORE_TIMEOUT_MS=${BROWSER_VISION_CORE_TIMEOUT_MS:-$smoke_timeout_ms}

smoke_server_pid=""
smoke_server_port_file=""

start_smoke_server() {
  # Avoid file:// since it is intentionally restricted; serve the fixture over HTTP.
  smoke_server_port_file=$(mktemp)
  node -e "
    const http = require('http');
    const fs = require('fs');
    const path = require('path');

    const root = path.resolve(process.argv[1]);
    const rootPrefix = root.endsWith(path.sep) ? root : root + path.sep;

    const send = (res, status, body) => {
      res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8' });
      res.end(body);
    };

    const server = http.createServer((req, res) => {
      try {
        const url = new URL(req.url || '/', 'http://127.0.0.1');
        const pathname = decodeURIComponent(url.pathname);
        const candidate = path.resolve(path.join(root, '.' + pathname));
        if (!(candidate === root || candidate.startsWith(rootPrefix))) {
          send(res, 403, 'forbidden');
          return;
        }
        fs.stat(candidate, (err, st) => {
          if (err || !st.isFile()) {
            send(res, 404, 'not found');
            return;
          }
          res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
          fs.createReadStream(candidate).pipe(res);
        });
      } catch (e) {
        send(res, 500, 'error');
      }
    });

    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      process.stdout.write(String(port) + '\\n');
    });

    const shutdown = () => server.close(() => process.exit(0));
    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
  " "$repo_root" >"$smoke_server_port_file" 2>/dev/null &
  smoke_server_pid=$!

  for _ in $(seq 1 100); do
    if [[ -s "$smoke_server_port_file" ]]; then
      local port
      port=$(head -n 1 "$smoke_server_port_file" | tr -d '\r\n')
      if [[ "$port" =~ ^[0-9]+$ ]]; then
        smoke_url="http://127.0.0.1:${port}/docs/fixtures/smoke-page.html"
        return 0
      fi
    fi
    sleep 0.05
  done

  echo "Failed to start smoke fixture HTTP server." >&2
  return 1
}

cleanup_smoke_server() {
  if [[ -n "${smoke_server_pid:-}" ]]; then
    kill "${smoke_server_pid}" >/dev/null 2>&1 || true
  fi
  if [[ -n "${smoke_server_port_file:-}" ]]; then
    rm -f "${smoke_server_port_file}" >/dev/null 2>&1 || true
  fi
}

if [[ -z "$smoke_url" ]]; then
  start_smoke_server
  trap cleanup_smoke_server EXIT
fi

extract_session_id() {
  node -e "const fs=require('fs');const data=JSON.parse(fs.readFileSync(0,'utf8'));console.log(data.result.session_id);"
}

extract_tab_id_for_url() {
  node -e "const fs=require('fs');const data=JSON.parse(fs.readFileSync(0,'utf8'));const url=process.argv[1];const tabs=(data.result?.tabs ?? data.tabs ?? []);const exact=tabs.find((t)=>t.url===url);if(exact){console.log(exact.tab_id);process.exit(0);}const active=tabs.find((t)=>t.active);if(active){console.log(active.tab_id);process.exit(0);}const first=tabs[0];if(first){console.log(first.tab_id);process.exit(0);}process.exit(1);" "$1"
}

run_json() {
  echo "+ ${cli_cmd[*]} --json $*" >&2
  "${cli_cmd[@]}" --json "$@"
}

extract_first_ref() {
  node -e "const fs=require('fs');const data=JSON.parse(fs.readFileSync(0,'utf8'));const matches=data.result?.matches ?? data.result?.result?.matches ?? []; if(!Array.isArray(matches) || matches.length===0 || !matches[0]?.ref){ process.exit(1);} process.stdout.write(matches[0].ref);"
}

assert_eval_true() {
  local expression=$1
  local label=$2
  local output
  output=$(run_json inspect evaluate --session-id "$session_id" --expression "$expression")
  if ! printf '%s' "$output" | node -e "const fs=require('fs');const data=JSON.parse(fs.readFileSync(0,'utf8'));const v=data.result?.value ?? data.result?.result?.value ?? data.value; if(v!==true){ console.error('ASSERT FAIL:', process.argv[1], '=>', JSON.stringify(v)); process.exit(1); }" "$label"; then
    exit 1
  fi
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

ensure_debugger_attached() {
  # Keep the debugger attached right before opening blocking JS dialogs.
  # Attaching after a dialog opens can race and lead to "No dialog is showing".
  run_json inspect evaluate --session-id "$session_id" --expression "1" >/dev/null
}

session_id=${BV_SMOKE_SESSION_ID:-""}
if [[ -z "$session_id" ]]; then
  session_id=$(run_json session create | extract_session_id)
fi

echo "Using session_id: $session_id"

run_json diagnostics health-check
run_json diagnostics doctor
run_json session status --session-id "$session_id"
run_json session recover --session-id "$session_id"

run_json drive navigate --session-id "$session_id" --url "$smoke_url" --wait none

# Now that the agent tab navigated to the smoke URL, re-resolve tab_id to avoid
# depending on the user already having it open.
tab_id=${BV_SMOKE_TAB_ID:-""}
if [[ -z "$tab_id" ]]; then
  tab_id=$(run_json drive tab-list --session-id "$session_id" | extract_tab_id_for_url "$smoke_url")
fi
echo "Using tab_id (post-navigate): $tab_id"
run_json drive tab-activate --session-id "$session_id" --tab-id "$tab_id"

# Ensure the smoke tab has actual history so go-back/go-forward tests are meaningful.
run_json drive navigate --session-id "$session_id" --tab-id "$tab_id" --url "https://example.com" --wait domcontentloaded
run_json drive navigate --session-id "$session_id" --tab-id "$tab_id" --url "$smoke_url" --wait domcontentloaded
run_json drive wait-for --session-id "$session_id" --tab-id "$tab_id" --kind url_matches --value "smoke-page.html" --timeout-ms 5000
run_json drive wait-for --session-id "$session_id" --tab-id "$tab_id" --kind locator_visible --value "#smoke-title" --timeout-ms 5000
run_json drive wait-for --session-id "$session_id" --tab-id "$tab_id" --kind text_present --value "Smoke Ready" --timeout-ms 5000

# Ensure the debugger is attached early (and again right before dialogs).
run_json inspect evaluate --session-id "$session_id" --expression "1"

run_json drive go-back --session-id "$session_id" --tab-id "$tab_id"
run_json drive go-forward --session-id "$session_id" --tab-id "$tab_id"
run_json drive back --session-id "$session_id" --tab-id "$tab_id"
run_json drive forward --session-id "$session_id" --tab-id "$tab_id"

run_json drive click --session-id "$session_id" --tab-id "$tab_id" --locator-css "#click-target"
run_json drive click --session-id "$session_id" --tab-id "$tab_id" --locator-testid "click-target"
run_json drive click --session-id "$session_id" --tab-id "$tab_id" --locator-role "button" --locator-role-value "Role Target"
assert_eval_true "document.getElementById('role-target')?.textContent === 'Role Clicked'" "role-target click updates text"
run_json drive click --session-id "$session_id" --tab-id "$tab_id" --locator-css "#click-target" --click-count 2
run_json drive hover --session-id "$session_id" --tab-id "$tab_id" --locator-css "#hover-target" --delay-ms 100
run_json drive type --session-id "$session_id" --tab-id "$tab_id" --locator-css "#text-input" --text "hello" --clear
assert_eval_true "document.activeElement?.id === 'text-input'" "type focuses text input"
assert_eval_true "document.getElementById('text-input')?.value === 'hello'" "type sets text input value"
run_json drive type --session-id "$session_id" --tab-id "$tab_id" --locator-css "#text-input" --text " submit" --submit
assert_eval_true "document.getElementById('form-status')?.textContent === 'Submitted'" "type submit triggers form submit"
run_json drive fill-form --session-id "$session_id" --tab-id "$tab_id" --fields '[{"selector":"#text-input","value":"smoke","type":"text"},{"locator":{"css":"#select-input"},"value":"beta","type":"select"},{"selector":"#check-input","value":true,"type":"checkbox"},{"selector":"#ce-input","value":"editable","type":"contentEditable"},{"selector":"#text-input","value":" done","type":"text","submit":true}]'
assert_eval_true "document.getElementById('text-input')?.value.includes(' done')" "fill-form updates text field"
assert_eval_true "document.getElementById('select-input')?.value === 'beta'" "fill-form updates select field"
assert_eval_true "document.getElementById('check-input')?.checked === true" "fill-form updates checkbox"
assert_eval_true "document.getElementById('ce-input')?.textContent?.includes('editable') === true" "fill-form updates contentEditable"
run_json drive select --session-id "$session_id" --tab-id "$tab_id" --locator-css "#select-input" --value "beta"
run_json drive select --session-id "$session_id" --tab-id "$tab_id" --locator-css "#select-input" --text "Alpha"
run_json drive select --session-id "$session_id" --tab-id "$tab_id" --locator-css "#select-input" --index 1
assert_eval_true "document.getElementById('select-input')?.value === 'beta'" "select supports value/text/index operations"
run_json drive key-press --session-id "$session_id" --tab-id "$tab_id" --key Enter --ctrl
run_json drive key --session-id "$session_id" --tab-id "$tab_id" --key Enter --modifier shift --repeat 2
run_json drive scroll --session-id "$session_id" --tab-id "$tab_id" --delta-y 200 --behavior smooth
run_json drive scroll --session-id "$session_id" --tab-id "$tab_id" --delta-x 10 --behavior auto
run_json drive scroll --session-id "$session_id" --tab-id "$tab_id" --top 0 --left 0 --behavior auto
run_json drive drag --session-id "$session_id" --tab-id "$tab_id" --from-locator-css "#drag-source" --to-locator-css "#drag-target" --steps 5
assert_eval_true "document.getElementById('drag-target')?.textContent === 'Dropped'" "drag drops onto target"

ensure_debugger_attached
run_json drive click --session-id "$session_id" --tab-id "$tab_id" --locator-css "#open-alert"
sleep 0.2
retry_json 10 dialog accept --session-id "$session_id" --tab-id "$tab_id"

ensure_debugger_attached
run_json drive click --session-id "$session_id" --tab-id "$tab_id" --locator-css "#open-prompt"
sleep 0.2
retry_json 10 drive handle-dialog --session-id "$session_id" --tab-id "$tab_id" --action accept --prompt-text "ok"

ensure_debugger_attached
run_json drive click --session-id "$session_id" --tab-id "$tab_id" --locator-css "#open-prompt"
sleep 0.2
retry_json 10 dialog accept --session-id "$session_id" --tab-id "$tab_id" --prompt-text "yep"

ensure_debugger_attached
run_json drive click --session-id "$session_id" --tab-id "$tab_id" --locator-css "#open-confirm"
sleep 0.2
retry_json 10 dialog dismiss --session-id "$session_id" --tab-id "$tab_id"

run_json artifacts screenshot --session-id "$session_id" --target viewport
run_json artifacts screenshot --session-id "$session_id" --full-page
run_json artifacts screenshot --session-id "$session_id" --selector "#smoke-title" --format webp --quality 80
run_json diagnostics doctor --session-id "$session_id"

run_json inspect dom-snapshot --session-id "$session_id" --format html --consistency best_effort
run_json inspect dom-snapshot --session-id "$session_id" --format ax --consistency best_effort --interactive --compact --max-nodes 750
run_json inspect dom-snapshot --session-id "$session_id" --format html --consistency best_effort --selector "#smoke-title"
run_json inspect dom-snapshot --session-id "$session_id" --format ax --consistency quiesce --selector "#scroll-area" --max-nodes 1000
run_json inspect dom-diff --session-id "$session_id"
ref=$(run_json inspect find role button --session-id "$session_id" --name "Click Target" | extract_first_ref)
run_json drive click --session-id "$session_id" --tab-id "$tab_id" --locator-ref "$ref"
run_json inspect find text "Smoke Ready" --session-id "$session_id"
run_json inspect find label "Text Input" --session-id "$session_id"
run_json inspect extract-content --session-id "$session_id" --format markdown --include-metadata
run_json inspect extract-content --session-id "$session_id" --format text --no-include-metadata
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
