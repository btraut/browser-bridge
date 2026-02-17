import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import type { IncomingMessage } from 'node:http';
import type { ErrorEnvelope, JsonlLogger } from '@btraut/browser-bridge-shared';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import {
  createCoreClient,
  type CoreClient,
  type CoreClientOptions,
} from './core-client';
import { createDeferredJsonlLogger } from './deferred-logger';
import { registerBrowserBridgeTools } from './tools';

export type CoreClientFactory = (
  logger: JsonlLogger
) => CoreClient | Promise<CoreClient>;

export type McpAdapterOptions = CoreClientOptions & {
  name?: string;
  version?: string;
  logger?: JsonlLogger;
  coreClient?: CoreClient;
  coreClientFactory?: CoreClientFactory;
  eager?: boolean;
};

export type McpAdapterHandle = {
  server: McpServer;
  client: CoreClient;
};

export type McpAdapterStartHandle = McpAdapterHandle & {
  transport: StdioServerTransport;
};

export type McpAdapterHttpOptions = {
  host?: string;
  port?: number;
  path?: string;
};

export type McpAdapterHttpStartHandle = {
  client: CoreClient;
  host: string;
  port: number;
  path: string;
  close: () => Promise<void>;
};

const DEFAULT_SERVER_NAME = 'browser-bridge';
const DEFAULT_SERVER_VERSION = '0.0.0';
const DEFAULT_HTTP_HOST = '127.0.0.1';
const DEFAULT_HTTP_PATH = '/mcp';
const ENV_MCP_EAGER = 'BROWSER_BRIDGE_MCP_EAGER';
const ENV_LEGACY_MCP_EAGER = 'BROWSER_VISION_MCP_EAGER';

type DeferredLoggerController = {
  logger: JsonlLogger;
  activate: () => void;
};

type RuntimeController = {
  logger: JsonlLogger;
  client: CoreClient;
  ensureInitialized: () => Promise<CoreClient>;
  isInitialized: () => boolean;
};

type EnsureReadyCoreClient = CoreClient & {
  ensureReady?: () => Promise<void>;
};

type McpBootstrapHandle = McpAdapterHandle & {
  logger: JsonlLogger;
  ensureInitialized: () => Promise<CoreClient>;
  isInitialized: () => boolean;
};

const durationMs = (startedAt: bigint): number =>
  Number((Number(process.hrtime.bigint() - startedAt) / 1_000_000).toFixed(3));

