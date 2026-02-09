import type { DriveTabInfo } from '../drive-protocol';
import type { TargetHint } from '../target-matching';

export type ResponseLike = {
  status: (code: number) => ResponseLike;
  json: (body: unknown) => void;
};

export type ErrorInfo = {
  code: string;
  message: string;
  retryable: boolean;
  details?: Record<string, unknown>;
};

export const sendError = (
  res: ResponseLike,
  status: number,
  error: ErrorInfo
): void => {
  res.status(status).json({ ok: false, error });
};

export const sendResult = <T>(res: ResponseLike, result: T): void => {
  res.status(200).json({ ok: true, result });
};

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export const errorStatus = (code: string): number => {
  switch (code) {
    case 'INVALID_ARGUMENT':
      return 400;
    case 'UNAUTHORIZED':
      return 401;
    case 'FORBIDDEN':
    case 'PERMISSION_REQUIRED':
    case 'PERMISSION_PROMPT_TIMEOUT':
    case 'PERMISSION_DENIED':
      return 403;
    case 'SESSION_NOT_FOUND':
    case 'TAB_NOT_FOUND':
    case 'LOCATOR_NOT_FOUND':
      return 404;
    case 'SESSION_CLOSED':
    case 'FAILED_PRECONDITION':
    case 'DEBUGGER_IN_USE':
      return 409;
    case 'ATTACH_DENIED':
      return 403;
    case 'NOT_SUPPORTED':
    case 'NOT_IMPLEMENTED':
      return 501;
    case 'EXTENSION_DISCONNECTED':
    case 'INSPECT_UNAVAILABLE':
      return 503;
    case 'TIMEOUT':
      return 504;
    default:
      return 500;
  }
};

export const deriveHintFromTabs = (
  tabs: DriveTabInfo[]
): TargetHint | undefined => {
  if (!Array.isArray(tabs) || tabs.length === 0) {
    return undefined;
  }
  let best: DriveTabInfo | undefined;
  let bestTime = -Infinity;
  for (const tab of tabs) {
    const raw = tab.last_active_at;
    const time = raw ? Date.parse(raw) : NaN;
    const score = Number.isFinite(time) ? time : -Infinity;
    if (!best || score > bestTime) {
      best = tab;
      bestTime = score;
    }
  }
  if (!best) {
    return undefined;
  }
  if (!best.url && !best.title && !best.last_active_at) {
    return undefined;
  }
  return {
    url: best.url,
    title: best.title,
    lastActiveAt: best.last_active_at,
  };
};
