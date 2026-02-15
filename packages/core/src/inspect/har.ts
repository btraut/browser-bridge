import type { DebuggerEventRecord } from '../debugger-bridge';

type HarLog = {
  log: {
    version: string;
    creator: { name: string; version: string };
    pages: Array<{
      id: string;
      title: string;
      startedDateTime: string;
      pageTimings: { onContentLoad: number; onLoad: number };
    }>;
    entries: unknown[];
  };
};

export const buildHar = (
  events: DebuggerEventRecord[],
  title?: string
): HarLog => {
  type RequestRecord = {
    id: string;
    url?: string;
    method?: string;
    startTime?: number;
    endTime?: number;
    requestHeaders?: Record<string, string>;
    responseHeaders?: Record<string, string>;
    status?: number;
    statusText?: string;
    mimeType?: string;
    encodedDataLength?: number;
    protocol?: string;
  };

  const requests = new Map<string, RequestRecord>();

  const toTimestamp = (
    event: DebuggerEventRecord,
    fallback?: number
  ): number => {
    const raw = (event.params as { timestamp?: number; wallTime?: number })
      ?.wallTime;
    if (typeof raw === 'number') {
      return raw * 1000;
    }
    const ts = (event.params as { timestamp?: number })?.timestamp;
    if (typeof ts === 'number') {
      return ts * 1000;
    }
    const parsed = Date.parse(event.timestamp);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
    return fallback ?? Date.now();
  };

  for (const event of events) {
    const params = event.params ?? {};
    switch (event.method) {
      case 'Network.requestWillBeSent': {
        const requestId = String((params as { requestId?: unknown }).requestId);
        if (!requestId) {
          break;
        }
        const request = (
          params as {
            request?: {
              url?: string;
              method?: string;
              headers?: Record<string, string>;
            };
          }
        ).request;
        const record: RequestRecord = {
          id: requestId,
          url: request?.url,
          method: request?.method,
          requestHeaders: request?.headers ?? {},
          startTime: toTimestamp(event),
        };
        requests.set(requestId, record);
        break;
      }
      case 'Network.responseReceived': {
        const requestId = String((params as { requestId?: unknown }).requestId);
        if (!requestId) {
          break;
        }
        const response = (
          params as {
            response?: {
              status?: number;
              statusText?: string;
              mimeType?: string;
              headers?: Record<string, string>;
              protocol?: string;
            };
          }
        ).response;
        const record = requests.get(requestId) ?? { id: requestId };
        record.status = response?.status;
        record.statusText = response?.statusText;
        record.mimeType = response?.mimeType;
        record.responseHeaders = response?.headers ?? {};
        record.protocol = response?.protocol;
        record.startTime = record.startTime ?? toTimestamp(event);
        requests.set(requestId, record);
        break;
      }
      case 'Network.loadingFinished': {
        const requestId = String((params as { requestId?: unknown }).requestId);
        if (!requestId) {
          break;
        }
        const record = requests.get(requestId) ?? { id: requestId };
        record.encodedDataLength = (
          params as { encodedDataLength?: number }
        ).encodedDataLength;
        record.endTime = toTimestamp(event, record.startTime);
        requests.set(requestId, record);
        break;
      }
      case 'Network.loadingFailed': {
        const requestId = String((params as { requestId?: unknown }).requestId);
        if (!requestId) {
          break;
        }
        const record = requests.get(requestId) ?? { id: requestId };
        record.endTime = toTimestamp(event, record.startTime);
        requests.set(requestId, record);
        break;
      }
      default:
        break;
    }
  }

  const entries = Array.from(requests.values()).map((record) => {
    const started = record.startTime ?? Date.now();
    const ended = record.endTime ?? started;
    const time = Math.max(0, ended - started);
    const url = record.url ?? '';
    const queryString: Array<{ name: string; value: string }> = [];
    try {
      const parsed = new URL(url);
      parsed.searchParams.forEach((value, name) => {
        queryString.push({ name, value });
      });
    } catch {
      // Ignore URL parse failures.
    }

    return {
      pageref: 'page_0',
      startedDateTime: new Date(started).toISOString(),
      time,
      request: {
        method: record.method ?? 'GET',
        url,
        httpVersion: record.protocol ?? 'HTTP/1.1',
        cookies: [],
        headers: [],
        queryString,
        headersSize: -1,
        bodySize: -1,
      },
      response: {
        status: record.status ?? 0,
        statusText: record.statusText ?? '',
        httpVersion: record.protocol ?? 'HTTP/1.1',
        cookies: [],
        headers: [],
        redirectURL: '',
        headersSize: -1,
        bodySize: record.encodedDataLength ?? 0,
        content: {
          size: record.encodedDataLength ?? 0,
          mimeType: record.mimeType ?? '',
        },
      },
      cache: {},
      timings: {
        send: 0,
        wait: time,
        receive: 0,
      },
    };
  });

  const startedDateTime = entries.length
    ? (entries[0] as { startedDateTime?: string }).startedDateTime ??
      new Date().toISOString()
    : new Date().toISOString();

  return {
    log: {
      version: '1.2',
      creator: {
        name: 'browser-bridge',
        version: '0.0.0',
      },
      pages: [
        {
          id: 'page_0',
          title: title ?? 'page',
          startedDateTime,
          pageTimings: {
            onContentLoad: -1,
            onLoad: -1,
          },
        },
      ],
      entries,
    },
  };
};