const parseBoolean = (value: string | undefined): boolean | undefined => {
  if (value === undefined) {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();
  if (
    normalized === '1' ||
    normalized === 'true' ||
    normalized === 'yes' ||
    normalized === 'on'
  ) {
    return true;
  }
  if (
    normalized === '0' ||
    normalized === 'false' ||
    normalized === 'no' ||
    normalized === 'off'
  ) {
    return false;
  }
  return undefined;
};

const resolveEagerMode = (explicit?: boolean): boolean => {
  if (typeof explicit === 'boolean') {
    return explicit;
  }

  const envValue =
    parseBoolean(process.env[ENV_MCP_EAGER]) ??
    parseBoolean(process.env[ENV_LEGACY_MCP_EAGER]);
  return envValue ?? false;
};

const toCoreClientOptions = (
  options: McpAdapterOptions,
  logger: JsonlLogger
): CoreClientOptions => ({
  host: options.host,
  port: options.port,
  cwd: options.cwd,
  timeoutMs: options.timeoutMs,
  ensureDaemon: options.ensureDaemon ?? true,
  componentVersion: options.version ?? DEFAULT_SERVER_VERSION,
  healthRetryMs: options.healthRetryMs,
  healthAttempts: options.healthAttempts,
  fetchImpl: options.fetchImpl,
  spawnImpl: options.spawnImpl,
  logger,
});

const buildInitializationError = (error: unknown): ErrorEnvelope => {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : 'Unknown initialization failure.';

  return {
    ok: false,
    error: {
      code: 'UNAVAILABLE',
      message: `MCP runtime initialization failed: ${message}`,
      retryable: true,
      details: {
        phase: 'mcp_runtime_init',
      },
    },
  };
};

const resolveDeferredLoggerController = (
  options: McpAdapterOptions
): DeferredLoggerController => {
  if (options.logger) {
    return {
      logger: options.logger,
      activate: () => undefined,
    };
  }

  const deferred = createDeferredJsonlLogger({
    stream: 'mcp-adapter',
    cwd: options.cwd,
  });

  return {
    logger: deferred.logger,
    activate: () => {
      deferred.activate();
    },
  };
};

const createRuntimeController = (
  options: McpAdapterOptions
): RuntimeController => {
  const deferredLogger = resolveDeferredLoggerController(options);
  const logger = deferredLogger.logger;
  const coreLogger = logger.child({ scope: 'core-client' });

  let initializedClient: CoreClient | null = null;
  let initializationPromise: Promise<CoreClient> | null = null;

  const createClient = async (): Promise<CoreClient> => {
    if (options.coreClient) {
      return options.coreClient;
    }
    if (options.coreClientFactory) {
      return await options.coreClientFactory(coreLogger);
    }
    return createCoreClient(toCoreClientOptions(options, coreLogger));
  };

  const proxyClient: CoreClient = {
    get baseUrl() {
      return initializedClient?.baseUrl ?? '';
    },
    ensureReady: async () => {
      await ensureInitialized();
    },
    post: async <T>(path: string, body?: unknown) => {
      const client = await ensureInitialized();
      return client.post<T>(path, body);
    },
  };

  const ensureInitialized = async (): Promise<CoreClient> => {
    if (initializedClient) {
      return initializedClient;
    }

    if (!initializationPromise) {
      initializationPromise = (async () => {
        logger.info('mcp.runtime.init.begin');
        try {
          const candidate = await createClient();
          const maybeEnsureReady = (candidate as EnsureReadyCoreClient)
            .ensureReady;
          if (typeof maybeEnsureReady === 'function') {
            await maybeEnsureReady.call(candidate);
          }

          deferredLogger.activate();
          initializedClient = candidate;

          logger.info('mcp.runtime.init.ready', {
            core_base_url: candidate.baseUrl,
          });

          return candidate;
        } catch (error) {
          logger.error('mcp.runtime.init.failed', {
            error,
          });
          throw buildInitializationError(error);
        }
      })();

      initializationPromise = initializationPromise.catch((error) => {
        initializationPromise = null;
        throw error;
      });
    }

    return initializationPromise;
  };

  return {
    logger,
    client: options.coreClient ?? proxyClient,
    ensureInitialized,
    isInitialized: () => initializedClient !== null,
  };
};

const createMcpServerBootstrap = (
  options: McpAdapterOptions = {}
): McpBootstrapHandle => {
  const runtime = createRuntimeController(options);
  const server = new McpServer({
    name: options.name ?? DEFAULT_SERVER_NAME,
    version: options.version ?? DEFAULT_SERVER_VERSION,
  });

  registerBrowserBridgeTools(server, runtime.ensureInitialized);

  runtime.logger.info('mcp.server.created', {
    name: options.name ?? DEFAULT_SERVER_NAME,
    version: options.version ?? DEFAULT_SERVER_VERSION,
    lazy_init: true,
  });

  return {
    server,
    client: runtime.client,
    logger: runtime.logger,
    ensureInitialized: runtime.ensureInitialized,
    isInitialized: runtime.isInitialized,
  };
};

export const createMcpServer = (
  options: McpAdapterOptions = {}
): McpAdapterHandle => {
  const handle = createMcpServerBootstrap(options);
  return {
    server: handle.server,
    client: handle.client,
  };
};

export const startMcpServer = async (
  options: McpAdapterOptions = {}
): Promise<McpAdapterStartHandle> => {
  const eager = resolveEagerMode(options.eager);
  const handle = createMcpServerBootstrap(options);

  handle.logger.info('mcp.stdio.start.begin', {
    name: options.name ?? DEFAULT_SERVER_NAME,
    version: options.version ?? DEFAULT_SERVER_VERSION,
    eager,
  });

  const transport = new StdioServerTransport();
  try {
    if (eager) {
      await handle.ensureInitialized();
    }

    await handle.server.connect(transport);
    handle.logger.info('mcp.stdio.start.ready', {
      core_base_url: handle.isInitialized() ? handle.client.baseUrl : null,
      eager,
    });
  } catch (error) {
    handle.logger.error('mcp.stdio.start.failed', {
      error,
    });
    throw error;
  }

  return {
    server: handle.server,
    client: handle.client,
    transport,
  };
};

const readJsonBody = async (
  req: IncomingMessage,
  maxBytes = 5 * 1024 * 1024
): Promise<unknown> => {
  const chunks: Buffer[] = [];
  let total = 0;
  await new Promise<void>((resolve, reject) => {
    req.on('data', (chunk: Buffer) => {
      total += chunk.length;
      if (total > maxBytes) {
        reject(new Error('Request body too large.'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve());
    req.on('error', (err: unknown) => reject(err));
  });
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) {
    return undefined;
  }
  return JSON.parse(raw) as unknown;
};

const getHeaderValue = (
  value: string | string[] | undefined
): string | undefined => {
  if (typeof value === 'string') {
    return value;
  }
  if (Array.isArray(value)) {
    return value[0];
  }
  return undefined;
};

export const startMcpHttpServer = async (
  options: McpAdapterOptions & McpAdapterHttpOptions = {}
): Promise<McpAdapterHttpStartHandle> => {
  const eager = resolveEagerMode(options.eager);
  const runtime = createRuntimeController(options);
  const logger = runtime.logger.child({ scope: 'http-server' });
  const host = options.host ?? DEFAULT_HTTP_HOST;
  const port = typeof options.port === 'number' ? options.port : 0;
  const path = options.path ?? DEFAULT_HTTP_PATH;

  logger.info('mcp.http.start.begin', {
    host,
    port,
    path,
    eager,
  });

  if (eager) {
    await runtime.ensureInitialized();
  }

  const sessions = new Map<
    string,
    {
      transport: StreamableHTTPServerTransport;
      server: McpServer;
    }
  >();

  const closeAllSessions = async (): Promise<void> => {
    const entries = Array.from(sessions.values());
    sessions.clear();
    await Promise.all(
      entries.map(async (entry) => {
        try {
          await entry.transport.close();
        } catch {
          // Ignore.
        }
        try {
          await entry.server.close();
        } catch {
          // Ignore.
        }
      })
    );
  };

  const httpServer = createServer(async (req, res) => {
    const startedAt = process.hrtime.bigint();
    const requestLogger = logger.child({
      scope: 'http-request',
      request_id: randomUUID(),
    });
    requestLogger.debug('mcp.http.request.start', {
      method: req.method,
      url: req.url ?? '',
    });

    try {
      const url = new URL(req.url ?? '', `http://${host}`);
      if (url.pathname !== path) {
        res.writeHead(404, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not Found' }));
        requestLogger.warn('mcp.http.request.not_found', {
          method: req.method,
          pathname: url.pathname,
          expected_path: path,
          status: 404,
          duration_ms: durationMs(startedAt),
        });
        return;
      }

      const sessionId = getHeaderValue(req.headers['mcp-session-id']);
      requestLogger.debug('mcp.http.request.session', {
        session_id: sessionId ?? null,
      });

      const parsedBody =
        req.method === 'POST' ? await readJsonBody(req) : undefined;

      if (sessionId) {
        const entry = sessions.get(sessionId);
        if (!entry) {
          res.writeHead(404, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: 'Unknown session.' }));
          requestLogger.warn('mcp.http.request.unknown_session', {
            session_id: sessionId,
            status: 404,
            duration_ms: durationMs(startedAt),
          });
          return;
        }
        await entry.transport.handleRequest(req, res, parsedBody);
        requestLogger.info('mcp.http.request.forwarded', {
          session_id: sessionId,
          status: res.statusCode,
          duration_ms: durationMs(startedAt),
        });
        return;
      }

      if (req.method !== 'POST' || !isInitializeRequest(parsedBody)) {
        res.writeHead(400, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            error:
              'Missing mcp-session-id header. First request must be initialize.',
          })
        );
        requestLogger.warn('mcp.http.request.invalid_initialize', {
          method: req.method,
          status: 400,
          duration_ms: durationMs(startedAt),
        });
        return;
      }

      let sessionEntry:
        | {
            transport: StreamableHTTPServerTransport;
            server: McpServer;
          }
        | undefined;

      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (sid) => {
          if (sessionEntry) {
            sessions.set(sid, sessionEntry);
            logger.info('mcp.http.session.opened', {
              session_id: sid,
            });
          }
        },
        onsessionclosed: async (sid) => {
          const entry = sessions.get(sid);
          sessions.delete(sid);
          if (!entry) {
            return;
          }
          await Promise.allSettled([
            entry.transport.close(),
            entry.server.close(),
          ]);
          logger.info('mcp.http.session.closed', {
            session_id: sid,
          });
        },
      });

      const sessionServer = new McpServer({
        name: options.name ?? DEFAULT_SERVER_NAME,
        version: options.version ?? DEFAULT_SERVER_VERSION,
      });
      registerBrowserBridgeTools(sessionServer, runtime.ensureInitialized);
      await sessionServer.connect(transport);
      sessionEntry = { transport, server: sessionServer };

      await transport.handleRequest(req, res, parsedBody);
      requestLogger.info('mcp.http.request.initialized', {
        status: res.statusCode,
        duration_ms: durationMs(startedAt),
      });
    } catch (error) {
      requestLogger.error('mcp.http.request.error', {
        method: req.method,
        url: req.url ?? '',
        status: 500,
        duration_ms: durationMs(startedAt),
        error,
      });
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          error: error instanceof Error ? error.message : 'Internal error.',
        })
      );
    }
  });

  const resolvedPort = await new Promise<number>((resolve, reject) => {
    httpServer.listen(port, host, () => {
      const address = httpServer.address();
      resolve(typeof address === 'object' && address ? address.port : port);
    });
    httpServer.on('error', reject);
  });
  logger.info('mcp.http.start.ready', {
    host,
    port: resolvedPort,
    path,
    core_base_url: runtime.isInitialized() ? runtime.client.baseUrl : null,
    eager,
  });

  return {
    client: runtime.client,
    host,
    port: resolvedPort,
    path,
    close: async () => {
      logger.info('mcp.http.stop.begin', {
        host,
        port: resolvedPort,
      });
      await new Promise<void>((resolve, reject) => {
        httpServer.close((err) => {
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        });
      });
      await closeAllSessions();
      logger.info('mcp.http.stop.complete', {
        host,
        port: resolvedPort,
      });
    },
  };
};
