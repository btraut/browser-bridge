import { describe, expect, it } from 'vitest';
import { ConnectionStateTracker } from './connection-state';

describe('ConnectionStateTracker', () => {
  it('tracks connecting -> backoff -> connected transitions', () => {
    let now = 1_700_000_000_000;
    const tracker = new ConnectionStateTracker(() => now);
    tracker.setEndpoint({
      host: '127.0.0.1',
      port: 3210,
      portSource: 'default',
    });

    tracker.markConnecting();
    expect(tracker.getStatus().state).toBe('connecting');

    tracker.recordFailure('connect ECONNREFUSED');
    tracker.markBackoff(1000);
    const backoff = tracker.getStatus();
    expect(backoff.state).toBe('backoff');
    expect(backoff.reconnect_delay_ms).toBe(1000);
    expect(backoff.retry_at).toBeDefined();
    expect(backoff.consecutive_failures).toBe(1);

    now += 1200;
    tracker.markConnected();
    const connected = tracker.getStatus();
    expect(connected.state).toBe('connected');
    expect(connected.consecutive_failures).toBe(0);
    expect(connected.last_connected_at).toBeDefined();
  });

  it('throttles repeated failure logs', () => {
    let now = 1_700_000_000_000;
    const tracker = new ConnectionStateTracker(() => now, 1000);

    const first = tracker.consumeFailureLogBudget();
    expect(first).toEqual({ shouldLog: true, suppressedCount: 0 });

    const second = tracker.consumeFailureLogBudget();
    expect(second.shouldLog).toBe(false);

    now += 1200;
    const third = tracker.consumeFailureLogBudget();
    expect(third).toEqual({ shouldLog: true, suppressedCount: 1 });
  });

  it('clears retry metadata outside backoff state', () => {
    let now = 1_700_000_000_000;
    const tracker = new ConnectionStateTracker(() => now);
    tracker.markBackoff(3000);

    tracker.markConnecting();
    expect(tracker.getStatus().retry_at).toBeUndefined();
    expect(tracker.getStatus().reconnect_delay_ms).toBeUndefined();

    tracker.markBackoff(2000);
    now += 500;
    tracker.markDisconnected();
    expect(tracker.getStatus().retry_at).toBeUndefined();
    expect(tracker.getStatus().reconnect_delay_ms).toBeUndefined();
  });
});
