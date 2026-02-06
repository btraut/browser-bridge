// Shared message protocol between core and the Chrome extension.
//
// Note: This is distinct from the public "drive" API types in ./schemas + ./types.
// The protocol is used for WS messages sent between core <-> extension, and it
// intentionally allows some fields (like tab URL/title) to be omitted.

export type DriveLocatorRole = {
  name: string;
  value?: string;
};

export type DriveLocator = {
  ref?: string;
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
  wait?: 'none' | 'domcontentloaded';
};

export type DriveGoBackParams = {
  tab_id?: number;
};

export type DriveGoForwardParams = {
  tab_id?: number;
};

export type DriveBackParams = {
  tab_id?: number;
};

export type DriveForwardParams = {
  tab_id?: number;
};

export type DriveClickParams = {
  locator: DriveLocator;
  click_count?: number;
  tab_id?: number;
};

export type DriveHoverParams = {
  locator: DriveLocator;
  delay_ms?: number;
  tab_id?: number;
};

export type DriveSelectParams = {
  locator: DriveLocator;
  value?: string;
  text?: string;
  index?: number;
  tab_id?: number;
};

export type DriveTypeParams = {
  locator?: DriveLocator;
  text: string;
  clear?: boolean;
  submit?: boolean;
  tab_id?: number;
};

export type DriveFillFormField = {
  selector?: string;
  locator?: DriveLocator;
  value: string | boolean;
  type?: 'auto' | 'text' | 'select' | 'checkbox' | 'radio' | 'contentEditable';
  submit?: boolean;
};

export type DriveFillFormParams = {
  fields: DriveFillFormField[];
  tab_id?: number;
};

export type DriveDragParams = {
  from: DriveLocator;
  to: DriveLocator;
  steps?: number;
  tab_id?: number;
};

export type DriveHandleDialogParams = {
  action: 'accept' | 'dismiss';
  promptText?: string;
  tab_id?: number;
};

export type DriveKeyPressParams = {
  key: string;
  modifiers?: {
    ctrl?: boolean;
    alt?: boolean;
    shift?: boolean;
    meta?: boolean;
  };
  tab_id?: number;
};

export type DriveKeyParams = {
  key: string;
  modifiers?: Array<'ctrl' | 'alt' | 'shift' | 'meta'>;
  repeat?: number;
  tab_id?: number;
};

export type DriveScrollParams = {
  delta_x?: number;
  delta_y?: number;
  top?: number;
  left?: number;
  behavior?: 'auto' | 'smooth';
  tab_id?: number;
};

export type DriveWaitForParams = {
  condition: {
    kind: 'locator_visible' | 'text_present' | 'url_matches';
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
  | 'drive.navigate'
  | 'drive.go_back'
  | 'drive.go_forward'
  | 'drive.back'
  | 'drive.forward'
  | 'drive.keepalive'
  | 'drive.click'
  | 'drive.hover'
  | 'drive.select'
  | 'drive.type'
  | 'drive.fill_form'
  | 'drive.drag'
  | 'drive.handle_dialog'
  | 'drive.key'
  | 'drive.key_press'
  | 'drive.scroll'
  | 'drive.wait_for'
  | 'drive.tab_list'
  | 'drive.tab_activate'
  | 'drive.tab_close'
  | 'drive.hello'
  | 'drive.tab_report'
  | 'drive.ping';

export type DriveRequestStatus = 'request';
export type DriveResponseStatus = 'ok' | 'error';
export type DriveEventStatus = 'event';

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

export type DebuggerAttachParams = {
  tab_id: number;
};

export type DebuggerDetachParams = {
  tab_id: number;
};

export type DebuggerCommandParams = {
  tab_id: number;
  method: string;
  params?: Record<string, unknown>;
};

export type DebuggerEventParams = {
  tab_id: number;
  method: string;
  params?: Record<string, unknown>;
  timestamp: string;
};

export type DebuggerRequestAction =
  | 'debugger.attach'
  | 'debugger.detach'
  | 'debugger.command';
export type DebuggerEventAction = 'debugger.event';
export type DebuggerAckAction = 'debugger.ack';
export type DebuggerErrorAction = 'debugger.error';

export type DebuggerAction =
  | DebuggerRequestAction
  | DebuggerEventAction
  | DebuggerAckAction
  | DebuggerErrorAction;

export type DebuggerRequestStatus = 'request';
export type DebuggerAckStatus = 'ack';
export type DebuggerErrorStatus = 'error';
export type DebuggerEventStatus = 'event';

export type DebuggerMessageStatus =
  | DebuggerRequestStatus
  | DebuggerAckStatus
  | DebuggerErrorStatus
  | DebuggerEventStatus;

export type DebuggerErrorInfo = DriveErrorInfo;

export type DebuggerRequest<TParams = Record<string, unknown>> = {
  id: string;
  action: DebuggerRequestAction;
  status: DebuggerRequestStatus;
  params?: TParams;
};

export type DebuggerAck<TResult = unknown> = {
  id: string;
  action: DebuggerRequestAction | DebuggerAckAction;
  status: DebuggerAckStatus;
  result?: TResult;
};

export type DebuggerError = {
  id: string;
  action: DebuggerRequestAction | DebuggerErrorAction;
  status: DebuggerErrorStatus;
  error?: DebuggerErrorInfo;
};

export type DebuggerEvent<TParams = Record<string, unknown>> = {
  id: string;
  action: DebuggerEventAction;
  status: DebuggerEventStatus;
  params?: TParams;
};

export type DebuggerResponse<TResult = unknown> =
  | DebuggerAck<TResult>
  | DebuggerError;

export type DebuggerMessage =
  | DebuggerRequest
  | DebuggerResponse
  | DebuggerEvent;

export type ExtensionRequestAction = DriveAction | DebuggerRequestAction;
export type ExtensionAction = DriveAction | DebuggerAction;
export type ExtensionRequest = DriveRequest | DebuggerRequest;
export type ExtensionResponse = DriveResponse | DebuggerResponse;
export type ExtensionEvent = DriveEvent | DebuggerEvent;
export type ExtensionMessage = DriveMessage | DebuggerMessage;
