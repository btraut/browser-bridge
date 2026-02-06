import { describe, expect, it } from 'vitest';
import { SessionRegistry } from './session';

describe('SessionRegistry.recover', () => {
  it('transitions DEGRADED_DRIVE to READY on successful recovery', () => {
    const registry = new SessionRegistry();
    const session = registry.create();
    registry.apply(session.id, 'DRIVE_CONNECTED');
    registry.apply(session.id, 'INSPECT_CONNECTED');
    registry.apply(session.id, 'DRIVE_DISCONNECTED');

    const result = registry.recover(session.id, {
      recovered: true,
      message: 'Drive recovered.',
    });

    expect(result.recovered).toBe(true);
    expect(result.state).toBe('READY');
  });

  it('transitions DEGRADED_INSPECT to BROKEN on failed recovery', () => {
    const registry = new SessionRegistry();
    const session = registry.create();
    registry.apply(session.id, 'DRIVE_CONNECTED');
    registry.apply(session.id, 'INSPECT_CONNECTED');
    registry.apply(session.id, 'INSPECT_DISCONNECTED');

    const result = registry.recover(session.id, {
      recovered: false,
      message: 'Inspect recovery failed.',
    });

    expect(result.recovered).toBe(false);
    expect(result.state).toBe('BROKEN');
  });
});

describe('SessionRegistry.cleanupIdleSessions', () => {
  it('removes sessions idle longer than the TTL', () => {
    const registry = new SessionRegistry();
    const session = registry.create();

    // Touch via require, then advance time beyond TTL.
    registry.require(session.id);
    const touchedAt = registry.require(session.id).lastAccessedAt;
    const ttlMs = 1000;
    const removed = registry.cleanupIdleSessions(
      ttlMs,
      new Date(touchedAt.getTime() + ttlMs + 1)
    );

    expect(removed).toBe(1);
    expect(registry.get(session.id)).toBe(undefined);
  });

  it('does not remove sessions when ttlMs is 0', () => {
    const registry = new SessionRegistry();
    const session = registry.create();
    const removed = registry.cleanupIdleSessions(0, new Date(Date.now() + 999));
    expect(removed).toBe(0);
    expect(registry.get(session.id)).toBeDefined();
  });
});
