import { ensureArtifactRootDir } from "../artifacts";

type RequestLike = {
  body?: unknown;
};

type ResponseLike = {
  status: (code: number) => ResponseLike;
  json: (body: unknown) => void;
};

type RouteRegistry = {
  post: (path: string, handler: (req: RequestLike, res: ResponseLike) => void) => void;
};

type ErrorEnvelope = {
  ok: false;
  error: {
    code: "INVALID_ARGUMENT" | "NOT_IMPLEMENTED" | "ARTIFACT_IO_ERROR";
    message: string;
    retryable: boolean;
    details?: Record<string, unknown>;
  };
};

const sendError = (
  res: ResponseLike,
  status: number,
  code: ErrorEnvelope["error"]["code"],
  message: string,
  details?: Record<string, unknown>
): void => {
  res.status(status).json({
    ok: false,
    error: {
      code,
      message,
      retryable: false,
      ...(details ? { details } : {}),
    },
  });
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const registerArtifactsRoutes = (router: RouteRegistry): void => {
  router.post("/artifacts/screenshot", async (req, res) => {
    if (!isRecord(req.body)) {
      sendError(res, 400, "INVALID_ARGUMENT", "Request body must be an object.");
      return;
    }

    const sessionId = req.body.session_id;
    if (typeof sessionId !== "string" || sessionId.length === 0) {
      sendError(res, 400, "INVALID_ARGUMENT", "session_id is required.", {
        field: "session_id",
      });
      return;
    }

    const target = req.body.target;
    if (
      target !== undefined &&
      target !== "viewport" &&
      target !== "full"
    ) {
      sendError(res, 400, "INVALID_ARGUMENT", "target must be viewport or full.", {
        field: "target",
      });
      return;
    }

    try {
      const rootDir = await ensureArtifactRootDir(sessionId);
      sendError(
        res,
        501,
        "NOT_IMPLEMENTED",
        "artifacts.screenshot is not implemented yet.",
        {
          action: "artifacts.screenshot",
          target: target ?? "viewport",
          root_dir: rootDir,
        }
      );
    } catch {
      sendError(res, 500, "ARTIFACT_IO_ERROR", "Failed to prepare artifact path.");
    }
  });
};
