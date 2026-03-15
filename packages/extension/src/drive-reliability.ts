const TRANSIENT_TAB_CHANNEL_ERROR_PATTERNS = [
  'receiving end does not exist',
  'message channel closed before a response was received',
  'the message port closed before a response was received',
  'extension port is moved into back/forward cache',
] as const;
const CONTENT_SCRIPT_RECOVERY_ERROR_PATTERNS = [
  'receiving end does not exist',
] as const;

const TAB_CHANNEL_RETRY_DELAYS_MS = [120, 200, 320, 500, 750, 1000, 1200];

const normalizePathname = (pathname: string): string => {
  if (pathname.length === 0) {
    return '/';
  }
  if (pathname.length > 1 && pathname.endsWith('/')) {
    return pathname.slice(0, -1);
  }
  return pathname;
};

export const isTransientTabChannelError = (message: unknown): boolean => {
  if (typeof message !== 'string') {
    return false;
  }
  const normalized = message.toLowerCase();
  return TRANSIENT_TAB_CHANNEL_ERROR_PATTERNS.some((pattern) =>
    normalized.includes(pattern)
  );
};

export const canInjectContentScriptForUrl = (url: unknown): boolean => {
  if (typeof url !== 'string' || url.trim().length === 0) {
    return false;
  }
  const normalized = url.toLowerCase();
  if (
    normalized.startsWith('chrome://') ||
    normalized.startsWith('chrome-extension://') ||
    normalized.startsWith('devtools://') ||
    normalized.startsWith('edge://') ||
    normalized.startsWith('about:') ||
    normalized.startsWith('file://')
  ) {
    return false;
  }
  return normalized.startsWith('http://') || normalized.startsWith('https://');
};

export const shouldReinjectContentScript = (
  message: unknown,
  tabUrl?: unknown
): boolean => {
  if (typeof message !== 'string') {
    return false;
  }
  const normalized = message.toLowerCase();
  return (
    CONTENT_SCRIPT_RECOVERY_ERROR_PATTERNS.some((pattern) =>
      normalized.includes(pattern)
    ) && canInjectContentScriptForUrl(tabUrl)
  );
};

type TabChannelError = {
  code?: unknown;
  message?: unknown;
  retryable?: unknown;
};

export const shouldRetryTabChannelFailure = (
  action: string,
  error: TabChannelError | null | undefined
): boolean => {
  if (!error || typeof error !== 'object') {
    return false;
  }
  if (isTransientTabChannelError(error.message)) {
    return true;
  }
  return (
    action === 'drive.wait_for' &&
    error.code === 'TIMEOUT' &&
    error.retryable === true &&
    typeof error.message === 'string' &&
    error.message.includes('Timed out waiting for content response')
  );
};

export const getTabChannelRetryDelayMs = (
  attempt: number
): number | undefined => {
  if (!Number.isInteger(attempt) || attempt < 1) {
    return undefined;
  }
  return TAB_CHANNEL_RETRY_DELAYS_MS[attempt - 1];
};

export const isLikelyNavigationCommitted = (
  requestedUrl: unknown,
  tabUrl: unknown
): boolean => {
  if (typeof requestedUrl !== 'string' || typeof tabUrl !== 'string') {
    return false;
  }
  if (requestedUrl === tabUrl) {
    return true;
  }
  try {
    const requested = new URL(requestedUrl);
    const actual = new URL(tabUrl);
    return (
      requested.origin === actual.origin &&
      normalizePathname(requested.pathname) ===
        normalizePathname(actual.pathname) &&
      requested.search === actual.search
    );
  } catch {
    return requestedUrl === tabUrl;
  }
};
