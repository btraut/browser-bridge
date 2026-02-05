/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it } from 'vitest';
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
