import { describe, expect, it } from 'vitest';
import { mapScreenshotCaptureError } from './screenshot-errors';

describe('screenshot error mapping', () => {
  it('maps captureVisibleTab rate limit errors to RATE_LIMITED', () => {
    const error = new Error(
      'Unchecked runtime.lastError: MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND captureVisibleTab.'
    );
    const mapped = mapScreenshotCaptureError(error, 'fallback');
    expect(mapped).toMatchObject({
      code: 'RATE_LIMITED',
      retryable: true,
      details: {
        reason: 'capture_visible_tab_rate_limited',
      },
    });
  });

  it('maps missing capture permission errors to PERMISSION_REQUIRED', () => {
    const error = new Error(
      "captureVisibleTab: Either the '<all_urls>' or 'activeTab' permission is required."
    );
    const mapped = mapScreenshotCaptureError(error, 'fallback');
    expect(mapped).toMatchObject({
      code: 'PERMISSION_REQUIRED',
      retryable: false,
      details: {
        reason: 'capture_visible_tab_permission_required',
        required_any_of: ['<all_urls>', 'activeTab'],
      },
    });
  });

  it('falls back to ARTIFACT_IO_ERROR for unknown capture failures', () => {
    const mapped = mapScreenshotCaptureError(
      new Error('something else failed'),
      'fallback'
    );
    expect(mapped).toMatchObject({
      code: 'ARTIFACT_IO_ERROR',
      message: 'something else failed',
      retryable: false,
    });
  });
});
