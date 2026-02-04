import { describe, expect, it } from 'vitest';
import {
  InvalidSessionTransition,
  SessionState,
  shouldRetryDriveOp,
  shouldRetryInspectOp,
  transitionSession,
} from './state';

describe('transitionSession', () => {
  it('moves INIT to DRIVE_READY on drive connect', () => {
    expect(transitionSession(SessionState.INIT, 'DRIVE_CONNECTED')).toBe(
      SessionState.DRIVE_READY
    );
  });

  it('moves INIT to INSPECT_READY on inspect connect', () => {
    expect(transitionSession(SessionState.INIT, 'INSPECT_CONNECTED')).toBe(
      SessionState.INSPECT_READY
    );
  });

  it('moves DRIVE_READY to READY on inspect connect', () => {
    expect(
      transitionSession(SessionState.DRIVE_READY, 'INSPECT_CONNECTED')
    ).toBe(SessionState.READY);
  });

  it('moves INSPECT_READY to READY on drive connect', () => {
    expect(
      transitionSession(SessionState.INSPECT_READY, 'DRIVE_CONNECTED')
    ).toBe(SessionState.READY);
  });

  it('moves READY to DEGRADED_DRIVE on drive disconnect', () => {
    expect(transitionSession(SessionState.READY, 'DRIVE_DISCONNECTED')).toBe(
      SessionState.DEGRADED_DRIVE
    );
  });

  it('moves READY to DEGRADED_INSPECT on inspect disconnect', () => {
    expect(transitionSession(SessionState.READY, 'INSPECT_DISCONNECTED')).toBe(
      SessionState.DEGRADED_INSPECT
    );
  });

  it('recovers DEGRADED_DRIVE to READY', () => {
    expect(
      transitionSession(SessionState.DEGRADED_DRIVE, 'RECOVER_SUCCEEDED')
    ).toBe(SessionState.READY);
  });

  it('recovers DEGRADED_INSPECT to READY', () => {
    expect(
      transitionSession(SessionState.DEGRADED_INSPECT, 'RECOVER_SUCCEEDED')
    ).toBe(SessionState.READY);
  });

  it('moves to BROKEN on recover failure', () => {
    expect(transitionSession(SessionState.INIT, 'RECOVER_FAILED')).toBe(
      SessionState.BROKEN
    );
  });

  it('moves any state to CLOSED on close', () => {
    expect(transitionSession(SessionState.READY, 'CLOSE')).toBe(
      SessionState.CLOSED
    );
  });

  it('throws on invalid transitions', () => {
    expect(() =>
      transitionSession(SessionState.INIT, 'DRIVE_DISCONNECTED')
    ).toThrow(InvalidSessionTransition);
  });
});

describe('retry rules', () => {
  it('retries drive ops once when retryable', () => {
    expect(shouldRetryDriveOp({ attempt: 0, retryable: true })).toBe(true);
    expect(shouldRetryDriveOp({ attempt: 1, retryable: true })).toBe(false);
    expect(shouldRetryDriveOp({ attempt: 0, retryable: false })).toBe(false);
  });

  it('retries inspect ops once when reconnect succeeds', () => {
    expect(shouldRetryInspectOp({ attempt: 0, reconnectSucceeded: true })).toBe(
      true
    );
    expect(shouldRetryInspectOp({ attempt: 1, reconnectSucceeded: true })).toBe(
      false
    );
    expect(
      shouldRetryInspectOp({ attempt: 0, reconnectSucceeded: false })
    ).toBe(false);
  });
});
