import {
  type ApiEnvelope,
  successEnvelopeSchema,
  ArtifactsScreenshotInputSchema,
  ArtifactsScreenshotOutputSchema,
  DiagnosticsDoctorInputSchema,
  DiagnosticsDoctorOutputSchema,
  DialogAcceptInputSchema,
  DialogAcceptOutputSchema,
  DialogDismissInputSchema,
  DialogDismissOutputSchema,
  HealthCheckInputSchema,
  HealthCheckOutputSchema,
  ErrorEnvelopeSchema,
  DriveClickInputSchema,
  DriveClickOutputSchema,
  DriveDragInputSchema,
  DriveDragOutputSchema,
  DriveFillFormInputSchema,
  DriveFillFormOutputSchema,
  DriveGoBackInputSchema,
  DriveGoBackOutputSchema,
  DriveGoForwardInputSchema,
  DriveGoForwardOutputSchema,
  DriveHandleDialogInputSchema,
  DriveHandleDialogOutputSchema,
  DriveHoverInputSchema,
  DriveHoverOutputSchema,
  DriveSelectInputSchema,
  DriveSelectOutputSchema,
  DriveKeyInputSchema,
  DriveKeyOutputSchema,
  DriveKeyPressInputSchema,
  DriveKeyPressOutputSchema,
  DriveNavigateInputSchema,
  DriveNavigateOutputSchema,
  DriveScrollInputSchema,
  DriveScrollOutputSchema,
  DriveTabActivateInputSchema,
  DriveTabActivateOutputSchema,
  DriveTabCloseInputSchema,
  DriveTabCloseOutputSchema,
  DriveTabListInputSchema,
  DriveTabListOutputSchema,
  DriveTypeInputSchema,
  DriveTypeOutputSchema,
  DriveWaitForInputSchema,
  DriveWaitForOutputSchema,
  InspectConsoleListInputSchema,
  InspectConsoleListOutputSchema,
  InspectDomDiffInputSchema,
  InspectDomDiffOutputSchema,
  InspectExtractContentInputSchema,
  InspectExtractContentOutputSchema,
  InspectDomSnapshotInputSchema,
  InspectDomSnapshotOutputSchema,
  InspectEvaluateInputSchema,
  InspectEvaluateOutputSchema,
  InspectFindInputSchema,
  InspectFindOutputSchema,
  InspectPageStateInputSchema,
  InspectPageStateOutputSchema,
  InspectNetworkHarInputSchema,
  InspectNetworkHarOutputSchema,
  InspectPerformanceMetricsInputSchema,
  InspectPerformanceMetricsOutputSchema,
  SessionCloseInputSchema,
  SessionCloseOutputSchema,
  SessionCreateInputSchema,
  SessionCreateOutputSchema,
  SessionRecoverInputSchema,
  SessionRecoverOutputSchema,
  SessionStatusInputSchema,
  SessionStatusOutputSchema,
} from '@btraut/browser-bridge-shared';
import type {
  AnySchema,
  ZodRawShapeCompat,
} from '@modelcontextprotocol/sdk/server/zod-compat';
import type {
  McpServer,
  ToolCallback,
} from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types';
import { CoreClient } from './core-client';

type ToolResult = CallToolResult;
type CoreClientProvider = CoreClient | (() => Promise<CoreClient>);

type ToolConfig = {
  title: string;
  description: string;
  inputSchema: AnySchema | ZodRawShapeCompat;
  outputSchema: AnySchema | ZodRawShapeCompat;
  corePath: string;
  deprecationAlias?: {
    alias: string;
    replacement: string;
  };
  transformInput?: (args: unknown) => unknown;
};

type ToolRegistrar = Pick<McpServer, 'registerTool'>;

type EnvelopeInput = Parameters<typeof successEnvelopeSchema>[0];

const toToolResult = (payload: unknown): ToolResult => {
  const content = [{ type: 'text' as const, text: JSON.stringify(payload) }];
  if (payload && typeof payload === 'object') {
    const isErrorEnvelope = ErrorEnvelopeSchema.safeParse(payload).success;
    return {
      content,
      structuredContent: payload as Record<string, unknown>,
      isError: isErrorEnvelope,
    };
  }
  return { content };
};

const toInternalErrorEnvelope = (error: unknown) => ({
  ok: false as const,
  error: {
    code: 'INTERNAL' as const,
    message: error instanceof Error ? error.message : 'Unknown error.',
    retryable: false,
  },
});

