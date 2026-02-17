import {
  JsonlLogger,
  JsonlLoggerOptions,
  LogFields,
  LogLevel,
  createJsonlLogger,
} from '@btraut/browser-bridge-shared';

type BufferedLogEntry = {
  level: LogLevel;
  event: string;
  fields: LogFields;
  bindings: LogFields;
};

type DeferredLoggerState = {
  stream: string;
  level: LogLevel;
  destination: JsonlLogger | null;
  buffered: BufferedLogEntry[];
  droppedEntries: number;
  maxBufferEntries: number;
};

export type DeferredJsonlLogger = {
  logger: JsonlLogger;
  activate: () => JsonlLogger;
  isActivated: () => boolean;
};

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const isEnabled = (state: DeferredLoggerState, level: LogLevel): boolean =>
  LOG_LEVEL_PRIORITY[level] >= LOG_LEVEL_PRIORITY[state.level];

const enqueue = (state: DeferredLoggerState, entry: BufferedLogEntry): void => {
  if (state.buffered.length >= state.maxBufferEntries) {
    state.buffered.shift();
    state.droppedEntries += 1;
  }
  state.buffered.push(entry);
};

const flushBuffered = (state: DeferredLoggerState): void => {
  const destination = state.destination;
  if (!destination) {
    return;
  }

  if (state.droppedEntries > 0) {
    destination.warn('mcp.log.buffer.dropped', {
      dropped_entries: state.droppedEntries,
    });
    state.droppedEntries = 0;
  }

  for (const entry of state.buffered) {
    destination.log(entry.level, entry.event, {
      ...entry.bindings,
      ...entry.fields,
    });
  }
  state.buffered.length = 0;
};

const buildLogger = (
  state: DeferredLoggerState,
  bindings: LogFields
): JsonlLogger => {
  const log = (
    level: LogLevel,
    event: string,
    fields: LogFields = {}
  ): void => {
    if (!isEnabled(state, level)) {
      return;
    }

    if (state.destination) {
      state.destination.log(level, event, {
        ...bindings,
        ...fields,
      });
      return;
    }

    enqueue(state, {
      level,
      event,
      fields: { ...fields },
      bindings: { ...bindings },
    });
  };

  return {
    stream: state.stream,
    get level() {
      return state.destination?.level ?? state.level;
    },
    get logDir() {
      return state.destination?.logDir ?? '';
    },
    get filePath() {
      return state.destination?.filePath ?? '';
    },
    child: (childBindings: LogFields) =>
      buildLogger(state, {
        ...bindings,
        ...childBindings,
      }),
    log,
    debug: (event, fields) => log('debug', event, fields),
    info: (event, fields) => log('info', event, fields),
    warn: (event, fields) => log('warn', event, fields),
    error: (event, fields) => log('error', event, fields),
  };
};

export const createDeferredJsonlLogger = (
  options: JsonlLoggerOptions & { maxBufferEntries?: number }
): DeferredJsonlLogger => {
  const state: DeferredLoggerState = {
    stream: options.stream,
    level: options.level ?? 'debug',
    destination: null,
    buffered: [],
    droppedEntries: 0,
    maxBufferEntries: Math.max(1, options.maxBufferEntries ?? 2000),
  };

  return {
    logger: buildLogger(state, options.bindings ?? {}),
    activate: () => {
      if (!state.destination) {
        state.destination = createJsonlLogger(options);
      }
      flushBuffered(state);
      return state.destination;
    },
    isActivated: () => state.destination !== null,
  };
};
