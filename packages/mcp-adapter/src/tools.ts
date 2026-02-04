import {
  apiEnvelopeSchema,
  ArtifactsScreenshotInputSchema,
  ArtifactsScreenshotOutputSchema,
  DiagnosticsDoctorInputSchema,
  DiagnosticsDoctorOutputSchema,
  ErrorEnvelopeSchema,
  DriveClickInputSchema,
  DriveClickOutputSchema,
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
  InspectDomSnapshotInputSchema,
  InspectDomSnapshotOutputSchema,
  InspectEvaluateInputSchema,
  InspectEvaluateOutputSchema,
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
} from "@browser-vision/shared";
import type {
  AnySchema,
  ZodRawShapeCompat,
} from "@modelcontextprotocol/sdk/server/zod-compat";
import type { McpServer, ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types";
import { CoreClient } from "./core-client";

type ToolResult = CallToolResult;

type ToolConfig = {
  title: string;
  description: string;
  inputSchema: AnySchema | ZodRawShapeCompat;
  outputSchema: AnySchema | ZodRawShapeCompat;
  corePath: string;
};

type ToolRegistrar = Pick<McpServer, "registerTool">;

type EnvelopeInput = Parameters<typeof apiEnvelopeSchema>[0];

const toToolResult = (payload: unknown): ToolResult => {
  const content = [{ type: "text" as const, text: JSON.stringify(payload) }];
  if (payload && typeof payload === "object") {
    return {
      content,
      structuredContent: payload as Record<string, unknown>,
    };
  }
  return { content };
};

const toInternalErrorEnvelope = (error: unknown) => ({
  ok: false as const,
  error: {
    code: "INTERNAL" as const,
    message: error instanceof Error ? error.message : "Unknown error.",
    retryable: false,
  },
});

const envelope = (schema: EnvelopeInput) => apiEnvelopeSchema(schema);

export const TOOL_DEFINITIONS: Array<{ name: string; config: ToolConfig }> = [
  {
    name: "session.create",
    config: {
      title: "Session Create",
      description: "Create a new browser session.",
      inputSchema: SessionCreateInputSchema,
      outputSchema: envelope(SessionCreateOutputSchema),
      corePath: "/session/create",
    },
  },
  {
    name: "session.status",
    config: {
      title: "Session Status",
      description: "Fetch session status.",
      inputSchema: SessionStatusInputSchema,
      outputSchema: envelope(SessionStatusOutputSchema),
      corePath: "/session/status",
    },
  },
  {
    name: "session.recover",
    config: {
      title: "Session Recover",
      description: "Recover a session after errors.",
      inputSchema: SessionRecoverInputSchema,
      outputSchema: envelope(SessionRecoverOutputSchema),
      corePath: "/session/recover",
    },
  },
  {
    name: "session.close",
    config: {
      title: "Session Close",
      description: "Close a session.",
      inputSchema: SessionCloseInputSchema,
      outputSchema: envelope(SessionCloseOutputSchema),
      corePath: "/session/close",
    },
  },
  {
    name: "drive.navigate",
    config: {
      title: "Drive Navigate",
      description: "Navigate to a URL.",
      inputSchema: DriveNavigateInputSchema,
      outputSchema: envelope(DriveNavigateOutputSchema),
      corePath: "/drive/navigate",
    },
  },
  {
    name: "drive.click",
    config: {
      title: "Drive Click",
      description: "Click an element.",
      inputSchema: DriveClickInputSchema,
      outputSchema: envelope(DriveClickOutputSchema),
      corePath: "/drive/click",
    },
  },
  {
    name: "drive.type",
    config: {
      title: "Drive Type",
      description: "Type into an element.",
      inputSchema: DriveTypeInputSchema,
      outputSchema: envelope(DriveTypeOutputSchema),
      corePath: "/drive/type",
    },
  },
  {
    name: "drive.scroll",
    config: {
      title: "Drive Scroll",
      description: "Scroll the active tab.",
      inputSchema: DriveScrollInputSchema,
      outputSchema: envelope(DriveScrollOutputSchema),
      corePath: "/drive/scroll",
    },
  },
  {
    name: "drive.wait_for",
    config: {
      title: "Drive Wait For",
      description: "Wait for a drive condition.",
      inputSchema: DriveWaitForInputSchema,
      outputSchema: envelope(DriveWaitForOutputSchema),
      corePath: "/drive/wait_for",
    },
  },
  {
    name: "drive.tab_list",
    config: {
      title: "Drive Tab List",
      description: "List browser tabs.",
      inputSchema: DriveTabListInputSchema,
      outputSchema: envelope(DriveTabListOutputSchema),
      corePath: "/drive/tab_list",
    },
  },
  {
    name: "drive.tab_activate",
    config: {
      title: "Drive Tab Activate",
      description: "Activate a browser tab.",
      inputSchema: DriveTabActivateInputSchema,
      outputSchema: envelope(DriveTabActivateOutputSchema),
      corePath: "/drive/tab_activate",
    },
  },
  {
    name: "drive.tab_close",
    config: {
      title: "Drive Tab Close",
      description: "Close a browser tab.",
      inputSchema: DriveTabCloseInputSchema,
      outputSchema: envelope(DriveTabCloseOutputSchema),
      corePath: "/drive/tab_close",
    },
  },
  {
    name: "inspect.dom_snapshot",
    config: {
      title: "Inspect DOM Snapshot",
      description: "Capture a DOM snapshot.",
      inputSchema: InspectDomSnapshotInputSchema,
      outputSchema: envelope(InspectDomSnapshotOutputSchema),
      corePath: "/inspect/dom_snapshot",
    },
  },
  {
    name: "inspect.console_list",
    config: {
      title: "Inspect Console List",
      description: "List console entries.",
      inputSchema: InspectConsoleListInputSchema,
      outputSchema: envelope(InspectConsoleListOutputSchema),
      corePath: "/inspect/console_list",
    },
  },
  {
    name: "inspect.network_har",
    config: {
      title: "Inspect Network HAR",
      description: "Capture network HAR data.",
      inputSchema: InspectNetworkHarInputSchema,
      outputSchema: envelope(InspectNetworkHarOutputSchema),
      corePath: "/inspect/network_har",
    },
  },
  {
    name: "inspect.evaluate",
    config: {
      title: "Inspect Evaluate",
      description: "Evaluate an expression in the target.",
      inputSchema: InspectEvaluateInputSchema,
      outputSchema: envelope(InspectEvaluateOutputSchema),
      corePath: "/inspect/evaluate",
    },
  },
  {
    name: "inspect.performance_metrics",
    config: {
      title: "Inspect Performance Metrics",
      description: "Collect performance metrics.",
      inputSchema: InspectPerformanceMetricsInputSchema,
      outputSchema: envelope(InspectPerformanceMetricsOutputSchema),
      corePath: "/inspect/performance_metrics",
    },
  },
  {
    name: "artifacts.screenshot",
    config: {
      title: "Artifacts Screenshot",
      description: "Capture a screenshot artifact.",
      inputSchema: ArtifactsScreenshotInputSchema,
      outputSchema: envelope(ArtifactsScreenshotOutputSchema),
      corePath: "/artifacts/screenshot",
    },
  },
  {
    name: "diagnostics.doctor",
    config: {
      title: "Diagnostics Doctor",
      description: "Run diagnostics checks.",
      inputSchema: DiagnosticsDoctorInputSchema,
      outputSchema: envelope(DiagnosticsDoctorOutputSchema),
      corePath: "/diagnostics/doctor",
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

export const registerBrowserVisionTools = (
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
