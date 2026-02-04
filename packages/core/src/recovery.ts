import { SessionState } from "./state";

export type RecoveryAttempt = {
  sessionId: string;
  recovered: boolean;
  state: SessionState;
  message?: string;
  at: string;
};

export class RecoveryTracker {
  private lastAttempt?: RecoveryAttempt;

  record(attempt: RecoveryAttempt): void {
    this.lastAttempt = attempt;
  }

  getLastAttempt(): RecoveryAttempt | undefined {
    return this.lastAttempt;
  }
}
