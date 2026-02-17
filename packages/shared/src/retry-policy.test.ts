import { describe, expect, it } from 'vitest';
import { resolveRetryHint, shouldRetryByPolicy } from './retry-policy';

describe('retry policy', () => {
  it('normalizes boolean-only retry metadata into structured hints', () => {
    expect(resolveRetryHint({ retryable: true })).toEqual({
      retryable: true,
      reason: undefined,
      retry_after_ms: undefined,
      max_attempts: 1,
    });
  });

  it('uses max_attempts from retry hints for deterministic decisions', () => {
    expect(
      shouldRetryByPolicy({
        attempt: 0,
        retryable: true,
        retry: { retryable: true, max_attempts: 2 },
      })
    ).toBe(true);
    expect(
      shouldRetryByPolicy({
        attempt: 1,
        retryable: true,
        retry: { retryable: true, max_attempts: 2 },
      })
    ).toBe(true);
    expect(
      shouldRetryByPolicy({
        attempt: 2,
        retryable: true,
        retry: { retryable: true, max_attempts: 2 },
      })
    ).toBe(false);
  });
});
