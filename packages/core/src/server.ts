import express, { Express } from "express";
import { createSessionRouter } from "./routes/session";
import { registerArtifactsRoutes } from "./routes/artifacts";
import { registerDiagnosticsRoutes } from "./routes/diagnostics";
import { registerDriveRoutes, registerInspectRoutes } from "./routes";
import { SessionRegistry } from "./session";

export type CoreServer = {
  app: Express;
  registry: SessionRegistry;
};

export type CoreServerOptions = {
  registry?: SessionRegistry;
};

export const createCoreServer = (options: CoreServerOptions = {}): CoreServer => {
  const app = express();
  const registry = options.registry ?? new SessionRegistry();

  app.use(express.json({ limit: "1mb" }));

  app.get("/health", (_req, res) => {
    res.status(200).json({ ok: true });
  });

  app.use("/session", createSessionRouter(registry));

  registerDriveRoutes(app);
  registerInspectRoutes(app);
  registerArtifactsRoutes(app);
  registerDiagnosticsRoutes(app);

  return { app, registry };
};

export type CoreServerStartOptions = {
  host?: string;
  port?: number;
  registry?: SessionRegistry;
};

export type CoreServerHandle = {
  app: Express;
  registry: SessionRegistry;
  server: ReturnType<Express["listen"]>;
  host: string;
  port: number;
};

export const startCoreServer = (
  options: CoreServerStartOptions = {}
): Promise<CoreServerHandle> => {
  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? 0;
  const { app, registry } = createCoreServer({ registry: options.registry });

  return new Promise((resolve, reject) => {
    const server = app.listen(port, host, () => {
      const address = server.address();
      const resolvedPort =
        typeof address === "object" && address !== null ? address.port : port;
      resolve({ app, registry, server, host, port: resolvedPort });
    });

    server.on("error", (error) => {
      reject(error);
    });
  });
};
