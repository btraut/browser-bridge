import { describe, expect, it } from 'vitest';
import {
  sanitizeChromeErrorMessage,
  sanitizeDriveErrorInfo,
} from './error-sanitizer';

describe('error sanitizer', () => {
  it('removes unix file paths while preserving basename', () => {
    const input =
      'Unhandled error at /Users/brent/Development/browser-bridge/packages/extension/src/background.ts:171:22';
    const output = sanitizeChromeErrorMessage(input);
    expect(output).toContain('background.ts:171:22');
    expect(output).not.toContain('/Users/');
    expect(output).not.toContain('/Development/');
  });

  it('removes windows file paths while preserving basename', () => {
    const input =
      'Unhandled error at C:\\Users\\brent\\project\\src\\background.ts:171:22';
    const output = sanitizeChromeErrorMessage(input);
    expect(output).toContain('background.ts:171:22');
    expect(output).not.toContain('C:\\Users\\');
  });

  it('redacts urls to origin', () => {
    const input =
      'Cannot access https://example.com/path?secret=1#hash from https://other.example.org/a/b.';
    const output = sanitizeChromeErrorMessage(input);
    expect(output).toContain('https://example.com');
    expect(output).toContain('https://other.example.org.');
    expect(output).not.toContain('/path?secret=1');
    expect(output).not.toContain('/a/b');
  });

  it('redacts chrome-extension urls to origin', () => {
    const input =
      'Script error at chrome-extension://abcdefghijklmnop/background.js:1:2';
    const output = sanitizeChromeErrorMessage(input);
    expect(output).toContain('chrome-extension://abcdefghijklmnop');
    expect(output).not.toContain('/background.js');
  });

  it('sanitizes view-source urls', () => {
    const input = 'Blocked on view-source:https://example.com/a/b?x=1';
    const output = sanitizeChromeErrorMessage(input);
    expect(output).toContain('view-source:https://example.com');
    expect(output).not.toContain('/a/b?x=1');
  });

  it('sanitizes DriveErrorInfo recursively', () => {
    const sanitized = sanitizeDriveErrorInfo({
      code: 'FAILED',
      message: 'Oops https://example.com/a/b?token=1',
      retryable: false,
      details: {
        url: 'https://example.com/a/b?token=1',
        original_message:
          'at /Users/brent/Development/browser-bridge/packages/extension/src/background.ts:171:22',
        nested: { list: ['file:///Users/brent/secret.txt', 42] },
      },
    });

    expect(sanitized.message).toContain('https://example.com');
    expect(sanitized.message).not.toContain('/a/b?token=1');

    expect(sanitized.details?.url).toBe('https://example.com');
    expect(String(sanitized.details?.original_message)).toContain(
      'background.ts:171:22'
    );
    expect(String(sanitized.details?.original_message)).not.toContain(
      '/Users/'
    );
    expect((sanitized.details?.nested as { list?: unknown[] }).list?.[0]).toBe(
      'file://[redacted]'
    );
  });
});
