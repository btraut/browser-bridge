import type { DriveTabInfo } from '../drive-protocol';
import type { TargetHint } from '../target-matching';
import {
  normalizeErrorCode,
  normalizeErrorInfo,
} from '@btraut/browser-bridge-shared';

export type ResponseLike = {
  status: (code: number) => ResponseLike;
  json: (body: unknown) => void;
};

export type RouteErrorInfo = {
  code: string;
  message: string;
  retryable: boolean;
  details?: Record<string, unknown>;
};

export const sendError = (
  res: ResponseLike,
  status: number,
  error: RouteErrorInfo
): void => {
  res.status(status).json({ ok: false, error: normalizeErrorInfo(error) });
};

export const sendResult = <T>(res: ResponseLike, result: T): void => {
  res.status(200).json({ ok: true, result });
};

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export const errorStatus = (code: string): number => {
  switch (normalizeErrorCode(code)) {
    case 'INVALID_ARGUMENT':
      return 400;
    case 'UNAUTHORIZED':
      return 401;
    case 'FORBIDDEN':
      return 403;
    case 'NOT_FOUND':
      return 404;
    case 'FAILED_PRECONDITION':
      return 409;
    case 'NOT_IMPLEMENTED':
      return 501;
    case 'UNAVAILABLE':
      return 503;
    case 'CONFLICT':
      return 409;
    case 'TIMEOUT':
      return 504;
    case 'RATE_LIMITED':
      return 429;
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
  const candidatePool = tabs.some((tab) => tab.active === true)
    ? tabs.filter((tab) => tab.active === true)
    : tabs;
  let best: DriveTabInfo | undefined;
  let bestTime = -Infinity;
  for (const tab of candidatePool) {
    const raw = tab.last_active_at;
    const time = raw ? Date.parse(raw) : NaN;
    const score = Number.isFinite(time) ? time : -Infinity;
    if (
      !best ||
      score > bestTime ||
      (score === bestTime && tab.tab_id < best.tab_id)
    ) {
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
