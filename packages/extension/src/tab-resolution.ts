import type { DriveErrorInfo } from './protocol.js';

type TabParams = Record<string, unknown>;

type GetDefaultTabId = () => Promise<number>;

type GetTab = (tabId: number) => Promise<Record<string, unknown>>;

type TabIdParseResult =
  | { ok: true; tabId: number | undefined }
  | { ok: false; error: DriveErrorInfo };

type TabIdResult =
  | { ok: true; tabId: number }
  | { ok: false; error: DriveErrorInfo };

type TabLookupResult =
  | { ok: true; tab: Record<string, unknown> }
  | { ok: false; error: DriveErrorInfo };

const invalidTabIdError = (message: string): DriveErrorInfo => ({
  code: 'INVALID_ARGUMENT',
  message,
  retryable: false,
});

export const readOptionalTabId = (
  params: TabParams,
  message = 'tab_id must be a number when provided.'
): TabIdParseResult => {
  const tabId = params.tab_id;
  if (tabId !== undefined && typeof tabId !== 'number') {
    return {
      ok: false,
      error: invalidTabIdError(message),
    };
  }
  return {
    ok: true,
    tabId: typeof tabId === 'number' ? tabId : undefined,
  };
};

export const readRequiredTabId = (
  params: TabParams,
  message = 'tab_id must be a number.'
): TabIdResult => {
  const tabId = params.tab_id;
  if (typeof tabId !== 'number') {
    return {
      ok: false,
      error: invalidTabIdError(message),
    };
  }
  return {
    ok: true,
    tabId,
  };
};

export const resolveOptionalTabId = async (
  params: TabParams,
  deps: { getDefaultTabId: GetDefaultTabId },
  message = 'tab_id must be a number when provided.'
): Promise<TabIdResult> => {
  const parsed = readOptionalTabId(params, message);
  if (!parsed.ok) {
    return parsed;
  }
  return {
    ok: true,
    tabId: parsed.tabId ?? (await deps.getDefaultTabId()),
  };
};

export const requireTab = async (
  tabId: number,
  getTab: GetTab
): Promise<TabLookupResult> => {
  try {
    return {
      ok: true,
      tab: await getTab(tabId),
    };
  } catch {
    return {
      ok: false,
      error: {
        code: 'TAB_NOT_FOUND',
        message: `tab_id ${tabId} was not found.`,
        retryable: false,
        details: { tab_id: tabId },
      },
    };
  }
};
