import { describe, expect, it } from 'vitest';
import { resolveTabActivationOutcome } from './tab-activation';

describe('resolveTabActivationOutcome', () => {
  it('fails when the tab did not become active', () => {
    expect(
      resolveTabActivationOutcome({
        tabId: 42,
        windowId: 7,
        activated: false,
      })
    ).toEqual({
      ok: false,
      error: {
        code: 'FAILED_PRECONDITION',
        message: 'Failed to activate tab_id 42.',
        retryable: true,
        details: { tab_id: 42 },
      },
    });
  });

  it('returns a warning when window focus update fails after tab activation', () => {
    expect(
      resolveTabActivationOutcome({
        tabId: 42,
        windowId: 7,
        activated: true,
        focusErrorMessage: 'Window manager said no.',
      })
    ).toEqual({
      ok: true,
      result: {
        ok: true,
        warnings: [
          'Activated tab_id 42, but failed to focus window_id 7: Window manager said no.',
        ],
      },
    });
  });

  it('returns a warning when the tab activates but the window never reports focused', () => {
    expect(
      resolveTabActivationOutcome({
        tabId: 42,
        windowId: 7,
        activated: true,
        windowFocused: false,
      })
    ).toEqual({
      ok: true,
      result: {
        ok: true,
        warnings: [
          'Activated tab_id 42, but window_id 7 did not report focused state.',
        ],
      },
    });
  });
});
