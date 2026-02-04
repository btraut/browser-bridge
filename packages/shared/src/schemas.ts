import { z } from "zod";
import { ErrorInfoSchema } from "./errors";

export const LocatorRoleSchema = z.object({
  name: z.string(),
  value: z.string().optional(),
});

export const LocatorSchema = z
  .object({
    testid: z.string().min(1).optional(),
    css: z.string().min(1).optional(),
    text: z.string().min(1).optional(),
    role: LocatorRoleSchema.optional(),
  })
  .refine(
    (value) => Boolean(value.testid || value.css || value.text || value.role),
    {
      message: "Locator must include at least one selector.",
    }
  );

export const OpResultSchema = z.object({
  ok: z.literal(true),
  message: z.string().optional(),
  warnings: z.array(z.string()).optional(),
});

export const SessionStateSchema = z.enum([
  "INIT",
  "DRIVE_READY",
  "INSPECT_READY",
  "READY",
  "DEGRADED_DRIVE",
  "DEGRADED_INSPECT",
  "BROKEN",
  "CLOSED",
]);

export const SessionInfoSchema = z.object({
  session_id: z.string(),
  state: SessionStateSchema,
  created_at: z.string().datetime().optional(),
});

export const SessionPlaneStatusSchema = z.object({
  connected: z.boolean(),
  last_seen_at: z.string().datetime().optional(),
  error: ErrorInfoSchema.optional(),
});

export const SessionStatusSchema = z.object({
  session_id: z.string(),
  state: SessionStateSchema,
  drive: SessionPlaneStatusSchema.optional(),
  inspect: SessionPlaneStatusSchema.optional(),
  updated_at: z.string().datetime().optional(),
});

export const RecoverResultSchema = z.object({
  session_id: z.string(),
  recovered: z.boolean(),
  state: SessionStateSchema,
  message: z.string().optional(),
});

export const DiagnosticCheckSchema = z.object({
  name: z.string(),
  ok: z.boolean(),
  message: z.string().optional(),
  details: z.record(z.string(), z.unknown()).optional(),
});

export const DiagnosticReportSchema = z.object({
  ok: z.boolean(),
  session_id: z.string().optional(),
  checks: z.array(DiagnosticCheckSchema).optional(),
  chrome: z
    .object({
      path: z.string().optional(),
      version: z.string().optional(),
      reachable: z.boolean().optional(),
    })
    .optional(),
  extension: z
    .object({
      connected: z.boolean().optional(),
      version: z.string().optional(),
      last_seen_at: z.string().datetime().optional(),
    })
    .optional(),
  cdp: z
    .object({
      connected: z.boolean().optional(),
      target_url: z.string().optional(),
    })
    .optional(),
  artifacts: z
    .object({
      root_dir: z.string().optional(),
    })
    .optional(),
  warnings: z.array(z.string()).optional(),
  notes: z.array(z.string()).optional(),
});
