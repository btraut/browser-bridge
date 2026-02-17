import { describe, expect, it } from 'vitest';
import { ErrorEnvelopeSchema } from './errors';
import {
  ArtifactsScreenshotInputSchema,
  DiagnosticsDoctorInputSchema,
  DiagnosticReportSchema,
  DialogAcceptInputSchema,
  DialogDismissInputSchema,
  HealthCheckInputSchema,
  HealthCheckOutputSchema,
  DriveClickInputSchema,
  DriveDragInputSchema,
  DriveFillFormInputSchema,
  DriveBackInputSchema,
  DriveForwardInputSchema,
  DriveGoBackInputSchema,
  DriveGoForwardInputSchema,
  DriveHandleDialogInputSchema,
  DriveHoverInputSchema,
  DriveSelectInputSchema,
  DriveKeyInputSchema,
  DriveKeyPressInputSchema,
  DriveNavigateInputSchema,
  DriveNavigateOutputSchema,
  DriveScrollInputSchema,
  DriveTypeInputSchema,
  DriveWaitForInputSchema,
  InspectConsoleListInputSchema,
  InspectDomDiffInputSchema,
  InspectDomSnapshotInputSchema,
  InspectDomDiffOutputSchema,
  InspectExtractContentInputSchema,
  InspectEvaluateInputSchema,
  InspectFindInputSchema,
  InspectPageStateInputSchema,
  LocatorSchema,
  OpResultSchema,
  SessionCreateInputSchema,
  SessionStatusSchema,
} from './schemas';

