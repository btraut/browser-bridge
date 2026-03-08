import { randomUUID } from 'crypto';
import {
  InvalidSessionTransition,
  SessionEvent,
  SessionState,
  transitionSession,
} from './state';

export type SessionRecord = {
  id: string;
  state: SessionState;
  createdAt: Date;
  updatedAt: Date;
  lastAccessedAt: Date;
  selectedTabId?: number;
};

export type RecoverResult = {
  sessionId: string;
  recovered: boolean;
  state: SessionState;
  message?: string;
};

export type SessionErrorCode = 'SESSION_NOT_FOUND' | 'SESSION_CLOSED';

export class SessionError extends Error {
  public readonly code: SessionErrorCode;

  constructor(code: SessionErrorCode, message: string) {
    super(message);
    this.name = 'SessionError';
    this.code = code;
  }
}

export class SessionRegistry {
  private sessions = new Map<string, SessionRecord>();

  create(): SessionRecord {
    const now = new Date();
    const id = `session-${randomUUID()}`;
    const session: SessionRecord = {
      id,
      state: SessionState.INIT,
      createdAt: now,
      updatedAt: now,
      lastAccessedAt: now,
      selectedTabId: undefined,
    };

    this.sessions.set(id, session);
    return session;
  }

  get(sessionId: string): SessionRecord | undefined {
    return this.sessions.get(sessionId);
  }

  list(): SessionRecord[] {
    return Array.from(this.sessions.values());
  }

  require(sessionId: string): SessionRecord {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new SessionError(
        'SESSION_NOT_FOUND',
        `Session ${sessionId} does not exist.`
      );
    }

    session.lastAccessedAt = new Date();
    return session;
  }

  cleanupIdleSessions(ttlMs: number, now = new Date()): number {
    if (!Number.isFinite(ttlMs) || ttlMs <= 0) {
      return 0;
    }

    let removed = 0;
    for (const [id, session] of this.sessions.entries()) {
      const idleMs = now.getTime() - session.lastAccessedAt.getTime();
      if (idleMs > ttlMs) {
        this.sessions.delete(id);
        removed += 1;
      }
    }
    return removed;
  }

  apply(sessionId: string, event: SessionEvent): SessionRecord {
    const session = this.require(sessionId);
    if (session.state === SessionState.CLOSED && event !== 'CLOSE') {
      throw new SessionError(
        'SESSION_CLOSED',
        `Session ${sessionId} is closed.`
      );
    }

    try {
      session.state = transitionSession(session.state, event);
    } catch (error) {
      if (error instanceof InvalidSessionTransition) {
        throw error;
      }
      throw error;
    }

    session.updatedAt = new Date();
    return session;
  }

  recover(
    sessionId: string,
    outcome?: { recovered: boolean; message?: string }
  ): RecoverResult {
    const session = this.require(sessionId);
    if (session.state === SessionState.CLOSED) {
      throw new SessionError(
        'SESSION_CLOSED',
        `Session ${sessionId} is closed.`
      );
    }

    let recovered = false;
    let message: string | undefined;

    if (
      session.state === SessionState.DEGRADED_DRIVE ||
      session.state === SessionState.DEGRADED_INSPECT
    ) {
      if (outcome?.recovered) {
        session.state = transitionSession(session.state, 'RECOVER_SUCCEEDED');
        recovered = true;
        message = outcome.message ?? 'Recovery succeeded.';
      } else if (outcome) {
        session.state = transitionSession(session.state, 'RECOVER_FAILED');
        recovered = false;
        message = outcome.message ?? 'Recovery failed.';
      } else {
        recovered = false;
        message = 'Recovery not attempted.';
      }
    } else if (session.state === SessionState.BROKEN) {
      recovered = false;
      message = 'Session is broken.';
    } else {
      recovered = false;
      message = 'No recovery needed.';
    }

    session.updatedAt = new Date();

    return {
      sessionId: session.id,
      recovered,
      state: session.state,
      message,
    };
  }

  close(sessionId: string): SessionRecord {
    const session = this.require(sessionId);
    session.state = transitionSession(session.state, 'CLOSE');
    session.updatedAt = new Date();
    return session;
  }

  setSelectedTab(sessionId: string, tabId: number): SessionRecord {
    const session = this.require(sessionId);
    session.selectedTabId = tabId;
    session.updatedAt = new Date();
    return session;
  }

  clearSelectedTab(sessionId: string): SessionRecord {
    const session = this.require(sessionId);
    session.selectedTabId = undefined;
    session.updatedAt = new Date();
    return session;
  }
}
