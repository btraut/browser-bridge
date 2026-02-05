import { SessionState } from './state';

export type RecoveryAttempt = {
  sessionId: string;
  recovered: boolean;
  state: SessionState;
  message?: string;
  at: string;
};

export type RecoveryMetrics = {
  attempts: RecoveryAttempt[];
  successCount: number;
  failureCount: number;
  successRate: number;
  recentFailureCount: number;
  loopDetected: boolean;
};

export class RecoveryTracker {
  private readonly attempts: RecoveryAttempt[] = [];
  private successCount = 0;
  private failureCount = 0;
  private readonly maxAttempts = 10;
  private readonly loopWindowMs = 60_000;
  private readonly loopFailureThreshold = 3;

  record(attempt: RecoveryAttempt): void {
    this.attempts.push(attempt);
    if (attempt.recovered) {
      this.successCount += 1;
    } else {
      this.failureCount += 1;
    }
    if (this.attempts.length > this.maxAttempts) {
      this.attempts.shift();
    }
  }

  getLastAttempt(): RecoveryAttempt | undefined {
    return this.attempts[this.attempts.length - 1];
  }

  getAttempts(): RecoveryAttempt[] {
    return [...this.attempts];
  }

  getMetrics(now: number = Date.now()): RecoveryMetrics {
    const recentFailureCount = this.attempts.reduce((count, attempt) => {
      if (attempt.recovered) {
        return count;
      }
      const timestamp = Date.parse(attempt.at);
      if (!Number.isFinite(timestamp)) {
        return count;
      }
      return now - timestamp <= this.loopWindowMs ? count + 1 : count;
    }, 0);
    const total = this.successCount + this.failureCount;
    const successRate = total > 0 ? this.successCount / total : 0;
    return {
      attempts: this.getAttempts(),
      successCount: this.successCount,
      failureCount: this.failureCount,
      successRate,
      recentFailureCount,
      loopDetected: recentFailureCount > this.loopFailureThreshold,
    };
  }
}
