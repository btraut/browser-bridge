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

beforeEach(() => {
  document.body.innerHTML = '';
  (
    document as unknown as {
      elementFromPoint?: (x: number, y: number) => Element | null;
    }
  ).elementFromPoint = undefined;
});

describe('content drive actions', () => {
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

  it('uses window history for back/forward', async () => {
    const backSpy = vi
      .spyOn(globalThis.history, 'back')
      .mockImplementation(() => {});
    const forwardSpy = vi
      .spyOn(globalThis.history, 'forward')
      .mockImplementation(() => {});

    const backResult = await runDriveAction('drive.go_back', {});
    expect(backResult.ok).toBe(true);
    expect(backSpy).toHaveBeenCalledTimes(1);

    const forwardResult = await runDriveAction('drive.go_forward', {});
    expect(forwardResult.ok).toBe(true);
    expect(forwardSpy).toHaveBeenCalledTimes(1);
  });

  it('drags between elements', async () => {
    const from = document.createElement('div');
    from.id = 'from';
    const to = document.createElement('div');
    to.id = 'to';
    document.body.append(from, to);

    setRect(from, new DOMRect(0, 0, 10, 10));
    setRect(to, new DOMRect(50, 50, 10, 10));

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
});
