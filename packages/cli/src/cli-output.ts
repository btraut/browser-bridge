import { ErrorEnvelope, ErrorInfo, ApiEnvelope } from '@browser-vision/shared';
import { ZodError, z } from 'zod';

type OutputOptions = {
  json: boolean;
};

export class CliError extends Error {
  readonly info: ErrorInfo;

  constructor(info: ErrorInfo) {
    super(info.message);
    this.info = info;
  }
}

export const parseInput = <T>(schema: z.ZodType<T>, payload: unknown): T => {
  const result = schema.safeParse(payload);
  if (result.success) {
    return result.data;
  }

  const [issue] = result.error.issues;
  throw new CliError({
    code: 'INVALID_ARGUMENT',
    message: issue?.message ?? 'Invalid input.',
    retryable: false,
    details: { issues: result.error.issues },
  });
};

export const outputEnvelope = (
  envelope: ApiEnvelope<unknown>,
  options: OutputOptions
): void => {
  if (options.json) {
    console.log(JSON.stringify(envelope, null, 2));
    return;
  }

  if (envelope.ok) {
    if (typeof envelope.result === 'string') {
      console.log(envelope.result);
      return;
    }

    console.log(JSON.stringify(envelope.result, null, 2));
    return;
  }

  console.error(`${envelope.error.code}: ${envelope.error.message}`);
  if (envelope.error.details) {
    console.error(JSON.stringify(envelope.error.details, null, 2));
  }
};

const toErrorInfo = (error: unknown): ErrorInfo => {
  if (error instanceof CliError) {
    return error.info;
  }

  if (error instanceof ZodError) {
    const [issue] = error.issues;
    return {
      code: 'INVALID_ARGUMENT',
      message: issue?.message ?? 'Invalid input.',
      retryable: false,
      details: { issues: error.issues },
    };
  }

  if (error instanceof Error) {
    return {
      code: 'INTERNAL',
      message: error.message,
      retryable: false,
    };
  }

  return {
    code: 'INTERNAL',
    message: 'Unknown error.',
    retryable: false,
  };
};

export const outputError = (error: unknown, options: OutputOptions): void => {
  const info = toErrorInfo(error);
  const envelope: ErrorEnvelope = { ok: false, error: info };

  if (options.json) {
    console.log(JSON.stringify(envelope, null, 2));
    return;
  }

  console.error(`${info.code}: ${info.message}`);
  if (info.details) {
    console.error(JSON.stringify(info.details, null, 2));
  }
};
