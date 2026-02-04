type DriveErrorInfo = {
  code: string;
  message: string;
  retryable: boolean;
  details?: Record<string, unknown>;
};

type ContentResult =
  | { ok: true; result?: unknown }
  | { ok: false; error: DriveErrorInfo };

const runDriveAction = async (
  action: string,
  params: Record<string, unknown> | undefined
): Promise<ContentResult> => {
  const buildError = (
    code: string,
    message: string,
    details?: Record<string, unknown>
  ): ContentResult => ({
    ok: false,
    error: {
      code,
      message,
      retryable: false,
      ...(details ? { details } : {}),
    },
  });

  const ok = (result?: unknown): ContentResult => ({ ok: true, result });

  const escapeSelector = (value: string): string => {
    if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
      return CSS.escape(value);
    }
    return value.replace(/[\\"']/g, '\\$&');
  };

  const isVisible = (element: Element): boolean => {
    if (!(element instanceof HTMLElement)) {
      return false;
    }
    const style = window.getComputedStyle(element);
    if (style.visibility === 'hidden' || style.display === 'none') {
      return false;
    }
    return element.getClientRects().length > 0;
  };

  // Heuristic guard against unsafe regex patterns to avoid ReDoS in url_matches.
  const buildUrlMatcher = (
    pattern: string
  ):
    | { ok: true; matcher: (url: string) => boolean }
    | { ok: false; error: ContentResult } => {
    const maxLength = 256;
    if (pattern.length > maxLength) {
      return {
        ok: false,
        error: buildError(
          "INVALID_ARGUMENT",
          `url_matches pattern exceeds ${maxLength} characters.`
        ),
      };
    }
    const nestedQuantifiers =
      /\((?:[^()\\]|\\.)*[+*{](?:[^()\\]|\\.)*\)[+*{]/.test(pattern);
    const repeatedWildcards = /(\.\*.*\.\*)|(\.\+.*\.\+)/.test(pattern);
    if (nestedQuantifiers || repeatedWildcards) {
      return {
        ok: false,
        error: buildError(
          "INVALID_ARGUMENT",
          "url_matches pattern rejected due to unsafe regex complexity."
        ),
      };
    }
    try {
      const regex = new RegExp(pattern);
      return { ok: true, matcher: (url: string) => regex.test(url) };
    } catch {
      return { ok: true, matcher: (url: string) => url.includes(pattern) };
    }
  };

  const findByText = (text: string): Element | null => {
    const tree = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_ELEMENT
    );
    let node = tree.nextNode();
    while (node) {
      const element = node as Element;
      if (element.textContent && element.textContent.includes(text)) {
        return element;
      }
      node = tree.nextNode();
    }
    return null;
  };

  const findByRole = (locator: Record<string, unknown>): Element | null => {
    const role = locator.role;
    if (!role || typeof role !== 'object') {
      return null;
    }
    const roleName = (role as Record<string, unknown>).name;
    const roleValue = (role as Record<string, unknown>).value;
    if (typeof roleName !== 'string' || roleName.length === 0) {
      return null;
    }
    const candidates = Array.from(
      document.querySelectorAll(`[role="${escapeSelector(roleName)}"]`)
    );
    if (typeof roleValue !== 'string' || roleValue.length === 0) {
      return candidates[0] ?? null;
    }
    return (
      candidates.find((candidate) => {
        const label = candidate.getAttribute('aria-label') ?? '';
        const text = candidate.textContent ?? '';
        return label.includes(roleValue) || text.includes(roleValue);
      }) ?? null
    );
  };

  const resolveLocator = (
    locator: Record<string, unknown> | undefined
  ): Element | null => {
    if (!locator) {
      return null;
    }
    const testid = locator.testid;
    if (typeof testid === 'string' && testid.length > 0) {
      const selector = `[data-testid="${escapeSelector(testid)}"]`;
      const found = document.querySelector(selector);
      if (found) {
        return found;
      }
    }
    const css = locator.css;
    if (typeof css === 'string' && css.length > 0) {
      const found = document.querySelector(css);
      if (found) {
        return found;
      }
    }
    const byRole = findByRole(locator);
    if (byRole) {
      return byRole;
    }
    const text = locator.text;
    if (typeof text === 'string' && text.length > 0) {
      return findByText(text);
    }
    return null;
  };

  const activeEditableElement = (): HTMLElement | null => {
    const active = document.activeElement;
    if (!active || !(active instanceof HTMLElement)) {
      return null;
    }
    const tag = active.tagName.toLowerCase();
    if (tag === 'input' || tag === 'textarea' || active.isContentEditable) {
      return active;
    }
    return null;
  };

  const parseParams = (): Record<string, unknown> => params ?? {};

  try {
    switch (action) {
      case 'drive.navigate': {
        const { url } = parseParams();
        if (typeof url !== 'string' || url.length === 0) {
          return buildError(
            'INVALID_ARGUMENT',
            'url must be a non-empty string.'
          );
        }
        window.location.href = url;
        return ok();
      }
      case 'drive.click': {
        const { locator, click_count } = parseParams();
        const target = resolveLocator(locator as Record<string, unknown>);
        if (!target) {
          return buildError('LOCATOR_NOT_FOUND', 'Failed to resolve locator.');
        }
        const count =
          typeof click_count === 'number' && Number.isFinite(click_count)
            ? Math.max(1, Math.floor(click_count))
            : 1;
        for (let i = 0; i < count; i += 1) {
          (target as HTMLElement).click();
        }
        return ok();
      }
      case 'drive.type': {
        const { locator, text, clear, submit } = parseParams();
        if (typeof text !== 'string') {
          return buildError('INVALID_ARGUMENT', 'text must be a string.');
        }
        let target = resolveLocator(
          locator as Record<string, unknown> | undefined
        );
        if (!target) {
          const active = activeEditableElement();
          if (active) {
            target = active;
          }
        }
        if (!target || !(target instanceof HTMLElement)) {
          return buildError('LOCATOR_NOT_FOUND', 'Failed to resolve locator.');
        }
        target.focus();
        const tag = target.tagName.toLowerCase();
        const shouldClear = Boolean(clear);
        if (tag === 'input' || tag === 'textarea') {
          const input = target as HTMLInputElement | HTMLTextAreaElement;
          if (shouldClear) {
            input.value = '';
          }
          input.value = `${input.value}${text}`;
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
        } else if (target.isContentEditable) {
          if (shouldClear) {
            target.textContent = '';
          }
          target.textContent = `${target.textContent ?? ''}${text}`;
          target.dispatchEvent(new Event('input', { bubbles: true }));
        } else {
          return buildError(
            'INVALID_ARGUMENT',
            'Target is not editable (input, textarea, or contenteditable).'
          );
        }

        if (submit) {
          const form = target.closest('form');
          if (form && form instanceof HTMLFormElement) {
            form.requestSubmit();
          } else {
            target.dispatchEvent(
              new KeyboardEvent('keydown', {
                key: 'Enter',
                bubbles: true,
              })
            );
          }
        }

        return ok();
      }
      case 'drive.scroll': {
        const { delta_x, delta_y, top, left, behavior } = parseParams();
        const scrollBehavior =
          behavior === 'smooth' || behavior === 'auto' ? behavior : undefined;
        if (typeof top === 'number' || typeof left === 'number') {
          window.scrollTo({
            top: typeof top === 'number' ? top : undefined,
            left: typeof left === 'number' ? left : undefined,
            behavior: scrollBehavior,
          });
          return ok();
        }
        if (typeof delta_x === 'number' || typeof delta_y === 'number') {
          window.scrollBy({
            left: typeof delta_x === 'number' ? delta_x : 0,
            top: typeof delta_y === 'number' ? delta_y : 0,
            behavior: scrollBehavior,
          });
          return ok();
        }
        return buildError(
          'INVALID_ARGUMENT',
          'scroll requires delta_x/delta_y or top/left.'
        );
      }
      case 'drive.wait_for': {
        const { condition, timeout_ms } = parseParams();
        if (!condition || typeof condition !== 'object') {
          return buildError('INVALID_ARGUMENT', 'condition must be an object.');
        }
        const kind = (condition as Record<string, unknown>).kind;
        const value = (condition as Record<string, unknown>).value;
        if (
          typeof kind !== 'string' ||
          !['locator_visible', 'text_present', 'url_matches'].includes(kind)
        ) {
          return buildError(
            'INVALID_ARGUMENT',
            'condition.kind must be locator_visible, text_present, or url_matches.'
          );
        }
        if (typeof value !== 'string' || value.length === 0) {
          return buildError(
            'INVALID_ARGUMENT',
            'condition.value must be a non-empty string.'
          );
        }
        const timeout =
          typeof timeout_ms === 'number' && Number.isFinite(timeout_ms)
            ? Math.max(0, timeout_ms)
            : 30000;
        const start = Date.now();
        const urlMatcher =
          kind === "url_matches" ? buildUrlMatcher(value) : null;
        if (urlMatcher && !urlMatcher.ok) {
          return urlMatcher.error;
        }

        const checkCondition = (): boolean => {
          if (kind === 'text_present') {
            return (document.body?.innerText ?? '').includes(value);
          }
          if (kind === 'url_matches') {
            return urlMatcher
              ? urlMatcher.matcher(window.location.href)
              : window.location.href.includes(value);
          }
          const selector = value;
          const element = document.querySelector(selector);
          return Boolean(element && isVisible(element));
        };

        return await new Promise<ContentResult>((resolve) => {
          const tick = () => {
            if (checkCondition()) {
              resolve(ok());
              return;
            }
            if (Date.now() - start >= timeout) {
              resolve(
                buildError('TIMEOUT', `wait_for timed out after ${timeout}ms.`)
              );
              return;
            }
            window.setTimeout(tick, 100);
          };
          tick();
        });
      }
      default:
        return buildError('INVALID_ARGUMENT', `Unsupported action ${action}.`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return buildError('EVALUATION_FAILED', message);
  }
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

chrome.runtime.onMessage.addListener(
  (
    message: Record<string, unknown>,
    _sender: unknown,
    sendResponse: (response: ContentResult) => void
  ) => {
    if (!isRecord(message) || typeof message.action !== 'string') {
      sendResponse({
        ok: false,
        error: {
          code: 'INVALID_ARGUMENT',
          message: 'Invalid content script request.',
          retryable: false,
        },
      });
      return;
    }

    void runDriveAction(
      message.action,
      message.params as Record<string, unknown>
    )
      .then(sendResponse)
      .catch((error) => {
        const messageText =
          error instanceof Error ? error.message : 'Unknown error';
        sendResponse({
          ok: false,
          error: {
            code: 'EVALUATION_FAILED',
            message: messageText,
            retryable: false,
          },
        });
      });

    return true;
  }
);
