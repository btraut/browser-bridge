/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runDriveAction } from './content';

type PointerEventInit = { [key: string]: unknown };

class TestPointerEvent extends MouseEvent {
  constructor(type: string, init?: PointerEventInit) {
    super(type, init);
  }
}

if (typeof globalThis.PointerEvent === 'undefined') {
  (
    globalThis as unknown as { PointerEvent: typeof TestPointerEvent }
  ).PointerEvent = TestPointerEvent;
}

const setRect = (el: HTMLElement, rect: DOMRect): void => {
  el.getBoundingClientRect = () => rect;
};

const makeVisible = (
  el: HTMLElement,
  rect = new DOMRect(0, 0, 120, 24)
): void => {
  setRect(el, rect);
  Object.defineProperty(el, 'offsetWidth', {
    configurable: true,
    get: () => rect.width,
  });
  Object.defineProperty(el, 'offsetHeight', {
    configurable: true,
    get: () => rect.height,
  });
  el.getClientRects = () => [rect] as unknown as DOMRectList;
};

beforeEach(() => {
  document.body.innerHTML = '';
  makeVisible(document.body, new DOMRect(0, 0, 1280, 720));
  (
    document as unknown as {
      elementFromPoint?: (x: number, y: number) => Element | null;
    }
  ).elementFromPoint = undefined;
});

