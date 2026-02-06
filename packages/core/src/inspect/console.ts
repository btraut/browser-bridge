import type { DebuggerEventRecord } from '../debugger-bridge';
import type { ConsoleEntry } from '../inspect';

type SourceLocation = { url?: string; line?: number; column?: number };

const toSourceLocation = (input: {
  url?: unknown;
  lineNumber?: unknown;
  columnNumber?: unknown;
}): SourceLocation | undefined => {
  const url =
    typeof input.url === 'string' && input.url.length > 0
      ? input.url
      : undefined;
  const line =
    typeof input.lineNumber === 'number' && Number.isFinite(input.lineNumber)
      ? Math.max(1, Math.floor(input.lineNumber) + 1)
      : undefined;
  const column =
    typeof input.columnNumber === 'number' &&
    Number.isFinite(input.columnNumber)
      ? Math.max(1, Math.floor(input.columnNumber) + 1)
      : undefined;
  if (!url && !line && !column) {
    return undefined;
  }
  return {
    ...(url ? { url } : {}),
    ...(line ? { line } : {}),
    ...(column ? { column } : {}),
  };
};

const toStackFrames = (
  stackTrace: unknown
):
  | Array<{
      functionName?: string;
      url?: string;
      line?: number;
      column?: number;
    }>
  | undefined => {
  const frames: Array<{
    functionName?: string;
    url?: string;
    line?: number;
    column?: number;
  }> = [];

  const collect = (trace: unknown): void => {
    if (!trace || typeof trace !== 'object') {
      return;
    }
    const callFrames = (trace as { callFrames?: unknown }).callFrames;
    if (Array.isArray(callFrames)) {
      for (const frame of callFrames) {
        if (!frame || typeof frame !== 'object') {
          continue;
        }
        const functionName =
          typeof (frame as { functionName?: unknown }).functionName === 'string'
            ? String((frame as { functionName?: unknown }).functionName)
            : undefined;
        const url =
          typeof (frame as { url?: unknown }).url === 'string'
            ? String((frame as { url?: unknown }).url)
            : undefined;
        const lineNumber = (frame as { lineNumber?: unknown }).lineNumber;
        const columnNumber = (frame as { columnNumber?: unknown }).columnNumber;

        const loc = toSourceLocation({ url, lineNumber, columnNumber });
        frames.push({
          ...(functionName ? { functionName } : {}),
          ...(loc?.url ? { url: loc.url } : {}),
          ...(loc?.line ? { line: loc.line } : {}),
          ...(loc?.column ? { column: loc.column } : {}),
        });

        if (frames.length >= 50) {
          return;
        }
      }
    }
    const parent = (trace as { parent?: unknown }).parent;
    if (frames.length < 50 && parent) {
      collect(parent);
    }
  };

  collect(stackTrace);
  return frames.length > 0 ? frames : undefined;
};

const toRemoteObjectSummary = (
  obj: unknown
):
  | {
      type?: string;
      subtype?: string;
      description?: string;
      value?: unknown;
      unserializableValue?: string;
    }
  | undefined => {
  if (!obj || typeof obj !== 'object') {
    return undefined;
  }
  const raw = obj as {
    type?: unknown;
    subtype?: unknown;
    description?: unknown;
    value?: unknown;
    unserializableValue?: unknown;
  };
  const type = typeof raw.type === 'string' ? raw.type : undefined;
  const subtype = typeof raw.subtype === 'string' ? raw.subtype : undefined;
  const description =
    typeof raw.description === 'string' ? raw.description : undefined;
  const unserializableValue =
    typeof raw.unserializableValue === 'string'
      ? raw.unserializableValue
      : undefined;

  const out: {
    type?: string;
    subtype?: string;
    description?: string;
    value?: unknown;
    unserializableValue?: string;
  } = {};

  if (type) out.type = type;
  if (subtype) out.subtype = subtype;
  if (description) out.description = description;
  if (raw.value !== undefined) out.value = raw.value;
  if (unserializableValue) out.unserializableValue = unserializableValue;

  return Object.keys(out).length > 0 ? out : undefined;
};

