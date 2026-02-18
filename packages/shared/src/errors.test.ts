import { describe, expect, it } from 'vitest';
import {
  type ErrorInfo,
  normalizeErrorCode,
  normalizeErrorInfo,
  PublicErrorDetailsSchema,
} from './errors';

describe('public error taxonomy normalization', () => {
  it('maps legacy codes to canonical public codes', () => {
    expect(normalizeErrorCode('SESSION_NOT_FOUND')).toBe('NOT_FOUND');
    expect(normalizeErrorCode('EXTENSION_DISCONNECTED')).toBe('UNAVAILABLE');
    expect(normalizeErrorCode('NOT_SUPPORTED')).toBe('NOT_IMPLEMENTED');
  });

  it('keeps canonical codes unchanged', () => {
    expect(normalizeErrorCode('INVALID_ARGUMENT')).toBe('INVALID_ARGUMENT');
    expect(normalizeErrorCode('TIMEOUT')).toBe('TIMEOUT');
  });

  it('preserves migration context in typed details when mapping legacy codes', () => {
    const normalized = normalizeErrorInfo({
      code: 'SESSION_NOT_FOUND',
      message: 'Session missing.',
      retryable: false,
      details: { session_id: 'session-1' },
    } satisfies ErrorInfo);

    expect(normalized.code).toBe('NOT_FOUND');
    expect(PublicErrorDetailsSchema.safeParse(normalized.details).success).toBe(
      true
    );
    expect(normalized.details).toEqual(
      expect.objectContaining({
        legacy_code: 'SESSION_NOT_FOUND',
        reason: 'session_not_found',
        resource: 'session',
        session_id: 'session-1',
      })
    );
  });

  it('never throws when normalizing unknown error codes', () => {
    const normalized = normalizeErrorInfo({
      code: 'SOMETHING_NEW',
      message: 'Unexpected.',
      retryable: false,
      details: { session_id: 'session-2' },
    });

    expect(normalized.code).toBe('INTERNAL');
    expect(normalized.details).toEqual(
      expect.objectContaining({
        legacy_code: 'SOMETHING_NEW',
        reason: 'unknown_code',
        session_id: 'session-2',
      })
    );
  });
});
