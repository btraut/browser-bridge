import {
  readPopupTriggerState,
  type PopupTriggerState,
} from '../popup-trigger-state.js';

export type ClickStrategySelection =
  | { kind: 'generic' }
  | { kind: 'popup_trigger'; state: PopupTriggerState };

export const selectClickStrategy = (
  target: Element
): ClickStrategySelection => {
  const popupTriggerState = readPopupTriggerState(target);
  if (popupTriggerState) {
    return {
      kind: 'popup_trigger',
      state: popupTriggerState,
    };
  }
  return { kind: 'generic' };
};
