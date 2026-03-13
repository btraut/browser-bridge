import {
  popupTriggerStateChanged,
  readPopupTriggerState,
} from './popup-trigger-state.js';

type DriveErrorInfo = {
  code: string;
  message: string;
  retryable: boolean;
  details?: Record<string, unknown>;
};

type ContentResult =
  | { ok: true; result?: unknown }
  | { ok: false; error: DriveErrorInfo };

const AGENT_TAB_BRANDING_ACTION = 'drive.agent_tab_branding';
const AGENT_TAB_FAVICON_MARKER_ATTR = 'data-bb-agent-favicon';
const SNAPSHOT_REF_REGISTRY_ID = '__bb_snapshot_ref_registry__';

const applyAgentTabFavicon = (faviconUrl: string): void => {
  if (faviconUrl.length === 0) {
    return;
  }
  const links = Array.from(
    document.querySelectorAll('link[rel~="icon"]')
  ).filter((node): node is HTMLLinkElement => node instanceof HTMLLinkElement);
  if (links.length > 0) {
    for (const link of links) {
      link.href = faviconUrl;
      if (!link.type) {
        link.type = 'image/png';
      }
    }
    return;
  }

  const head = document.head ?? document.documentElement;
  if (!head) {
    return;
  }
  const link = document.createElement('link');
  link.rel = 'icon';
  link.type = 'image/png';
  link.href = faviconUrl;
  link.setAttribute(AGENT_TAB_FAVICON_MARKER_ATTR, 'true');
  head.appendChild(link);
};

