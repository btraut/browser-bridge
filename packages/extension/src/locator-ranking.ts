import { getHittablePoint, pointHitsTarget } from './locator-point.js';

const collectVisibleText = (
  node: Node,
  isVisible: (element: Element) => boolean
): string => {
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
    .map((child) => collectVisibleText(child, isVisible))
    .join('');
};

export const normalizeText = (value: string): string =>
  value.replace(/\s+/g, ' ').trim();

export const isClickable = (element: Element): boolean =>
  element instanceof HTMLElement &&
  element.matches(
    'a,button,input,textarea,select,summary,label,[role="button"],[tabindex]'
  );

export const getNodeDepth = (element: Element): number => {
  let depth = 0;
  let current: Element | null = element;
  while (current) {
    depth += 1;
    current = current.parentElement;
  }
  return depth;
};

export const isVisible = (element: Element): boolean => {
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
    const currentStyle = window.getComputedStyle(current);
    if (currentStyle.display === 'none') {
      return false;
    }
    if (
      currentStyle.visibility === 'hidden' ||
      currentStyle.visibility === 'collapse'
    ) {
      return false;
    }
    const opacity = Number.parseFloat(currentStyle.opacity ?? '1');
    if (Number.isFinite(opacity) && opacity <= 0) {
      return false;
    }
    current = current.parentElement;
  }
  return true;
};

export const isOnScreen = (element: Element): boolean => {
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

export const getRenderedText = (element: Element): string =>
  normalizeText(collectVisibleText(element, isVisible));

export const getRoleAccessibleName = (element: Element): string =>
  normalizeText(
    element.getAttribute('aria-label') ??
      element.getAttribute('title') ??
      getRenderedText(element)
  );

const getActionabilityScore = (
  element: Element
): { directHit: boolean; hittable: boolean } => {
  if (!(element instanceof HTMLElement) || !isVisible(element)) {
    return { directHit: false, hittable: false };
  }
  const point = getHittablePoint(element, { preferDirectHit: true });
  return {
    directHit: pointHitsTarget(element, point.x, point.y, { directOnly: true }),
    hittable: pointHitsTarget(element, point.x, point.y),
  };
};

export const scoreCandidates = (
  candidates: Element[],
  options?: {
    exactText?: string;
    exactHref?: string;
  }
): Element | null => {
  const queryText = options?.exactText ? normalizeText(options.exactText) : '';
  const queryHref = options?.exactHref ?? '';
  if (candidates.length === 0) {
    return null;
  }
  const scored = candidates
    .filter(isVisible)
    .map((candidate) => {
      const text = getRenderedText(candidate);
      const accessibleName = getRoleAccessibleName(candidate);
      const href = candidate.getAttribute('href') ?? '';
      const actionability = getActionabilityScore(candidate);
      return {
        candidate,
        exactText:
          queryText.length > 0 &&
          (text === queryText || accessibleName === queryText),
        exactHref:
          queryHref.length > 0 &&
          (href === queryHref ||
            (candidate instanceof HTMLAnchorElement &&
              candidate.href === queryHref)),
        directHit: actionability.directHit,
        hittable: actionability.hittable,
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
      if (a.directHit !== b.directHit) {
        return a.directHit ? -1 : 1;
      }
      if (a.hittable !== b.hittable) {
        return a.hittable ? -1 : 1;
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

export const findByText = (text: string): Element | null => {
  const query = normalizeText(text);
  if (query.length === 0) {
    return null;
  }

  const candidateMap = new Map<
    Element,
    {
      exact: boolean;
      directHit: boolean;
      hittable: boolean;
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
    const actionability = getActionabilityScore(preferredTarget);
    const nextScore = {
      exact: preferredText === query || elementText === query,
      directHit: actionability.directHit,
      hittable: actionability.hittable,
      onScreen: isOnScreen(preferredTarget),
      clickable: isClickable(preferredTarget),
      textLength: preferredText.length || elementText.length,
      depth: getNodeDepth(preferredTarget),
    };

    if (
      !currentBest ||
      Number(nextScore.exact) > Number(currentBest.exact) ||
      (nextScore.exact === currentBest.exact &&
        Number(nextScore.directHit) > Number(currentBest.directHit)) ||
      (nextScore.exact === currentBest.exact &&
        nextScore.directHit === currentBest.directHit &&
        Number(nextScore.hittable) > Number(currentBest.hittable)) ||
      (nextScore.exact === currentBest.exact &&
        nextScore.directHit === currentBest.directHit &&
        nextScore.hittable === currentBest.hittable &&
        Number(nextScore.onScreen) > Number(currentBest.onScreen)) ||
      (nextScore.exact === currentBest.exact &&
        nextScore.directHit === currentBest.directHit &&
        nextScore.hittable === currentBest.hittable &&
        nextScore.onScreen === currentBest.onScreen &&
        Number(nextScore.clickable) > Number(currentBest.clickable)) ||
      (nextScore.exact === currentBest.exact &&
        nextScore.directHit === currentBest.directHit &&
        nextScore.hittable === currentBest.hittable &&
        nextScore.onScreen === currentBest.onScreen &&
        nextScore.clickable === currentBest.clickable &&
        nextScore.textLength < currentBest.textLength) ||
      (nextScore.exact === currentBest.exact &&
        nextScore.directHit === currentBest.directHit &&
        nextScore.hittable === currentBest.hittable &&
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
    if (left.directHit !== right.directHit) {
      return left.directHit ? -1 : 1;
    }
    if (left.hittable !== right.hittable) {
      return left.hittable ? -1 : 1;
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
