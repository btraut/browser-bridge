import { z } from "zod";
import {
  ErrorCodeSchema,
  ErrorEnvelopeSchema,
  ErrorInfoSchema,
  type ApiEnvelope,
  type SuccessEnvelope,
} from "./errors";
import {
  DiagnosticCheckSchema,
  DiagnosticReportSchema,
  LocatorRoleSchema,
  LocatorSchema,
  OpResultSchema,
  RecoverResultSchema,
  SessionInfoSchema,
  SessionPlaneStatusSchema,
  SessionStateSchema,
  SessionStatusSchema,
} from "./schemas";

export type ErrorCode = z.infer<typeof ErrorCodeSchema>;
export type ErrorInfo = z.infer<typeof ErrorInfoSchema>;
export type ErrorEnvelope = z.infer<typeof ErrorEnvelopeSchema>;
export type { ApiEnvelope, SuccessEnvelope };

export type LocatorRole = z.infer<typeof LocatorRoleSchema>;
export type Locator = z.infer<typeof LocatorSchema>;
export type OpResult = z.infer<typeof OpResultSchema>;

export type SessionState = z.infer<typeof SessionStateSchema>;
export type SessionInfo = z.infer<typeof SessionInfoSchema>;
export type SessionPlaneStatus = z.infer<typeof SessionPlaneStatusSchema>;
export type SessionStatus = z.infer<typeof SessionStatusSchema>;

export type RecoverResult = z.infer<typeof RecoverResultSchema>;

export type DiagnosticCheck = z.infer<typeof DiagnosticCheckSchema>;
export type DiagnosticReport = z.infer<typeof DiagnosticReportSchema>;
