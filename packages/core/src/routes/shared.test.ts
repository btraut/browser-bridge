import { describe, expect, it } from 'vitest';
import { deriveHintFromTabs } from './shared';

describe('deriveHintFromTabs', () => {
  it('prefers active tabs over newer inactive tabs', () => {
    const hint = deriveHintFromTabs([
      {
        tab_id: 10,
        window_id: 1,
        url: 'https://inactive.example',
        title: 'Inactive',
        active: false,
        last_active_at: '2026-03-07T10:00:00.000Z',
      },
      {
        tab_id: 11,
        window_id: 2,
        url: 'https://active.example',
        title: 'Active',
        active: true,
        last_active_at: '2026-03-07T09:00:00.000Z',
      },
    ]);

    expect(hint).toEqual({
      url: 'https://active.example',
      title: 'Active',
      lastActiveAt: '2026-03-07T09:00:00.000Z',
    });
  });

  it('breaks equal-recency ties deterministically by tab_id', () => {
    const hint = deriveHintFromTabs([
      {
        tab_id: 20,
        window_id: 1,
        url: 'https://two.example',
        title: 'Two',
        active: true,
        last_active_at: '2026-03-07T09:00:00.000Z',
      },
      {
        tab_id: 19,
        window_id: 2,
        url: 'https://one.example',
        title: 'One',
        active: true,
        last_active_at: '2026-03-07T09:00:00.000Z',
      },
    ]);

    expect(hint).toEqual({
      url: 'https://one.example',
      title: 'One',
      lastActiveAt: '2026-03-07T09:00:00.000Z',
    });
  });
});
