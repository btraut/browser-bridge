import process from 'node:process';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const cliPath = path.join(repoRoot, 'packages', 'cli', 'dist', 'index.js');
const defaultTimeoutMs = 20000;

const usage = () => {
  console.log(`Usage: npm run dev:loop -- [options]

Rebuild Browser Bridge, use macOS UI scripting to hit Chrome's Extensions
page Update button in your existing Chrome profile, wait for the extension to
reconnect, and optionally request bypass mode for faster local testing.

Options:
  --install               Run npm install before building
  --skip-build            Skip npm run build
  --url <url>             Open this URL in Chrome after the extension reload
  --timeout-ms <ms>       Extension reconnect timeout (default: ${defaultTimeoutMs})
  --no-ensure-bypass      Do not request bypass mode when Chrome is granular
  --open-options          Open the Browser Bridge options page after reload
  --help                  Show this help
`);
};

const parseArgs = (argv) => {
  const options = {
    install: false,
    skipBuild: false,
    url: '',
    timeoutMs: defaultTimeoutMs,
    ensureBypass: true,
    openOptions: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help') {
      usage();
      process.exit(0);
    }
    if (arg === '--install') {
      options.install = true;
      continue;
    }
    if (arg === '--skip-build') {
      options.skipBuild = true;
      continue;
    }
    if (arg === '--no-ensure-bypass') {
      options.ensureBypass = false;
      continue;
    }
    if (arg === '--open-options') {
      options.openOptions = true;
      continue;
    }
    if (arg === '--url') {
      options.url = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg === '--timeout-ms') {
      options.timeoutMs = Number(argv[i + 1]);
      i += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0) {
    throw new Error('--timeout-ms must be a positive number.');
  }

  if (process.platform !== 'darwin') {
    throw new Error(
      'dev:loop currently supports macOS only because it relies on AppleScript UI automation for your existing Chrome.'
    );
  }

  return options;
};

const run = (cmd, args, options = {}) => {
  const result = spawnSync(cmd, args, {
    cwd: repoRoot,
    stdio: 'inherit',
    ...options,
  });
  if (result.status !== 0) {
    throw new Error(
      `${cmd} ${args.join(' ')} failed with status ${result.status ?? 'unknown'}.`
    );
  }
};

const runJson = (cmd, args, options = {}) => {
  const result = spawnSync(cmd, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options,
  });
  if (result.status !== 0) {
    const stderr = result.stderr?.trim();
    throw new Error(
      `${cmd} ${args.join(' ')} failed with status ${result.status ?? 'unknown'}${stderr ? `: ${stderr}` : '.'}`
    );
  }
  return JSON.parse(result.stdout);
};

