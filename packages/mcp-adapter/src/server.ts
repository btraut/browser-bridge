import { createServer } from 'node:http';
import type { IncomingMessage } from 'node:http';
import { randomUUID } from 'node:crypto';
import { JsonlLogger, createJsonlLogger } from '@btraut/browser-bridge-shared';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { CoreClient, CoreClientOptions, createCoreClient } from './core-client';
import { registerBrowserBridgeTools } from './tools';

export type McpAdapterOptions = CoreClientOptions & {
  name?: string;
  version?: string;
  coreClient?: CoreClient;
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

const durationMs = (startedAt: bigint): number =>
  Number((Number(process.hrtime.bigint() - startedAt) / 1_000_000).toFixed(3));

const resolveAdapterLogger = (
  options: McpAdapterOptions & { logger?: JsonlLogger }
): JsonlLogger =>
  options.logger ??
  createJsonlLogger({
    stream: 'mcp-adapter',
    cwd: options.cwd,
  });

export const createMcpServer = (
  options: McpAdapterOptions = {}
): McpAdapterHandle => {
  const logger = resolveAdapterLogger(options);
  const server = new McpServer({
    name: options.name ?? DEFAULT_SERVER_NAME,
    version: options.version ?? DEFAULT_SERVER_VERSION,
  });
  const client =
    options.coreClient ??
    createCoreClient({
      ...options,
      logger: logger.child({ scope: 'core-client' }),
    });

  registerBrowserBridgeTools(server, client);
  logger.info('mcp.server.created', {
    name: options.name ?? DEFAULT_SERVER_NAME,
    version: options.version ?? DEFAULT_SERVER_VERSION,
    core_base_url: client.baseUrl,
  });

  return { server, client };
};

export const startMcpServer = async (
  options: McpAdapterOptions = {}
): Promise<McpAdapterStartHandle> => {
  const logger = resolveAdapterLogger(options);
  logger.info('mcp.stdio.start.begin', {
    name: options.name ?? DEFAULT_SERVER_NAME,
    version: options.version ?? DEFAULT_SERVER_VERSION,
  });

  const handle = createMcpServer({
    ...options,
    logger,
  });
  const transport = new StdioServerTransport();
  try {
    await handle.server.connect(transport);
    logger.info('mcp.stdio.start.ready', {
      core_base_url: handle.client.baseUrl,
    });
  } catch (error) {
    logger.error('mcp.stdio.start.failed', {
      error,
    });
    throw error;
  }
  return { ...handle, transport };
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
  const logger = resolveAdapterLogger(options).child({ scope: 'http-server' });
  const host = options.host ?? DEFAULT_HTTP_HOST;
  const port = typeof options.port === 'number' ? options.port : 0;
  const path = options.path ?? DEFAULT_HTTP_PATH;
  logger.info('mcp.http.start.begin', {
    host,
    port,
    path,
  });

  const client =
    options.coreClient ??
    createCoreClient({
      ...options,
      logger: logger.child({ scope: 'core-client' }),
    });

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
      registerBrowserBridgeTools(sessionServer, client);
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
    core_base_url: client.baseUrl,
  });

  return {
    client,
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
