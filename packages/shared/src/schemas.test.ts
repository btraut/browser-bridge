import { describe, expect, it } from 'vitest';
import { ErrorEnvelopeSchema } from './errors';
import {
  ArtifactsScreenshotInputSchema,
  DiagnosticsDoctorInputSchema,
  DiagnosticReportSchema,
  DriveClickInputSchema,
  DriveDragInputSchema,
  DriveFillFormInputSchema,
  DriveHandleDialogInputSchema,
  DriveNavigateInputSchema,
  DriveScrollInputSchema,
  DriveTypeInputSchema,
  DriveWaitForInputSchema,
  InspectConsoleListInputSchema,
  InspectDomSnapshotInputSchema,
  InspectEvaluateInputSchema,
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
      session_id: 'session-1',
      url: 'https://example.com',
    });
    expect(parsed.wait).toBe('domcontentloaded');
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

  it('parses diagnostics doctor with optional session', () => {
    const parsed = DiagnosticsDoctorInputSchema.parse({});
    expect(parsed.session_id).toBeUndefined();
  });

  it('parses diagnostics report with debugger info', () => {
    const parsed = DiagnosticReportSchema.parse({
      ok: true,
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
