export type DriveLocatorRole = {
  name: string;
  value?: string;
};

export type DriveLocator = {
  testid?: string;
  css?: string;
  text?: string;
  role?: DriveLocatorRole;
};

export type DriveTabInfo = {
  tab_id: number;
  url?: string;
  title?: string;
  window_id: number;
  active?: boolean;
  last_active_at: string;
};

export type DriveNavigateParams = {
  url: string;
  wait?: "none" | "domcontentloaded";
};

export type DriveClickParams = {
  locator: DriveLocator;
  click_count?: number;
  tab_id?: number;
};

export type DriveTypeParams = {
  locator?: DriveLocator;
  text: string;
  clear?: boolean;
  submit?: boolean;
  tab_id?: number;
};

export type DriveScrollParams = {
  delta_x?: number;
  delta_y?: number;
  top?: number;
  left?: number;
  behavior?: "auto" | "smooth";
  tab_id?: number;
};

export type DriveWaitForParams = {
  condition: {
    kind: "locator_visible" | "text_present" | "url_matches";
    value: string;
  };
  timeout_ms?: number;
  tab_id?: number;
};

export type DriveTabActivateParams = {
  tab_id: number;
};

export type DriveTabCloseParams = {
  tab_id: number;
};

export type DriveHelloParams = {
  version?: string;
  tabs: DriveTabInfo[];
};

export type DriveTabReportParams = {
  tabs: DriveTabInfo[];
};

export type DriveAction =
  | "drive.navigate"
  | "drive.click"
  | "drive.type"
  | "drive.scroll"
  | "drive.wait_for"
  | "drive.tab_list"
  | "drive.tab_activate"
  | "drive.tab_close"
  | "drive.hello"
  | "drive.tab_report";

export type DriveRequestStatus = "request";
export type DriveResponseStatus = "ok" | "error";
export type DriveEventStatus = "event";

export type DriveMessageStatus =
  | DriveRequestStatus
  | DriveResponseStatus
  | DriveEventStatus;

export type DriveErrorInfo = {
  code: string;
  message: string;
  retryable: boolean;
  details?: Record<string, unknown>;
};

export type DriveRequest<TParams = Record<string, unknown>> = {
  id: string;
  action: DriveAction;
  status: DriveRequestStatus;
  params?: TParams;
};

export type DriveResponse<TResult = unknown> = {
  id: string;
  action: DriveAction;
  status: DriveResponseStatus;
  result?: TResult;
  error?: DriveErrorInfo;
};

export type DriveEvent<TParams = Record<string, unknown>> = {
  id: string;
  action: DriveAction;
  status: DriveEventStatus;
  params?: TParams;
};

export type DriveMessage = DriveRequest | DriveResponse | DriveEvent;

export type DriveOpResult = {
  ok: true;
  message?: string;
  warnings?: string[];
};

export type DriveTabListResult = {
  tabs: DriveTabInfo[];
};

// NOTE: Keep this protocol in sync with packages/core/src/drive-protocol.ts.
