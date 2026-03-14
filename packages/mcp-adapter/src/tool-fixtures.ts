import {
  DRIVE_NAVIGATE_PARITY_CASES,
  type ApiEnvelope,
  type ErrorEnvelope,
} from '@btraut/browser-bridge-shared';

export type ToolFixture = {
  name: string;
  corePath: string;
  input: unknown;
  successEnvelope: ApiEnvelope<unknown>;
  errorEnvelope?: ErrorEnvelope;
};

export type ToolCoverageStatus = 'covered' | 'optional' | 'not_planned';

export type ToolCoverageRow = {
  name: string;
  fixture: ToolCoverageStatus;
  contract: ToolCoverageStatus;
  wiring: ToolCoverageStatus;
  integration: ToolCoverageStatus;
  e2e: ToolCoverageStatus;
};

export type DriveNavigateParityFixture = {
  caseId: 'explicit_session' | 'missing_session';
  input: unknown;
  successEnvelope: ApiEnvelope<unknown>;
};

export const MCP_TOOL_FIXTURES: ToolFixture[] = [
  {
    name: 'session.create',
    corePath: '/session/create',
    input: {},
    successEnvelope: {
      ok: true,
      result: {
        session_id: 'session-1',
        state: 'READY',
      },
    },
  },
  {
    name: 'session.status',
    corePath: '/session/status',
    input: { session_id: 'session-1' },
    successEnvelope: {
      ok: true,
      result: {
        session_id: 'session-1',
        state: 'READY',
      },
    },
  },
  {
    name: 'session.recover',
    corePath: '/session/recover',
    input: { session_id: 'session-1' },
    successEnvelope: {
      ok: true,
      result: {
        session_id: 'session-1',
        recovered: true,
        state: 'READY',
      },
    },
  },
  {
    name: 'session.close',
    corePath: '/session/close',
    input: { session_id: 'session-1' },
    successEnvelope: {
      ok: true,
      result: {
        ok: true,
      },
    },
  },
  {
    name: 'permissions.list',
    corePath: '/permissions/list',
    input: {},
    successEnvelope: {
      ok: true,
      result: {
        sites: [
          {
            site: 'example.com',
            created_at: '2026-03-13T00:00:00.000Z',
            last_used_at: '2026-03-13T01:00:00.000Z',
          },
        ],
      },
    },
  },
  {
    name: 'permissions.get_mode',
    corePath: '/permissions/get_mode',
    input: {},
    successEnvelope: {
      ok: true,
      result: {
        mode: 'granular',
      },
    },
  },
  {
    name: 'permissions.list_pending_requests',
    corePath: '/permissions/list_pending_requests',
    input: {},
    successEnvelope: {
      ok: true,
      result: {
        requests: [
          {
            request_id: 'perm-1',
            kind: 'allow_site',
            status: 'pending',
            requested_at: '2026-03-13T00:00:00.000Z',
            site: 'example.com',
            source: 'mcp',
          },
        ],
      },
    },
  },
  {
    name: 'permissions.request_allow_site',
    corePath: '/permissions/request_allow_site',
    input: {
      site: 'example.com',
      timeout_ms: 30000,
      source: 'mcp',
    },
    successEnvelope: {
      ok: true,
      result: {
        request_id: 'perm-1',
        kind: 'allow_site',
        status: 'approved',
        requested_at: '2026-03-13T00:00:00.000Z',
        site: 'example.com',
        source: 'mcp',
        message: 'Allow Browser Bridge actions on example.com.',
      },
    },
  },
  {
    name: 'permissions.request_revoke_site',
    corePath: '/permissions/request_revoke_site',
    input: {
      site: 'example.com',
      timeout_ms: 30000,
      source: 'mcp',
    },
    successEnvelope: {
      ok: true,
      result: {
        request_id: 'perm-2',
        kind: 'revoke_site',
        status: 'denied',
        requested_at: '2026-03-13T00:00:00.000Z',
        site: 'example.com',
        source: 'mcp',
        message: 'Permission change request was denied.',
      },
    },
  },
  {
    name: 'permissions.request_set_mode',
    corePath: '/permissions/request_set_mode',
    input: {
      mode: 'bypass',
      timeout_ms: 30000,
      source: 'mcp',
    },
    successEnvelope: {
      ok: true,
      result: {
        request_id: 'perm-3',
        kind: 'set_mode',
        status: 'timed_out',
        requested_at: '2026-03-13T00:00:00.000Z',
        mode: 'bypass',
        source: 'mcp',
        warning:
          'Bypass mode lets the agent act on any website without asking first.',
        message: 'Permission change request timed out waiting for approval.',
      },
    },
  },
  {
    name: 'drive.navigate',
    corePath: '/drive/navigate',
    input: {
      session_id: 'session-1',
      url: 'https://example.com',
      wait: 'domcontentloaded',
    },
    successEnvelope: {
      ok: true,
      result: {
        ok: true,
        session_id: 'session-1',
      },
    },
  },
  {
    name: 'drive.go_back',
    corePath: '/drive/go_back',
    input: { session_id: 'session-1' },
    successEnvelope: {
      ok: true,
      result: {
        ok: true,
      },
    },
  },
  {
    name: 'drive.go_forward',
    corePath: '/drive/go_forward',
    input: { session_id: 'session-1' },
    successEnvelope: {
      ok: true,
      result: {
        ok: true,
      },
    },
  },
  {
    name: 'drive.back',
    corePath: '/drive/go_back',
    input: { session_id: 'session-1' },
    successEnvelope: {
      ok: true,
      result: {
        ok: true,
        warnings: ['drive.back is deprecated; use drive.go_back.'],
      },
    },
  },
  {
    name: 'drive.forward',
    corePath: '/drive/go_forward',
    input: { session_id: 'session-1' },
    successEnvelope: {
      ok: true,
      result: {
        ok: true,
        warnings: ['drive.forward is deprecated; use drive.go_forward.'],
      },
    },
  },
  {
    name: 'drive.click',
    corePath: '/drive/click',
    input: {
      session_id: 'session-1',
      locator: { css: 'button' },
    },
    successEnvelope: {
      ok: true,
      result: {
        ok: true,
      },
    },
  },
  {
    name: 'drive.hover',
    corePath: '/drive/hover',
    input: {
      session_id: 'session-1',
      locator: { css: 'button' },
    },
    successEnvelope: {
      ok: true,
      result: {
        format: 'html',
        snapshot: '<button>Example</button>',
      },
    },
  },
  {
    name: 'drive.select',
    corePath: '/drive/select',
    input: {
      session_id: 'session-1',
      locator: { css: 'select' },
      value: 'option-1',
    },
    successEnvelope: {
      ok: true,
      result: {
        ok: true,
      },
    },
  },
  {
    name: 'drive.type',
    corePath: '/drive/type',
    input: {
      session_id: 'session-1',
      text: 'hello',
    },
    successEnvelope: {
      ok: true,
      result: {
        ok: true,
      },
    },
  },
  {
    name: 'drive.fill_form',
    corePath: '/drive/fill_form',
    input: {
      session_id: 'session-1',
      fields: [
        {
          selector: 'input[name=email]',
          value: 'test@example.com',
        },
      ],
    },
    successEnvelope: {
      ok: true,
      result: {
        filled: 1,
        attempted: 1,
      },
    },
  },
  {
    name: 'drive.drag',
    corePath: '/drive/drag',
    input: {
      session_id: 'session-1',
      from: { css: '#source' },
      to: { css: '#target' },
      steps: 10,
    },
    successEnvelope: {
      ok: true,
      result: {
        ok: true,
      },
    },
  },
  {
    name: 'drive.handle_dialog',
    corePath: '/drive/handle_dialog',
    input: {
      session_id: 'session-1',
      action: 'accept',
    },
    successEnvelope: {
      ok: true,
      result: {
        ok: true,
      },
    },
  },
  {
    name: 'dialog.accept',
    corePath: '/drive/handle_dialog',
    input: {
      session_id: 'session-1',
      action: 'accept',
      promptText: 'confirm',
    },
    successEnvelope: {
      ok: true,
      result: {
        ok: true,
        warnings: ['dialog.accept is deprecated; use drive.handle_dialog.'],
      },
    },
  },
  {
    name: 'dialog.dismiss',
    corePath: '/drive/handle_dialog',
    input: {
      session_id: 'session-1',
      action: 'dismiss',
    },
    successEnvelope: {
      ok: true,
      result: {
        ok: true,
        warnings: ['dialog.dismiss is deprecated; use drive.handle_dialog.'],
      },
    },
  },
  {
    name: 'drive.key',
    corePath: '/drive/key',
    input: {
      session_id: 'session-1',
      key: 'Enter',
      modifiers: ['ctrl'],
    },
    successEnvelope: {
      ok: true,
      result: {
        ok: true,
      },
    },
  },
  {
    name: 'drive.key_press',
    corePath: '/drive/key_press',
    input: {
      session_id: 'session-1',
      key: 'Enter',
      modifiers: {
        ctrl: true,
      },
    },
    successEnvelope: {
      ok: true,
      result: {
        ok: true,
      },
    },
  },
  {
    name: 'drive.scroll',
    corePath: '/drive/scroll',
    input: {
      session_id: 'session-1',
      delta_y: 120,
    },
    successEnvelope: {
      ok: true,
      result: {
        ok: true,
      },
    },
  },
  {
    name: 'drive.wait_for',
    corePath: '/drive/wait_for',
    input: {
      session_id: 'session-1',
      condition: {
        kind: 'url_matches',
        value: 'example.com',
      },
    },
    successEnvelope: {
      ok: true,
      result: {
        ok: true,
      },
    },
  },
  {
    name: 'drive.tab_list',
    corePath: '/drive/tab_list',
    input: { session_id: 'session-1' },
    successEnvelope: {
      ok: true,
      result: {
        tabs: [
          {
            tab_id: 1,
            window_id: 1,
            url: 'https://example.com',
            title: 'Example Domain',
            active: true,
          },
        ],
      },
    },
  },
  {
    name: 'drive.tab_activate',
    corePath: '/drive/tab_activate',
    input: {
      session_id: 'session-1',
      tab_id: 1,
    },
    successEnvelope: {
      ok: true,
      result: {
        ok: true,
      },
    },
  },
  {
    name: 'drive.tab_close',
    corePath: '/drive/tab_close',
    input: {
      session_id: 'session-1',
      tab_id: 1,
    },
    successEnvelope: {
      ok: true,
      result: {
        ok: true,
      },
    },
  },
  {
    name: 'inspect.dom_snapshot',
    corePath: '/inspect/dom_snapshot',
    input: {
      session_id: 'session-1',
      format: 'ax',
      consistency: 'best_effort',
    },
    successEnvelope: {
      ok: true,
      result: {
        format: 'ax',
        snapshot: {},
      },
    },
  },
  {
    name: 'inspect.dom_diff',
    corePath: '/inspect/dom_diff',
    input: { session_id: 'session-1' },
    successEnvelope: {
      ok: true,
      result: {
        added: ['div#new'],
        removed: [],
        changed: ['span.title'],
        summary: 'Added 1, removed 0, changed 1.',
      },
    },
  },
  {
    name: 'inspect.find',
    corePath: '/inspect/find',
    input: {
      session_id: 'session-1',
      kind: 'role',
      role: 'button',
      name: 'Submit',
    },
    successEnvelope: {
      ok: true,
      result: {
        matches: [{ ref: '@e1', role: 'button', name: 'Submit' }],
      },
    },
  },
  {
    name: 'inspect.extract_content',
    corePath: '/inspect/extract_content',
    input: { session_id: 'session-1', format: 'markdown' },
    successEnvelope: {
      ok: true,
      result: {
        content: '# Example',
        title: 'Example',
        excerpt: 'Example excerpt.',
      },
    },
  },
  {
    name: 'inspect.page_state',
    corePath: '/inspect/page_state',
    input: { session_id: 'session-1' },
    successEnvelope: {
      ok: true,
      result: {
        forms: [],
        localStorage: [],
        sessionStorage: [],
        cookies: [],
      },
    },
  },
  {
    name: 'inspect.console_list',
    corePath: '/inspect/console_list',
    input: { session_id: 'session-1' },
    successEnvelope: {
      ok: true,
      result: {
        entries: [],
      },
    },
  },
  {
    name: 'inspect.network_har',
    corePath: '/inspect/network_har',
    input: { session_id: 'session-1' },
    successEnvelope: {
      ok: true,
      result: {
        artifact_id: 'artifact-1',
        path: '/tmp/network.har',
        mime: 'application/json',
      },
    },
  },
  {
    name: 'inspect.evaluate',
    corePath: '/inspect/evaluate',
    input: {
      session_id: 'session-1',
      expression: '1 + 1',
    },
    successEnvelope: {
      ok: true,
      result: {
        value: 2,
      },
    },
  },
  {
    name: 'inspect.performance_metrics',
    corePath: '/inspect/performance_metrics',
    input: { session_id: 'session-1' },
    successEnvelope: {
      ok: true,
      result: {
        metrics: [
          {
            name: 'FirstContentfulPaint',
            value: 123.4,
          },
        ],
      },
    },
  },
  {
    name: 'artifacts.screenshot',
    corePath: '/artifacts/screenshot',
    input: {
      session_id: 'session-1',
      target: 'viewport',
    },
    successEnvelope: {
      ok: true,
      result: {
        artifact_id: 'artifact-1',
        path: '/tmp/screenshot.png',
        mime: 'image/png',
      },
    },
  },
  {
    name: 'health_check',
    corePath: '/health/check',
    input: {},
    successEnvelope: {
      ok: true,
      result: {
        started_at: '2026-02-07T00:00:00.000Z',
        uptime_ms: 1234,
        memory: {
          rss: 1000000,
          heapTotal: 2000000,
          heapUsed: 1500000,
          external: 500000,
          arrayBuffers: 0,
        },
        sessions: {
          active: 1,
        },
        extension: {
          connected: true,
          last_seen_at: '2026-02-07T00:00:00.000Z',
        },
      },
    },
  },
  {
    name: 'diagnostics.doctor',
    corePath: '/diagnostics/doctor',
    input: { session_id: 'session-1' },
    successEnvelope: {
      ok: true,
      result: {
        ok: true,
        session_id: 'session-1',
        checks: [
          {
            name: 'extension',
            ok: true,
          },
        ],
      },
    },
  },
];

export const MCP_TOOL_COVERAGE_MATRIX: ToolCoverageRow[] =
  MCP_TOOL_FIXTURES.map((fixture) => ({
    name: fixture.name,
    fixture: 'covered',
    contract: 'covered',
    wiring: 'covered',
    integration: 'covered',
    e2e: 'optional',
  }));

export const MCP_DRIVE_NAVIGATE_PARITY_FIXTURES: DriveNavigateParityFixture[] =
  DRIVE_NAVIGATE_PARITY_CASES.map((parityCase) => ({
    caseId: parityCase.caseId,
    input: parityCase.input,
    successEnvelope: {
      ok: true,
      result: parityCase.successResult,
    },
  }));
