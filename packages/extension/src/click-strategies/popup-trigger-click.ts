import {
  popupTriggerStateChanged,
  readPopupTriggerState,
  type PopupTriggerState,
} from '../popup-trigger-state.js';

type DriveErrorInfo = {
  code: string;
  message: string;
  retryable: boolean;
  details?: Record<string, unknown>;
};

type ContentResult =
  | { ok: true; result?: unknown }
  | { ok: false; error: DriveErrorInfo };

export const executePopupTriggerClick = async (options: {
  target: Element;
  beforeState: PopupTriggerState;
  clickCount: number;
  locationBefore: string;
  sleep: (ms: number) => Promise<void>;
  settleMs?: number;
}): Promise<ContentResult> => {
  const popupTarget = options.target as HTMLElement;
  try {
    popupTarget.focus({ preventScroll: true });
  } catch {
    popupTarget.focus();
  }
  for (let i = 0; i < options.clickCount; i += 1) {
    popupTarget.click();
  }
  await options.sleep(options.settleMs ?? 50);
  if (
    window.location.href !== options.locationBefore ||
    !options.target.isConnected
  ) {
    return { ok: true };
  }
  const popupTriggerAfter = readPopupTriggerState(options.target);
  if (
    !popupTriggerStateChanged(options.beforeState, popupTriggerAfter ?? null)
  ) {
    return {
      ok: false,
      error: {
        code: 'FAILED_PRECONDITION',
        message:
          'Click focused the popup trigger but did not change its open state.',
        retryable: false,
        details: {
          reason: 'click_state_unchanged',
          control: options.beforeState.kind,
          aria_haspopup: options.beforeState.ariaHasPopup,
          aria_expanded_before: options.beforeState.ariaExpanded,
          aria_expanded_after: popupTriggerAfter?.ariaExpanded,
          data_state_before: options.beforeState.dataState,
          data_state_after: popupTriggerAfter?.dataState,
        },
      },
    };
  }
  return { ok: true };
};
