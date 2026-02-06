import { describe, expect, it } from 'vitest';
import { toConsoleEntry } from './console';

describe('toConsoleEntry', () => {
  it('includes exception details + stack frames in console output', () => {
    const entry = toConsoleEntry({
      tab_id: 1,
      method: 'Runtime.exceptionThrown',
      timestamp: '2026-02-05T00:00:00.000Z',
      params: {
        exceptionDetails: {
          text: 'Uncaught',
          url: 'https://example.com/app.js',
          lineNumber: 0,
          columnNumber: 9,
          exception: {
            type: 'object',
            subtype: 'error',
            description: 'TypeError: boom',
          },
          stackTrace: {
            callFrames: [
              {
                functionName: 'explode',
                url: 'https://example.com/app.js',
                lineNumber: 0,
                columnNumber: 9,
              },
            ],
          },
        },
      },
    });

    expect(entry).toBeTruthy();
    expect(entry?.level).toBe('error');
    expect(entry?.text).toBe('Uncaught: TypeError: boom');
    expect(entry?.exception?.description).toBe('TypeError: boom');
    expect(entry?.source?.url).toBe('https://example.com/app.js');
    expect(entry?.source?.line).toBe(1);
    expect(entry?.source?.column).toBe(10);
    expect(entry?.stack?.[0]).toMatchObject({
      functionName: 'explode',
      url: 'https://example.com/app.js',
      line: 1,
      column: 10,
    });
  });
});