describe('content drive actions', () => {
  it('applies agent-tab branding favicon to existing icon links', async () => {
    const link = document.createElement('link');
    link.rel = 'icon';
    link.href = 'https://example.com/favicon.ico';
    document.head.appendChild(link);

    const result = await runDriveAction('drive.agent_tab_branding', {
      favicon_url: 'chrome-extension://test-id/assets/icons/icon-32.png',
    });

    expect(result.ok).toBe(true);
    expect(link.href).toBe(
      'chrome-extension://test-id/assets/icons/icon-32.png'
    );
  });

  it('rejects agent-tab branding without favicon_url', async () => {
    const result = await runDriveAction('drive.agent_tab_branding', {});

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('INVALID_ARGUMENT');
    }
  });

  it('defers click so dialog-triggering clicks do not block responses', async () => {
    vi.useFakeTimers();
    try {
      const button = document.createElement('button');
      button.id = 'click-me';
      let clicked = 0;
      button.addEventListener('click', () => {
        clicked += 1;
      });
      document.body.appendChild(button);

      const result = await runDriveAction('drive.click', {
        locator: { css: '#click-me' },
      });

      expect(result.ok).toBe(true);
      // Click runs on the next tick.
      expect(clicked).toBe(0);

      await vi.runAllTimersAsync();
      expect(clicked).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('returns locator center coordinates', async () => {
    const target = document.createElement('div');
    target.id = 'point-me';
    document.body.appendChild(target);
    setRect(target, new DOMRect(10, 20, 30, 40));

    const result = await runDriveAction('drive.locator_point', {
      locator: { css: '#point-me' },
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.result).toEqual({ x: 25, y: 40 });
    }
  });

  it('returns html snapshot payload', async () => {
    const target = document.createElement('div');
    target.id = 'snapshot-me';
    document.body.appendChild(target);

    const result = await runDriveAction('drive.snapshot_html', {});

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.result).toEqual(
        expect.objectContaining({ format: 'html' })
      );
      const payload = result.result as { snapshot?: string };
      expect(payload.snapshot).toContain('snapshot-me');
    }
  });

  it('resolves editable type target by locator', async () => {
    const input = document.createElement('input');
    input.id = 'type-me';
    document.body.appendChild(input);
    setRect(input, new DOMRect(5, 15, 20, 10));

    const result = await runDriveAction('drive.type_target_point', {
      locator: { css: '#type-me' },
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.result).toEqual({ x: 15, y: 20 });
    }
  });

  it('clears active editable value', async () => {
    const input = document.createElement('input');
    input.value = 'hello';
    document.body.appendChild(input);
    input.focus();

    const result = await runDriveAction('drive.clear_active_editable', {});

    expect(result.ok).toBe(true);
    expect(input.value).toBe('');
  });

  it('focuses input elements when clicked', async () => {
    vi.useFakeTimers();
    try {
      const input = document.createElement('input');
      input.id = 'focus-me';
      document.body.appendChild(input);

      const result = await runDriveAction('drive.click', {
        locator: { css: '#focus-me' },
      });

      expect(result.ok).toBe(true);
      expect(document.activeElement).toBe(document.body);

      await vi.runAllTimersAsync();
      expect(document.activeElement).toBe(input);
    } finally {
      vi.useRealTimers();
    }
  });

  it('hovers and returns a snapshot', async () => {
    const target = document.createElement('div');
    target.id = 'card';
    document.body.appendChild(target);
    makeVisible(target);

    const result = await runDriveAction('drive.hover', {
      locator: { css: '#card' },
      delay_ms: 0,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      const payload = result.result as { snapshot?: string };
      expect(payload.snapshot).toContain('card');
    }
  });

  it('selects option by value', async () => {
    const select = document.createElement('select');
    select.id = 'size';
    const optionSmall = new Option('Small', 'small');
    const optionLarge = new Option('Large', 'large');
    select.append(optionSmall, optionLarge);
    document.body.appendChild(select);

    const result = await runDriveAction('drive.select', {
      locator: { css: '#size' },
      value: 'large',
    });

    expect(result.ok).toBe(true);
    expect(select.value).toBe('large');
  });

  it('fills form fields', async () => {
    const input = document.createElement('input');
    input.id = 'email';
    const checkbox = document.createElement('input');
    checkbox.id = 'terms';
    checkbox.type = 'checkbox';
    document.body.append(input, checkbox);

    const result = await runDriveAction('drive.fill_form', {
      fields: [
        { selector: '#email', value: 'test@example.com' },
        { selector: '#terms', value: true, type: 'checkbox' },
      ],
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      const payload = result.result as { filled?: number; attempted?: number };
      expect(payload.filled).toBe(2);
      expect(payload.attempted).toBe(2);
    }
    expect(input.value).toBe('test@example.com');
    expect(checkbox.checked).toBe(true);
  });

  it('detects field type for locator', async () => {
    const checkbox = document.createElement('input');
    checkbox.id = 'marketing';
    checkbox.type = 'checkbox';
    document.body.appendChild(checkbox);

    const result = await runDriveAction('drive.detect_field_type', {
      locator: { css: '#marketing' },
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.result).toEqual({ fieldType: 'checkbox' });
    }
  });

  it('dispatches key press', async () => {
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();

    let count = 0;
    input.addEventListener('keydown', () => {
      count += 1;
    });

    const result = await runDriveAction('drive.key_press', {
      key: 'Enter',
      modifiers: { ctrl: true },
    });

    expect(result.ok).toBe(true);
    expect(count).toBe(1);
  });

  it('dispatches repeated key presses', async () => {
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();

    let count = 0;
    input.addEventListener('keydown', () => {
      count += 1;
    });

    const result = await runDriveAction('drive.key', {
      key: 'ArrowDown',
      modifiers: ['alt'],
      repeat: 3,
    });

    expect(result.ok).toBe(true);
    expect(count).toBe(3);
  });

  it('defers window history back/forward until after response', async () => {
    vi.useFakeTimers();
    try {
      const backSpy = vi
        .spyOn(globalThis.history, 'back')
        .mockImplementation(() => {});
      const forwardSpy = vi
        .spyOn(globalThis.history, 'forward')
        .mockImplementation(() => {});

      const backResult = await runDriveAction('drive.go_back', {});
      expect(backResult.ok).toBe(true);
      expect(backSpy).not.toHaveBeenCalled();
      await vi.runOnlyPendingTimersAsync();
      expect(backSpy).toHaveBeenCalledTimes(1);

      const forwardResult = await runDriveAction('drive.go_forward', {});
      expect(forwardResult.ok).toBe(true);
      expect(forwardSpy).not.toHaveBeenCalled();
      await vi.runOnlyPendingTimersAsync();
      expect(forwardSpy).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('drags between elements', async () => {
    const from = document.createElement('div');
    from.id = 'from';
    const to = document.createElement('div');
    to.id = 'to';
    document.body.append(from, to);

    makeVisible(from, new DOMRect(0, 0, 10, 10));
    makeVisible(to, new DOMRect(50, 50, 10, 10));

    (
      document as unknown as {
        elementFromPoint: (x: number, y: number) => Element | null;
      }
    ).elementFromPoint = () => to;

    const result = await runDriveAction('drive.drag', {
      from: { css: '#from' },
      to: { css: '#to' },
      steps: 3,
    });

    expect(result.ok).toBe(true);
  });

  it('clicks a text locator when nested text normalizes to the requested label', async () => {
    vi.useFakeTimers();
    try {
      const button = document.createElement('button');
      button.id = 'view-deck';
      button.append(
        Object.assign(document.createElement('span'), { textContent: 'View' }),
        Object.assign(document.createElement('span'), { textContent: ' deck' })
      );
      document.body.appendChild(button);
      makeVisible(button, new DOMRect(10, 10, 120, 24));
      makeVisible(
        button.children[0] as HTMLElement,
        new DOMRect(10, 10, 40, 24)
      );
      makeVisible(
        button.children[1] as HTMLElement,
        new DOMRect(50, 10, 60, 24)
      );

      let clicks = 0;
      button.addEventListener('click', () => {
        clicks += 1;
      });

      const result = await runDriveAction('drive.click', {
        locator: { text: 'View deck' },
      });

      expect(result.ok).toBe(true);
      await vi.runAllTimersAsync();
      expect(clicks).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('prefers an exact text match over a longer substring match for locator.text', async () => {
    vi.useFakeTimers();
    try {
      const saved = document.createElement('button');
      saved.id = 'saved';
      saved.textContent = 'Saved';
      const savedCopy = document.createElement('button');
      savedCopy.id = 'saved-copy';
      savedCopy.textContent = 'Saved as copy';
      document.body.append(savedCopy, saved);
      makeVisible(savedCopy, new DOMRect(10, 10, 160, 24));
      makeVisible(saved, new DOMRect(10, 50, 80, 24));

      let savedClicks = 0;
      let savedCopyClicks = 0;
      saved.addEventListener('click', () => {
        savedClicks += 1;
      });
      savedCopy.addEventListener('click', () => {
        savedCopyClicks += 1;
      });

      const result = await runDriveAction('drive.click', {
        locator: { text: 'Saved' },
      });

      expect(result.ok).toBe(true);
      await vi.runAllTimersAsync();
      expect(savedClicks).toBe(1);
      expect(savedCopyClicks).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('prefers a clickable text match over a non-clickable container match', async () => {
    vi.useFakeTimers();
    try {
      const container = document.createElement('div');
      container.id = 'container';
      container.textContent = 'View deck';
      const link = document.createElement('a');
      link.id = 'view-deck-link';
      link.href = '#deck';
      link.textContent = 'View deck';
      document.body.append(container, link);
      makeVisible(container, new DOMRect(10, 10, 200, 30));
      makeVisible(link, new DOMRect(10, 60, 90, 24));

      let containerClicks = 0;
      let linkClicks = 0;
      container.addEventListener('click', () => {
        containerClicks += 1;
      });
      link.addEventListener('click', () => {
        linkClicks += 1;
      });

      const result = await runDriveAction('drive.click', {
        locator: { text: 'View deck' },
      });

      expect(result.ok).toBe(true);
      await vi.runAllTimersAsync();
      expect(linkClicks).toBe(1);
      expect(containerClicks).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('ignores hidden text matches when resolving locator.text', async () => {
    vi.useFakeTimers();
    try {
      const hidden = document.createElement('button');
      hidden.id = 'hidden-view-deck';
      hidden.textContent = 'View deck';
      hidden.style.display = 'none';
      const visible = document.createElement('button');
      visible.id = 'visible-view-deck';
      visible.textContent = 'View deck';
      document.body.append(hidden, visible);
      makeVisible(visible, new DOMRect(10, 10, 120, 24));

      let hiddenClicks = 0;
      let visibleClicks = 0;
      hidden.addEventListener('click', () => {
        hiddenClicks += 1;
      });
      visible.addEventListener('click', () => {
        visibleClicks += 1;
      });

      const result = await runDriveAction('drive.click', {
        locator: { text: 'View deck' },
      });

      expect(result.ok).toBe(true);
      await vi.runAllTimersAsync();
      expect(visibleClicks).toBe(1);
      expect(hiddenClicks).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('clicks a native button by role using aria-label even without an explicit role attribute', async () => {
    vi.useFakeTimers();
    try {
      const button = document.createElement('button');
      button.setAttribute('aria-label', 'Account menu');
      document.body.appendChild(button);
      makeVisible(button, new DOMRect(10, 10, 40, 40));

      let clicks = 0;
      button.addEventListener('click', () => {
        clicks += 1;
      });

      const result = await runDriveAction('drive.click', {
        locator: { role: { name: 'button', value: 'Account menu' } },
      });

      expect(result.ok).toBe(true);
      await vi.runAllTimersAsync();
      expect(clicks).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('prefers an exact native-role button name match over a longer substring match', async () => {
    vi.useFakeTimers();
    try {
      const exact = document.createElement('button');
      exact.textContent = 'Sign in';
      const longer = document.createElement('button');
      longer.textContent = 'Sign in with Google';
      document.body.append(longer, exact);
      makeVisible(longer, new DOMRect(10, 10, 180, 24));
      makeVisible(exact, new DOMRect(10, 50, 90, 24));

      let exactClicks = 0;
      let longerClicks = 0;
      exact.addEventListener('click', () => {
        exactClicks += 1;
      });
      longer.addEventListener('click', () => {
        longerClicks += 1;
      });

      const result = await runDriveAction('drive.click', {
        locator: { role: { name: 'button', value: 'Sign in' } },
      });

      expect(result.ok).toBe(true);
      await vi.runAllTimersAsync();
      expect(exactClicks).toBe(1);
      expect(longerClicks).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('falls back from a stale snapshot ref to current link metadata', async () => {
    vi.useFakeTimers();
    try {
      const registry = document.createElement('script');
      registry.id = '__bb_snapshot_ref_registry__';
      registry.type = 'application/json';
      registry.textContent = JSON.stringify([
        {
          ref: '@e36',
          role: 'link',
          name: 'Untitled deck',
          url: 'https://manavault.gg/decks/123',
        },
      ]);
      document.documentElement.appendChild(registry);

      const hidden = document.createElement('a');
      hidden.href = 'https://manavault.gg/decks/123';
      hidden.textContent = 'Untitled deck';
      hidden.style.display = 'none';
      const visible = document.createElement('a');
      visible.href = 'https://manavault.gg/decks/123';
      visible.textContent = 'Untitled deck';
      visible.addEventListener('click', (event) => {
        event.preventDefault();
      });
      document.body.append(hidden, visible);
      makeVisible(visible, new DOMRect(10, 10, 140, 24));

      let visibleClicks = 0;
      visible.addEventListener('click', () => {
        visibleClicks += 1;
      });

      const result = await runDriveAction('drive.click', {
        locator: { ref: '@e36' },
      });

      expect(result.ok).toBe(true);
      await vi.runAllTimersAsync();
      expect(visibleClicks).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('prefers the visible css-matched quantity control over a hidden twin', async () => {
    vi.useFakeTimers();
    try {
      const hidden = document.createElement('button');
      hidden.setAttribute(
        'aria-label',
        'Increase maindeck count for Jace, the Mind Sculptor'
      );
      hidden.style.display = 'none';
      const visible = document.createElement('button');
      visible.setAttribute(
        'aria-label',
        'Increase maindeck count for Jace, the Mind Sculptor'
      );
      document.body.append(hidden, visible);
      makeVisible(visible, new DOMRect(10, 10, 28, 28));

      let hiddenClicks = 0;
      let visibleClicks = 0;
      hidden.addEventListener('click', () => {
        hiddenClicks += 1;
      });
      visible.addEventListener('click', () => {
        visibleClicks += 1;
      });

      const result = await runDriveAction('drive.click', {
        locator: {
          css: 'button[aria-label="Increase maindeck count for Jace, the Mind Sculptor"]',
        },
      });

      expect(result.ok).toBe(true);
      await vi.runAllTimersAsync();
      expect(visibleClicks).toBe(1);
      expect(hiddenClicks).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('wait_for text_present matches normalized text across nested elements', async () => {
    const status = document.createElement('div');
    const first = document.createElement('span');
    first.textContent = 'Sa';
    const second = document.createElement('span');
    second.textContent = 'ved';
    status.append(first, second);
    document.body.appendChild(status);
    makeVisible(status, new DOMRect(10, 10, 120, 24));
    makeVisible(first, new DOMRect(10, 10, 30, 24));
    makeVisible(second, new DOMRect(40, 10, 40, 24));

    const result = await runDriveAction('drive.wait_for', {
      condition: { kind: 'text_present', value: 'Saved' },
      timeout_ms: 10,
    });

    expect(result.ok).toBe(true);
  });

  it('wait_for text_present succeeds when normalized text appears asynchronously', async () => {
    vi.useFakeTimers();
    try {
      const status = document.createElement('div');
      status.textContent = 'Saving';
      document.body.appendChild(status);
      makeVisible(status, new DOMRect(10, 10, 120, 24));

      const resultPromise = runDriveAction('drive.wait_for', {
        condition: { kind: 'text_present', value: 'Saved' },
        timeout_ms: 500,
      });

      window.setTimeout(() => {
        status.replaceChildren(
          Object.assign(document.createElement('span'), { textContent: 'Sa' }),
          Object.assign(document.createElement('span'), { textContent: 'ved' })
        );
        makeVisible(status, new DOMRect(10, 10, 120, 24));
        makeVisible(
          status.children[0] as HTMLElement,
          new DOMRect(10, 10, 30, 24)
        );
        makeVisible(
          status.children[1] as HTMLElement,
          new DOMRect(40, 10, 40, 24)
        );
      }, 100);

      await vi.advanceTimersByTimeAsync(250);
      const result = await resultPromise;
      expect(result.ok).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('wait_for text_present times out when only hidden matching text exists', async () => {
    vi.useFakeTimers();
    try {
      const hidden = document.createElement('div');
      hidden.textContent = 'Saved';
      hidden.style.display = 'none';
      document.body.appendChild(hidden);

      const resultPromise = runDriveAction('drive.wait_for', {
        condition: { kind: 'text_present', value: 'Saved' },
        timeout_ms: 150,
      });

      await vi.advanceTimersByTimeAsync(250);
      const result = await resultPromise;
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('TIMEOUT');
      }
    } finally {
      vi.useRealTimers();
    }
  });
});
