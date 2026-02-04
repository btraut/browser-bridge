import { buildDiagnosticReport } from "../diagnostics";

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
    code: "INVALID_ARGUMENT" | "INTERNAL";
    message: string;
    retryable: boolean;
    details?: Record<string, unknown>;
  };
};

type SuccessEnvelope<T> = {
  ok: true;
  result: T;
};

const sendError = (
  res: ResponseLike,
  status: number,
  error: ErrorEnvelope["error"]
): void => {
  res.status(status).json({ ok: false, error });
};

const sendResult = <T>(res: ResponseLike, result: T): void => {
  const envelope: SuccessEnvelope<T> = { ok: true, result };
  res.status(200).json(envelope);
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const registerDiagnosticsRoutes = (router: RouteRegistry): void => {
  router.post("/diagnostics/doctor", (req, res) => {
    let sessionId: string | undefined;
    if (req.body !== undefined) {
      if (!isRecord(req.body)) {
        sendError(res, 400, {
          code: "INVALID_ARGUMENT",
          message: "Request body must be an object.",
          retryable: false,
        });
        return;
      }
      const raw = req.body.session_id;
      if (raw !== undefined && (typeof raw !== "string" || raw.length === 0)) {
        sendError(res, 400, {
          code: "INVALID_ARGUMENT",
          message: "session_id must be a non-empty string.",
          retryable: false,
          details: { field: "session_id" },
        });
        return;
      }
      sessionId = raw as string | undefined;
    }

    try {
      const report = buildDiagnosticReport(sessionId);
      sendResult(res, report);
    } catch {
      sendError(res, 500, {
        code: "INTERNAL",
        message: "Failed to build diagnostics report.",
        retryable: false,
      });
    }
  });
};
