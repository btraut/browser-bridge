export type CoreServerStartOptions = {
  host?: string;
  port?: number;
};

export type CoreServerHandle = {
  host: string;
  port: number;
  // Intentionally opaque: avoid forcing consumers to install @types/* packages.
  server: unknown;
};

export declare const startCoreServer: (
  options?: CoreServerStartOptions
) => Promise<CoreServerHandle>;

export type McpAdapterOptions = {
  name?: string;
  version?: string;
  host?: string;
  port?: number | string;
  timeoutMs?: number;
  // Advanced: allow providing a preconfigured Core client.
  coreClient?: unknown;
};

export type McpAdapterStartHandle = {
  server: unknown;
  client: unknown;
  transport: unknown;
};

export declare const startMcpServer: (
  options?: McpAdapterOptions
) => Promise<McpAdapterStartHandle>;
