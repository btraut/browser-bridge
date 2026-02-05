import { z } from 'zod';
import { ErrorInfoSchema } from './errors';

export const LocatorRoleSchema = z.object({
  name: z.string(),
  value: z.string().optional(),
});

export const LocatorSchema = z
  .object({
    ref: z.string().min(1).optional(),
    testid: z.string().min(1).optional(),
    css: z.string().min(1).optional(),
    text: z.string().min(1).optional(),
    role: LocatorRoleSchema.optional(),
  })
  .refine(
    (value) =>
      Boolean(value.ref || value.testid || value.css || value.text || value.role),
    {
      message: 'Locator must include at least one selector.',
    }
  );

export const OpResultSchema = z.object({
  ok: z.literal(true),
  message: z.string().optional(),
  warnings: z.array(z.string()).optional(),
});

export const SessionStateSchema = z.enum([
  'INIT',
  'DRIVE_READY',
  'INSPECT_READY',
  'READY',
  'DEGRADED_DRIVE',
  'DEGRADED_INSPECT',
  'BROKEN',
  'CLOSED',
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
  extension: z
    .object({
      connected: z.boolean().optional(),
      version: z.string().optional(),
      last_seen_at: z.string().datetime().optional(),
    })
    .optional(),
  debugger: z
    .object({
      attached: z.boolean().optional(),
      idle_timeout_ms: z.number().finite().optional(),
      console_buffer_size: z.number().finite().optional(),
      network_buffer_size: z.number().finite().optional(),
      last_error: ErrorInfoSchema.optional(),
    })
    .optional(),
  artifacts: z
    .object({
      root_dir: z.string().optional(),
    })
    .optional(),
  recovery: z
    .object({
      last_attempt: z
        .object({
          session_id: z.string(),
          recovered: z.boolean(),
          state: SessionStateSchema,
          message: z.string().optional(),
          at: z.string(),
        })
        .optional(),
      attempts: z
        .array(
          z.object({
            session_id: z.string(),
            recovered: z.boolean(),
            state: SessionStateSchema,
            message: z.string().optional(),
            at: z.string(),
          })
        )
        .optional(),
      success_count: z.number().finite().optional(),
      failure_count: z.number().finite().optional(),
      success_rate: z.number().finite().optional(),
      recent_failure_count: z.number().finite().optional(),
      loop_detected: z.boolean().optional(),
    })
    .optional(),
  warnings: z.array(z.string()).optional(),
  notes: z.array(z.string()).optional(),
});

export const SessionIdSchema = z.object({
  session_id: z.string().min(1),
});

export const SessionCreateInputSchema = z.object({}).strict().default({});
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
  kind: z.enum(['locator_visible', 'text_present', 'url_matches']),
  value: z.string().min(1),
});

export const DriveNavigateInputSchema = z.object({
  session_id: z.string().min(1),
  url: z.string().min(1),
  tab_id: z.number().finite().optional(),
  wait: z.enum(['none', 'domcontentloaded']).default('domcontentloaded'),
});
export const DriveNavigateOutputSchema = OpResultSchema;

export const DriveGoBackInputSchema = z.object({
  session_id: z.string().min(1),
  tab_id: z.number().finite().optional(),
});
export const DriveGoBackOutputSchema = OpResultSchema;

export const DriveGoForwardInputSchema = z.object({
  session_id: z.string().min(1),
  tab_id: z.number().finite().optional(),
});
export const DriveGoForwardOutputSchema = OpResultSchema;

export const DriveBackInputSchema = DriveGoBackInputSchema;
export const DriveBackOutputSchema = OpResultSchema;

export const DriveForwardInputSchema = DriveGoForwardInputSchema;
export const DriveForwardOutputSchema = OpResultSchema;

export const DriveClickInputSchema = z.object({
  session_id: z.string().min(1),
  locator: LocatorSchema,
  tab_id: z.number().finite().optional(),
  click_count: z.number().finite().optional(),
});
export const DriveClickOutputSchema = OpResultSchema;

export const DriveHoverInputSchema = z.object({
  session_id: z.string().min(1),
  locator: LocatorSchema,
  delay_ms: z.number().min(0).max(10000).optional(),
  tab_id: z.number().finite().optional(),
});
export const DriveHoverOutputSchema = z.object({
  format: z.literal("html"),
  snapshot: z.string(),
});

