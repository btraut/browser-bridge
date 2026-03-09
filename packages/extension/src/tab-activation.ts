import type { DriveErrorInfo, DriveOpResult } from './protocol.js';

type ResolveTabActivationOutcomeInput = {
  tabId: number;
  windowId?: number;
  activated: boolean;
  focusErrorMessage?: string;
  windowFocused?: boolean;
};

export type TabActivationOutcome =
  | { ok: true; result: DriveOpResult }
  | { ok: false; error: DriveErrorInfo };

export const resolveTabActivationOutcome = ({
  tabId,
  windowId,
  activated,
  focusErrorMessage,
  windowFocused,
}: ResolveTabActivationOutcomeInput): TabActivationOutcome => {
  if (!activated) {
    return {
      ok: false,
      error: {
        code: 'FAILED_PRECONDITION',
        message: `Failed to activate tab_id ${tabId}.`,
        retryable: true,
        details: { tab_id: tabId },
      },
    };
  }

  const warnings: string[] = [];
  if (typeof windowId === 'number') {
    if (focusErrorMessage) {
      warnings.push(
        `Activated tab_id ${tabId}, but failed to focus window_id ${windowId}: ${focusErrorMessage}`
      );
    } else if (windowFocused === false) {
      warnings.push(
        `Activated tab_id ${tabId}, but window_id ${windowId} did not report focused state.`
      );
    }
  }

  return {
    ok: true,
    result: {
      ok: true,
      ...(warnings.length > 0 ? { warnings } : {}),
    },
  };
};
