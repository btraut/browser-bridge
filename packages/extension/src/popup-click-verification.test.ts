import { describe, expect, it, vi } from 'vitest';
import {
  shouldTreatPostClickReadErrorAsSuccess,
  verifyPopupTriggerClick,
  type LocatorPoint,
} from './popup-click-verification';

const popupPoint = (
  overrides: Partial<LocatorPoint['targetState']> = {}
): LocatorPoint => ({
  x: 24,
  y: 48,
  targetState: {
    kind: 'popup_trigger',
    ariaHasPopup: 'menu',
    ariaExpanded: 'false',
    dataState: 'closed',
    ...overrides,
  },
});

describe('popup click verification', () => {
  it('fails when popup trigger state does not change', async () => {
    const dispatchCdpClick = vi.fn(async () => {});
    const resolveLocatorPoint = vi.fn(async () => ({
      ok: true as const,
      point: popupPoint(),
    }));

    const result = await verifyPopupTriggerClick({
      clickCount: 1,
      locator: { css: '#menu' },
      point: popupPoint(),
      resolveLocatorPoint,
      dispatchCdpClick,
      mapDispatchError: () => ({
        code: 'INTERNAL',
        message: 'boom',
        retryable: false,
      }),
      delayMs: async () => {},
    });

    expect(dispatchCdpClick).toHaveBeenCalledWith(24, 48, 1);
    expect(result).toEqual({
      ok: false,
      error: expect.objectContaining({
        code: 'FAILED_PRECONDITION',
        details: expect.objectContaining({
          reason: 'click_state_unchanged',
          aria_expanded_before: 'false',
          aria_expanded_after: 'false',
        }),
      }),
    });
  });

  it('succeeds when popup trigger state changes', async () => {
    const result = await verifyPopupTriggerClick({
      clickCount: 1,
      locator: { css: '#menu' },
      point: popupPoint(),
      resolveLocatorPoint: async () => ({
        ok: true,
        point: popupPoint({ ariaExpanded: 'true', dataState: 'open' }),
      }),
      dispatchCdpClick: async () => {},
      mapDispatchError: () => ({
        code: 'INTERNAL',
        message: 'boom',
        retryable: false,
      }),
      delayMs: async () => {},
    });

    expect(result).toEqual({ ok: true });
  });

  it('treats locator disappearance after click as success', async () => {
    const result = await verifyPopupTriggerClick({
      clickCount: 1,
      locator: { css: '#menu' },
      point: popupPoint(),
      resolveLocatorPoint: async () => ({
        ok: false,
        error: {
          code: 'LOCATOR_NOT_FOUND',
          message: 'gone',
          retryable: false,
        },
      }),
      dispatchCdpClick: async () => {},
      mapDispatchError: () => ({
        code: 'INTERNAL',
        message: 'boom',
        retryable: false,
      }),
      delayMs: async () => {},
    });

    expect(result).toEqual({ ok: true });
  });

  it('preserves dispatch failures through the mapper', async () => {
    const result = await verifyPopupTriggerClick({
      clickCount: 2,
      locator: { css: '#menu' },
      point: popupPoint(),
      resolveLocatorPoint: async () => ({
        ok: true,
        point: popupPoint({ ariaExpanded: 'true' }),
      }),
      dispatchCdpClick: async () => {
        throw new Error('Debugger is detached');
      },
      mapDispatchError: (error) => ({
        code: 'DEBUGGER',
        message: error instanceof Error ? error.message : 'unknown',
        retryable: true,
      }),
      delayMs: async () => {},
    });

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'DEBUGGER',
        message: 'Debugger is detached',
        retryable: true,
      },
    });
  });

  it('only swallows post-click read errors that imply page churn', () => {
    expect(
      shouldTreatPostClickReadErrorAsSuccess({
        code: 'TIMEOUT',
        message: 'later',
        retryable: true,
      })
    ).toBe(true);
    expect(
      shouldTreatPostClickReadErrorAsSuccess({
        code: 'EVALUATION_FAILED',
        message: 'broken',
        retryable: false,
      })
    ).toBe(false);
  });
});