const envelope = (schema: EnvelopeInput) => successEnvelopeSchema(schema);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const readSessionId = (args: unknown): string | undefined => {
  if (!isRecord(args)) {
    return undefined;
  }
  const sessionId = args.session_id;
  return typeof sessionId === 'string' && sessionId.length > 0
    ? sessionId
    : undefined;
};

const supportsSessionMigration = (corePath: string): boolean =>
  corePath.startsWith('/drive/') ||
  corePath.startsWith('/inspect/') ||
  corePath.startsWith('/artifacts/') ||
  corePath === '/diagnostics/doctor';

const isSessionNotFoundEnvelope = (
  envelopeResult: ApiEnvelope<unknown>
): boolean => {
  if (envelopeResult.ok) {
    return false;
  }
  const details = envelopeResult.error.details;
  return (
    envelopeResult.error.code === 'NOT_FOUND' &&
    isRecord(details) &&
    details.reason === 'session_not_found'
  );
};

const addSessionRecoveryHint = (
  envelopeResult: ApiEnvelope<unknown>
): ApiEnvelope<unknown> => {
  if (envelopeResult.ok) {
    return envelopeResult;
  }
  return {
    ok: false,
    error: {
      ...envelopeResult.error,
      details: {
        ...(isRecord(envelopeResult.error.details)
          ? envelopeResult.error.details
          : {}),
        recover_action: 'session.create',
      },
    },
  };
};

const addSessionMigrationNotice = (
  envelopeResult: ApiEnvelope<unknown>,
  staleSessionId: string,
  replacementSessionId: string
): ApiEnvelope<unknown> => {
  if (envelopeResult.ok) {
    if (!isRecord(envelopeResult.result)) {
      return envelopeResult;
    }
    const warning = `Session ${staleSessionId} became stale after runtime switch; retried with ${replacementSessionId}.`;
    const existingWarnings = Array.isArray(envelopeResult.result.warnings)
      ? envelopeResult.result.warnings.filter(
          (item): item is string => typeof item === 'string'
        )
      : [];
    return {
      ok: true,
      result: {
        ...envelopeResult.result,
        warnings: existingWarnings.includes(warning)
          ? existingWarnings
          : [...existingWarnings, warning],
        session_migration: {
          stale_session_id: staleSessionId,
          replacement_session_id: replacementSessionId,
        },
      },
    };
  }

  return {
    ok: false,
    error: {
      ...envelopeResult.error,
      details: {
        ...(isRecord(envelopeResult.error.details)
          ? envelopeResult.error.details
          : {}),
        stale_session_id: staleSessionId,
        replacement_session_id: replacementSessionId,
        recover_action: 'session.recover',
      },
    },
  };
};

const addDeprecatedAliasWarning = (
  envelopeResult: ApiEnvelope<unknown>,
  deprecationAlias?: {
    alias: string;
    replacement: string;
  }
): ApiEnvelope<unknown> => {
  if (
    !deprecationAlias ||
    !envelopeResult.ok ||
    typeof envelopeResult.result !== 'object' ||
    !envelopeResult.result
  ) {
    return envelopeResult;
  }

  const warning = `${deprecationAlias.alias} is deprecated; use ${deprecationAlias.replacement}.`;
  const result = envelopeResult.result as Record<string, unknown>;
  const existingWarnings = Array.isArray(result.warnings)
    ? result.warnings.filter((item): item is string => typeof item === 'string')
    : [];

  return {
    ok: true,
    result: {
      ...result,
      warnings: existingWarnings.includes(warning)
        ? existingWarnings
        : [...existingWarnings, warning],
    },
  };
};

