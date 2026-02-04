import { describe, expect, it } from 'vitest';
import { buildDiagnosticReport } from './diagnostics';
import { DiagnosticReportSchema } from '../../shared/src/schemas';
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
});
