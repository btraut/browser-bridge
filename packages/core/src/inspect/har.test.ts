import { describe, expect, it } from 'vitest';
import { buildHar } from './har';

describe('buildHar', () => {
  it('builds a minimal HAR log from request/response events', () => {
    const har = buildHar(
      [
        {
          tab_id: 1,
          method: 'Network.requestWillBeSent',
          timestamp: '2026-02-05T00:00:00.000Z',
          params: {
            requestId: '1',
            request: {
              url: 'https://example.com/api?q=1',
              method: 'GET',
              headers: { Accept: 'application/json' },
            },
          },
        },
        {
          tab_id: 1,
          method: 'Network.responseReceived',
          timestamp: '2026-02-05T00:00:00.100Z',
          params: {
            requestId: '1',
            response: {
              status: 200,
              statusText: 'OK',
              mimeType: 'application/json',
              headers: { 'Content-Type': 'application/json' },
              protocol: 'h2',
            },
          },
        },
        {
          tab_id: 1,
          method: 'Network.loadingFinished',
          timestamp: '2026-02-05T00:00:00.200Z',
          params: { requestId: '1', encodedDataLength: 123 },
        },
      ],
      'Example'
    );

    expect(har.log.version).toBe('1.2');
    expect(har.log.pages[0].title).toBe('Example');
    expect(har.log.entries).toHaveLength(1);

    const entry = har.log.entries[0] as {
      request?: {
        url?: string;
        queryString?: Array<{ name: string; value: string }>;
      };
      response?: {
        status?: number;
        content?: { mimeType?: string; size?: number };
      };
    };
    expect(entry.request?.url).toBe('https://example.com/api?q=1');
    expect(entry.request?.queryString).toEqual([{ name: 'q', value: '1' }]);
    expect(entry.response?.status).toBe(200);
    expect(entry.response?.content?.mimeType).toBe('application/json');
    expect(entry.response?.content?.size).toBe(123);
  });

  it('does not throw when request URLs are invalid', () => {
    const har = buildHar([
      {
        tab_id: 1,
        method: 'Network.requestWillBeSent',
        timestamp: '2026-02-05T00:00:00.000Z',
        params: {
          requestId: '1',
          request: {
            url: 'not-a-url',
            method: 'GET',
            headers: {},
          },
        },
      },
    ]);

    const entry = har.log.entries[0] as {
      request?: { url?: string; queryString?: unknown[] };
    };
    expect(entry.request?.url).toBe('not-a-url');
    expect(entry.request?.queryString).toEqual([]);
  });
});
