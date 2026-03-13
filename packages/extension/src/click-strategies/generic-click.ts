type DriveErrorInfo = {
  code: string;
  message: string;
  retryable: boolean;
  details?: Record<string, unknown>;
};

type ContentResult =
  | { ok: true; result?: unknown }
  | { ok: false; error: DriveErrorInfo };

export const executeGenericClick = (options: {
  target: Element;
  clickCount: number;
}): ContentResult => {
  const { target, clickCount } = options;
  // Clicking elements that trigger JS dialogs (alert/confirm/prompt) can block
  // the renderer thread before we can reply to the background script, so defer
  // the actual click to the next tick and acknowledge immediately.
  window.setTimeout(() => {
    try {
      if (target instanceof HTMLElement) {
        try {
          target.focus({ preventScroll: true });
        } catch {
          target.focus();
        }
      }
      for (let i = 0; i < clickCount; i += 1) {
        (target as HTMLElement).click();
      }
    } catch {
      // Best-effort: the element may have disappeared or navigation occurred.
    }
  }, 0);
  return { ok: true };
};
