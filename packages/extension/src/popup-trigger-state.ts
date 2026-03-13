export type PopupTriggerState = {
  kind: 'popup_trigger';
  ariaHasPopup?: string;
  ariaExpanded?: string;
  dataState?: string;
  open?: boolean;
};

const normalizeAttr = (value: string | null): string | undefined => {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

export const readPopupTriggerState = (
  target: Element
): PopupTriggerState | null => {
  if (!(target instanceof HTMLElement)) {
    return null;
  }
  const ariaHasPopup = normalizeAttr(target.getAttribute('aria-haspopup'));
  const ariaExpanded = normalizeAttr(target.getAttribute('aria-expanded'));
  const dataState = normalizeAttr(target.getAttribute('data-state'));
  const open =
    'open' in target && typeof (target as { open?: unknown }).open === 'boolean'
      ? ((target as { open: boolean }).open ?? false)
      : undefined;
  const qualifiesAsPopupTrigger =
    Boolean(ariaHasPopup) || ariaExpanded !== undefined || open !== undefined;
  if (!qualifiesAsPopupTrigger && dataState === undefined) {
    return null;
  }
  if (!qualifiesAsPopupTrigger) {
    return null;
  }
  return {
    kind: 'popup_trigger',
    ariaHasPopup,
    ariaExpanded,
    dataState,
    open,
  };
};

export const popupTriggerStateChanged = (
  before: PopupTriggerState | null,
  after: PopupTriggerState | null
): boolean => {
  if (!before || !after) {
    return before !== after;
  }
  return (
    before.ariaExpanded !== after.ariaExpanded ||
    before.dataState !== after.dataState ||
    before.open !== after.open
  );
};

export const coercePopupTriggerState = (
  value: unknown
): PopupTriggerState | undefined => {
  if (!value || typeof value !== 'object') {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  if (record.kind !== 'popup_trigger') {
    return undefined;
  }
  const ariaHasPopup =
    typeof record.ariaHasPopup === 'string' ? record.ariaHasPopup : undefined;
  const ariaExpanded =
    typeof record.ariaExpanded === 'string' ? record.ariaExpanded : undefined;
  const dataState =
    typeof record.dataState === 'string' ? record.dataState : undefined;
  const open = typeof record.open === 'boolean' ? record.open : undefined;
  return {
    kind: 'popup_trigger',
    ...(ariaHasPopup ? { ariaHasPopup } : {}),
    ...(ariaExpanded !== undefined ? { ariaExpanded } : {}),
    ...(dataState !== undefined ? { dataState } : {}),
    ...(open !== undefined ? { open } : {}),
  };
};