const runAppleScript = (script) => {
  const result = spawnSync('osascript', ['-'], {
    cwd: repoRoot,
    encoding: 'utf8',
    input: script,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  if (result.status !== 0) {
    const stderr = result.stderr?.trim();
    throw new Error(stderr || 'AppleScript failed.');
  }
  return result.stdout.trim();
};

const appleScriptString = (value) =>
  String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const ensureChromeRunning = () => {
  runAppleScript(`
tell application "Google Chrome"
  activate
  if (count of windows) is 0 then
    make new window
  end if
end tell
`);
};

const reloadInstalledExtension = () => {
  runAppleScript(`
tell application "Google Chrome"
  activate
  tell front window
    make new tab with properties {URL:"chrome://extensions"}
    set active tab index to (count of tabs)
  end tell
end tell

delay 0.6

tell application "System Events"
  tell process "Google Chrome"
    set frontmost to true
    set devModeCheckbox to missing value
    set updateButton to missing value

    repeat 40 times
      set allElems to entire contents of front window
      repeat with elem in allElems
        try
          if class of elem is checkbox and (name of elem as text) is "Developer mode" then
            set devModeCheckbox to elem
          end if
          if class of elem is button and (title of elem as text) is "Update" then
            set updateButton to elem
          end if
        end try
      end repeat
      if devModeCheckbox is not missing value and updateButton is not missing value then
        exit repeat
      end if
      delay 0.2
    end repeat

    if devModeCheckbox is missing value then
      error "Could not find the Developer mode toggle on chrome://extensions."
    end if
    if updateButton is missing value then
      error "Could not find the Update button on chrome://extensions."
    end if

    if value of devModeCheckbox is 0 then
      click devModeCheckbox
      delay 0.2
    end if

    click updateButton
  end tell
end tell

delay 0.5

tell application "Google Chrome"
  tell front window to close active tab
end tell
`);
};

const waitForExtension = async (timeoutMs) => {
  const deadline = Date.now() + timeoutMs;
  let lastMessage = 'Extension is not connected yet.';

  while (Date.now() < deadline) {
    try {
      const envelope = runJson(process.execPath, [
        cliPath,
        'diagnostics',
        'doctor',
        '--json',
      ]);
      const report = envelope?.result;
      const extensionConnected = report?.extension?.connected === true;
      if (extensionConnected) {
        return report;
      }
      const failedCheck = Array.isArray(report?.checks)
        ? report.checks.find((check) => check?.name === 'extension.connected')
        : null;
      if (failedCheck?.message) {
        lastMessage = failedCheck.message;
      }
    } catch (error) {
      if (error instanceof Error) {
        lastMessage = error.message;
      }
    }
    await sleep(500);
  }

  throw new Error(
    `Timed out waiting for the Browser Bridge extension to reconnect. Last status: ${lastMessage}`
  );
};

const readPermissionsMode = () => {
  const envelope = runJson(process.execPath, [
    cliPath,
    'permissions',
    'mode',
    '--json',
  ]);
  return envelope?.result?.mode ?? null;
};

const requestBypassMode = () => {
  console.log('Requesting bypass mode approval in Chrome...');
  const envelope = runJson(process.execPath, [
    cliPath,
    'permissions',
    'set-mode',
    '--mode',
    'bypass',
    '--timeout-ms',
    '30000',
    '--json',
  ]);
  return envelope?.result?.status ?? null;
};

const readExtensionId = () => {
  const envelope = runJson(process.execPath, [
    cliPath,
    'dev',
    'info',
    '--json',
  ]);
  return envelope?.result?.metadataSnapshot?.extension_id ?? null;
};

const openChromeUrl = (target) => {
  runAppleScript(`
tell application "Google Chrome"
  activate
  tell front window
    make new tab with properties {URL:"${appleScriptString(target)}"}
    set active tab index to (count of tabs)
  end tell
end tell
`);
};

const main = async () => {
  const options = parseArgs(process.argv.slice(2));

  ensureChromeRunning();

  if (options.install) {
    run('npm', ['install']);
  }

  if (!options.skipBuild) {
    run('npm', ['run', 'build']);
  }

  reloadInstalledExtension();
  await waitForExtension(options.timeoutMs);

  const mode = readPermissionsMode();
  if (options.ensureBypass && mode !== 'bypass') {
    const status = requestBypassMode();
    if (status !== 'approved') {
      console.log(
        `Bypass mode request finished with status "${status ?? 'unknown'}". Open the options page and flip it manually if Chrome ignored the prompt.`
      );
      options.openOptions = true;
    }
  }

  if (options.openOptions) {
    const extensionId = readExtensionId();
    if (extensionId) {
      openChromeUrl(`chrome-extension://${extensionId}/options.html`);
    } else {
      console.log(
        'Could not resolve the extension id for the options page. Open Browser Bridge options from chrome://extensions if you still need it.'
      );
    }
  }

  if (options.url) {
    openChromeUrl(options.url);
  }

  console.log(`Browser Bridge dev loop is ready.
- Chrome: existing profile
- Reload path: chrome://extensions -> Update
- URL: ${options.url || '(unchanged)'}`);
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