export const DriveSelectInputSchema = z
  .object({
    session_id: z.string().min(1),
    locator: LocatorSchema,
    value: z.string().min(1).optional(),
    text: z.string().min(1).optional(),
    index: z.number().int().min(0).optional(),
    tab_id: z.number().finite().optional(),
  })
  .refine((value) => value.value || value.text || value.index !== undefined, {
    message: "Either value, text, or index must be provided.",
    path: ["select"],
  });
export const DriveSelectOutputSchema = OpResultSchema;

export const DriveTypeInputSchema = z.object({
  session_id: z.string().min(1),
  locator: LocatorSchema.optional(),
  text: z.string().min(1),
  tab_id: z.number().finite().optional(),
  clear: z.boolean().default(false),
  submit: z.boolean().default(false),
});
export const DriveTypeOutputSchema = OpResultSchema;

export const DriveFillFormFieldSchema = z
  .object({
    selector: z.string().min(1).optional(),
    locator: LocatorSchema.optional(),
    value: z.union([z.string(), z.boolean()]),
    type: z
      .enum(["auto", "text", "select", "checkbox", "radio", "contentEditable"])
      .default("auto"),
    submit: z.boolean().default(false),
  })
  .refine((value) => Boolean(value.selector || value.locator), {
    message: "fill_form field requires selector or locator.",
    path: ["selector"],
  });

export const DriveFillFormInputSchema = z.object({
  session_id: z.string().min(1),
  fields: z.array(DriveFillFormFieldSchema).min(1),
  tab_id: z.number().finite().optional(),
});
export const DriveFillFormOutputSchema = z.object({
  filled: z.number().finite(),
  attempted: z.number().finite(),
  errors: z.array(z.string()).optional(),
});

export const DriveDragInputSchema = z.object({
  session_id: z.string().min(1),
  from: LocatorSchema,
  to: LocatorSchema,
  steps: z.number().min(1).max(50).default(12),
  tab_id: z.number().finite().optional(),
});
export const DriveDragOutputSchema = OpResultSchema;

export const DriveHandleDialogInputSchema = z.object({
  session_id: z.string().min(1),
  action: z.enum(["accept", "dismiss"]),
  promptText: z.string().optional(),
  tab_id: z.number().finite().optional(),
});
export const DriveHandleDialogOutputSchema = OpResultSchema;

export const DriveKeyModifiersSchema = z.object({
  ctrl: z.boolean().optional(),
  alt: z.boolean().optional(),
  shift: z.boolean().optional(),
  meta: z.boolean().optional(),
});

export const DriveKeyPressInputSchema = z.object({
  session_id: z.string().min(1),
  key: z.string().min(1),
  modifiers: DriveKeyModifiersSchema.optional(),
  tab_id: z.number().finite().optional(),
});
export const DriveKeyPressOutputSchema = OpResultSchema;

export const DriveKeyModifierSchema = z.enum(["ctrl", "alt", "shift", "meta"]);

export const DriveKeyInputSchema = z.object({
  session_id: z.string().min(1),
  key: z.string().min(1),
  modifiers: z.array(DriveKeyModifierSchema).optional(),
  repeat: z.number().int().min(1).max(50).optional(),
  tab_id: z.number().finite().optional(),
});
export const DriveKeyOutputSchema = OpResultSchema;

export const DriveScrollInputSchema = z
  .object({
    session_id: z.string().min(1),
    delta_x: z.number().finite().optional(),
    delta_y: z.number().finite().optional(),
    top: z.number().finite().optional(),
    left: z.number().finite().optional(),
    behavior: z.enum(['auto', 'smooth']).optional(),
    tab_id: z.number().finite().optional(),
  })
  .refine(
    (value) =>
      value.delta_x !== undefined ||
      value.delta_y !== undefined ||
      value.top !== undefined ||
      value.left !== undefined,
    {
      message: 'scroll requires delta_x/delta_y or top/left.',
      path: ['scroll'],
    }
  );
export const DriveScrollOutputSchema = OpResultSchema;

