import { z } from "zod";

// Keep error codes stable; add new codes without renaming existing ones.
export const ErrorCodeSchema = z.enum([
  "UNKNOWN",
  "INVALID_ARGUMENT",
  "NOT_FOUND",
  "ALREADY_EXISTS",
  "FAILED_PRECONDITION",
  "UNAUTHORIZED",
  "FORBIDDEN",
  "CONFLICT",
  "TIMEOUT",
  "CANCELLED",
  "UNAVAILABLE",
  "RATE_LIMITED",
  "NOT_IMPLEMENTED",
  "INTERNAL",
  "SESSION_NOT_FOUND",
  "SESSION_CLOSED",
  "SESSION_BROKEN",
  "DRIVE_UNAVAILABLE",
  "INSPECT_UNAVAILABLE",
  "EXTENSION_DISCONNECTED",
  "DEBUGGER_IN_USE",
  "ATTACH_DENIED",
  "TAB_NOT_FOUND",
  "NOT_SUPPORTED",
  "LOCATOR_NOT_FOUND",
  "NAVIGATION_FAILED",
  "EVALUATION_FAILED",
  "ARTIFACT_IO_ERROR",
]);

export type ErrorCode = z.infer<typeof ErrorCodeSchema>;

export const ErrorInfoSchema = z.object({
  code: ErrorCodeSchema,
  message: z.string(),
  retryable: z.boolean(),
  details: z.record(z.string(), z.unknown()).optional(),
});

export type ErrorInfo = z.infer<typeof ErrorInfoSchema>;

export const ErrorEnvelopeSchema = z.object({
  ok: z.literal(false),
  error: ErrorInfoSchema,
});

export type ErrorEnvelope = z.infer<typeof ErrorEnvelopeSchema>;

export const successEnvelopeSchema = <T extends z.ZodTypeAny>(result: T) =>
  z.object({
    ok: z.literal(true),
    result,
  });

export const apiEnvelopeSchema = <T extends z.ZodTypeAny>(result: T) =>
  z.union([successEnvelopeSchema(result), ErrorEnvelopeSchema]);

export type SuccessEnvelope<T> = {
  ok: true;
  result: T;
};

export type ApiEnvelope<T> = SuccessEnvelope<T> | ErrorEnvelope;
