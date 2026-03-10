import { Router } from 'express';
import { InvalidSessionTransition, SessionState } from '../state';
import { SessionError, SessionRegistry } from '../session';
import { isRecord, sendError, sendResult } from './shared';

const readSessionId = (body: unknown): string | undefined => {
  if (!isRecord(body)) {
    return undefined;
  }

  const sessionId = body.session_id;
  if (typeof sessionId !== 'string' || sessionId.length === 0) {
    return undefined;
  }

  return sessionId;
};

type SessionRouterOptions = {
  driveConnected?: () => boolean;
  inspectRecover?: (sessionId: string) => Promise<boolean>;
  recordRecovery?: (attempt: {
    sessionId: string;
    recovered: boolean;
    state: SessionState;
    message?: string;
    at: string;
  }) => void;
};

export const createSessionRouter = (
  registry: SessionRegistry,
  options: SessionRouterOptions = {}
): Router => {
  const router = Router();

  router.post('/create', (req, res) => {
    const body = req.body;
    if (body !== undefined) {
      if (!isRecord(body)) {
        return sendError(res, 400, {
          code: 'INVALID_ARGUMENT',
          message: 'Request body must be an object.',
          retryable: false,
        });
      }
      if (Object.keys(body).length > 0) {
        return sendError(res, 400, {
          code: 'INVALID_ARGUMENT',
          message: 'session.create does not accept any input fields.',
          retryable: false,
        });
      }
    }

    const session = registry.create();
    if (options.driveConnected?.()) {
      try {
        registry.apply(session.id, 'DRIVE_CONNECTED');
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

  router.post('/status', (req, res) => {
    const sessionId = readSessionId(req.body);
    if (!sessionId) {
      return sendError(res, 400, {
        code: 'INVALID_ARGUMENT',
        message: 'session_id is required',
        retryable: false,
      });
    }

    try {
      const session = registry.require(sessionId);
      return sendResult(res, {
        session_id: session.id,
        state: session.state,
        updated_at: session.updatedAt.toISOString(),
        ...(typeof session.selectedTabId === 'number'
          ? { selected_tab_id: session.selectedTabId }
          : {}),
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
        code: 'INTERNAL',
        message: 'Unexpected error while fetching status.',
        retryable: false,
      });
    }
  });

  router.post('/recover', async (req, res) => {
    const sessionId = readSessionId(req.body);
    if (!sessionId) {
      return sendError(res, 400, {
        code: 'INVALID_ARGUMENT',
        message: 'session_id is required',
        retryable: false,
      });
    }

    try {
      const session = registry.require(sessionId);
      let outcome:
        | {
            recovered: boolean;
            message?: string;
          }
        | undefined;

      if (session.state === SessionState.DEGRADED_DRIVE) {
        const connected = options.driveConnected?.() ?? false;
        outcome = {
          recovered: connected,
          message: connected
            ? 'Drive recovery succeeded.'
            : 'Drive recovery failed.',
        };
      } else if (session.state === SessionState.DEGRADED_INSPECT) {
        const recovered = options.inspectRecover
          ? await options.inspectRecover(sessionId)
          : false;
        outcome = {
          recovered,
          message: recovered
            ? 'Inspect recovery succeeded.'
            : 'Inspect recovery failed.',
        };
      }

      const result = registry.recover(sessionId, outcome);
      if (outcome) {
        const attempt = {
          sessionId,
          recovered: result.recovered,
          state: result.state,
          message: result.message,
          at: new Date().toISOString(),
        };
        options.recordRecovery?.(attempt);
        const status = result.recovered ? 'succeeded' : 'failed';
        console.info(
          `[recovery] session ${sessionId} ${status}: ${result.message ?? ''}`
        );
      }
      return sendResult(res, {
        session_id: result.sessionId,
        recovered: result.recovered,
        state: result.state,
        message: result.message,
      });
    } catch (error) {
      if (error instanceof SessionError) {
        const status = error.code === 'SESSION_CLOSED' ? 409 : 404;
        return sendError(res, status, {
          code: error.code,
          message: error.message,
          retryable: false,
        });
      }

      if (error instanceof InvalidSessionTransition) {
        return sendError(res, 409, {
          code: 'FAILED_PRECONDITION',
          message: error.message,
          retryable: false,
        });
      }

      return sendError(res, 500, {
        code: 'INTERNAL',
        message: 'Unexpected error while recovering session.',
        retryable: false,
      });
    }
  });

  router.post('/close', (req, res) => {
    const sessionId = readSessionId(req.body);
    if (!sessionId) {
      return sendError(res, 400, {
        code: 'INVALID_ARGUMENT',
        message: 'session_id is required',
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
          code: 'FAILED_PRECONDITION',
          message: error.message,
          retryable: false,
        });
      }

      return sendError(res, 500, {
        code: 'INTERNAL',
        message: 'Unexpected error while closing session.',
        retryable: false,
      });
    }
  });

  return router;
};
