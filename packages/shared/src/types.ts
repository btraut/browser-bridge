import { z } from 'zod';
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
  DomDiffResultSchema,
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
  DriveKeyModifierSchema,
  DriveKeyOutputSchema,
  DriveKeyModifiersSchema,
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
  DriveTabInfoSchema,
  DriveTabListInputSchema,
  DriveTabListOutputSchema,
  DriveTypeInputSchema,
  DriveTypeOutputSchema,
  DriveWaitConditionSchema,
  DriveWaitForInputSchema,
  DriveWaitForOutputSchema,
  FormFieldInfoSchema,
  FormInfoSchema,
  EvaluateResultSchema,
  InspectConsoleListInputSchema,
  InspectConsoleListOutputSchema,
  InspectConsistencySchema,
  InspectDomFormatSchema,
  InspectDomSnapshotInputSchema,
  InspectDomSnapshotOutputSchema,
  InspectDomDiffInputSchema,
  InspectDomDiffOutputSchema,
  InspectExtractContentFormatSchema,
  InspectExtractContentInputSchema,
  InspectExtractContentOutputSchema,
  InspectEvaluateInputSchema,
  InspectEvaluateOutputSchema,
  InspectFindInputSchema,
  InspectFindMatchSchema,
  InspectFindOutputSchema,
  InspectPageStateInputSchema,
  InspectPageStateOutputSchema,
  InspectNetworkHarInputSchema,
  InspectNetworkHarOutputSchema,
  InspectPerformanceMetricsInputSchema,
  InspectPerformanceMetricsOutputSchema,
  LocatorRoleSchema,
  LocatorSchema,
  OpResultSchema,
  PageStateSchema,
  PerformanceMetricSchema,
  PerformanceMetricsSchema,
  RecoverResultSchema,
  SessionCloseInputSchema,
  SessionCloseOutputSchema,
  SessionCreateInputSchema,
  SessionCreateOutputSchema,
  SessionIdSchema,
  SessionInfoSchema,
  SessionPlaneStatusSchema,
  SessionRecoverInputSchema,
  SessionRecoverOutputSchema,
  SessionStateSchema,
  SessionStatusInputSchema,
  SessionStatusOutputSchema,
  SessionStatusSchema,
  StorageEntrySchema,
} from './schemas';

export type LocatorRole = z.infer<typeof LocatorRoleSchema>;
export type Locator = z.infer<typeof LocatorSchema>;
export type OpResult = z.infer<typeof OpResultSchema>;

export type SessionId = z.infer<typeof SessionIdSchema>;

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
export type DriveBackInput = z.infer<typeof DriveBackInputSchema>;
export type DriveBackOutput = z.infer<typeof DriveBackOutputSchema>;
export type DriveForwardInput = z.infer<typeof DriveForwardInputSchema>;
export type DriveForwardOutput = z.infer<typeof DriveForwardOutputSchema>;
export type DriveGoBackInput = z.infer<typeof DriveGoBackInputSchema>;
export type DriveGoBackOutput = z.infer<typeof DriveGoBackOutputSchema>;
export type DriveGoForwardInput = z.infer<typeof DriveGoForwardInputSchema>;
export type DriveGoForwardOutput = z.infer<typeof DriveGoForwardOutputSchema>;
export type DriveClickInput = z.infer<typeof DriveClickInputSchema>;
export type DriveClickOutput = z.infer<typeof DriveClickOutputSchema>;
export type DriveHoverInput = z.infer<typeof DriveHoverInputSchema>;
export type DriveHoverOutput = z.infer<typeof DriveHoverOutputSchema>;
export type DriveSelectInput = z.infer<typeof DriveSelectInputSchema>;
export type DriveSelectOutput = z.infer<typeof DriveSelectOutputSchema>;
export type DriveKeyModifier = z.infer<typeof DriveKeyModifierSchema>;
export type DriveKeyInput = z.infer<typeof DriveKeyInputSchema>;
export type DriveKeyOutput = z.infer<typeof DriveKeyOutputSchema>;
export type DriveTypeInput = z.infer<typeof DriveTypeInputSchema>;
export type DriveTypeOutput = z.infer<typeof DriveTypeOutputSchema>;
export type DriveFillFormInput = z.infer<typeof DriveFillFormInputSchema>;
export type DriveFillFormOutput = z.infer<typeof DriveFillFormOutputSchema>;
export type DriveDragInput = z.infer<typeof DriveDragInputSchema>;
export type DriveDragOutput = z.infer<typeof DriveDragOutputSchema>;
export type DriveHandleDialogInput = z.infer<typeof DriveHandleDialogInputSchema>;
export type DriveHandleDialogOutput = z.infer<typeof DriveHandleDialogOutputSchema>;
export type DriveKeyModifiers = z.infer<typeof DriveKeyModifiersSchema>;
export type DriveKeyPressInput = z.infer<typeof DriveKeyPressInputSchema>;
export type DriveKeyPressOutput = z.infer<typeof DriveKeyPressOutputSchema>;
export type DriveScrollInput = z.infer<typeof DriveScrollInputSchema>;
export type DriveScrollOutput = z.infer<typeof DriveScrollOutputSchema>;
export type DriveWaitForInput = z.infer<typeof DriveWaitForInputSchema>;
export type DriveWaitForOutput = z.infer<typeof DriveWaitForOutputSchema>;
export type DriveTabInfo = z.infer<typeof DriveTabInfoSchema>;
export type DriveTabListInput = z.infer<typeof DriveTabListInputSchema>;
export type DriveTabListOutput = z.infer<typeof DriveTabListOutputSchema>;
export type DriveTabActivateInput = z.infer<typeof DriveTabActivateInputSchema>;
export type DriveTabActivateOutput = z.infer<
  typeof DriveTabActivateOutputSchema