export const TOOL_DEFINITIONS: Array<{ name: string; config: ToolConfig }> = [
  {
    name: 'session.create',
    config: {
      title: 'Session Create',
      description: 'Create a new browser session.',
      inputSchema: SessionCreateInputSchema,
      outputSchema: envelope(SessionCreateOutputSchema),
      corePath: '/session/create',
    },
  },
  {
    name: 'session.status',
    config: {
      title: 'Session Status',
      description: 'Fetch session status.',
      inputSchema: SessionStatusInputSchema,
      outputSchema: envelope(SessionStatusOutputSchema),
      corePath: '/session/status',
    },
  },
  {
    name: 'session.recover',
    config: {
      title: 'Session Recover',
      description: 'Recover a session after errors.',
      inputSchema: SessionRecoverInputSchema,
      outputSchema: envelope(SessionRecoverOutputSchema),
      corePath: '/session/recover',
    },
  },
  {
    name: 'session.close',
    config: {
      title: 'Session Close',
      description: 'Close a session.',
      inputSchema: SessionCloseInputSchema,
      outputSchema: envelope(SessionCloseOutputSchema),
      corePath: '/session/close',
    },
  },
  {
    name: 'drive.navigate',
    config: {
      title: 'Drive Navigate',
      description: 'Navigate to a URL.',
      inputSchema: DriveNavigateInputSchema,
      outputSchema: envelope(DriveNavigateOutputSchema),
      corePath: '/drive/navigate',
    },
  },
  {
    name: 'drive.go_back',
    config: {
      title: 'Drive Go Back',
      description: 'Go back in browser history.',
      inputSchema: DriveGoBackInputSchema,
      outputSchema: envelope(DriveGoBackOutputSchema),
      corePath: '/drive/go_back',
    },
  },
  {
    name: 'drive.go_forward',
    config: {
      title: 'Drive Go Forward',
      description: 'Go forward in browser history.',
      inputSchema: DriveGoForwardInputSchema,
      outputSchema: envelope(DriveGoForwardOutputSchema),
      corePath: '/drive/go_forward',
    },
  },
  {
    name: 'drive.back',
    config: {
      title: 'Drive Back',
      description: 'Deprecated alias for drive.go_back.',
      inputSchema: DriveGoBackInputSchema,
      outputSchema: envelope(DriveGoBackOutputSchema),
      corePath: '/drive/go_back',
      deprecationAlias: {
        alias: 'drive.back',
        replacement: 'drive.go_back',
      },
    },
  },
  {
    name: 'drive.forward',
    config: {
      title: 'Drive Forward',
      description: 'Deprecated alias for drive.go_forward.',
      inputSchema: DriveGoForwardInputSchema,
      outputSchema: envelope(DriveGoForwardOutputSchema),
      corePath: '/drive/go_forward',
      deprecationAlias: {
        alias: 'drive.forward',
        replacement: 'drive.go_forward',
      },
    },
  },
  {
    name: 'drive.click',
    config: {
      title: 'Drive Click',
      description: 'Click an element.',
      inputSchema: DriveClickInputSchema,
      outputSchema: envelope(DriveClickOutputSchema),
      corePath: '/drive/click',
    },
  },
  {
    name: 'drive.hover',
    config: {
      title: 'Drive Hover',
      description: 'Hover over an element.',
      inputSchema: DriveHoverInputSchema,
      outputSchema: envelope(DriveHoverOutputSchema),
      corePath: '/drive/hover',
    },
  },
  {
    name: 'drive.select',
    config: {
      title: 'Drive Select',
      description: 'Select an option in a dropdown.',
      inputSchema: DriveSelectInputSchema,
      outputSchema: envelope(DriveSelectOutputSchema),
      corePath: '/drive/select',
    },
  },
  {
    name: 'drive.type',
    config: {
      title: 'Drive Type',
      description: 'Type into an element.',
      inputSchema: DriveTypeInputSchema,
      outputSchema: envelope(DriveTypeOutputSchema),
      corePath: '/drive/type',
    },
  },
  {
    name: 'drive.fill_form',
    config: {
      title: 'Drive Fill Form',
      description: 'Fill multiple form fields.',
      inputSchema: DriveFillFormInputSchema,
      outputSchema: envelope(DriveFillFormOutputSchema),
      corePath: '/drive/fill_form',
    },
  },
  {
    name: 'drive.drag',
    config: {
      title: 'Drive Drag',
      description: 'Drag an element to a target.',
      inputSchema: DriveDragInputSchema,
      outputSchema: envelope(DriveDragOutputSchema),
      corePath: '/drive/drag',
    },
  },
  {
    name: 'drive.handle_dialog',
    config: {
      title: 'Drive Handle Dialog',
      description: 'Handle a JavaScript dialog.',
      inputSchema: DriveHandleDialogInputSchema,
      outputSchema: envelope(DriveHandleDialogOutputSchema),
      corePath: '/drive/handle_dialog',
    },
  },
  {
    name: 'dialog.accept',
    config: {
      title: 'Dialog Accept',
      description: 'Deprecated alias for drive.handle_dialog (action=accept).',
      inputSchema: DialogAcceptInputSchema,
      outputSchema: envelope(DialogAcceptOutputSchema),
      corePath: '/drive/handle_dialog',
      deprecationAlias: {
        alias: 'dialog.accept',
        replacement: 'drive.handle_dialog',
      },
      transformInput: (args) =>
        isRecord(args) ? { ...args, action: 'accept' } : args,
    },
  },
  {
    name: 'dialog.dismiss',
    config: {
      title: 'Dialog Dismiss',
      description: 'Deprecated alias for drive.handle_dialog (action=dismiss).',
      inputSchema: DialogDismissInputSchema,
      outputSchema: envelope(DialogDismissOutputSchema),
      corePath: '/drive/handle_dialog',
      deprecationAlias: {
        alias: 'dialog.dismiss',
        replacement: 'drive.handle_dialog',
      },
      transformInput: (args) =>
        isRecord(args) ? { ...args, action: 'dismiss' } : args,
    },
  },
  {
    name: 'drive.key',
    config: {
      title: 'Drive Key',
      description: 'Press a keyboard key.',
      inputSchema: DriveKeyInputSchema,
      outputSchema: envelope(DriveKeyOutputSchema),
      corePath: '/drive/key',
    },
  },
  {
    name: 'drive.key_press',
    config: {
      title: 'Drive Key Press',
      description: 'Press a key on the active element.',
      inputSchema: DriveKeyPressInputSchema,
      outputSchema: envelope(DriveKeyPressOutputSchema),
      corePath: '/drive/key_press',
    },
  },
  {
    name: 'drive.scroll',
    config: {
      title: 'Drive Scroll',
      description:
        'Scroll the default tab (agent window/tab unless tab_id is provided).',
      inputSchema: DriveScrollInputSchema,
      outputSchema: envelope(DriveScrollOutputSchema),
      corePath: '/drive/scroll',
    },
  },
  {
    name: 'drive.wait_for',
    config: {
      title: 'Drive Wait For',
      description: 'Wait for a drive condition.',
      inputSchema: DriveWaitForInputSchema,
      outputSchema: envelope(DriveWaitForOutputSchema),
      corePath: '/drive/wait_for',
    },
  },
  {
    name: 'drive.tab_list',
    config: {
      title: 'Drive Tab List',
      description: 'List browser tabs.',
      inputSchema: DriveTabListInputSchema,
      outputSchema: envelope(DriveTabListOutputSchema),
      corePath: '/drive/tab_list',
    },
  },
  {
    name: 'drive.tab_activate',
    config: {
      title: 'Drive Tab Activate',
      description: 'Activate a browser tab.',
      inputSchema: DriveTabActivateInputSchema,
      outputSchema: envelope(DriveTabActivateOutputSchema),
      corePath: '/drive/tab_activate',
    },
  },
  {
    name: 'drive.tab_close',
    config: {
      title: 'Drive Tab Close',
      description: 'Close a browser tab.',
      inputSchema: DriveTabCloseInputSchema,
      outputSchema: envelope(DriveTabCloseOutputSchema),
      corePath: '/drive/tab_close',
    },
  },
  {
    name: 'inspect.dom_snapshot',
    config: {
      title: 'Inspect DOM Snapshot',
      description: 'Capture a DOM snapshot.',
      inputSchema: InspectDomSnapshotInputSchema,
      outputSchema: envelope(InspectDomSnapshotOutputSchema),
      corePath: '/inspect/dom_snapshot',
    },
  },
  {
    name: 'inspect.dom_diff',
    config: {
      title: 'Inspect DOM Diff',
      description: 'Compare recent DOM snapshots.',
      inputSchema: InspectDomDiffInputSchema,
      outputSchema: envelope(InspectDomDiffOutputSchema),
      corePath: '/inspect/dom_diff',
    },
  },
  {
    name: 'inspect.find',
    config: {
      title: 'Inspect Find',
      description: 'Find elements in the accessibility tree and return refs.',
      inputSchema: InspectFindInputSchema,
      outputSchema: envelope(InspectFindOutputSchema),
      corePath: '/inspect/find',
    },
  },
  {
    name: 'inspect.extract_content',
    config: {
      title: 'Inspect Extract Content',
      description: 'Extract main content as markdown or text.',
      inputSchema: InspectExtractContentInputSchema,
      outputSchema: envelope(InspectExtractContentOutputSchema),
      corePath: '/inspect/extract_content',
    },
  },
  {
    name: 'inspect.page_state',
    config: {
      title: 'Inspect Page State',
      description: 'Capture form, storage, and cookie state.',
      inputSchema: InspectPageStateInputSchema,
      outputSchema: envelope(InspectPageStateOutputSchema),
      corePath: '/inspect/page_state',
    },
  },
  {
    name: 'inspect.console_list',
    config: {
      title: 'Inspect Console List',
      description: 'List console entries.',
      inputSchema: InspectConsoleListInputSchema,
      outputSchema: envelope(InspectConsoleListOutputSchema),
      corePath: '/inspect/console_list',
    },
  },
  {
    name: 'inspect.network_har',
    config: {
      title: 'Inspect Network HAR',
      description: 'Capture network HAR data.',
      inputSchema: InspectNetworkHarInputSchema,
      outputSchema: envelope(InspectNetworkHarOutputSchema),
      corePath: '/inspect/network_har',
    },
  },
  {
    name: 'inspect.evaluate',
    config: {
      title: 'Inspect Evaluate',
      description: 'Evaluate an expression in the target.',
      inputSchema: InspectEvaluateInputSchema,
      outputSchema: envelope(InspectEvaluateOutputSchema),
      corePath: '/inspect/evaluate',
    },
  },
  {
    name: 'inspect.performance_metrics',
    config: {
      title: 'Inspect Performance Metrics',
      description: 'Collect performance metrics.',
      inputSchema: InspectPerformanceMetricsInputSchema,
      outputSchema: envelope(InspectPerformanceMetricsOutputSchema),
      corePath: '/inspect/performance_metrics',
    },
  },
  {
    name: 'artifacts.screenshot',
    config: {
      title: 'Artifacts Screenshot',
      description: 'Capture a screenshot artifact.',
      inputSchema: ArtifactsScreenshotInputSchema,
      outputSchema: envelope(ArtifactsScreenshotOutputSchema),
      corePath: '/artifacts/screenshot',
    },
  },
  {
    name: 'health_check',
    config: {
      title: 'Health Check',
      description:
        'Check server health including uptime, memory usage, active session count, and extension connection status.',
      inputSchema: HealthCheckInputSchema,
      outputSchema: envelope(HealthCheckOutputSchema),
      corePath: '/health/check',
    },
  },
  {
    name: 'diagnostics.doctor',
    config: {
      title: 'Diagnostics Doctor',
      description: 'Run diagnostics checks.',
      inputSchema: DiagnosticsDoctorInputSchema,
      outputSchema: envelope(DiagnosticsDoctorOutputSchema),
      corePath: '/diagnostics/doctor',
    },
  },
];