export const DriveWaitForInputSchema = z.object({
  session_id: z.string().min(1),
  condition: DriveWaitConditionSchema,
  timeout_ms: z.number().finite().optional(),
  tab_id: z.number().finite().optional(),
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

export const InspectDomFormatSchema = z.enum(['ax', 'html']);
export const InspectConsistencySchema = z.enum(['best_effort', 'quiesce']);

export const TargetHintSchema = z.object({
  url: z.string().min(1).optional(),
  title: z.string().min(1).optional(),
  last_active_at: z.string().optional(),
  lastActiveAt: z.string().optional(),
});

export const FormFieldInfoSchema = z.object({
  name: z.string(),
  type: z.string(),
  value: z.string(),
  options: z.array(z.string()).optional(),
});

export const FormInfoSchema = z.object({
  selector: z.string(),
  action: z.string().optional(),
  method: z.string().optional(),
  fields: z.array(FormFieldInfoSchema),
});

export const StorageEntrySchema = z.object({
  key: z.string(),
  value: z.string(),
});

export const PageStateSchema = z.object({
  forms: z.array(FormInfoSchema),
  localStorage: z.array(StorageEntrySchema),
  sessionStorage: z.array(StorageEntrySchema),
  cookies: z.array(StorageEntrySchema),
  warnings: z.array(z.string()).optional(),
});

export const DomSnapshotSchema = z
  .object({
    format: InspectDomFormatSchema,
    snapshot: z.unknown(),
  })
  .passthrough();

export const InspectDomSnapshotInputSchema = z.object({
  session_id: z.string().min(1),
  format: InspectDomFormatSchema.default('ax'),
  consistency: InspectConsistencySchema.default('best_effort'),
  target: TargetHintSchema.optional(),
});
export const InspectDomSnapshotOutputSchema = DomSnapshotSchema;

export const DomDiffResultSchema = z.object({
  added: z.array(z.string()),
  removed: z.array(z.string()),
  changed: z.array(z.string()),
  summary: z.string(),
});

export const InspectDomDiffInputSchema = SessionIdSchema;
export const InspectDomDiffOutputSchema = DomDiffResultSchema;

export const InspectPageStateInputSchema = SessionIdSchema.extend({
  target: TargetHintSchema.optional(),
});
export const InspectPageStateOutputSchema = PageStateSchema;

export const InspectExtractContentFormatSchema = z.enum([
  "markdown",
  "text",
  "article_json",
]);

export const InspectExtractContentInputSchema = SessionIdSchema.extend({
  format: InspectExtractContentFormatSchema.default("markdown"),
  include_metadata: z.boolean().default(true),
  target: TargetHintSchema.optional(),
});

export const InspectExtractContentOutputSchema = z.object({
  content: z.string(),
  title: z.string().optional(),
  byline: z.string().optional(),
  excerpt: z.string().optional(),
  siteName: z.string().optional(),
  warnings: z.array(z.string()).optional(),
});

export const InspectConsoleListInputSchema = SessionIdSchema.extend({
  target: TargetHintSchema.optional(),
});
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

export const InspectNetworkHarInputSchema = SessionIdSchema.extend({
  target: TargetHintSchema.optional(),
});
export const InspectNetworkHarOutputSchema = ArtifactInfoSchema;

export const InspectEvaluateInputSchema = z.object({
  session_id: z.string().min(1),
  expression: z.string().min(1).optional(),
  target: TargetHintSchema.optional(),
});
// Evaluate output is implementation-defined; allow passthrough fields.
export const EvaluateResultSchema = z
  .object({
    value: z.unknown().optional(),
    exception: z.unknown().optional(),
  })
  .passthrough();
export const InspectEvaluateOutputSchema = EvaluateResultSchema;

export const InspectPerformanceMetricsInputSchema = SessionIdSchema.extend({
  target: TargetHintSchema.optional(),
});
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
  target: z.enum(['viewport', 'full']).default('viewport'),
  fullPage: z.boolean().default(false),
  format: z.enum(['png', 'jpeg', 'webp']).default('png'),
  quality: z.number().min(0).max(100).optional(),
});
export const ArtifactsScreenshotOutputSchema = ArtifactInfoSchema;

export const DiagnosticsDoctorInputSchema = z.object({
  session_id: z.string().min(1).optional(),
});
export const DiagnosticsDoctorOutputSchema = DiagnosticReportSchema;
