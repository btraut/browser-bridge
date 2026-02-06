import type { InspectErrorCode } from './types';

export class InspectError extends Error {
  public readonly code: InspectErrorCode;
  public readonly retryable: boolean;
  public readonly details?: Record<string, unknown>;

  constructor(
    code: InspectErrorCode,
    message: string,
    options: { retryable?: boolean; details?: Record<string, unknown> } = {}
  ) {
    super(message);
    this.name = 'InspectError';
    this.code = code;
    this.retryable = options.retryable ?? false;
    this.details = options.details;
  }
}
