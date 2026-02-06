import type { DriveErrorInfo } from './protocol.js';

const TRAILING_PUNCTUATION_RE = /[.,;:!?]+$/;

const stripTrailingPunctuation = (
  value: string
): {
  core: string;
  trailing: string;
} => {
  const match = value.match(TRAILING_PUNCTUATION_RE);
  if (!match) {
    return { core: value, trailing: '' };
  }
  const trailing = match[0] ?? '';
  return { core: value.slice(0, -trailing.length), trailing };
};

const sanitizeUrlToken = (token: string): string => {
  const { core, trailing } = stripTrailingPunctuation(token);
  try {
    const parsed = new URL(core);
    if (parsed.protocol === 'file:') {
      return `file://[redacted]${trailing}`;
    }

    if (parsed.origin && parsed.origin !== 'null') {
      return `${parsed.origin}${trailing}`;
    }

    // Non-standard schemes can have a "null" origin (chrome://, devtools://, etc).
    // Keep scheme + host and drop everything else.
    if (parsed.protocol && parsed.host) {
      return `${parsed.protocol}//${parsed.host}${trailing}`;
    }
    if (parsed.protocol) {
      return `${parsed.protocol}${trailing}`;
    }
  } catch {
    // Ignore and fall back to a simpler heuristic.
  }

  const fallback = core.match(/^([a-zA-Z][a-zA-Z0-9+.-]*):\/\/([^/\s]+)/);
  if (fallback?.[1] && fallback?.[2]) {
    return `${fallback[1]}://${fallback[2]}${trailing}`;
  }
  return `[redacted url]${trailing}`;
};

const URL_TOKEN_RE =
  /\b(?:https?|wss?|chrome-extension|chrome|chrome-devtools|devtools|edge|brave|file):\/\/[^\s"'<>)}\]]+/gi;

const VIEW_SOURCE_RE = /\bview-source:(https?:\/\/[^\s"'<>)}\]]+)/gi;

const sanitizeUrls = (message: string): string => {
  // Special-case view-source: since it nests another URL.
  let next = message.replace(VIEW_SOURCE_RE, (_match, inner: string) => {
    return `view-source:${sanitizeUrlToken(inner)}`;
  });
  next = next.replace(URL_TOKEN_RE, (match) => sanitizeUrlToken(match));
  return next;
};

const extractBasename = (value: string): string => {
  const trimmed = value.trim();
  const lastSlash = Math.max(
    trimmed.lastIndexOf('/'),
    trimmed.lastIndexOf('\\')
  );
  if (lastSlash < 0) {
    return trimmed;
  }
  return trimmed.slice(lastSlash + 1);
};

const sanitizeWindowsPaths = (message: string): string => {
  // Example: C:\Users\me\project\file.ts:12:34 -> file.ts:12:34
  const windowsPathRe =
    /\b[A-Za-z]:\\(?:[^\s"')\]}]+\\)+[^\s"')\]}]+(?::\d+(?::\d+)?)?/g;
  return message.replace(windowsPathRe, (match) => extractBasename(match));
};

const sanitizeUnixPaths = (message: string): string => {
  // Only redact paths rooted in common system locations to avoid clobbering
  // generic "/api/v1" style strings that might appear in error messages.
  const unixPathRe =
    /\/(?:Users|home|var|private|tmp|opt|etc|Library|Applications|Volumes|System)(?:\/[^\s"')\]}]+)+(?::\d+(?::\d+)?)?/g;
  return message.replace(unixPathRe, (match) => extractBasename(match));
};

export const sanitizeChromeErrorMessage = (message: string): string => {
  let next = message;
  next = sanitizeUrls(next);
  next = sanitizeWindowsPaths(next);
  next = sanitizeUnixPaths(next);
  return next;
};

const sanitizeUnknown = (value: unknown): unknown => {
  if (typeof value === 'string') {
    return sanitizeChromeErrorMessage(value);
  }
  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeUnknown(entry));
  }
  if (!value || typeof value !== 'object') {
    return value;
  }
  const record = value as Record<string, unknown>;
  const next: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(record)) {
    next[key] = sanitizeUnknown(entry);
  }
  return next;
};

export const sanitizeDriveErrorInfo = (
  error: DriveErrorInfo
): DriveErrorInfo => {
  return {
    ...error,
    message: sanitizeChromeErrorMessage(error.message),
    ...(error.details
      ? { details: sanitizeUnknown(error.details) as Record<string, unknown> }
      : {}),
  };
};
