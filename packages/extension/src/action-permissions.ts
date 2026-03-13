import type { PermissionPromptResult } from './permission-prompt.js';
import type { DriveErrorInfo } from './protocol.js';
import { buildRestrictedUrlError, isRestrictedUrl } from './restricted-url.js';
import {
  allowSiteAlways,
  isSiteAllowed,
  readSitePermissionsMode,
  siteKeyFromUrl,
} from './site-permissions.js';
import { readOptionalTabId } from './tab-resolution.js';

type PermissionPromptControllerLike = {
  requestPermission: (request: {
    siteKey: string;
    action: string;
  }) => Promise<PermissionPromptResult>;
};

type GateDriveActionResult =
  | { ok: true; siteKey: string | null; touchOnSuccess: boolean }
  | { ok: false; error: DriveErrorInfo };

const GATED_ACTIONS = new Set<string>([
  'drive.navigate',
  'drive.go_back',
  'drive.go_forward',
  'drive.click',
  'drive.hover',
  'drive.select',
  'drive.type',
  'drive.fill_form',
  'drive.drag',
  'drive.handle_dialog',
  'drive.key',
  'drive.key_press',
  'drive.scroll',
  'drive.screenshot',
  'drive.wait_for',
]);

export const gateDriveAction = async (options: {
  action: string;
  params: Record<string, unknown>;
  getDefaultTabId: () => Promise<number>;
  getTab: (tabId: number) => Promise<Record<string, unknown>>;
  permissionPrompts: PermissionPromptControllerLike;
}): Promise<GateDriveActionResult> => {
  const { action, params, getDefaultTabId, getTab, permissionPrompts } =
    options;
  if (!GATED_ACTIONS.has(action)) {
    return { ok: true, siteKey: null, touchOnSuccess: false };
  }

  let siteKey: string | null = null;

  if (action === 'drive.navigate') {
    const url = params.url;
    if (typeof url !== 'string' || url.length === 0) {
      // Let the caller surface INVALID_ARGUMENT for missing url.
      return { ok: true, siteKey: null, touchOnSuccess: false };
    }
    if (isRestrictedUrl(url)) {
      return {
        ok: false,
        error: buildRestrictedUrlError({
          url,
          operation: 'navigate',
          action,
        }),
      };
    }
    siteKey = siteKeyFromUrl(url);
    if (!siteKey) {
      return {
        ok: false,
        error: {
          code: 'INVALID_ARGUMENT',
          message: 'Unable to resolve site permission key for url.',
          retryable: false,
          details: { url },
        },
      };
    }
  } else {
    const parsedTabId = readOptionalTabId(params);
    if (!parsedTabId.ok) {
      // Let the caller surface INVALID_ARGUMENT for tab_id shape.
      return { ok: true, siteKey: null, touchOnSuccess: false };
    }
    const resolvedTabId = parsedTabId.tabId ?? (await getDefaultTabId());
    const tab = await getTab(resolvedTabId);
    const url = tab.url;
    if (typeof url !== 'string' || url.length === 0) {
      return {
        ok: false,
        error: {
          code: 'FAILED_PRECONDITION',
          message: 'Active tab URL is unavailable for permission gating.',
          retryable: false,
          details: { tab_id: resolvedTabId },
        },
      };
    }
    if (isRestrictedUrl(url)) {
      return {
        ok: false,
        error: buildRestrictedUrlError({
          url,
          operation: action === 'drive.screenshot' ? 'screenshot' : 'action',
          action,
        }),
      };
    }
    siteKey = siteKeyFromUrl(url);
    if (!siteKey) {
      return {
        ok: false,
        error: {
          code: 'FAILED_PRECONDITION',
          message: 'Unable to resolve site permission key for active tab.',
          retryable: false,
          details: { url, tab_id: resolvedTabId },
        },
      };
    }
  }

  if ((await readSitePermissionsMode()) === 'bypass') {
    return { ok: true, siteKey, touchOnSuccess: false };
  }

  if (await isSiteAllowed(siteKey)) {
    return { ok: true, siteKey, touchOnSuccess: true };
  }

  const decision = await permissionPrompts.requestPermission({
    siteKey,
    action,
  });

  if (decision.kind === 'timed_out') {
    return {
      ok: false,
      error: {
        code: 'PERMISSION_PROMPT_TIMEOUT',
        message: `Permission prompt timed out for ${siteKey}.`,
        retryable: true,
        details: {
          reason: 'prompt_timed_out',
          site: siteKey,
          action,
          wait_ms: decision.waitMs,
        },
      },
    };
  }

  if (decision.kind === 'deny') {
    return {
      ok: false,
      error: {
        code: 'PERMISSION_DENIED',
        message: `User denied Browser Bridge permission for ${siteKey}.`,
        retryable: false,
        details: {
          reason: 'user_denied',
          site: siteKey,
          action,
          next_step:
            'Ask the user to approve the permission prompt (Allow/Always allow) or allow the site in the extension options page, then retry the command.',
        },
      },
    };
  }

  if (decision.kind === 'allow_always') {
    await allowSiteAlways(siteKey);
    return { ok: true, siteKey, touchOnSuccess: true };
  }

  return { ok: true, siteKey, touchOnSuccess: false };
};
