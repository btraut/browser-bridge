import { describe, expect, it, vi } from 'vitest';
import {
  readOptionalTabId,
  readRequiredTabId,
  requireTab,
  resolveOptionalTabId,
} from './tab-resolution';

describe('tab resolution helpers', () => {
  it('rejects invalid optional tab ids', () => {
    expect(readOptionalTabId({ tab_id: '7' })).toEqual({
      ok: false,
      error: {
        code: 'INVALID_ARGUMENT',
        message: 'tab_id must be a number when provided.',
        retryable: false,
      },
    });
  });

  it('resolves omitted tab ids through the default resolver', async () => {
    const getDefaultTabId = vi.fn(async () => 42);

    await expect(
      resolveOptionalTabId({}, { getDefaultTabId })
    ).resolves.toEqual({
      ok: true,
      tabId: 42,
    });
    expect(getDefaultTabId).toHaveBeenCalledTimes(1);
  });

  it('requires explicit tab ids where needed', () => {
    expect(readRequiredTabId({})).toEqual({
      ok: false,
      error: {
        code: 'INVALID_ARGUMENT',
        message: 'tab_id must be a number.',
        retryable: false,
      },
    });
  });

  it('maps missing tabs to TAB_NOT_FOUND', async () => {
    await expect(
      requireTab(9, async () => {
        throw new Error('missing');
      })
    ).resolves.toEqual({
      ok: false,
      error: {
        code: 'TAB_NOT_FOUND',
        message: 'tab_id 9 was not found.',
        retryable: false,
        details: { tab_id: 9 },
      },
    });
  });
});
