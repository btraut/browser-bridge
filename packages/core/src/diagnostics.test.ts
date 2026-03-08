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
    expect(debuggerCheck?.ok).toBe(true);
    const sessionCheck = report.checks?.find(
      (check) => check.name === 'session.state'
    );
    expect(sessionCheck?.ok).toBe(true);
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

  it('treats stale drive and inspect errors as warnings', () => {
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();

    const report = buildDiagnosticReport('session-123', {
      sessionState: SessionState.DRIVE_READY,
      extension: { connected: true },
      runtime: {
        extension: {
          capabilityNegotiated: true,
          capabilities: {
            'drive.navigate': true,
            'debugger.attach': true,
            'debugger.command': true,
          },
        },
      },
      driveLastError: {
        code: 'TIMEOUT',
        message: 'stale drive timeout',
        retryable: false,
        at: fiveMinutesAgo,
      },
      inspectLastError: {
        code: 'INSPECT_UNAVAILABLE',
        message: 'stale inspect error',
        retryable: false,
        at: fiveMinutesAgo,
      },
    });

    expect(report.ok).toBe(true);
    const driveCheck = report.checks?.find(
      (check) => check.name === 'drive.last_error'
    );
    const inspectCheck = report.checks?.find(
      (check) => check.name === 'inspect.last_error'
    );
    expect(driveCheck?.ok).toBe(true);
    expect(inspectCheck?.ok).toBe(true);
    expect(report.warnings?.length).toBeGreaterThanOrEqual(2);
  });

  it('keeps fresh errors as failing checks', () => {
    const now = new Date().toISOString();
    const report = buildDiagnosticReport('session-123', {
      sessionState: SessionState.DRIVE_READY,
      extension: { connected: true },
      driveLastError: {
        code: 'TIMEOUT',
        message: 'fresh drive timeout',
        retryable: false,
        at: now,
      },
    });

    expect(report.ok).toBe(false);
    const driveCheck = report.checks?.find(
      (check) => check.name === 'drive.last_error'
    );
    expect(driveCheck?.ok).toBe(false);
  });

  it('reports caller/extension runtime endpoint mismatches explicitly', () => {
    const report = buildDiagnosticReport(undefined, {
      extension: {
        connected: true,
        version: '1.0.0',
      },
      runtime: {
        caller: {
          endpoint: {
            host: '127.0.0.1',
            port: 3999,
            baseUrl: 'http://127.0.0.1:3999',
            hostSource: 'env',
            portSource: 'env',
          },
          process: {
            component: 'cli',
            version: '2.0.0',
          },
        },
        core: {
          endpoint: {
            host: '127.0.0.1',
            port: 3210,
            baseUrl: 'http://127.0.0.1:3210',
            hostSource: 'default',
            portSource: 'default',
          },
          process: {
            component: 'core',
          },
        },
        extension: {
          version: '1.0.0',
          endpoint: {
            host: '127.0.0.1',
            port: 4333,
            baseUrl: 'http://127.0.0.1:4333',
          },
          portSource: 'storage',
        },
      },
    });

    const callerCheck = report.checks?.find(
      (check) => check.name === 'runtime.caller.endpoint_match'
    );
    const extensionCheck = report.checks?.find(
      (check) => check.name === 'runtime.extension.endpoint_match'
    );
    const versionCheck = report.checks?.find(
      (check) => check.name === 'runtime.extension.version_match_caller'
    );

    expect(callerCheck?.ok).toBe(false);
    expect(extensionCheck?.ok).toBe(false);
    expect(versionCheck?.ok).toBe(false);
    expect(report.runtime?.core?.endpoint?.base_url).toBe(
      'http://127.0.0.1:3210'
    );
    expect(report.runtime?.extension?.port_source).toBe('storage');
  });

  it('reports runtime endpoint/version matches when extension is connected', () => {
    const report = buildDiagnosticReport(undefined, {
      extension: {
        connected: true,
        extensionId: 'abcdefghijklmnopabcdefghijklmnop',
        version: '2.0.0',
      },
      runtime: {
        caller: {
          endpoint: {
            host: '127.0.0.1',
            port: 3210,
            baseUrl: 'http://127.0.0.1:3210',
            hostSource: 'default',
            portSource: 'default',
          },
          process: {
            component: 'cli',
            version: '2.0.0',
          },
        },
        core: {
          endpoint: {
            host: '127.0.0.1',
            port: 3210,
            baseUrl: 'http://127.0.0.1:3210',
            hostSource: 'default',
            portSource: 'default',
          },
          process: {
            component: 'core',
          },
        },
        extension: {
          extensionId: 'abcdefghijklmnopabcdefghijklmnop',
          version: '2.0.0',
          capabilityNegotiated: true,
          capabilities: {
            'drive.navigate': true,
            'debugger.attach': true,
            'debugger.command': true,
          },
          endpoint: {
            host: '127.0.0.1',
            port: 3210,
            baseUrl: 'http://127.0.0.1:3210',
          },
          portSource: 'default',
        },
      },
    });

    const extensionCheck = report.checks?.find(
      (check) => check.name === 'runtime.extension.endpoint_match'
    );
    const versionCheck = report.checks?.find(
      (check) => check.name === 'runtime.extension.version_match_caller'
    );
    expect(extensionCheck?.ok).toBe(true);
    expect(versionCheck?.ok).toBe(true);
    const capabilityNegotiated = report.checks?.find(
      (check) => check.name === 'runtime.extension.capability_negotiated'
    );
    const inspectCapability = report.checks?.find(
      (check) => check.name === 'inspect.capability'
    );
    expect(capabilityNegotiated?.ok).toBe(true);
    expect(inspectCapability?.ok).toBe(true);
    expect(report.extension?.extension_id).toBe(
      'abcdefghijklmnopabcdefghijklmnop'
    );
    expect(report.runtime?.extension?.extension_id).toBe(
      'abcdefghijklmnopabcdefghijklmnop'
    );
  });

  it('ignores extension runtime mismatch checks when extension is disconnected', () => {
    const report = buildDiagnosticReport(undefined, {
      extension: {
        connected: false,
        version: '1.0.0',
      },
      runtime: {
        caller: {
          endpoint: {
            host: '127.0.0.1',
            port: 3210,
            baseUrl: 'http://127.0.0.1:3210',
          },
          process: {
            component: 'cli',
            version: '2.0.0',
          },
        },
        core: {
          endpoint: {
            host: '127.0.0.1',
            port: 3210,
            baseUrl: 'http://127.0.0.1:3210',
          },
          process: {
            component: 'core',
          },
        },
        extension: {
          version: '0.9.0',
          endpoint: {
            host: '127.0.0.1',
            port: 4333,
            baseUrl: 'http://127.0.0.1:4333',
          },
          portSource: 'storage',
        },
      },
    });

    const extensionEndpointCheck = report.checks?.find(
      (check) => check.name === 'runtime.extension.endpoint_match'
    );
    const extensionVersionCheck = report.checks?.find(
      (check) => check.name === 'runtime.extension.version_match_caller'
    );
    expect(extensionEndpointCheck).toBeUndefined();
    expect(extensionVersionCheck).toBeUndefined();
  });

  it('flags inspect capability when debugger actions are disabled', () => {
    const report = buildDiagnosticReport(undefined, {
      extension: {
        connected: true,
      },
      runtime: {
        extension: {
          capabilityNegotiated: true,
          capabilities: {
            'drive.navigate': true,
            'debugger.attach': false,
            'debugger.command': false,
          },
        },
      },
    });

    const inspectCapability = report.checks?.find(
      (check) => check.name === 'inspect.capability'
    );
    expect(inspectCapability?.ok).toBe(false);
    expect(inspectCapability?.message).toContain('disabled');
    expect(
      report.warnings?.some((warning) => warning.includes('Inspect'))
    ).toBe(true);
  });

  it('flags caller/core metadata path mismatch for shared-core collisions', () => {
    const report = buildDiagnosticReport(undefined, {
      runtime: {
        caller: {
          endpoint: {
            host: '127.0.0.1',
            port: 3210,
            metadataPath: '/tmp/wt-a/.context/browser-bridge/dev.json',
          },
        },
        core: {
          endpoint: {
            host: '127.0.0.1',
            port: 3210,
            metadataPath: '/tmp/wt-b/.context/browser-bridge/dev.json',
          },
        },
      },
    });

    const metadataCheck = report.checks?.find(
      (check) => check.name === 'runtime.caller.metadata_path_match'
    );
    expect(metadataCheck?.ok).toBe(false);
    expect(metadataCheck?.message).toContain('shared core');
    expect(
      report.warnings?.some((warning) =>
        warning.includes('different worktree metadata path')
      )
    ).toBe(true);
  });
});