export const createToolHandler = (
  clientProvider: CoreClientProvider,
  corePath: string,
  deprecationAlias?: {
    alias: string;
    replacement: string;
  },
  transformInput?: (args: unknown) => unknown
): ToolCallback<AnySchema> => {
  return (async (args: unknown, _extra: unknown): Promise<ToolResult> => {
    void _extra;
    try {
      const client =
        typeof clientProvider === 'function'
          ? await clientProvider()
          : clientProvider;
      const transformedArgs = transformInput ? transformInput(args) : args;
      const staleSessionId = readSessionId(transformedArgs);
      let envelopeResult = await client.post(corePath, transformedArgs);

      if (
        staleSessionId &&
        supportsSessionMigration(corePath) &&
        isSessionNotFoundEnvelope(envelopeResult) &&
        isRecord(transformedArgs)
      ) {
        const createdSession = await client.post('/session/create', {});
        if (
          createdSession.ok &&
          isRecord(createdSession.result) &&
          typeof createdSession.result.session_id === 'string' &&
          createdSession.result.session_id.length > 0
        ) {
          const replacementSessionId = createdSession.result.session_id;
          const retryArgs = {
            ...transformedArgs,
            session_id: replacementSessionId,
          };
          envelopeResult = addSessionMigrationNotice(
            await client.post(corePath, retryArgs),
            staleSessionId,
            replacementSessionId
          );
        } else {
          envelopeResult = addSessionRecoveryHint(envelopeResult);
        }
      }
      return toToolResult(
        addDeprecatedAliasWarning(envelopeResult, deprecationAlias)
      );
    } catch (error) {
      const parsed = ErrorEnvelopeSchema.safeParse(error);
      if (parsed.success) {
        return toToolResult(parsed.data);
      }
      return toToolResult(toInternalErrorEnvelope(error));
    }
  }) as ToolCallback<AnySchema>;
};

export const registerBrowserBridgeTools = (
  server: ToolRegistrar,
  clientProvider: CoreClientProvider
): void => {
  for (const tool of TOOL_DEFINITIONS) {
    server.registerTool(
      tool.name,
      {
        title: tool.config.title,
        description: tool.config.description,
        inputSchema: tool.config.inputSchema,
        outputSchema: tool.config.outputSchema,
      },
      createToolHandler(
        clientProvider,
        tool.config.corePath,
        tool.config.deprecationAlias,
        tool.config.transformInput
      )
    );
  }
};