>;
export type DriveTabCloseInput = z.infer<typeof DriveTabCloseInputSchema>;
export type DriveTabCloseOutput = z.infer<typeof DriveTabCloseOutputSchema>;

export type InspectDomFormat = z.infer<typeof InspectDomFormatSchema>;
export type InspectConsistency = z.infer<typeof InspectConsistencySchema>;
export type DomSnapshot = z.infer<typeof DomSnapshotSchema>;
export type DomDiffResult = z.infer<typeof DomDiffResultSchema>;
export type InspectDomSnapshotInput = z.infer<
  typeof InspectDomSnapshotInputSchema
>;
export type InspectDomSnapshotOutput = z.infer<
  typeof InspectDomSnapshotOutputSchema
>;
export type InspectDomDiffInput = z.infer<typeof InspectDomDiffInputSchema>;
export type InspectDomDiffOutput = z.infer<typeof InspectDomDiffOutputSchema>;
export type InspectFindInput = z.infer<typeof InspectFindInputSchema>;
export type InspectFindMatch = z.infer<typeof InspectFindMatchSchema>;
export type InspectFindOutput = z.infer<typeof InspectFindOutputSchema>;
export type InspectExtractContentFormat = z.infer<typeof InspectExtractContentFormatSchema>;
export type InspectExtractContentInput = z.infer<typeof InspectExtractContentInputSchema>;
export type InspectExtractContentOutput = z.infer<typeof InspectExtractContentOutputSchema>;
export type FormFieldInfo = z.infer<typeof FormFieldInfoSchema>;
export type FormInfo = z.infer<typeof FormInfoSchema>;
export type StorageEntry = z.infer<typeof StorageEntrySchema>;
export type PageState = z.infer<typeof PageStateSchema>;
export type InspectPageStateInput = z.infer<typeof InspectPageStateInputSchema>;
export type InspectPageStateOutput = z.infer<typeof InspectPageStateOutputSchema>;
export type InspectConsoleListInput = z.infer<
  typeof InspectConsoleListInputSchema
>;
export type ConsoleEntry = z.infer<typeof ConsoleEntrySchema>;
export type ConsoleList = z.infer<typeof ConsoleListSchema>;
export type InspectConsoleListOutput = z.infer<
  typeof InspectConsoleListOutputSchema
>;
export type ArtifactInfo = z.infer<typeof ArtifactInfoSchema>;
export type InspectNetworkHarInput = z.infer<
  typeof InspectNetworkHarInputSchema
>;
export type InspectNetworkHarOutput = z.infer<
  typeof InspectNetworkHarOutputSchema
>;
export type InspectEvaluateInput = z.infer<typeof InspectEvaluateInputSchema>;
export type EvaluateResult = z.infer<typeof EvaluateResultSchema>;
export type InspectEvaluateOutput = z.infer<typeof InspectEvaluateOutputSchema>;
export type InspectPerformanceMetricsInput = z.infer<
  typeof InspectPerformanceMetricsInputSchema
>;
export type PerformanceMetric = z.infer<typeof PerformanceMetricSchema>;
export type PerformanceMetrics = z.infer<typeof PerformanceMetricsSchema>;
export type InspectPerformanceMetricsOutput = z.infer<
  typeof InspectPerformanceMetricsOutputSchema
>;

export type ArtifactsScreenshotInput = z.infer<
  typeof ArtifactsScreenshotInputSchema
>;
export type ArtifactsScreenshotOutput = z.infer<
  typeof ArtifactsScreenshotOutputSchema
>;

export type DiagnosticsDoctorInput = z.infer<
  typeof DiagnosticsDoctorInputSchema
>;
export type DiagnosticsDoctorOutput = z.infer<
  typeof DiagnosticsDoctorOutputSchema
>;
