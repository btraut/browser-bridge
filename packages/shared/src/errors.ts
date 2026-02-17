import { z } from 'zod';

// Keep error codes stable; add new codes without renaming existing ones.
export const ErrorCodeSchema = z.enum([
  'UNKNOWN',
  'INVALID_ARGUMENT',
  'NOT_FOUND',
  'ALREADY_EXISTS',
  'FAILED_PRECONDITION',
  'UNAUTHORIZED',
  'FORBIDDEN',
  'PERMISSION_REQUIRED',
  'PERMISSION_DENIED',
  'PERMISSION_PROMPT_TIMEOUT',
  'CONFLICT',
  'TIMEOUT',
  'CANCELLED',
  'UNAVAILABLE',
  'RATE_LIMITED',
  'NOT_IMPLEMENTED',
  'INTERNAL',
  'SESSION_NOT_FOUND',
  'SESSION_CLOSED',
  'SESSION_BROKEN',
  'DRIVE_UNAVAILABLE',
  'INSPECT_UNAVAILABLE',
  'EXTENSION_DISCONNECTED',
  'DEBUGGER_IN_USE',
  'ATTACH_DENIED',
  'TAB_NOT_FOUND',
  'NOT_SUPPORTED',
  'LOCATOR_NOT_FOUND',
  'NAVIGATION_FAILED',
  'EVALUATION_FAILED',
  'ARTIFACT_IO_ERROR',
]);

export type ErrorCode = z.infer<typeof ErrorCodeSchema>;

export const PublicErrorCodeSchema = z.enum([
  'UNKNOWN',
  'INVALID_ARGUMENT',
  'NOT_FOUND',
  'ALREADY_EXISTS',
  'FAILED_PRECONDITION',
  'UNAUTHORIZED',
  'FORBIDDEN',
  'CONFLICT',
  'TIMEOUT',
  'CANCELLED',
  'UNAVAILABLE',
  'RATE_LIMITED',
  'NOT_IMPLEMENTED',
  'INTERNAL',
]);

export type PublicErrorCode = z.infer<typeof PublicErrorCodeSchema>;

export const PublicErrorDetailsSchema = z
  .object({
    legacy_code: ErrorCodeSchema.optional(),
    reason: z.string().optional(),
    resource: z.string().optional(),
    field: z.string().optional(),
    session_id: z.string().optional(),
    tab_id: z.number().finite().optional(),
    retry_after_ms: z.number().finite().optional(),
    next_step: z.string().optional(),
  })
  .catchall(z.unknown());

export type PublicErrorDetails = z.infer<typeof PublicErrorDetailsSchema>;

const LEGACY_ERROR_CODE_MAP: Partial<
  Record<
    ErrorCode,
    { code: PublicErrorCode; reason: string; resource?: string }
  >
> = {
  PERMISSION_REQUIRED: {
    code: 'FORBIDDEN',
    reason: 'permission_required',
  },
  PERMISSION_DENIED: {
    code: 'FORBIDDEN',
    reason: 'permission_denied',
  },
  PERMISSION_PROMPT_TIMEOUT: {
    code: 'TIMEOUT',
    reason: 'permission_prompt_timeout',
  },
  SESSION_NOT_FOUND: {
    code: 'NOT_FOUND',
    reason: 'session_not_found',
    resource: 'session',
  },
  SESSION_CLOSED: {
    code: 'FAILED_PRECONDITION',
    reason: 'session_closed',
    resource: 'session',
  },
  SESSION_BROKEN: {
    code: 'FAILED_PRECONDITION',
    reason: 'session_broken',
    resource: 'session',
  },
  DRIVE_UNAVAILABLE: {
    code: 'UNAVAILABLE',
    reason: 'drive_unavailable',
  },
  INSPECT_UNAVAILABLE: {
    code: 'UNAVAILABLE',
    reason: 'inspect_unavailable',
  },
  EXTENSION_DISCONNECTED: {
    code: 'UNAVAILABLE',
    reason: 'extension_disconnected',
  },
  DEBUGGER_IN_USE: {
    code: 'CONFLICT',
    reason: 'debugger_in_use',
  },
  ATTACH_DENIED: {
    code: 'FORBIDDEN',
    reason: 'attach_denied',
  },
  TAB_NOT_FOUND: {
    code: 'NOT_FOUND',
    reason: 'tab_not_found',
    resource: 'tab',
  },
  LOCATOR_NOT_FOUND: {
    code: 'NOT_FOUND',
    reason: 'locator_not_found',
    resource: 'locator',
  },
  NOT_SUPPORTED: {
    code: 'NOT_IMPLEMENTED',
    reason: 'not_supported',
  },
  NAVIGATION_FAILED: {
    code: 'FAILED_PRECONDITION',
    reason: 'navigation_failed',
  },
  EVALUATION_FAILED: {
    code: 'FAILED_PRECONDITION',
    reason: 'evaluation_failed',
  },
  ARTIFACT_IO_ERROR: {
    code: 'FAILED_PRECONDITION',
    reason: 'artifact_io_error',
  },
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export const normalizeErrorCode = (code: ErrorCode | string): PublicErrorCode =>
  LEGACY_ERROR_CODE_MAP[code as ErrorCode]?.code ??
  (PublicErrorCodeSchema.safeParse(code).success
    ? (code as PublicErrorCode)
    : 'INTERNAL');

export const ErrorInfoSchema = z.object({
  code: ErrorCodeSchema,
  message: z.string(),
  retryable: z.boolean(),
  details: z.record(z.string(), z.unknown()).optional(),
});

export type ErrorInfo = z.infer<typeof ErrorInfoSchema>;

type ErrorLike = {
  code: string;
  message: string;
  retryable: boolean;
  details?: Record<string, unknown>;
};

export const normalizeErrorInfo = (error: ErrorLike): ErrorInfo => {
  const parsedCode = ErrorCodeSchema.safeParse(error.code);
  const normalizedInputCode: ErrorCode = parsedCode.success
    ? parsedCode.data
    : 'INTERNAL';

  const normalizedInput: ErrorInfo = {
    ...error,
    code: normalizedInputCode,
    ...(parsedCode.success
      ? {}
      : {
          details: PublicErrorDetailsSchema.parse({
            ...(isRecord(error.details) ? error.details : {}),
            legacy_code: error.code,
            reason: 'unknown_code',
          }),
        }),
  };

  const mapping = LEGACY_ERROR_CODE_MAP[normalizedInput.code];
  if (!mapping) {
    return normalizedInput;
  }

  const existingDetails = isRecord(normalizedInput.details)
    ? normalizedInput.details
    : {};
  const details: PublicErrorDetails = {
    ...existingDetails,
    legacy_code: normalizedInput.code,
    reason: mapping.reason,
    ...(mapping.resource ? { resource: mapping.resource } : {}),
  };

  return {
    ...normalizedInput,
    code: mapping.code,
    details: PublicErrorDetailsSchema.parse(details),
  };
};

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
