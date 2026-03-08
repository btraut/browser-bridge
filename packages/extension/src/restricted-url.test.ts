import { describe, expect, it } from 'vitest';
import { buildRestrictedUrlError, isRestrictedUrl } from './restricted-url';

describe('restricted URL helpers', () => {
  it('detects internal browser URLs', () => {
    expect(isRestrictedUrl('chrome://extensions')).toBe(true);
    expect(isRestrictedUrl('chrome-extension://abc/options.html')).toBe(true);
    expect(isRestrictedUrl('https://example.com')).toBe(false);
  });

  it('returns actionable alternatives for extension setup URLs', () => {
    const error = buildRestrictedUrlError({
      url: 'chrome-extension://abcdefghijklmnop/options.html',
      operation: 'navigate',
      action: 'drive.navigate',
    });

    expect(error.code).toBe('NOT_SUPPORTED');
    expect(error.details).toMatchObject({
      reason: 'restricted_internal_url',
      url_kind: 'extension_internal',
      next_step: 'browser-bridge dev enable-inspect --extension-id <id>',
      alternatives: expect.arrayContaining([
        'browser-bridge dev enable-inspect --extension-id <id>',
        'browser-bridge dev info',
      ]),
    });
  });

  it('returns rationale for screenshot attempts on restricted URLs', () => {
    const error = buildRestrictedUrlError({
      url: 'chrome://settings',
      operation: 'screenshot',
      action: 'drive.screenshot',
    });

    expect(error.message).toContain('Screenshots');
    expect(error.details).toMatchObject({
      reason: 'restricted_internal_url',
      action: 'drive.screenshot',
    });
  });
});
