import {
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
  DriveBackInputSchema,
  DriveBackOutputSchema,
  DriveForwardInputSchema,
  DriveForwardOutputSchema,
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

type ToolConfig = {
  title: string;
  description: string;
  inputSchema: AnySchema | ZodRawShapeCompat;
  outputSchema: AnySchema | ZodRawShapeCompat;
  corePath: string;
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
      description: 'Go back in browser history.',
      inputSchema: DriveBackInputSchema,
      outputSchema: envelope(DriveBackOutputSchema),
      corePath: '/drive/back',
    },
  },
  {
    name: 'drive.forward',
    config: {
      title: 'Drive Forward',
      description: 'Go forward in browser history.',
      inputSchema: DriveForwardInputSchema,
      outputSchema: envelope(DriveForwardOutputSchema),
      corePath: '/drive/forward',
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
      description: 'Accept a JavaScript dialog.',
      inputSchema: DialogAcceptInputSchema,
      outputSchema: envelope(DialogAcceptOutputSchema),
      corePath: '/dialog/accept',
    },
  },
  {
    name: 'dialog.dismiss',
    config: {
      title: 'Dialog Dismiss',
      description: 'Dismiss a JavaScript dialog.',
      inputSchema: DialogDismissInputSchema,
      outputSchema: envelope(DialogDismissOutputSchema),
      corePath: '/dialog/dismiss',
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
      corePath: '/health_check',
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
  client: CoreClient,
  corePath: string
): ToolCallback<AnySchema> => {
  return (async (args: unknown, _extra: unknown): Promise<ToolResult> => {
    void _extra;
    try {
      const envelopeResult = await client.post(corePath, args);
      return toToolResult(envelopeResult);
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
  client: CoreClient
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
      createToolHandler(client, tool.config.corePath)
    );
  }
};