describe('shared schemas', () => {
  it('requires a locator selector', () => {
    expect(() => LocatorSchema.parse({})).toThrow();
    expect(LocatorSchema.parse({ testid: 'submit' }).testid).toBe('submit');
  });

  it('parses an op result', () => {
    expect(OpResultSchema.parse({ ok: true }).ok).toBe(true);
  });

  it('parses session create with no input', () => {
    const parsed = SessionCreateInputSchema.parse({});
    expect(parsed).toEqual({});
  });

  it('parses drive navigate defaults', () => {
    const parsed = DriveNavigateInputSchema.parse({
      url: 'https://example.com',
    });
    expect(parsed.session_id).toBeUndefined();
    expect(parsed.wait).toBe('domcontentloaded');
  });

  it('parses drive navigate output with canonical session_id', () => {
    const parsed = DriveNavigateOutputSchema.parse({
      ok: true,
      session_id: 'session-1',
    });
    expect(parsed.session_id).toBe('session-1');
  });

  it('accepts tab_id on drive requests', () => {
    expect(
      DriveNavigateInputSchema.parse({
        session_id: 'session-1',
        url: 'https://example.com',
        tab_id: 5,
      }).tab_id
    ).toBe(5);
    expect(
      DriveClickInputSchema.parse({
        session_id: 'session-1',
        locator: { css: '.cta' },
        tab_id: 2,
      }).tab_id
    ).toBe(2);
    expect(
      DriveTypeInputSchema.parse({
        session_id: 'session-1',
        text: 'hello',
        tab_id: 3,
      }).tab_id
    ).toBe(3);
    expect(
      DriveWaitForInputSchema.parse({
        session_id: 'session-1',
        condition: { kind: 'text_present', value: 'ready' },
        tab_id: 9,
      }).tab_id
    ).toBe(9);
    expect(
      DriveGoBackInputSchema.parse({
        session_id: 'session-1',
        tab_id: 4,
      }).tab_id
    ).toBe(4);
    expect(
      DriveGoForwardInputSchema.parse({
        session_id: 'session-1',
        tab_id: 8,
      }).tab_id
    ).toBe(8);
    expect(
      DriveBackInputSchema.parse({
        session_id: 'session-1',
        tab_id: 6,
      }).tab_id
    ).toBe(6);
    expect(
      DriveForwardInputSchema.parse({
        session_id: 'session-1',
        tab_id: 7,
      }).tab_id
    ).toBe(7);
  });

  it('parses drive scroll input', () => {
    const parsed = DriveScrollInputSchema.parse({
      session_id: 'session-1',
      delta_y: 120,
    });
    expect(parsed.delta_y).toBe(120);
  });

  it('parses fill form input', () => {
    const parsed = DriveFillFormInputSchema.parse({
      session_id: 'session-1',
      fields: [
        { selector: '#email', value: 'test@example.com' },
        { selector: '#terms', value: true, type: 'checkbox' },
      ],
    });
    expect(parsed.fields).toHaveLength(2);
  });

  it('parses drive drag input', () => {
    const parsed = DriveDragInputSchema.parse({
      session_id: 'session-1',
      from: { css: '.drag-source' },
      to: { css: '.drop-target' },
    });
    expect(parsed.steps).toBe(12);
  });

  it('parses handle dialog input', () => {
    const parsed = DriveHandleDialogInputSchema.parse({
      session_id: 'session-1',
      action: 'accept',
      promptText: 'ok',
    });
    expect(parsed.action).toBe('accept');
  });

  it('parses dialog accept input', () => {
    const parsed = DialogAcceptInputSchema.parse({
      session_id: 'session-1',
      promptText: 'hello',
    });
    expect(parsed.promptText).toBe('hello');
  });

  it('parses dialog dismiss input', () => {
    const parsed = DialogDismissInputSchema.parse({
      session_id: 'session-1',
      tab_id: 2,
    });
    expect(parsed.tab_id).toBe(2);
  });

  it('parses locator ref input', () => {
    const parsed = DriveClickInputSchema.parse({
      session_id: 'session-1',
      locator: { ref: '@e1' },
    });
    expect(parsed.locator.ref).toBe('@e1');
  });

  it('parses hover input', () => {
    const parsed = DriveHoverInputSchema.parse({
      session_id: 'session-1',
      locator: { css: '.card' },
      delay_ms: 100,
    });
    expect(parsed.delay_ms).toBe(100);
  });

  it('parses select input', () => {
    const parsed = DriveSelectInputSchema.parse({
      session_id: 'session-1',
      locator: { css: 'select#size' },
      value: 'large',
    });
    expect(parsed.value).toBe('large');
  });

  it('parses key press input', () => {
    const parsed = DriveKeyPressInputSchema.parse({
      session_id: 'session-1',
      key: 'Enter',
      modifiers: { ctrl: true },
    });
    expect(parsed.key).toBe('Enter');
  });

  it('parses key input', () => {
    const parsed = DriveKeyInputSchema.parse({
      session_id: 'session-1',
      key: 'Escape',
      modifiers: ['ctrl', 'shift'],
      repeat: 2,
    });
    expect(parsed.repeat).toBe(2);
  });

  it('requires a scroll delta or position', () => {
    expect(() =>
      DriveScrollInputSchema.parse({
        session_id: 'session-1',
      })
    ).toThrow();
  });

  it('parses inspect dom snapshot defaults', () => {
    const parsed = InspectDomSnapshotInputSchema.parse({
      session_id: 'session-1',
    });
    expect(parsed.format).toBe('ax');
    expect(parsed.consistency).toBe('best_effort');
    expect(parsed.interactive).toBe(false);
    expect(parsed.compact).toBe(false);
  });

  it('parses dom snapshot selector', () => {
    const parsed = InspectDomSnapshotInputSchema.parse({
      session_id: 'session-1',
      selector: '#main-content',
    });
    expect(parsed.selector).toBe('#main-content');
  });

  it('parses dom snapshot max_nodes', () => {
    const parsed = InspectDomSnapshotInputSchema.parse({
      session_id: 'session-1',
      max_nodes: '123',
    });
    expect(parsed.max_nodes).toBe(123);

    expect(() =>
      InspectDomSnapshotInputSchema.parse({
        session_id: 'session-1',
        max_nodes: '0',
      })
    ).toThrow();

    expect(() =>
      InspectDomSnapshotInputSchema.parse({
        session_id: 'session-1',
        max_nodes: '50001',
      })
    ).toThrow();
  });

  it('parses inspect find role input', () => {
    const parsed = InspectFindInputSchema.parse({
      session_id: 'session-1',
      kind: 'role',
      role: 'button',
      name: 'Submit',
    });
    expect(parsed.kind).toBe('role');
    if (parsed.kind !== 'role') {
      throw new Error('Expected role kind');
    }
    expect(parsed.role).toBe('button');
  });

  it('parses dom diff schemas', () => {
    const input = InspectDomDiffInputSchema.parse({ session_id: 'session-1' });
    expect(input.session_id).toBe('session-1');
    const output = InspectDomDiffOutputSchema.parse({
      added: ['div#new'],
      removed: [],
      changed: ['span.title'],
      summary: 'Added 1, removed 0, changed 1.',
    });
    expect(output.added).toHaveLength(1);
  });

  it('parses inspect page state input', () => {
    const parsed = InspectPageStateInputSchema.parse({
      session_id: 'session-1',
    });
    expect(parsed.session_id).toBe('session-1');
  });

  it('parses inspect extract content defaults', () => {
    const parsed = InspectExtractContentInputSchema.parse({
      session_id: 'session-1',
    });
    expect(parsed.format).toBe('markdown');
    expect(parsed.include_metadata).toBe(true);
  });

  it('accepts inspect target hints', () => {
    const parsed = InspectDomSnapshotInputSchema.parse({
      session_id: 'session-1',
      target: {
        url: 'https://example.com',
        last_active_at: '2025-01-01T00:00:00Z',
      },
    });
    expect(parsed.target?.url).toBe('https://example.com');

    const evalParsed = InspectEvaluateInputSchema.parse({
      session_id: 'session-1',
      expression: '1+1',
      target: { title: 'Example', lastActiveAt: '2025-01-01T00:00:00Z' },
    });
    expect(evalParsed.target?.title).toBe('Example');

    const consoleParsed = InspectConsoleListInputSchema.parse({
      session_id: 'session-1',
      target: { title: 'Console' },
    });
    expect(consoleParsed.target?.title).toBe('Console');
  });

  it('parses artifacts screenshot defaults', () => {
    const parsed = ArtifactsScreenshotInputSchema.parse({
      session_id: 'session-1',
    });
    expect(parsed.target).toBe('viewport');
    expect(parsed.fullPage).toBe(false);
    expect(parsed.format).toBe('png');
  });

  it('accepts full page screenshot options', () => {
    const parsed = ArtifactsScreenshotInputSchema.parse({
      session_id: 'session-1',
      fullPage: true,
      format: 'jpeg',
      quality: 80,
    });
    expect(parsed.fullPage).toBe(true);
    expect(parsed.format).toBe('jpeg');
    expect(parsed.quality).toBe(80);
  });

  it('accepts element selector for screenshots', () => {
    const parsed = ArtifactsScreenshotInputSchema.parse({
      session_id: 'session-1',
      selector: '#app > button.primary',
    });
    expect(parsed.selector).toBe('#app > button.primary');
  });

  it('parses diagnostics doctor with optional session', () => {
    const parsed = DiagnosticsDoctorInputSchema.parse({});
    expect(parsed.session_id).toBeUndefined();
  });

  it('parses diagnostics doctor caller runtime context', () => {
    const parsed = DiagnosticsDoctorInputSchema.parse({
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
          version: '0.11.1',
        },
      },
    });
    expect(parsed.caller?.endpoint?.port).toBe(3210);
    expect(parsed.caller?.process?.component).toBe('cli');
  });

  it('parses health check output', () => {
    const parsed = HealthCheckInputSchema.parse({});
    expect(parsed).toEqual({});

    const output = HealthCheckOutputSchema.parse({
      started_at: '2026-02-07T00:00:00.000Z',
      uptime_ms: 1234,
      memory: {
        rss: 1000000,
        heapTotal: 2000000,
        heapUsed: 1500000,
        external: 500000,
        arrayBuffers: 0,
      },
      sessions: { active: 1 },
      extension: { connected: true },
    });
    expect(output.extension.connected).toBe(true);
  });

  it('parses diagnostics report with debugger info', () => {
    const parsed = DiagnosticReportSchema.parse({
      ok: true,
      runtime: {
        core: {
          endpoint: {
            host: '127.0.0.1',
            port: 3210,
            base_url: 'http://127.0.0.1:3210',
          },
          process: {
            component: 'core',
            version: '0.11.1',
          },
        },
      },
      debugger: {
        attached: true,
        idle_timeout_ms: 15000,
        console_buffer_size: 200,
        network_buffer_size: 500,
      },
    });
    expect(parsed.debugger?.attached).toBe(true);

    const report = ErrorEnvelopeSchema.safeParse({
      ok: false,
      error: {
        code: 'DEBUGGER_IN_USE',
        message: 'Debugger already attached',
        retryable: true,
      },
    });
    expect(report.success).toBe(true);
  });

  it('parses diagnostics recovery metrics', () => {
    const parsed = DiagnosticReportSchema.parse({
      ok: true,
      recovery: {
        last_attempt: {
          session_id: 'session-1',
          recovered: false,
          state: 'READY',
          at: '2025-01-01T00:00:00Z',
        },
        attempts: [
          {
            session_id: 'session-1',
            recovered: false,
            state: 'READY',
            at: '2025-01-01T00:00:00Z',
          },
        ],
        success_count: 1,
        failure_count: 2,
        success_rate: 0.33,
        recent_failure_count: 2,
        loop_detected: false,
      },
    });

    expect(parsed.recovery?.success_count).toBe(1);
  });

  it('validates the error envelope shape', () => {
    const parsed = ErrorEnvelopeSchema.parse({
      ok: false,
      error: {
        code: 'TIMEOUT',
        message: 'Timed out',
        retryable: true,
      },
    });

    expect(parsed.error.retryable).toBe(true);
  });

  it('allows session status with plane errors', () => {
    const parsed = SessionStatusSchema.parse({
      session_id: 'session-1',
      state: 'READY',
      drive: { connected: true },
      inspect: {
        connected: false,
        error: {
          code: 'INSPECT_UNAVAILABLE',
          message: 'Inspect down',
          retryable: true,
        },
      },
    });

    expect(parsed.inspect?.error?.code).toBe('INSPECT_UNAVAILABLE');
  });
});
