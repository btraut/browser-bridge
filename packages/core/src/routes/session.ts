import { Response, Router } from "express";
import { InvalidSessionTransition } from "../state";
import { SessionError, SessionMode, SessionRegistry } from "../session";

const SESSION_MODES = new Set(["auto", "attach", "launch"]);

type ErrorInfo = {
  code: string;
  message: string;
  retryable: boolean;
  details?: Record<string, unknown>;
};

type ErrorEnvelope = {
  ok: false;
  error: ErrorInfo;
};

type SuccessEnvelope<T> = {
  ok: true;
  result: T;
};

const sendError = (res: Response, status: number, error: ErrorInfo) => {
  const envelope: ErrorEnvelope = { ok: false, error };
  res.status(status).json(envelope);
};

const sendResult = <T>(res: Response, result: T) => {
  const envelope: SuccessEnvelope<T> = { ok: true, result };
  res.status(200).json(envelope);
};

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null;
};

const readSessionId = (body: unknown): string | undefined => {
  if (!isRecord(body)) {
    return undefined;
  }

  const sessionId = body.session_id;
  if (typeof sessionId !== "string" || sessionId.length === 0) {
    return undefined;
  }

  return sessionId;
};

type SessionRouterOptions = {
  driveConnected?: () => boolean;
};

export const createSessionRouter = (
  registry: SessionRegistry,
  options: SessionRouterOptions = {}
): Router => {
  const router = Router();

  router.post("/create", (req, res) => {
    const body = req.body;
    if (isRecord(body) && body.mode !== undefined) {
      if (typeof body.mode !== "string" || !SESSION_MODES.has(body.mode)) {
        return sendError(res, 400, {
          code: "INVALID_ARGUMENT",
          message: "mode must be one of auto, attach, launch",
          retryable: false,
        });
      }
    }

    const mode = isRecord(body) && typeof body.mode === "string"
      ? (body.mode as SessionMode)
      : "auto";
    const session = registry.create(mode);
    if (options.driveConnected?.()) {
      try {
        registry.apply(session.id, "DRIVE_CONNECTED");
      } catch {
        // Ignore invalid transitions.
      }
    }
    return sendResult(res, {
      session_id: session.id,
      state: session.state,
      created_at: session.createdAt.toISOString(),
    });
  });

  router.post("/status", (req, res) => {
    const sessionId = readSessionId(req.body);
    if (!sessionId) {
      return sendError(res, 400, {
        code: "INVALID_ARGUMENT",
        message: "session_id is required",
        retryable: false,
      });
    }

    try {
      const session = registry.require(sessionId);
      return sendResult(res, {
        session_id: session.id,
        state: session.state,
        updated_at: session.updatedAt.toISOString(),
      });
    } catch (error) {
      if (error instanceof SessionError) {
        return sendError(res, 404, {
          code: error.code,
          message: error.message,
          retryable: false,
        });
      }

      return sendError(res, 500, {
        code: "INTERNAL",
        message: "Unexpected error while fetching status.",
        retryable: false,
      });
    }
  });

  router.post("/recover", (req, res) => {
    const sessionId = readSessionId(req.body);
    if (!sessionId) {
      return sendError(res, 400, {
        code: "INVALID_ARGUMENT",
        message: "session_id is required",
        retryable: false,
      });
    }

    try {
      const result = registry.recover(sessionId);
      return sendResult(res, {
        session_id: result.sessionId,
        recovered: result.recovered,
        state: result.state,
        message: result.message,
      });
    } catch (error) {
      if (error instanceof SessionError) {
        const status = error.code === "SESSION_CLOSED" ? 409 : 404;
        return sendError(res, status, {
          code: error.code,
          message: error.message,
          retryable: false,
        });
      }

      if (error instanceof InvalidSessionTransition) {
        return sendError(res, 409, {
          code: "FAILED_PRECONDITION",
          message: error.message,
          retryable: false,
        });
      }

      return sendError(res, 500, {
        code: "INTERNAL",
        message: "Unexpected error while recovering session.",
        retryable: false,
      });
    }
  });

  router.post("/close", (req, res) => {
    const sessionId = readSessionId(req.body);
    if (!sessionId) {
      return sendError(res, 400, {
        code: "INVALID_ARGUMENT",
        message: "session_id is required",
        retryable: false,
      });
    }

    try {
      registry.close(sessionId);
      return sendResult(res, { ok: true });
    } catch (error) {
      if (error instanceof SessionError) {
        return sendError(res, 404, {
          code: error.code,
          message: error.message,
          retryable: false,
        });
      }

      if (error instanceof InvalidSessionTransition) {
        return sendError(res, 409, {
          code: "FAILED_PRECONDITION",
          message: error.message,
          retryable: false,
        });
      }

      return sendError(res, 500, {
        code: "INTERNAL",
        message: "Unexpected error while closing session.",
        retryable: false,
      });
    }
  });

  return router;
};
