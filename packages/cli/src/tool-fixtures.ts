import { DRIVE_NAVIGATE_PARITY_CASES } from '@btraut/browser-bridge-shared';

export type CliFixtureKind = 'core' | 'local';

export type CliToolFixture = {
  name: string;
  kind: CliFixtureKind;
  argv: string[];
  payload: unknown;
  corePath?: string;
};

export type CliCoverageStatus = 'covered' | 'optional' | 'not_planned';

export type CliCoverageRow = {
  name: string;
  fixture: CliCoverageStatus;
  contract: CliCoverageStatus;
  unit: CliCoverageStatus;
  integration: CliCoverageStatus;
  e2e: CliCoverageStatus;
};

export type CliDriveNavigateParityFixture = {
  caseId: 'explicit_session' | 'missing_session';
  argv: string[];
  payload: unknown;
  successResult: {
    ok: true;
    session_id: string;
  };
};

export const CLI_TOOL_FIXTURES: CliToolFixture[] = [
  {
    name: 'session.create',
    kind: 'core',
    corePath: '/session/create',
    argv: ['session', 'create'],
    payload: {},
  },
  {
    name: 'session.status',
    kind: 'core',
    corePath: '/session/status',
    argv: ['session', 'status', '--session-id', 'session-1'],
    payload: { session_id: 'session-1' },
  },
  {
    name: 'session.recover',
    kind: 'core',
    corePath: '/session/recover',
    argv: ['session', 'recover', '--session-id', 'session-1'],
    payload: { session_id: 'session-1' },
  },
  {
    name: 'session.close',
    kind: 'core',
    corePath: '/session/close',
    argv: ['session', 'close', '--session-id', 'session-1'],
    payload: { session_id: 'session-1' },
  },
  {
    name: 'drive.navigate',
    kind: 'core',
    corePath: '/drive/navigate',
    argv: [
      'drive',
      'navigate',
      '--session-id',
      'session-1',
      '--url',
      'https://example.com',
      '--wait',
      'domcontentloaded',
    ],
    payload: {
      session_id: 'session-1',
      url: 'https://example.com',
      wait: 'domcontentloaded',
    },
  },
  {
    name: 'drive.go_back',
    kind: 'core',
    corePath: '/drive/go_back',
    argv: ['drive', 'go-back', '--session-id', 'session-1', '--tab-id', '2'],
    payload: { session_id: 'session-1', tab_id: 2 },
  },
  {
    name: 'drive.go_forward',
    kind: 'core',
    corePath: '/drive/go_forward',
    argv: ['drive', 'go-forward', '--session-id', 'session-1', '--tab-id', '2'],
    payload: { session_id: 'session-1', tab_id: 2 },
  },
  {
    name: 'drive.back',
    kind: 'core',
    corePath: '/drive/back',
    argv: ['drive', 'back', '--session-id', 'session-1', '--tab-id', '2'],
    payload: { session_id: 'session-1', tab_id: 2 },
  },
  {
    name: 'drive.forward',
    kind: 'core',
    corePath: '/drive/forward',
    argv: ['drive', 'forward', '--session-id', 'session-1', '--tab-id', '2'],
    payload: { session_id: 'session-1', tab_id: 2 },
  },
  {
    name: 'drive.click',
    kind: 'core',
    corePath: '/drive/click',
    argv: [
      'drive',
      'click',
      '--session-id',
      'session-1',
      '--locator-css',
      'button',
    ],
    payload: {
      session_id: 'session-1',
      locator: { css: 'button' },
    },
  },
  {
    name: 'drive.hover',
    kind: 'core',
    corePath: '/drive/hover',
    argv: [
      'drive',
      'hover',
      '--session-id',
      'session-1',
      '--locator-css',
      'button',
      '--delay-ms',
      '150',
    ],
    payload: {
      session_id: 'session-1',
      locator: { css: 'button' },
      delay_ms: 150,
    },
  },
  {
    name: 'drive.select',
    kind: 'core',
    corePath: '/drive/select',
    argv: [
      'drive',
      'select',
      '--session-id',
      'session-1',
      '--locator-css',
      'select',
      '--value',
      'option-1',
    ],
    payload: {
      session_id: 'session-1',
      locator: { css: 'select' },
      value: 'option-1',
    },
  },
  {
    name: 'drive.type',
    kind: 'core',
    corePath: '/drive/type',
    argv: [
      'drive',
      'type',
      '--session-id',
      'session-1',
      '--locator-css',
      'input',
      '--text',
      'hello',
      '--clear',
      '--submit',
    ],
    payload: {
      session_id: 'session-1',
      locator: { css: 'input' },
      text: 'hello',
      clear: true,
      submit: true,
    },
  },
  {
    name: 'drive.fill_form',
    kind: 'core',
    corePath: '/drive/fill_form',
    argv: [
      'drive',
      'fill-form',
      '--session-id',
      'session-1',
      '--fields',
      '[{"selector":"input[name=email]","value":"test@example.com"}]',
      '--tab-id',
      '1',
    ],
    payload: {
      session_id: 'session-1',
      fields: [
        {
          selector: 'input[name=email]',
          value: 'test@example.com',
          type: 'auto',
          submit: false,
        },
      ],
      tab_id: 1,
    },
  },
  {
    name: 'drive.drag',
    kind: 'core',
    corePath: '/drive/drag',
    argv: [
      'drive',
      'drag',
      '--session-id',
      'session-1',
      '--from-locator-css',
      '.source',
      '--to-locator-css',
      '.target',
      '--steps',
      '3',
      '--tab-id',
      '1',
    ],
    payload: {
      session_id: 'session-1',
      from: { css: '.source' },
      to: { css: '.target' },
      steps: 3,
      tab_id: 1,
    },
  },
  {
    name: 'drive.handle_dialog',
    kind: 'core',
    corePath: '/drive/handle_dialog',
    argv: [
      'drive',
      'handle-dialog',
      '--session-id',
      'session-1',
      '--action',
      'accept',
      '--prompt-text',
      'Hello',
      '--tab-id',
      '4',
    ],
    payload: {
      session_id: 'session-1',
      action: 'accept',
      promptText: 'Hello',
      tab_id: 4,
    },
  },
  {
    name: 'dialog.accept',
    kind: 'core',
    corePath: '/dialog/accept',
    argv: [
      'dialog',
      'accept',
      '--session-id',
      'session-1',
      '--prompt-text',
      'Sure',
      '--tab-id',
      '2',
    ],
    payload: {
      session_id: 'session-1',
      promptText: 'Sure',
      tab_id: 2,
    },
  },
  {
    name: 'dialog.dismiss',
    kind: 'core',
    corePath: '/dialog/dismiss',
    argv: ['dialog', 'dismiss', '--session-id', 'session-1', '--tab-id', '2'],
    payload: {
      session_id: 'session-1',
      tab_id: 2,
    },
  },
  {
    name: 'drive.key',
    kind: 'core',
    corePath: '/drive/key',
    argv: [
      'drive',
      'key',
      '--session-id',
      'session-1',
      '--key',
      'Enter',
      '--modifier',
      'ctrl',
      '--modifier',
      'shift',
      '--repeat',
      '2',
      '--tab-id',
      '1',
    ],
    payload: {
      session_id: 'session-1',
      key: 'Enter',
      modifiers: ['ctrl', 'shift'],
      repeat: 2,
      tab_id: 1,
    },
  },
  {
    name: 'drive.key_press',
    kind: 'core',
    corePath: '/drive/key_press',
    argv: [
      'drive',
      'key-press',
      '--session-id',
      'session-1',
      '--key',
      'Enter',
      '--ctrl',
      '--shift',
      '--tab-id',
      '2',
    ],
    payload: {
      session_id: 'session-1',
      key: 'Enter',
      modifiers: {
        ctrl: true,
        alt: false,
        shift: true,
        meta: false,
      },
      tab_id: 2,
    },
  },
  {
    name: 'drive.scroll',
    kind: 'core',
    corePath: '/drive/scroll',
    argv: [
      'drive',
      'scroll',
      '--session-id',
      'session-1',
      '--delta-x',
      '10',
      '--delta-y',
      '20',
      '--top',
      '5',
      '--left',
      '7',
      '--behavior',
      'smooth',
      '--tab-id',
      '1',
    ],
    payload: {
      session_id: 'session-1',
      delta_x: 10,
      delta_y: 20,
      top: 5,
      left: 7,
      behavior: 'smooth',
      tab_id: 1,
    },
  },
  {
    name: 'drive.wait_for',
    kind: 'core',
    corePath: '/drive/wait_for',
    argv: [
      'drive',
      'wait-for',
      '--session-id',
      'session-1',
      '--kind',
      'text_present',
      '--value',
      'Hello',
      '--timeout-ms',
      '3000',
    ],
    payload: {
      session_id: 'session-1',
      condition: {
        kind: 'text_present',
        value: 'Hello',
      },
      timeout_ms: 3000,
    },
  },
  {
    name: 'drive.tab_list',
    kind: 'core',
    corePath: '/drive/tab_list',
    argv: ['drive', 'tab-list', '--session-id', 'session-1'],
    payload: { session_id: 'session-1' },
  },
  {
    name: 'drive.tab_activate',
    kind: 'core',
    corePath: '/drive/tab_activate',
    argv: [
      'drive',
      'tab-activate',
      '--session-id',
      'session-1',
      '--tab-id',
      '3',
    ],
    payload: { session_id: 'session-1', tab_id: 3 },
  },
  {
    name: 'drive.tab_close',
    kind: 'core',
    corePath: '/drive/tab_close',
    argv: ['drive', 'tab-close', '--session-id', 'session-1', '--tab-id', '3'],
    payload: { session_id: 'session-1', tab_id: 3 },
  },
  {
    name: 'inspect.dom_snapshot',
    kind: 'core',
    corePath: '/inspect/dom_snapshot',
    argv: [
      'inspect',
      'dom-snapshot',
      '--session-id',
      'session-1',
      '--format',
      'html',
      '--consistency',
      'quiesce',
      '--interactive',
      '--compact',
      '--selector',
      '#main',
    ],
    payload: {
      session_id: 'session-1',
      format: 'html',
      consistency: 'quiesce',
      interactive: true,
      compact: true,
      selector: '#main',
    },
  },
  {
    name: 'inspect.dom_diff',
    kind: 'core',
    corePath: '/inspect/dom_diff',
    argv: ['inspect', 'dom-diff', '--session-id', 'session-1'],
    payload: { session_id: 'session-1' },
  },
  {
    name: 'inspect.find',
    kind: 'core',
    corePath: '/inspect/find',
    argv: [
      'inspect',
      'find',
      'role',
      'button',
      '--session-id',
      'session-1',
      '--name',
      'Submit',
    ],
    payload: {
      session_id: 'session-1',
      kind: 'role',
      role: 'button',
      name: 'Submit',
    },
  },
  {
    name: 'inspect.extract_content',
    kind: 'core',
    corePath: '/inspect/extract_content',
    argv: [
      'inspect',
      'extract-content',
      '--session-id',
      'session-1',
      '--format',
      'markdown',
      '--include-metadata',
    ],
    payload: {
      session_id: 'session-1',
      format: 'markdown',
      include_metadata: true,
    },
  },
  {
    name: 'inspect.page_state',
    kind: 'core',
    corePath: '/inspect/page_state',
    argv: ['inspect', 'page-state', '--session-id', 'session-1'],
    payload: { session_id: 'session-1' },
  },
  {
    name: 'inspect.console_list',
    kind: 'core',
    corePath: '/inspect/console_list',
    argv: ['inspect', 'console-list', '--session-id', 'session-1'],
    payload: { session_id: 'session-1' },
  },
  {
    name: 'inspect.network_har',
    kind: 'core',
    corePath: '/inspect/network_har',
    argv: ['inspect', 'network-har', '--session-id', 'session-1'],
    payload: { session_id: 'session-1' },
  },
  {
    name: 'inspect.evaluate',
    kind: 'core',
    corePath: '/inspect/evaluate',
    argv: [
      'inspect',
      'evaluate',
      '--session-id',
      'session-1',
      '--expression',
      '2 + 2',
    ],
    payload: { session_id: 'session-1', expression: '2 + 2' },
  },
  {
    name: 'inspect.performance_metrics',
    kind: 'core',
    corePath: '/inspect/performance_metrics',
    argv: ['inspect', 'performance-metrics', '--session-id', 'session-1'],
    payload: { session_id: 'session-1' },
  },
  {
    name: 'artifacts.screenshot',
    kind: 'core',
    corePath: '/artifacts/screenshot',
    argv: [
      'artifacts',
      'screenshot',
      '--session-id',
      'session-1',
      '--target',
      'full',
      '--full-page',
      '--format',
      'jpeg',
      '--quality',
      '80',
    ],
    payload: {
      session_id: 'session-1',
      target: 'full',
      fullPage: true,
      format: 'jpeg',
      quality: 80,
    },
  },
  {
    name: 'health_check',
    kind: 'core',
    corePath: '/health_check',
    argv: ['diagnostics', 'health-check'],
    payload: {},
  },
  {
    name: 'diagnostics.doctor',
    kind: 'core',
    corePath: '/diagnostics/doctor',
    argv: ['diagnostics', 'doctor', '--session-id', 'session-1'],
    payload: {
      session_id: 'session-1',
      caller: {
        endpoint: {
          host: '127.0.0.1',
          port: 3210,
          base_url: 'http://127.0.0.1:3210',
          host_source: 'default',
          port_source: 'default',
        },
        process: {
          component: 'cli',
        },
      },
    },
  },
  {
    name: 'open-artifacts',
    kind: 'local',
    argv: ['open-artifacts', '--session-id', 'session-1'],
    payload: { session_id: 'session-1' },
  },
];

export const CLI_DRIVE_NAVIGATE_PARITY_FIXTURES: CliDriveNavigateParityFixture[] =
  DRIVE_NAVIGATE_PARITY_CASES.map((parityCase) => ({
    caseId: parityCase.caseId,
    argv: [
      'drive',
      'navigate',
      ...(parityCase.input.session_id
        ? ['--session-id', parityCase.input.session_id]
        : []),
      '--url',
      parityCase.input.url,
      '--wait',
      parityCase.input.wait,
    ],
    payload: parityCase.input,
    successResult: parityCase.successResult,
  }));

export const CLI_TOOL_COVERAGE_MATRIX: CliCoverageRow[] = CLI_TOOL_FIXTURES.map(
  (fixture) => ({
    name: fixture.name,
    fixture: 'covered',
    contract: 'covered',
    unit: 'covered',
    integration: fixture.kind === 'core' ? 'covered' : 'not_planned',
    e2e: fixture.kind === 'local' ? 'optional' : 'optional',
  })
);
