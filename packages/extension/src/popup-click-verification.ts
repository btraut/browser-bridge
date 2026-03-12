import type { DriveErrorInfo } from './protocol.js';
import {
  popupTriggerStateChanged,
  type PopupTriggerState,
} from './popup-trigger-state.js';

export type LocatorPoint = {
  x: number;
  y: number;
  targetState?: PopupTriggerState;
};

type PointResult =
  | { ok: true; point: LocatorPoint }
  | { ok: false; error: DriveErrorInfo };

export const POPUP_TRIGGER_CLICK_SETTLE_MS = 50;

export const shouldTreatPostClickReadErrorAsSuccess = (
  error: DriveErrorInfo
): boolean => {
  return (
    error.code === 'LOCATOR_NOT_FOUND' ||
    error.code === 'NOT_FOUND' ||
    (error.retryable === true &&
      (error.code === 'TIMEOUT' ||
        error.details?.reason === 'transient_tab_channel_error'))
  );
};

export const verifyPopupTriggerClick = async (options: {
  clickCount: number;
  locator: unknown;
  point: LocatorPoint;
  resolveLocatorPoint: (locator: unknown) => Promise<PointResult>;
  dispatchCdpClick: (x: number, y: number, clickCount: number) => Promise<void>;
  mapDispatchError: (error: unknown) => DriveErrorInfo;
  delayMs: (ms: number) => Promise<void>;
  settleMs?: number;
}): Promise<{ ok: true } | { ok: false; error: DriveErrorInfo }> => {
  try {
    await options.dispatchCdpClick(
      options.point.x,
      options.point.y,
      options.clickCount
    );
  } catch (error) {
    return { ok: false, error: options.mapDispatchError(error) };
  }

  await options.delayMs(options.settleMs ?? POPUP_TRIGGER_CLICK_SETTLE_MS);

  const after = await options.resolveLocatorPoint(options.locator);
  if (!after.ok) {
    if (shouldTreatPostClickReadErrorAsSuccess(after.error)) {
      return { ok: true };
    }
    return after;
  }

  if (
    popupTriggerStateChanged(
      options.point.targetState ?? null,
      after.point.targetState ?? null
    )
  ) {
    return { ok: true };
  }

  return {
    ok: false,
    error: {
      code: 'FAILED_PRECONDITION',
      message:
        'Click focused the popup trigger but did not change its open state.',
      retryable: false,
      details: {
        reason: 'click_state_unchanged',
        control: 'popup_trigger',
        aria_haspopup: options.point.targetState?.ariaHasPopup,
        aria_expanded_before: options.point.targetState?.ariaExpanded,
        aria_expanded_after: after.point.targetState?.ariaExpanded,
        data_state_before: options.point.targetState?.dataState,
        data_state_after: after.point.targetState?.dataState,
      },
    },
  };
};
