export type McpToolDefinition = {
  name: string;
  corePath: string;
  deprecation?: DeprecationLifecycle;
};

export type DeprecationLifecycleStage = 'deprecated';

export type DeprecationWarningBehavior = 'warn-on-use';

export type DeprecationLifecycle = {
  stage: DeprecationLifecycleStage;
  deprecated_since: string;
  removal_target: string;
  replacement: string;
  warning_behavior: DeprecationWarningBehavior;
  migration_notes: string;
};

export type DriveNavigateParityCase = {
  caseId: 'explicit_session' | 'missing_session';
  input: {
    session_id?: string;
    url: string;
    wait: 'domcontentloaded';
  };
  successResult: {
    ok: true;
    session_id: string;
  };
};

export const DEPRECATION_POLICY = {
  minimum_notice_days: 90,
  migration_notes_path: 'docs/deprecation-lifecycle-policy.md',
} as const;

export const MCP_TOOL_DEFINITIONS: McpToolDefinition[] = [
  { name: 'session.create', corePath: '/session/create' },
  { name: 'session.status', corePath: '/session/status' },
  { name: 'session.recover', corePath: '/session/recover' },
  { name: 'session.close', corePath: '/session/close' },
  { name: 'drive.navigate', corePath: '/drive/navigate' },
  { name: 'drive.go_back', corePath: '/drive/go_back' },
  { name: 'drive.go_forward', corePath: '/drive/go_forward' },
  {
    name: 'drive.back',
    corePath: '/drive/go_back',
    deprecation: {
      stage: 'deprecated',
      deprecated_since: '2026-02-17',
      removal_target: '2026-06-01',
      replacement: 'drive.go_back',
      warning_behavior: 'warn-on-use',
      migration_notes:
        'docs/deprecation-lifecycle-policy.md#current-deprecations',
    },
  },
  {
    name: 'drive.forward',
    corePath: '/drive/go_forward',
    deprecation: {
      stage: 'deprecated',
      deprecated_since: '2026-02-17',
      removal_target: '2026-06-01',
      replacement: 'drive.go_forward',
      warning_behavior: 'warn-on-use',
      migration_notes:
        'docs/deprecation-lifecycle-policy.md#current-deprecations',
    },
  },
  { name: 'drive.click', corePath: '/drive/click' },
  { name: 'drive.hover', corePath: '/drive/hover' },
  { name: 'drive.select', corePath: '/drive/select' },
  { name: 'drive.type', corePath: '/drive/type' },
  { name: 'drive.fill_form', corePath: '/drive/fill_form' },
  { name: 'drive.drag', corePath: '/drive/drag' },
  { name: 'drive.handle_dialog', corePath: '/drive/handle_dialog' },
  {
    name: 'dialog.accept',
    corePath: '/drive/handle_dialog',
    deprecation: {
      stage: 'deprecated',
      deprecated_since: '2026-02-17',
      removal_target: '2026-06-01',
      replacement: 'drive.handle_dialog',
      warning_behavior: 'warn-on-use',
      migration_notes:
        'docs/deprecation-lifecycle-policy.md#current-deprecations',
    },
  },
  {
    name: 'dialog.dismiss',
    corePath: '/drive/handle_dialog',
    deprecation: {
      stage: 'deprecated',
      deprecated_since: '2026-02-17',
      removal_target: '2026-06-01',
      replacement: 'drive.handle_dialog',
      warning_behavior: 'warn-on-use',
      migration_notes:
        'docs/deprecation-lifecycle-policy.md#current-deprecations',
    },
  },
  { name: 'drive.key', corePath: '/drive/key' },
  { name: 'drive.key_press', corePath: '/drive/key_press' },
  { name: 'drive.scroll', corePath: '/drive/scroll' },
  { name: 'drive.wait_for', corePath: '/drive/wait_for' },
  { name: 'drive.tab_list', corePath: '/drive/tab_list' },
  { name: 'drive.tab_activate', corePath: '/drive/tab_activate' },
  { name: 'drive.tab_close', corePath: '/drive/tab_close' },
  { name: 'inspect.dom_snapshot', corePath: '/inspect/dom_snapshot' },
  { name: 'inspect.dom_diff', corePath: '/inspect/dom_diff' },
  { name: 'inspect.find', corePath: '/inspect/find' },
  { name: 'inspect.extract_content', corePath: '/inspect/extract_content' },
  { name: 'inspect.page_state', corePath: '/inspect/page_state' },
  { name: 'inspect.console_list', corePath: '/inspect/console_list' },
  { name: 'inspect.network_har', corePath: '/inspect/network_har' },
  { name: 'inspect.evaluate', corePath: '/inspect/evaluate' },
  {
    name: 'inspect.performance_metrics',
    corePath: '/inspect/performance_metrics',
  },
  { name: 'artifacts.screenshot', corePath: '/artifacts/screenshot' },
  { name: 'health_check', corePath: '/health/check' },
  { name: 'diagnostics.doctor', corePath: '/diagnostics/doctor' },
];

export const DRIVE_NAVIGATE_PARITY_CASES: DriveNavigateParityCase[] = [
  {
    caseId: 'explicit_session',
    input: {
      session_id: 'session-1',
      url: 'https://example.com',
      wait: 'domcontentloaded',
    },
    successResult: {
      ok: true,
      session_id: 'session-1',
    },
  },
  {
    caseId: 'missing_session',
    input: {
      url: 'https://example.com',
      wait: 'domcontentloaded',
    },
    successResult: {
      ok: true,
      session_id: 'session-auto',
    },
  },
];
