import type { DebuggerBridge } from '../debugger-bridge';
import type {
  DriveAction,
  DriveResponse,
  DriveTabInfo,
} from '../drive-protocol';
import type { SessionRegistry } from '../session';

export type InspectErrorCode =
  | 'INVALID_ARGUMENT'
  | 'SESSION_NOT_FOUND'
  | 'SESSION_CLOSED'
  | 'INSPECT_UNAVAILABLE'
  | 'EXTENSION_DISCONNECTED'
  | 'DEBUGGER_IN_USE'
  | 'ATTACH_DENIED'
  | 'TAB_NOT_FOUND'
  | 'NOT_SUPPORTED'
  | 'RATE_LIMITED'
  | 'TIMEOUT'
  | 'EVALUATION_FAILED'
  | 'ARTIFACT_IO_ERROR'
  | 'INTERNAL';

export type DomSnapshotResult = {
  format: 'ax' | 'html';
  snapshot: unknown;
  warnings?: string[];
  truncated?: boolean;
};

export type ConsoleEntry = {
  level?: string;
  text?: string;
  timestamp?: string;
  source?: { url?: string; line?: number; column?: number };
  stack?: Array<{
    functionName?: string;
    url?: string;
    line?: number;
    column?: number;
  }>;
  exception?: {
    type?: string;
    subtype?: string;
    description?: string;
    value?: unknown;
    unserializableValue?: string;
  };
  args?: Array<{
    type?: string;
    subtype?: string;
    description?: string;
    value?: unknown;
    unserializableValue?: string;
  }>;
};

export type ConsoleListResult = {
  entries: ConsoleEntry[];
  warnings?: string[];
};

export type EvaluateResult = {
  value?: unknown;
  exception?: unknown;
  warnings?: string[];
};

export type ExtractContentResult = {
  content: string;
  title?: string;
  byline?: string;
  excerpt?: string;
  siteName?: string;
  warnings?: string[];
};

export type FormFieldInfo = {
  name: string;
  type: string;
  value: string;
  options?: string[];
};

export type FormInfo = {
  selector: string;
  action?: string;
  method?: string;
  fields: FormFieldInfo[];
};

export type StorageEntry = {
  key: string;
  value: string;
};

export type PageStateResult = {
  forms: FormInfo[];
  localStorage: StorageEntry[];
  sessionStorage: StorageEntry[];
  cookies: StorageEntry[];
  warnings?: string[];
};

export type PerformanceMetricsResult = {
  metrics: Array<{ name: string; value: number }>;
  warnings?: string[];
};

export type ArtifactInfo = {
  artifact_id: string;
  path: string;
  mime: string;
};

export type InspectServiceOptions = {
  registry: SessionRegistry;
  debuggerBridge?: DebuggerBridge;
  extensionBridge?: {
    isConnected: () => boolean;
    getStatus: () => { tabs: DriveTabInfo[] };
    request?: <T = unknown>(
      action: DriveAction,
      params?: Record<string, unknown>,
      timeoutMs?: number
    ) => Promise<DriveResponse<T>>;
  };
  maxSnapshotsPerSession?: number;
  maxSnapshotHistory?: number;
};
