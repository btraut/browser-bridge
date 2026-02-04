import { z } from "zod";
import {
  ArtifactInfoSchema,
  ArtifactsScreenshotInputSchema,
  ArtifactsScreenshotOutputSchema,
  ConsoleEntrySchema,
  ConsoleListSchema,
  DiagnosticCheckSchema,
  DiagnosticReportSchema,
  DiagnosticsDoctorInputSchema,
  DiagnosticsDoctorOutputSchema,
  DomSnapshotSchema,
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
  DriveTabInfoSchema,
  DriveTabListInputSchema,
  DriveTabListOutputSchema,
  DriveTypeInputSchema,
  DriveTypeOutputSchema,
  DriveWaitConditionSchema,
  DriveWaitForInputSchema,
  DriveWaitForOutputSchema,
  EvaluateResultSchema,
  InspectConsoleListInputSchema,
  InspectConsoleListOutputSchema,
  InspectConsistencySchema,
  InspectDomFormatSchema,
  InspectDomSnapshotInputSchema,
  InspectDomSnapshotOutputSchema,
  InspectEvaluateInputSchema,
  InspectEvaluateOutputSchema,
  InspectNetworkHarInputSchema,
  InspectNetworkHarOutputSchema,
  InspectPerformanceMetricsInputSchema,
  InspectPerformanceMetricsOutputSchema,
  LocatorRoleSchema,
  LocatorSchema,
  OpResultSchema,
  PerformanceMetricSchema,
  PerformanceMetricsSchema,
  RecoverResultSchema,
  SessionCloseInputSchema,
  SessionCloseOutputSchema,
  SessionCreateInputSchema,
  SessionCreateOutputSchema,
  SessionIdSchema,
  SessionInfoSchema,
  SessionModeSchema,
  SessionPlaneStatusSchema,
  SessionRecoverInputSchema,
  SessionRecoverOutputSchema,
  SessionStateSchema,
  SessionStatusInputSchema,
  SessionStatusOutputSchema,
  SessionStatusSchema,
} from "./schemas";

export type LocatorRole = z.infer<typeof LocatorRoleSchema>;
export type Locator = z.infer<typeof LocatorSchema>;
export type OpResult = z.infer<typeof OpResultSchema>;

export type SessionId = z.infer<typeof SessionIdSchema>;
export type SessionMode = z.infer<typeof SessionModeSchema>;

export type SessionState = z.infer<typeof SessionStateSchema>;
export type SessionInfo = z.infer<typeof SessionInfoSchema>;
export type SessionPlaneStatus = z.infer<typeof SessionPlaneStatusSchema>;
export type SessionStatus = z.infer<typeof SessionStatusSchema>;

export type RecoverResult = z.infer<typeof RecoverResultSchema>;

export type DiagnosticCheck = z.infer<typeof DiagnosticCheckSchema>;
export type DiagnosticReport = z.infer<typeof DiagnosticReportSchema>;

export type SessionCreateInput = z.infer<typeof SessionCreateInputSchema>;
export type SessionCreateOutput = z.infer<typeof SessionCreateOutputSchema>;
export type SessionStatusInput = z.infer<typeof SessionStatusInputSchema>;
export type SessionStatusOutput = z.infer<typeof SessionStatusOutputSchema>;
export type SessionRecoverInput = z.infer<typeof SessionRecoverInputSchema>;
export type SessionRecoverOutput = z.infer<typeof SessionRecoverOutputSchema>;
export type SessionCloseInput = z.infer<typeof SessionCloseInputSchema>;
export type SessionCloseOutput = z.infer<typeof SessionCloseOutputSchema>;

export type DriveWaitCondition = z.infer<typeof DriveWaitConditionSchema>;
export type DriveNavigateInput = z.infer<typeof DriveNavigateInputSchema>;
export type DriveNavigateOutput = z.infer<typeof DriveNavigateOutputSchema>;
export type DriveClickInput = z.infer<typeof DriveClickInputSchema>;
export type DriveClickOutput = z.infer<typeof DriveClickOutputSchema>;
export type DriveTypeInput = z.infer<typeof DriveTypeInputSchema>;
export type DriveTypeOutput = z.infer<typeof DriveTypeOutputSchema>;
export type DriveScrollInput = z.infer<typeof DriveScrollInputSchema>;
export type DriveScrollOutput = z.infer<typeof DriveScrollOutputSchema>;
export type DriveWaitForInput = z.infer<typeof DriveWaitForInputSchema>;
export type DriveWaitForOutput = z.infer<typeof DriveWaitForOutputSchema>;
export type DriveTabInfo = z.infer<typeof DriveTabInfoSchema>;
export type DriveTabListInput = z.infer<typeof DriveTabListInputSchema>;
export type DriveTabListOutput = z.infer<typeof DriveTabListOutputSchema>;
export type DriveTabActivateInput = z.infer<typeof DriveTabActivateInputSchema>;
export type DriveTabActivateOutput = z.infer<typeof DriveTabActivateOutputSchema>;
export type DriveTabCloseInput = z.infer<typeof DriveTabCloseInputSchema>;
export type DriveTabCloseOutput = z.infer<typeof DriveTabCloseOutputSchema>;

export type InspectDomFormat = z.infer<typeof InspectDomFormatSchema>;
export type InspectConsistency = z.infer<typeof InspectConsistencySchema>;
export type DomSnapshot = z.infer<typeof DomSnapshotSchema>;
export type InspectDomSnapshotInput = z.infer<typeof InspectDomSnapshotInputSchema>;
export type InspectDomSnapshotOutput = z.infer<typeof InspectDomSnapshotOutputSchema>;
export type InspectConsoleListInput = z.infer<typeof InspectConsoleListInputSchema>;
export type ConsoleEntry = z.infer<typeof ConsoleEntrySchema>;
export type ConsoleList = z.infer<typeof ConsoleListSchema>;
export type InspectConsoleListOutput = z.infer<typeof InspectConsoleListOutputSchema>;
export type ArtifactInfo = z.infer<typeof ArtifactInfoSchema>;
export type InspectNetworkHarInput = z.infer<typeof InspectNetworkHarInputSchema>;
export type InspectNetworkHarOutput = z.infer<typeof InspectNetworkHarOutputSchema>;
export type InspectEvaluateInput = z.infer<typeof InspectEvaluateInputSchema>;
export type EvaluateResult = z.infer<typeof EvaluateResultSchema>;
export type InspectEvaluateOutput = z.infer<typeof InspectEvaluateOutputSchema>;
export type InspectPerformanceMetricsInput = z.infer<typeof InspectPerformanceMetricsInputSchema>;
export type PerformanceMetric = z.infer<typeof PerformanceMetricSchema>;
export type PerformanceMetrics = z.infer<typeof PerformanceMetricsSchema>;
export type InspectPerformanceMetricsOutput = z.infer<typeof InspectPerformanceMetricsOutputSchema>;

export type ArtifactsScreenshotInput = z.infer<typeof ArtifactsScreenshotInputSchema>;
export type ArtifactsScreenshotOutput = z.infer<typeof ArtifactsScreenshotOutputSchema>;

export type DiagnosticsDoctorInput = z.infer<typeof DiagnosticsDoctorInputSchema>;
export type DiagnosticsDoctorOutput = z.infer<typeof DiagnosticsDoctorOutputSchema>;
