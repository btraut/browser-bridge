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

export const SessionIdSchema = z.object({
  session_id: z.string().min(1),
});

export const SessionModeSchema = z.enum(["auto", "attach", "launch"]);

export const SessionCreateInputSchema = z.object({
  mode: SessionModeSchema.default("auto"),
});
export const SessionCreateOutputSchema = SessionInfoSchema;

export const SessionStatusInputSchema = SessionIdSchema;
export const SessionStatusOutputSchema = SessionStatusSchema;

export const SessionRecoverInputSchema = SessionIdSchema;
export const SessionRecoverOutputSchema = RecoverResultSchema;

export const SessionCloseInputSchema = SessionIdSchema;
export const SessionCloseOutputSchema = z.object({
  ok: z.boolean(),
});

export const DriveWaitConditionSchema = z.object({
  kind: z.enum(["locator_visible", "text_present", "url_matches"]),
  value: z.string().min(1),
});

export const DriveNavigateInputSchema = z.object({
  session_id: z.string().min(1),
  url: z.string().min(1),
  wait: z.enum(["none", "domcontentloaded"]).default("domcontentloaded"),
});
export const DriveNavigateOutputSchema = OpResultSchema;

export const DriveClickInputSchema = z.object({
  session_id: z.string().min(1),
  locator: LocatorSchema,
  click_count: z.number().finite().optional(),
});
export const DriveClickOutputSchema = OpResultSchema;

export const DriveTypeInputSchema = z.object({
  session_id: z.string().min(1),
  locator: LocatorSchema.optional(),
  text: z.string().min(1),
  clear: z.boolean().default(false),
  submit: z.boolean().default(false),
});
export const DriveTypeOutputSchema = OpResultSchema;

export const DriveWaitForInputSchema = z.object({
  session_id: z.string().min(1),
  condition: DriveWaitConditionSchema,
  timeout_ms: z.number().finite().optional(),
});
export const DriveWaitForOutputSchema = OpResultSchema;

export const DriveTabInfoSchema = z.object({
  tab_id: z.number().finite(),
  window_id: z.number().finite(),
  url: z.string().min(1),
  title: z.string(),
  active: z.boolean().optional(),
  last_active_at: z.string().datetime().optional(),
});

export const DriveTabListInputSchema = SessionIdSchema;
export const DriveTabListOutputSchema = z.object({
  tabs: z.array(DriveTabInfoSchema),
});

export const DriveTabActivateInputSchema = z.object({
  session_id: z.string().min(1),
  tab_id: z.number().finite(),
});
export const DriveTabActivateOutputSchema = OpResultSchema;

export const DriveTabCloseInputSchema = z.object({
  session_id: z.string().min(1),
  tab_id: z.number().finite(),
});
export const DriveTabCloseOutputSchema = OpResultSchema;

export const InspectDomFormatSchema = z.enum(["ax", "html"]);
export const InspectConsistencySchema = z.enum(["best_effort", "quiesce"]);

export const DomSnapshotSchema = z
  .object({
    format: InspectDomFormatSchema,
    snapshot: z.unknown(),
  })
  .passthrough();

export const InspectDomSnapshotInputSchema = z.object({
  session_id: z.string().min(1),
  format: InspectDomFormatSchema.default("ax"),
  consistency: InspectConsistencySchema.default("best_effort"),
});
export const InspectDomSnapshotOutputSchema = DomSnapshotSchema;

export const InspectConsoleListInputSchema = SessionIdSchema;
// Console output shape is not specified yet; allow passthrough fields.
export const ConsoleEntrySchema = z
  .object({
    level: z.string().optional(),
    text: z.string().optional(),
    timestamp: z.string().datetime().optional(),
  })
  .passthrough();
export const ConsoleListSchema = z
  .object({
    entries: z.array(ConsoleEntrySchema),
  })
  .passthrough();
export const InspectConsoleListOutputSchema = ConsoleListSchema;

export const ArtifactInfoSchema = z.object({
  artifact_id: z.string(),
  path: z.string(),
  mime: z.string(),
});

export const InspectNetworkHarInputSchema = SessionIdSchema;
export const InspectNetworkHarOutputSchema = ArtifactInfoSchema;

export const InspectEvaluateInputSchema = z.object({
  session_id: z.string().min(1),
  expression: z.string().min(1).optional(),
});
// Evaluate output is implementation-defined; allow passthrough fields.
export const EvaluateResultSchema = z
  .object({
    value: z.unknown().optional(),
    exception: z.unknown().optional(),
  })
  .passthrough();
export const InspectEvaluateOutputSchema = EvaluateResultSchema;

export const InspectPerformanceMetricsInputSchema = SessionIdSchema;
// Performance metrics output shape may expand; allow passthrough metadata.
export const PerformanceMetricSchema = z
  .object({
    name: z.string(),
    value: z.number().finite(),
  })
  .passthrough();
export const PerformanceMetricsSchema = z
  .object({
    metrics: z.array(PerformanceMetricSchema),
  })
  .passthrough();
export const InspectPerformanceMetricsOutputSchema = PerformanceMetricsSchema;

export const ArtifactsScreenshotInputSchema = z.object({
  session_id: z.string().min(1),
  target: z.enum(["viewport", "full"]).default("viewport"),
});
export const ArtifactsScreenshotOutputSchema = ArtifactInfoSchema;

export const DiagnosticsDoctorInputSchema = z.object({
  session_id: z.string().min(1).optional(),
});
export const DiagnosticsDoctorOutputSchema = DiagnosticReportSchema;