export const runDriveAction = async (
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

  const normalizeText = (value: string): string =>
    value.replace(/\s+/g, ' ').trim();

  const isClickable = (element: Element): boolean =>
    element instanceof HTMLElement &&
    element.matches(
      'a,button,input,textarea,select,summary,label,[role="button"],[tabindex]'
    );

  const getNodeDepth = (element: Element): number => {
    let depth = 0;
    let current: Element | null = element;
    while (current) {
      depth += 1;
      current = current.parentElement;
    }
    return depth;
  };

  const isVisible = (element: Element): boolean => {
    if (!(element instanceof HTMLElement)) {
      return false;
    }
    const style = window.getComputedStyle(element);
    if (style.visibility === 'hidden' || style.display === 'none') {
      return false;
    }
    const rect = element.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) {
      return false;
    }
    if (
      element.offsetWidth === 0 &&
      element.offsetHeight === 0 &&
      element.getClientRects().length === 0
    ) {
      return false;
    }
    let current: HTMLElement | null = element;
    while (current) {
      const style = window.getComputedStyle(current);
      if (style.display === 'none') {
        return false;
      }
      if (style.visibility === 'hidden' || style.visibility === 'collapse') {
        return false;
      }
      const opacity = Number.parseFloat(style.opacity ?? '1');
      if (Number.isFinite(opacity) && opacity <= 0) {
        return false;
      }
      current = current.parentElement;
    }
    return true;
  };

  const isOnScreen = (element: Element): boolean => {
    if (!(element instanceof HTMLElement) || !isVisible(element)) {
      return false;
    }
    const rect = element.getBoundingClientRect();
    return (
      rect.right > 0 &&
      rect.bottom > 0 &&
      rect.left < window.innerWidth &&
      rect.top < window.innerHeight
    );
  };

  const pointHitsTarget = (
    target: Element,
    x: number,
    y: number,
    options?: { directOnly?: boolean }
  ): boolean => {
    if (typeof document.elementFromPoint !== 'function') {
      return true;
    }
    const hit = document.elementFromPoint(x, y);
    if (!hit) {
      return false;
    }
    if (options?.directOnly) {
      return target === hit;
    }
    return target === hit || target.contains(hit);
  };

  const getHittablePoint = (
    target: Element,
    options?: { preferDirectHit?: boolean }
  ): { x: number; y: number } => {
    const rect = target.getBoundingClientRect();
    const insetX = Math.min(Math.max(rect.width * 0.25, 1), rect.width / 2);
    const insetY = Math.min(Math.max(rect.height * 0.25, 1), rect.height / 2);
    const candidatePoints = [
      { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 },
      { x: rect.left + insetX, y: rect.top + insetY },
      { x: rect.right - insetX, y: rect.top + insetY },
      { x: rect.left + insetX, y: rect.bottom - insetY },
      { x: rect.right - insetX, y: rect.bottom - insetY },
      { x: rect.left + rect.width / 2, y: rect.top + insetY },
      { x: rect.left + rect.width / 2, y: rect.bottom - insetY },
      { x: rect.left + insetX, y: rect.top + rect.height / 2 },
      { x: rect.right - insetX, y: rect.top + rect.height / 2 },
    ];
    if (options?.preferDirectHit) {
      for (const point of candidatePoints) {
        if (pointHitsTarget(target, point.x, point.y, { directOnly: true })) {
          return point;
        }
      }
    }
    for (const point of candidatePoints) {
      if (pointHitsTarget(target, point.x, point.y)) {
        return point;
      }
    }
    return candidatePoints[0] ?? { x: rect.left, y: rect.top };
  };

  const collectVisibleText = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) {
      return node.textContent || '';
    }
    if (!(node instanceof Element)) {
      return '';
    }
    if (!isVisible(node)) {
      return '';
    }
    if (node instanceof HTMLElement) {
      const { innerText } = node;
      if (typeof innerText === 'string' && innerText.length > 0) {
        return innerText;
      }
    }
    return Array.from(node.childNodes)
      .map((child) => collectVisibleText(child))
      .join('');
  };

  const getRenderedText = (element: Element): string =>
    normalizeText(collectVisibleText(element));

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
          'INVALID_ARGUMENT',
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
          'INVALID_ARGUMENT',
          'url_matches pattern rejected due to unsafe regex complexity.'
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
    const query = normalizeText(text);
    if (query.length === 0) {
      return null;
    }

    const candidateMap = new Map<
      Element,
      {
        exact: boolean;
        onScreen: boolean;
        clickable: boolean;
        textLength: number;
        depth: number;
      }
    >();
    const tree = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_ELEMENT
    );
    let node = tree.nextNode();
    while (node) {
      const element = node as Element;
      if (!isVisible(element)) {
        node = tree.nextNode();
        continue;
      }
      const elementText = getRenderedText(element);
      if (!elementText.includes(query)) {
        node = tree.nextNode();
        continue;
      }

      let preferredTarget: Element = element;
      let current: Element | null = element;
      while (current) {
        if (
          current !== element &&
          isVisible(current) &&
          isClickable(current) &&
          getRenderedText(current).includes(query)
        ) {
          preferredTarget = current;
          break;
        }
        current = current.parentElement;
      }

      const preferredText = getRenderedText(preferredTarget);
      const currentBest = candidateMap.get(preferredTarget);
      const nextScore = {
        exact: preferredText === query || elementText === query,
        onScreen: isOnScreen(preferredTarget),
        clickable: isClickable(preferredTarget),
        textLength: preferredText.length || elementText.length,
        depth: getNodeDepth(preferredTarget),
      };

      if (
        !currentBest ||
        Number(nextScore.exact) > Number(currentBest.exact) ||
        (nextScore.exact === currentBest.exact &&
          Number(nextScore.onScreen) > Number(currentBest.onScreen)) ||
        (nextScore.exact === currentBest.exact &&
          nextScore.onScreen === currentBest.onScreen &&
          Number(nextScore.clickable) > Number(currentBest.clickable)) ||
        (nextScore.exact === currentBest.exact &&
          nextScore.onScreen === currentBest.onScreen &&
          nextScore.clickable === currentBest.clickable &&
          nextScore.textLength < currentBest.textLength) ||
        (nextScore.exact === currentBest.exact &&
          nextScore.onScreen === currentBest.onScreen &&
          nextScore.clickable === currentBest.clickable &&
          nextScore.textLength === currentBest.textLength &&
          nextScore.depth > currentBest.depth)
      ) {
        candidateMap.set(preferredTarget, nextScore);
      }

      node = tree.nextNode();
    }

    const candidates = Array.from(candidateMap.entries()).sort((a, b) => {
      const [, left] = a;
      const [, right] = b;
      if (left.exact !== right.exact) {
        return left.exact ? -1 : 1;
      }
      if (left.onScreen !== right.onScreen) {
        return left.onScreen ? -1 : 1;
      }
      if (left.clickable !== right.clickable) {
        return left.clickable ? -1 : 1;
      }
      if (left.textLength !== right.textLength) {
        return left.textLength - right.textLength;
      }
      return right.depth - left.depth;
    });

    return candidates[0]?.[0] ?? null;
  };

  const getRoleCandidates = (roleName: string): Element[] => {
    const selectorMap: Record<string, string> = {
      button:
        'button,[role="button"],input[type="button"],input[type="submit"],input[type="reset"],summary',
      link: 'a[href],[role="link"]',
      checkbox: 'input[type="checkbox"],[role="checkbox"]',
      radio: 'input[type="radio"],[role="radio"]',
      textbox:
        'textarea,input:not([type]),input[type="text"],input[type="search"],input[type="email"],input[type="url"],input[type="tel"],input[type="password"],[role="textbox"]',
      combobox: 'select,input[list],[role="combobox"]',
    };
    const selector =
      selectorMap[roleName] ?? `[role="${escapeSelector(roleName)}"]`;
    return Array.from(document.querySelectorAll(selector)).filter(isVisible);
  };

  const getRoleAccessibleName = (element: Element): string =>
    normalizeText(
      element.getAttribute('aria-label') ??
        element.getAttribute('title') ??
        getRenderedText(element)
    );

  const scoreCandidates = (
    candidates: Element[],
    options?: {
      exactText?: string;
      exactHref?: string;
    }
  ): Element | null => {
    const queryText = options?.exactText
      ? normalizeText(options.exactText)
      : '';
    const queryHref = options?.exactHref ?? '';
    if (candidates.length === 0) {
      return null;
    }
    const scored = candidates
      .filter(isVisible)
      .map((candidate) => {
        const text = getRenderedText(candidate);
        const href = candidate.getAttribute('href') ?? '';
        return {
          candidate,
          exactText: queryText.length > 0 && text === queryText,
          exactHref:
            queryHref.length > 0 &&
            (href === queryHref ||
              (candidate instanceof HTMLAnchorElement &&
                candidate.href === queryHref)),
          onScreen: isOnScreen(candidate),
          clickable: isClickable(candidate),
          textLength: text.length,
          depth: getNodeDepth(candidate),
        };
      })
      .sort((a, b) => {
        if (a.exactHref !== b.exactHref) {
          return a.exactHref ? -1 : 1;
        }
        if (a.exactText !== b.exactText) {
          return a.exactText ? -1 : 1;
        }
        if (a.onScreen !== b.onScreen) {
          return a.onScreen ? -1 : 1;
        }
        if (a.clickable !== b.clickable) {
          return a.clickable ? -1 : 1;
        }
        if (a.textLength !== b.textLength) {
          return a.textLength - b.textLength;
        }
        return b.depth - a.depth;
      });
    return scored[0]?.candidate ?? candidates[0] ?? null;
  };

  const readSnapshotRefRegistry = (): Map<
    string,
    { role?: string; name?: string; url?: string }
  > => {
    const registry = new Map<
      string,
      { role?: string; name?: string; url?: string }
    >();
    const el = document.getElementById(SNAPSHOT_REF_REGISTRY_ID);
    const raw = el?.textContent;
    if (!raw) {
      return registry;
    }
    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        return registry;
      }
      for (const entry of parsed) {
        if (!entry || typeof entry !== 'object') {
          continue;
        }
        const ref = (entry as { ref?: unknown }).ref;
        if (typeof ref !== 'string' || ref.length === 0) {
          continue;
        }
        registry.set(ref, {
          role:
            typeof (entry as { role?: unknown }).role === 'string'
              ? ((entry as { role?: string }).role ?? undefined)
              : undefined,
          name:
            typeof (entry as { name?: unknown }).name === 'string'
              ? ((entry as { name?: string }).name ?? undefined)
              : undefined,
          url:
            typeof (entry as { url?: unknown }).url === 'string'
              ? ((entry as { url?: string }).url ?? undefined)
              : undefined,
        });
      }
    } catch {
      return new Map();
    }
    return registry;
  };

  const findBySnapshotRefFallback = (ref: string): Element | null => {
    const metadata = readSnapshotRefRegistry().get(ref);
    if (!metadata) {
      return null;
    }

    if (typeof metadata.url === 'string' && metadata.url.length > 0) {
      const linkCandidates = Array.from(
        document.querySelectorAll('a[href],[role="link"]')
      );
      const bestLink = scoreCandidates(linkCandidates, {
        exactHref: metadata.url,
        exactText: metadata.name,
      });
      if (bestLink) {
        return bestLink;
      }
    }

    if (typeof metadata.role === 'string' && metadata.role.length > 0) {
      const roleMatch = findByRole({
        role: {
          name: metadata.role,
          ...(metadata.name ? { value: metadata.name } : {}),
        },
      });
      if (roleMatch) {
        return roleMatch;
      }
    }

    if (typeof metadata.name === 'string' && metadata.name.length > 0) {
      return findByText(metadata.name);
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
    const candidates = getRoleCandidates(roleName);
    if (typeof roleValue !== 'string' || roleValue.length === 0) {
      return candidates[0] ?? null;
    }

    const query = normalizeText(roleValue);
    const matching = candidates.filter((candidate) =>
      getRoleAccessibleName(candidate).includes(query)
    );
    if (matching.length === 0) {
      return null;
    }
    const exactMatches = matching.filter(
      (candidate) => getRoleAccessibleName(candidate) === query
    );
    return scoreCandidates(exactMatches.length > 0 ? exactMatches : matching, {
      exactText: query,
    });
  };

  const resolveLocator = (
    locator: Record<string, unknown> | undefined
  ): Element | null => {
    if (!locator) {
      return null;
    }
    const ref = locator.ref;
    if (typeof ref === 'string' && ref.length > 0) {
      const normalized = ref.startsWith('@') ? ref : `@${ref}`;
      const selector = `[data-bv-ref="${escapeSelector(normalized)}"]`;
      const found = document.querySelector(selector);
      if (found) {
        return found;
      }
      const fallback = findBySnapshotRefFallback(normalized);
      if (fallback) {
        return fallback;
      }
    }
    const testid = locator.testid;
    if (typeof testid === 'string' && testid.length > 0) {
      const selector = `[data-testid="${escapeSelector(testid)}"]`;
      const found = scoreCandidates(
        Array.from(document.querySelectorAll(selector))
      );
      if (found) {
        return found;
      }
    }
    const css = locator.css;
    if (typeof css === 'string' && css.length > 0) {
      const found = scoreCandidates(Array.from(document.querySelectorAll(css)));
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

  const coerceBoolean = (value: string | boolean): boolean => {
    if (typeof value === 'boolean') {
      return value;
    }
    const normalized = value.trim().toLowerCase();
    return ['true', '1', 'yes', 'y', 'on', 'checked'].includes(normalized);
  };

  const dispatchValueEvents = (element: HTMLElement): void => {
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  };

  const selectOption = (select: HTMLSelectElement, value: string): boolean => {
    const option = Array.from(select.options).find(
      (entry) => entry.value === value || entry.text === value
    );
    if (!option) {
      return false;
    }
    select.value = option.value;
    dispatchValueEvents(select);
    return true;
  };

  const selectOptionByIndex = (
    select: HTMLSelectElement,
    index: number
  ): boolean => {
    if (!Number.isInteger(index)) {
      return false;
    }
    if (index < 0 || index >= select.options.length) {
      return false;
    }
    select.selectedIndex = index;
    dispatchValueEvents(select);
    return true;
  };

  const setTextValue = (
    element: HTMLElement,
    value: string,
    clear: boolean
  ): boolean => {
    const tag = element.tagName.toLowerCase();
    if (tag === 'input' || tag === 'textarea') {
      const input = element as HTMLInputElement | HTMLTextAreaElement;
      if (clear) {
        input.value = '';
      }
      input.value = `${input.value}${value}`;
      dispatchValueEvents(input);
      return true;
    }
    if (element.isContentEditable) {
      if (clear) {
        element.textContent = '';
      }
      element.textContent = `${element.textContent ?? ''}${value}`;
      dispatchValueEvents(element);
      return true;
    }
    return false;
  };

  const detectFieldType = (
    element: Element
  ): 'text' | 'select' | 'checkbox' | 'radio' | 'contentEditable' => {
    if (element instanceof HTMLSelectElement) {
      return 'select';
    }
    if (element instanceof HTMLInputElement) {
      const type = element.type.toLowerCase();
      if (type === 'checkbox') {
        return 'checkbox';
      }
      if (type === 'radio') {
        return 'radio';
      }
      return 'text';
    }
    if (element instanceof HTMLTextAreaElement) {
      return 'text';
    }
    if (element instanceof HTMLElement && element.isContentEditable) {
      return 'contentEditable';
    }
    return 'text';
  };

  const submitIfRequested = (element: Element): void => {
    const form = element.closest('form');
    if (form && form instanceof HTMLFormElement) {
      form.requestSubmit();
    } else if (element instanceof HTMLElement) {
      element.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })
      );
    }
  };

  const sleep = (ms: number): Promise<void> =>
    new Promise((resolve) => window.setTimeout(resolve, ms));

  const dispatchPointer = (
    element: Element,
    type: string,
    x: number,
    y: number
  ): void => {
    element.dispatchEvent(
      new PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        clientX: x,
        clientY: y,
        button: 0,
      })
    );
  };

  const dispatchDrag = (
    element: Element,
    type: string,
    x: number,
    y: number,
    dataTransfer?: DataTransfer
  ): void => {
    try {
      element.dispatchEvent(
        new DragEvent(type, {
          bubbles: true,
          cancelable: true,
          clientX: x,
          clientY: y,
          dataTransfer,
        })
      );
    } catch {
      element.dispatchEvent(
        new Event(type, { bubbles: true, cancelable: true })
      );
    }
  };

  const keyToCode = (key: string): string => {
    const map: Record<string, string> = {
      Enter: 'Enter',
      Tab: 'Tab',
      Escape: 'Escape',
      Esc: 'Escape',
      Backspace: 'Backspace',
      Delete: 'Delete',
      ArrowUp: 'ArrowUp',
      ArrowDown: 'ArrowDown',
      ArrowLeft: 'ArrowLeft',
      ArrowRight: 'ArrowRight',
      Home: 'Home',
      End: 'End',
      PageUp: 'PageUp',
      PageDown: 'PageDown',
      ' ': 'Space',
      Space: 'Space',
    };
    if (map[key]) {
      return map[key];
    }
    if (key.length === 1) {
      if (/[a-zA-Z]/.test(key)) {
        return `Key${key.toUpperCase()}`;
      }
      if (/[0-9]/.test(key)) {
        return `Digit${key}`;
      }
    }
    return key;
  };

  const normalizeModifiers = (
    modifiers: unknown
  ): { ctrl: boolean; alt: boolean; shift: boolean; meta: boolean } => {
    const state = { ctrl: false, alt: false, shift: false, meta: false };
    if (Array.isArray(modifiers)) {
      modifiers.forEach((modifier) => {
        if (typeof modifier !== 'string') {
          return;
        }
        const normalized = modifier.toLowerCase();
        if (normalized === 'ctrl') {
          state.ctrl = true;
        } else if (normalized === 'alt') {
          state.alt = true;
        } else if (normalized === 'shift') {
          state.shift = true;
        } else if (normalized === 'meta') {
          state.meta = true;
        }
      });
      return state;
    }
    if (modifiers && typeof modifiers === 'object') {
      const record = modifiers as Record<string, unknown>;
      state.ctrl = Boolean(record.ctrl);
      state.alt = Boolean(record.alt);
      state.shift = Boolean(record.shift);
      state.meta = Boolean(record.meta);
    }
    return state;
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
      case AGENT_TAB_BRANDING_ACTION: {
        const { favicon_url: faviconUrl } = parseParams();
        if (typeof faviconUrl !== 'string' || faviconUrl.length === 0) {
          return buildError(
            'INVALID_ARGUMENT',
            'favicon_url must be a non-empty string.'
          );
        }
        applyAgentTabFavicon(faviconUrl);
        return ok();
      }
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
      case 'drive.locator_point': {
        const { locator } = parseParams();
        const target = resolveLocator(locator as Record<string, unknown>);
        if (!target) {
          return buildError('LOCATOR_NOT_FOUND', 'Failed to resolve locator.');
        }
        const targetState = readPopupTriggerState(target);
        const point = getHittablePoint(target, {
          preferDirectHit: targetState !== null,
        });
        return ok({
          x: point.x,
          y: point.y,
          ...(targetState ? { target_state: targetState } : {}),
        });
      }
      case 'drive.focus_locator': {
        const { locator } = parseParams();
        const target = resolveLocator(locator as Record<string, unknown>);
        if (!target || !(target instanceof HTMLElement)) {
          return buildError('LOCATOR_NOT_FOUND', 'Failed to resolve locator.');
        }
        try {
          target.focus({ preventScroll: true });
        } catch {
          target.focus();
        }
        return ok();
      }
      case 'drive.snapshot_html': {
        const html = document.documentElement?.outerHTML ?? '';
        return ok({ format: 'html', snapshot: html });
      }
      case 'drive.type_target_point': {
        const { locator } = parseParams();
        let target = resolveLocator(
          locator as Record<string, unknown> | undefined
        );
        if (!target) {
          target = activeEditableElement();
        }
        if (!target || !(target instanceof HTMLElement)) {
          return buildError('LOCATOR_NOT_FOUND', 'Failed to resolve locator.');
        }
        const tag = target.tagName.toLowerCase();
        if (
          tag !== 'input' &&
          tag !== 'textarea' &&
          !target.isContentEditable
        ) {
          return buildError(
            'INVALID_ARGUMENT',
            'Target is not editable (input, textarea, or contenteditable).'
          );
        }
        const rect = target.getBoundingClientRect();
        return ok({
          x: rect.left + rect.width / 2,
          y: rect.top + rect.height / 2,
        });
      }
      case 'drive.clear_active_editable': {
        const target = activeEditableElement();
        if (!target) {
          return buildError(
            'INVALID_ARGUMENT',
            'No active editable target to clear.'
          );
        }
        const tag = target.tagName.toLowerCase();
        if (tag === 'input' || tag === 'textarea') {
          const input = target as HTMLInputElement | HTMLTextAreaElement;
          input.value = '';
          dispatchValueEvents(input);
          return ok({ ok: true });
        }
        if (target.isContentEditable) {
          target.textContent = '';
          dispatchValueEvents(target);
          return ok({ ok: true });
        }
        return buildError(
          'INVALID_ARGUMENT',
          'Active target is not editable (input, textarea, or contenteditable).'
        );
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
        const popupTriggerBefore = readPopupTriggerState(target);
        const locationBefore = window.location.href;
        if (popupTriggerBefore) {
          const popupTarget = target as HTMLElement;
          try {
            popupTarget.focus({ preventScroll: true });
          } catch {
            popupTarget.focus();
          }
          for (let i = 0; i < count; i += 1) {
            popupTarget.click();
          }
          await sleep(50);
          if (window.location.href !== locationBefore || !target.isConnected) {
            return ok();
          }
          const popupTriggerAfter = readPopupTriggerState(target);
          if (
            !popupTriggerStateChanged(popupTriggerBefore, popupTriggerAfter)
          ) {
            return buildError(
              'FAILED_PRECONDITION',
              'Click focused the popup trigger but did not change its open state.',
              {
                reason: 'click_state_unchanged',
                control: popupTriggerBefore.kind,
                aria_haspopup: popupTriggerBefore.ariaHasPopup,
                aria_expanded_before: popupTriggerBefore.ariaExpanded,
                aria_expanded_after: popupTriggerAfter?.ariaExpanded,
                data_state_before: popupTriggerBefore.dataState,
                data_state_after: popupTriggerAfter?.dataState,
              }
            );
          }
          return ok();
        }
        // Clicking elements that trigger JS dialogs (alert/confirm/prompt) can
        // block the renderer thread before we can reply to the background script,
        // causing the caller to time out. Defer the click to the next tick so
        // we can respond immediately.
        window.setTimeout(() => {
          try {
            if (target instanceof HTMLElement) {
              try {
                target.focus({ preventScroll: true });
              } catch {
                target.focus();
              }
            }
            for (let i = 0; i < count; i += 1) {
              (target as HTMLElement).click();
            }
          } catch {
            // Best-effort: the element may have disappeared or navigation occurred.
          }
        }, 0);
        return ok();
      }
      case 'drive.hover': {
        const { locator, delay_ms } = parseParams();
        const target = resolveLocator(locator as Record<string, unknown>);
        if (!target) {
          return buildError('LOCATOR_NOT_FOUND', 'Failed to resolve locator.');
        }
        const rect = target.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        const eventInit = {
          bubbles: true,
          cancelable: true,
          clientX: centerX,
          clientY: centerY,
        };
        target.dispatchEvent(new MouseEvent('mouseover', eventInit));
        target.dispatchEvent(
          new MouseEvent('mouseenter', { ...eventInit, bubbles: false })
        );
        target.dispatchEvent(new MouseEvent('mousemove', eventInit));
        if (typeof delay_ms === 'number' && Number.isFinite(delay_ms)) {
          const waitMs = Math.min(Math.max(delay_ms, 0), 10000);
          if (waitMs > 0) {
            await sleep(waitMs);
          }
        }
        const html = document.documentElement?.outerHTML ?? '';
        return ok({ format: 'html', snapshot: html });
      }
      case 'drive.select': {
        const { locator, value, text, index } = parseParams();
        const target = resolveLocator(locator as Record<string, unknown>);
        if (!target) {
          return buildError('LOCATOR_NOT_FOUND', 'Failed to resolve locator.');
        }
        if (!(target instanceof HTMLSelectElement)) {
          return buildError(
            'INVALID_ARGUMENT',
            'Target is not a select element.'
          );
        }
        let applied = false;
        if (typeof index === 'number' && Number.isFinite(index)) {
          applied = selectOptionByIndex(target, Math.trunc(index));
        }
        if (!applied && typeof value === 'string') {
          applied = selectOption(target, value);
        }
        if (!applied && typeof text === 'string') {
          applied = selectOption(target, text);
        }
        if (!applied) {
          return buildError(
            'INVALID_ARGUMENT',
            'No matching option found for select.'
          );
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
      case 'drive.detect_field_type': {
        const { locator, selector } = parseParams();
        let target = resolveLocator(
          locator as Record<string, unknown> | undefined
        );
        if (!target && typeof selector === 'string' && selector.length > 0) {
          target = document.querySelector(selector);
        }
        if (!target) {
          return buildError('LOCATOR_NOT_FOUND', 'Failed to resolve locator.');
        }
        return ok({ fieldType: detectFieldType(target) });
      }
      case 'drive.fill_form': {
        const { fields } = parseParams();
        if (!Array.isArray(fields) || fields.length === 0) {
          return buildError(
            'INVALID_ARGUMENT',
            'fields must be a non-empty array.'
          );
        }
        let filled = 0;
        const errors: string[] = [];
        fields.forEach((field, index) => {
          if (!field || typeof field !== 'object') {
            errors.push(`Field ${index} is not an object.`);
            return;
          }
          const record = field as Record<string, unknown>;
          const selector = record.selector;
          const locator =
            record.locator && typeof record.locator === 'object'
              ? (record.locator as Record<string, unknown>)
              : undefined;
          let element: Element | null = null;
          if (locator) {
            element = resolveLocator(locator);
          }
          if (!element && typeof selector === 'string' && selector.length > 0) {
            element = document.querySelector(selector);
          }
          if (!element) {
            errors.push(`Field ${index} could not be resolved.`);
            return;
          }

          const value = record.value;
          if (typeof value !== 'string' && typeof value !== 'boolean') {
            errors.push(`Field ${index} has invalid value.`);
            return;
          }

          const type =
            typeof record.type === 'string' && record.type.length > 0
              ? record.type
              : 'auto';
          const resolvedType =
            type === 'auto' ? detectFieldType(element) : type;
          const submit = Boolean(record.submit);

          let applied = false;
          if (resolvedType === 'select') {
            if (element instanceof HTMLSelectElement) {
              applied = selectOption(element, String(value));
            }
          } else if (resolvedType === 'checkbox' || resolvedType === 'radio') {
            if (element instanceof HTMLInputElement) {
              const shouldCheck =
                typeof value === 'boolean' ? value : coerceBoolean(value);
              element.checked = shouldCheck;
              dispatchValueEvents(element);
              applied = true;
            }
          } else {
            if (element instanceof HTMLElement) {
              applied = setTextValue(element, String(value), true);
            }
          }

          if (!applied) {
            errors.push(`Field ${index} could not be filled.`);
            return;
          }

          if (submit) {
            submitIfRequested(element);
          }
          filled += 1;
        });

        return ok({
          filled,
          attempted: fields.length,
          errors: errors.length > 0 ? errors : [],
        });
      }
      case 'drive.drag': {
        const { from, to, steps } = parseParams();
        const fromEl = resolveLocator(from as Record<string, unknown>);
        if (!fromEl) {
          return buildError(
            'LOCATOR_NOT_FOUND',
            'Failed to resolve drag source.'
          );
        }
        const toEl = resolveLocator(to as Record<string, unknown>);
        if (!toEl) {
          return buildError(
            'LOCATOR_NOT_FOUND',
            'Failed to resolve drag target.'
          );
        }

        const fromRect = fromEl.getBoundingClientRect();
        const toRect = toEl.getBoundingClientRect();
        const startX = fromRect.left + fromRect.width / 2;
        const startY = fromRect.top + fromRect.height / 2;
        const endX = toRect.left + toRect.width / 2;
        const endY = toRect.top + toRect.height / 2;
        // Defensive bounds in case content script receives unvalidated inputs.
        const totalSteps =
          typeof steps === 'number' && Number.isFinite(steps)
            ? Math.max(1, Math.min(50, Math.floor(steps)))
            : 12;
        let dataTransfer: DataTransfer | undefined;
        try {
          dataTransfer = new DataTransfer();
        } catch {
          dataTransfer = undefined;
        }

        dispatchPointer(fromEl, 'pointerdown', startX, startY);
        dispatchDrag(fromEl, 'dragstart', startX, startY, dataTransfer);

        for (let i = 1; i <= totalSteps; i += 1) {
          const progress = i / totalSteps;
          const x = startX + (endX - startX) * progress;
          const y = startY + (endY - startY) * progress;
          const target = document.elementFromPoint(x, y) ?? toEl;
          dispatchPointer(target, 'pointermove', x, y);
          dispatchDrag(target, 'dragover', x, y, dataTransfer);
          await sleep(10);
        }

        const dropTarget = document.elementFromPoint(endX, endY) ?? toEl;
        dispatchDrag(dropTarget, 'drop', endX, endY, dataTransfer);
        dispatchPointer(dropTarget, 'pointerup', endX, endY);
        dispatchDrag(fromEl, 'dragend', endX, endY, dataTransfer);
        return ok();
      }
      case 'drive.key_press': {
        const { key, modifiers } = parseParams();
        if (typeof key !== 'string' || key.length === 0) {
          return buildError(
            'INVALID_ARGUMENT',
            'key must be a non-empty string.'
          );
        }
        const target =
          document.activeElement instanceof HTMLElement
            ? document.activeElement
            : document.body;
        if (!target) {
          return buildError('INVALID_ARGUMENT', 'No target for key press.');
        }
        const mods = normalizeModifiers(modifiers);
        const eventInit = {
          key,
          code: keyToCode(key),
          bubbles: true,
          cancelable: true,
          ctrlKey: mods.ctrl,
          altKey: mods.alt,
          shiftKey: mods.shift,
          metaKey: mods.meta,
        };
        target.dispatchEvent(new KeyboardEvent('keydown', eventInit));
        target.dispatchEvent(new KeyboardEvent('keyup', eventInit));
        return ok();
      }
      case 'drive.key': {
        const { key, modifiers, repeat } = parseParams();
        if (typeof key !== 'string' || key.length === 0) {
          return buildError(
            'INVALID_ARGUMENT',
            'key must be a non-empty string.'
          );
        }
        const target =
          document.activeElement instanceof HTMLElement
            ? document.activeElement
            : document.body;
        if (!target) {
          return buildError('INVALID_ARGUMENT', 'No target for key press.');
        }
        const mods = normalizeModifiers(modifiers);
        const eventInit = {
          key,
          code: keyToCode(key),
          bubbles: true,
          cancelable: true,
          ctrlKey: mods.ctrl,
          altKey: mods.alt,
          shiftKey: mods.shift,
          metaKey: mods.meta,
        };
        const count =
          typeof repeat === 'number' && Number.isFinite(repeat)
            ? Math.max(1, Math.min(50, Math.floor(repeat)))
            : 1;
        for (let i = 0; i < count; i += 1) {
          target.dispatchEvent(new KeyboardEvent('keydown', eventInit));
          target.dispatchEvent(new KeyboardEvent('keyup', eventInit));
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
      case 'drive.screenshot_meta': {
        const root = document.documentElement;
        const body = document.body;
        const scrollWidth = Math.max(
          root?.scrollWidth ?? 0,
          root?.clientWidth ?? 0,
          body?.scrollWidth ?? 0,
          body?.clientWidth ?? 0
        );
        const scrollHeight = Math.max(
          root?.scrollHeight ?? 0,
          root?.clientHeight ?? 0,
          body?.scrollHeight ?? 0,
          body?.clientHeight ?? 0
        );

        return ok({
          scrollX: window.scrollX,
          scrollY: window.scrollY,
          viewportWidth: window.innerWidth,
          viewportHeight: window.innerHeight,
          scrollWidth,
          scrollHeight,
          devicePixelRatio:
            typeof window.devicePixelRatio === 'number' &&
            Number.isFinite(window.devicePixelRatio) &&
            window.devicePixelRatio > 0
              ? window.devicePixelRatio
              : 1,
        });
      }
      case 'drive.screenshot_element': {
        const { selector } = parseParams();
        if (typeof selector !== 'string' || selector.trim().length === 0) {
          return buildError(
            'INVALID_ARGUMENT',
            'selector must be a non-empty string.'
          );
        }

        let element: Element | null = null;
        try {
          element = document.querySelector(selector);
        } catch {
          return buildError(
            'INVALID_ARGUMENT',
            'selector must be a valid CSS selector.'
          );
        }

        if (!element) {
          return buildError('INVALID_ARGUMENT', 'No element matched selector.');
        }

        try {
          (element as HTMLElement).scrollIntoView?.({
            block: 'center',
            inline: 'center',
          });
        } catch {
          // Ignore scroll failures; capture whatever is visible.
        }

        const rect = element.getBoundingClientRect();
        const scrollX = window.scrollX;
        const scrollY = window.scrollY;
        const dpr =
          typeof window.devicePixelRatio === 'number' &&
          Number.isFinite(window.devicePixelRatio) &&
          window.devicePixelRatio > 0
            ? window.devicePixelRatio
            : 1;

        return ok({
          selector,
          pageX: rect.left + scrollX,
          pageY: rect.top + scrollY,
          width: rect.width,
          height: rect.height,
          viewportLeft: rect.left,
          viewportTop: rect.top,
          viewportWidth: window.innerWidth,
          viewportHeight: window.innerHeight,
          scrollX,
          scrollY,
          devicePixelRatio: dpr,
        });
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
          kind === 'url_matches' ? buildUrlMatcher(value) : null;
        if (urlMatcher && !urlMatcher.ok) {
          return urlMatcher.error;
        }

        const checkCondition = (): boolean => {
          if (kind === 'text_present') {
            return getRenderedText(document.body).includes(
              normalizeText(value)
            );
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
      case 'drive.go_back': {
        // Trigger history changes on the next tick so the background script gets
        // our response before this page unloads.
        window.setTimeout(() => {
          history.back();
        }, 0);
        return ok();
      }
      case 'drive.go_forward': {
        window.setTimeout(() => {
          history.forward();
        }, 0);
        return ok();
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

if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
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
}
