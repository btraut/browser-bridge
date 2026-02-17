import { z } from 'zod';

export const RetryHintSchema = z.object({
  retryable: z.boolean(),
  reason: z.string().optional(),
  retry_after_ms: z.number().int().nonnegative().optional(),
  max_attempts: z.number().int().positive().optional(),
});

export type RetryHint = z.infer<typeof RetryHintSchema>;

const DEFAULT_MAX_ATTEMPTS = 1;

type RetryPolicyInput = {
  retryable: boolean;
  retry?: Partial<RetryHint>;
};

export const resolveRetryHint = (input: RetryPolicyInput): RetryHint => ({
  retryable: input.retry?.retryable ?? input.retryable,
  reason: input.retry?.reason,
  retry_after_ms: input.retry?.retry_after_ms,
  max_attempts: input.retry?.max_attempts ?? DEFAULT_MAX_ATTEMPTS,
});

export const shouldRetryByPolicy = (
  options: RetryPolicyInput & { attempt: number }
): boolean => {
  const hint = resolveRetryHint(options);
  const maxAttempts = hint.max_attempts ?? DEFAULT_MAX_ATTEMPTS;
  return hint.retryable && options.attempt < maxAttempts;
};
