import type {
  DebuggerCommandParams,
  DebuggerRequest,
  DriveErrorInfo,
} from './protocol.js';
import { readRequiredTabId } from './tab-resolution.js';

type DebuggerSessionLike = {
  attached?: boolean;
  attachPromise?: Promise<void>;
};

type Responders = {
  respondAck: (result?: unknown) => void;
  respondError: (error: DriveErrorInfo) => void;
};

type DebuggerDispatchDeps = {
  getSession: (tabId: number) => DebuggerSessionLike | undefined;
  ensureDebuggerAttached: (tabId: number) => Promise<DriveErrorInfo | null>;
  detachDebugger: (tabId: number) => Promise<DriveErrorInfo | null>;
  sendDebuggerCommand: (
    tabId: number,
    method: string,
    params: Record<string, unknown> | undefined,
    timeoutMs: number
  ) => Promise<unknown>;
  touchDebuggerSession: (tabId: number) => void;
  clearDebuggerSession: (tabId: number) => void;
  mapDebuggerErrorMessage: (message: string) => DriveErrorInfo;
  debuggerCommandTimeoutMs: number;
};

export const dispatchDebuggerRequest = async (
  message: DebuggerRequest,
  deps: DebuggerDispatchDeps,
  responders: Responders
): Promise<void> => {
  const { respondAck, respondError } = responders;

  try {
    switch (message.action) {
      case 'debugger.attach': {
        const parsedTabId = readRequiredTabId(
          (message.params ?? {}) as Record<string, unknown>
        );
        if (!parsedTabId.ok) {
          respondError(parsedTabId.error);
          return;
        }
        const error = await deps.ensureDebuggerAttached(parsedTabId.tabId);
        if (error) {
          respondError(error);
          return;
        }
        respondAck({ ok: true });
        return;
      }
      case 'debugger.detach': {
        const parsedTabId = readRequiredTabId(
          (message.params ?? {}) as Record<string, unknown>
        );
        if (!parsedTabId.ok) {
          respondError(parsedTabId.error);
          return;
        }
        const error = await deps.detachDebugger(parsedTabId.tabId);
        if (error) {
          respondError(error);
          return;
        }
        respondAck({ ok: true });
        return;
      }
      case 'debugger.command': {
        const params = (message.params ?? {}) as DebuggerCommandParams;
        const parsedTabId = readRequiredTabId(
          params as Record<string, unknown>
        );
        if (!parsedTabId.ok) {
          respondError(parsedTabId.error);
          return;
        }
        if (typeof params.method !== 'string' || params.method.length === 0) {
          respondError({
            code: 'INVALID_ARGUMENT',
            message: 'method must be a non-empty string.',
            retryable: false,
          });
          return;
        }

        const session = deps.getSession(parsedTabId.tabId);
        if (session?.attachPromise) {
          try {
            await session.attachPromise;
          } catch (error) {
            const info = deps.mapDebuggerErrorMessage(
              error instanceof Error ? error.message : 'Debugger attach failed.'
            );
            deps.clearDebuggerSession(parsedTabId.tabId);
            respondError(info);
            return;
          }
        }

        const attachedSession = deps.getSession(parsedTabId.tabId);
        if (!attachedSession?.attached) {
          respondError({
            code: 'FAILED_PRECONDITION',
            message: 'Debugger is not attached to the requested tab.',
            retryable: false,
          });
          return;
        }

        try {
          const result = await deps.sendDebuggerCommand(
            parsedTabId.tabId,
            params.method,
            params.params,
            deps.debuggerCommandTimeoutMs
          );
          deps.touchDebuggerSession(parsedTabId.tabId);
          respondAck(result);
        } catch (error) {
          const info = deps.mapDebuggerErrorMessage(
            error instanceof Error ? error.message : 'Debugger command failed.'
          );
          respondError(info);
        }
        return;
      }
      default:
        respondError({
          code: 'NOT_IMPLEMENTED',
          message: `${message.action} not implemented in extension yet.`,
          retryable: false,
        });
    }
  } catch (error) {
    const messageText =
      error instanceof Error ? error.message : 'Unexpected debugger error.';
    respondError({
      code: 'INSPECT_UNAVAILABLE',
      message: messageText,
      retryable: false,
    });
  }
};
