import type { DriveErrorInfo } from './protocol.js';

export const isCaptureVisibleTabRateLimitedMessage = (
  message: string
): boolean => {
  const normalized = message.toLowerCase();
  const hasCaptureSignal = normalized.includes('capturevisibletab');
  const hasRateSignal =
    normalized.includes('max_capture_visible_tab_calls_per_second') ||
    normalized.includes('too often') ||
    normalized.includes('rate limit') ||
    normalized.includes('rate-limit');
  return hasCaptureSignal && hasRateSignal;
};

export const isCaptureVisibleTabPermissionMessage = (
  message: string
): boolean => {
  const normalized = message.toLowerCase();
  const hasCaptureSignal = normalized.includes('capturevisibletab');
  const hasPermissionSignal =
    normalized.includes('permission is required') ||
    normalized.includes('requires permission') ||
    normalized.includes('requires either');
  const hasPermissionTarget =
    normalized.includes('all_urls') || normalized.includes('activetab');
  return hasCaptureSignal && hasPermissionSignal && hasPermissionTarget;
};

export const isCaptureVisibleTabRateLimitedError = (error: unknown): boolean =>
  error instanceof Error &&
  isCaptureVisibleTabRateLimitedMessage(error.message);

export const isCaptureVisibleTabPermissionError = (error: unknown): boolean =>
  error instanceof Error && isCaptureVisibleTabPermissionMessage(error.message);

export const mapScreenshotCaptureError = (
  error: unknown,
  fallbackMessage: string
): DriveErrorInfo => {
  const message =
    error instanceof Error && error.message ? error.message : fallbackMessage;

  if (isCaptureVisibleTabRateLimitedError(error)) {
    return {
      code: 'RATE_LIMITED',
      message:
        'Screenshot capture hit Chrome capture rate limits. Please retry shortly.',
      retryable: true,
      details: {
        reason: 'capture_visible_tab_rate_limited',
        original_message: message,
      },
    };
  }

  if (isCaptureVisibleTabPermissionError(error)) {
    return {
      code: 'PERMISSION_REQUIRED',
      message:
        'Screenshot capture requires captureVisibleTab permission (<all_urls> or activeTab).',
      retryable: false,
      details: {
        reason: 'capture_visible_tab_permission_required',
        required_any_of: ['<all_urls>', 'activeTab'],
        next_step:
          'Reload the Browser Bridge extension in chrome://extensions and retry screenshot capture.',
        original_message: message,
      },
    };
  }

  return {
    code: 'ARTIFACT_IO_ERROR',
    message,
    retryable: false,
  };
};