const stringifyRemoteObject = (value: unknown): string => {
  if (!value || typeof value !== 'object') {
    return String(value ?? '');
  }
  const obj = value as {
    value?: unknown;
    description?: string;
    unserializableValue?: string;
    type?: string;
  };
  if (obj.unserializableValue) {
    return obj.unserializableValue;
  }
  if (obj.value !== undefined) {
    try {
      return typeof obj.value === 'string'
        ? obj.value
        : JSON.stringify(obj.value);
    } catch {
      return String(obj.value);
    }
  }
  if (obj.description) {
    return obj.description;
  }
  return obj.type ?? '';
};

export const toConsoleEntry = (
  event: DebuggerEventRecord
): ConsoleEntry | null => {
  const params = event.params ?? {};
  switch (event.method) {
    case 'Runtime.consoleAPICalled': {
      const rawArgs = Array.isArray((params as { args?: unknown[] }).args)
        ? (params as { args: unknown[] }).args
        : [];
      const text = rawArgs.map((arg) => stringifyRemoteObject(arg)).join(' ');
      const level = String((params as { type?: string }).type ?? 'log');
      const stack = toStackFrames(
        (params as { stackTrace?: unknown }).stackTrace
      );
      const args = rawArgs
        .map((arg) => toRemoteObjectSummary(arg))
        .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));
      return {
        level,
        text,
        timestamp: event.timestamp,
        ...(stack && stack.length > 0 ? { stack } : {}),
        ...(args.length > 0 ? { args } : {}),
      };
    }
    case 'Runtime.exceptionThrown': {
      const details = (
        params as {
          exceptionDetails?: {
            text?: string;
            url?: string;
            lineNumber?: number;
            columnNumber?: number;
            stackTrace?: unknown;
            exception?: unknown;
          };
        }
      ).exceptionDetails;

      const exception = toRemoteObjectSummary(details?.exception);
      const stack = toStackFrames(details?.stackTrace);
      const source =
        toSourceLocation({
          url: details?.url,
          lineNumber: details?.lineNumber,
          columnNumber: details?.columnNumber,
        }) ??
        // If the top frame exists, treat it as the source.
        (stack && stack.length > 0
          ? {
              url: stack[0].url,
              line: stack[0].line,
              column: stack[0].column,
            }
          : undefined);

      const baseText =
        typeof details?.text === 'string' && details.text.trim().length > 0
          ? details.text
          : 'Uncaught exception';
      const exceptionDesc =
        typeof exception?.description === 'string' &&
        exception.description.trim().length > 0
          ? exception.description
          : undefined;

      // CDP often reports `exceptionDetails.text` as just "Uncaught".
      // Enrich the message with the exception description when available.
      const text =
        baseText === 'Uncaught' && exceptionDesc
          ? `Uncaught: ${exceptionDesc}`
          : baseText;

      return {
        level: 'error',
        text,
        timestamp: event.timestamp,
        ...(source ? { source } : {}),
        ...(stack && stack.length > 0 ? { stack } : {}),
        ...(exception ? { exception } : {}),
      };
    }
    case 'Log.entryAdded': {
      const entry = (
        params as {
          entry?: {
            level?: string;
            text?: string;
            url?: string;
            lineNumber?: number;
            stackTrace?: unknown;
            timestamp?: number;
          };
        }
      ).entry;
      if (!entry) {
        return null;
      }
      const stack = toStackFrames(entry.stackTrace);
      const source = toSourceLocation({
        url: entry.url,
        lineNumber: entry.lineNumber,
        columnNumber: undefined,
      });
      return {
        level: entry.level ?? 'log',
        text: entry.text ?? '',
        timestamp: event.timestamp,
        ...(source ? { source } : {}),
        ...(stack && stack.length > 0 ? { stack } : {}),
      };
    }
    default:
      return null;
  }
};
