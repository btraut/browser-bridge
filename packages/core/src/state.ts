export enum SessionState {
  INIT = 'INIT',
  DRIVE_READY = 'DRIVE_READY',
  INSPECT_READY = 'INSPECT_READY',
  READY = 'READY',
  DEGRADED_DRIVE = 'DEGRADED_DRIVE',
  DEGRADED_INSPECT = 'DEGRADED_INSPECT',
  BROKEN = 'BROKEN',
  CLOSED = 'CLOSED',
}

export type SessionEvent =
  | 'DRIVE_CONNECTED'
  | 'INSPECT_CONNECTED'
  | 'DRIVE_DISCONNECTED'
  | 'INSPECT_DISCONNECTED'
  | 'RECOVER_SUCCEEDED'
  | 'RECOVER_FAILED'
  | 'CLOSE';

export class InvalidSessionTransition extends Error {
  public readonly from: SessionState;
  public readonly event: SessionEvent;

  constructor(from: SessionState, event: SessionEvent) {
    super(`Invalid session transition from ${from} via ${event}.`);
    this.name = 'InvalidSessionTransition';
    this.from = from;
    this.event = event;
  }
}

export const transitionSession = (
  state: SessionState,
  event: SessionEvent
): SessionState => {
  if (event === 'CLOSE') {
    return SessionState.CLOSED;
  }

  if (event === 'RECOVER_FAILED') {
    if (state === SessionState.CLOSED) {
      throw new InvalidSessionTransition(state, event);
    }

    return SessionState.BROKEN;
  }

  switch (state) {
    case SessionState.INIT: {
      if (event === 'DRIVE_CONNECTED') {
        return SessionState.DRIVE_READY;
      }
      if (event === 'INSPECT_CONNECTED') {
        return SessionState.INSPECT_READY;
      }
      break;
    }
    case SessionState.DRIVE_READY: {
      if (event === 'INSPECT_CONNECTED') {
        return SessionState.READY;
      }
      if (event === "DRIVE_DISCONNECTED") {
        return SessionState.INIT;
      }
      break;
    }
    case SessionState.INSPECT_READY: {
      if (event === 'DRIVE_CONNECTED') {
        return SessionState.READY;
      }
      break;
    }
    case SessionState.READY: {
      if (event === 'DRIVE_DISCONNECTED') {
        return SessionState.DEGRADED_DRIVE;
      }
      if (event === 'INSPECT_DISCONNECTED') {
        return SessionState.DEGRADED_INSPECT;
      }
      break;
    }
    case SessionState.DEGRADED_DRIVE: {
      if (event === 'RECOVER_SUCCEEDED') {
        return SessionState.READY;
      }
      break;
    }
    case SessionState.DEGRADED_INSPECT: {
      if (event === 'RECOVER_SUCCEEDED') {
        return SessionState.READY;
      }
      break;
    }
    case SessionState.BROKEN:
    case SessionState.CLOSED:
    default:
      break;
  }

  throw new InvalidSessionTransition(state, event);
};

export const shouldRetryDriveOp = (options: {
  attempt: number;
  retryable: boolean;
}): boolean => {
  return options.retryable && options.attempt === 0;
};

export const shouldRetryInspectOp = (options: {
  attempt: number;
  reconnectSucceeded: boolean;
}): boolean => {
  return options.reconnectSucceeded && options.attempt === 0;
};
