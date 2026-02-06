import { describe, expect, it } from 'vitest';
import { buildDiagnosticReport } from './diagnostics';
import { DiagnosticReportSchema } from '@btraut/browser-bridge-shared';
import { SessionState } from './state';
import { getArtifactRootDir } from './artifacts';

describe('buildDiagnosticReport', () => {
  it('includes artifact root when session id is provided', () => {
    const report = buildDiagnosticReport('session-123');
    expect(report.artifacts?.root_dir).toBe(getArtifactRootDir('session-123'));
    expect(report.session_id).toBe('session-123');
  });

  it('includes extension status by default', () => {
    const report = buildDiagnosticReport();
    expect(report.extension?.connected).toBe(false);
    const debuggerCheck = report.checks?.find(
      (check) => check.name === 'debugger.attached'
    );
    expect(debuggerCheck?.ok).toBe(false);
  });

  it('emits debugger settings using snake_case fields', () => {
    const report = buildDiagnosticReport('session-123', {
      debugger: {
        attached: true,
        idle_timeout_ms: 15000,
        console_buffer_size: 200,
        network_buffer_size: 500,
      },
    });

    const parsed = DiagnosticReportSchema.parse(report);
    expect(parsed.debugger?.idle_timeout_ms).toBe(15000);
    expect(parsed.debugger?.console_buffer_size).toBe(200);
    expect(parsed.debugger?.network_buffer_size).toBe(500);
    expect(
      (report.debugger as Record<string, unknown> | undefined)?.idleTimeoutMs
    ).toBe(undefined);
  });

  it('includes recovery metrics in the report', () => {
    const report = buildDiagnosticReport('session-123', {
      recoveryAttempt: {
        sessionId: 'session-123',
        recovered: false,
        state: SessionState.READY,
        at: '2025-01-01T00:00:00Z',
      },
      recoveryMetrics: {
        attempts: [
          {
            sessionId: 'session-123',
            recovered: false,
            state: SessionState.READY,
            at: '2025-01-01T00:00:00Z',
          },
        ],
        successCount: 1,
        failureCount: 2,
        successRate: 1 / 3,
        recentFailureCount: 2,
        loopDetected: false,
      },
    });

    expect(report.recovery?.success_count).toBe(1);
    expect(report.recovery?.attempts?.length).toBe(1);
  });

  it('includes session summary when provided', () => {
    const report = buildDiagnosticReport(undefined, {
      sessions: {
        count: 2,
        maxAgeMs: 1234,
        maxIdleMs: 5678,
      },
    });

    const parsed = DiagnosticReportSchema.parse(report);
    expect(parsed.sessions?.count).toBe(2);
    expect(parsed.sessions?.max_age_ms).toBe(1234);
    expect(parsed.sessions?.max_idle_ms).toBe(5678);
  });
});
