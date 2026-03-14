/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  readSnapshotRefRegistry,
  recoverElementBySnapshotRef,
  SNAPSHOT_REF_REGISTRY_ID,
} from './snapshot-ref-recovery';

const makeVisible = (
  el: HTMLElement,
  rect = new DOMRect(0, 0, 120, 24)
): void => {
  el.getBoundingClientRect = () => rect;
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
  document.documentElement.innerHTML = '<head></head><body></body>';
  makeVisible(document.body, new DOMRect(0, 0, 1280, 720));
});

describe('snapshot ref recovery', () => {
  it('returns an empty registry for malformed JSON', () => {
    const registry = document.createElement('script');
    registry.id = SNAPSHOT_REF_REGISTRY_ID;
    registry.type = 'application/json';
    registry.textContent = '{ definitely not json';
    document.documentElement.appendChild(registry);

    expect(readSnapshotRefRegistry().size).toBe(0);
  });

  it('prefers an exact visible link match before role fallback', () => {
    const registry = document.createElement('script');
    registry.id = SNAPSHOT_REF_REGISTRY_ID;
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
    document.body.append(hidden, visible);
    makeVisible(visible, new DOMRect(10, 10, 140, 24));

    const findByRole = vi.fn(() => null);

    const result = recoverElementBySnapshotRef('@e36', { findByRole });

    expect(result).toBe(visible);
    expect(findByRole).not.toHaveBeenCalled();
  });
});
