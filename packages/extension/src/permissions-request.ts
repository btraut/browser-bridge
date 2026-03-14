import {
  allowSiteAlways,
  readPermissionPromptWaitMs,
  revokeSite,
  type SitePermissionsMode,
  writeSitePermissionsMode,
} from './site-permissions.js';

export const PERMISSIONS_REQUEST_PORT_NAME = 'permissions_request_prompt';

export type PermissionsRequestSource = 'cli' | 'mcp' | 'api';
export type PermissionsRequestKind = 'allow_site' | 'revoke_site' | 'set_mode';
export type PermissionsRequestStatus =
  | 'pending'
  | 'approved'
  | 'denied'
  | 'timed_out';

export type PermissionsChangeRequest = {
  kind: PermissionsRequestKind;
  site?: string;
  mode?: SitePermissionsMode;
  timeoutMs?: number;
  source?: PermissionsRequestSource;
};

export type PermissionsRequestResult = {
  request_id: string;
  kind: PermissionsRequestKind;
  status: Exclude<PermissionsRequestStatus, 'pending'>;
  requested_at: string;
  site?: string;
  mode?: SitePermissionsMode;
  source?: PermissionsRequestSource;
  warning?: string;
  message?: string;
};

export type PendingPermissionsRequest = {
  request_id: string;
  kind: PermissionsRequestKind;
  status: 'pending';
  requested_at: string;
  site?: string;
  mode?: SitePermissionsMode;
  source?: PermissionsRequestSource;
  warning?: string;
};

type ApprovalDecision = 'approve' | 'deny';

type RequestState = {
  requestId: string;
  kind: PermissionsRequestKind;
  requestedAt: string;
  site?: string;
  mode?: SitePermissionsMode;
  source?: PermissionsRequestSource;
  warning?: string;
  windowId: number | null;
  decided: ApprovalDecision | null;
  waiters: Set<(decision: ApprovalDecision) => void>;
};

export type PermissionsRequestControllerDeps = {
  openWindow: (url: string) => Promise<number>;
  closeWindow: (windowId: number) => Promise<void>;
  getDefaultWaitMs: () => Promise<number>;
  makeRequestId: () => string;
  now: () => string;
  allowSite: (siteKey: string) => Promise<void>;
  revokeSite: (siteKey: string) => Promise<void>;
  setMode: (mode: SitePermissionsMode) => Promise<void>;
};

const defaultMakeRequestId = (): string => {
  if (
    typeof crypto !== 'undefined' &&
    typeof crypto.randomUUID === 'function'
  ) {
    return crypto.randomUUID();
  }
  return `perm-change-${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

const defaultOpenWindow = async (url: string): Promise<number> => {
  return await new Promise<number>((resolve, reject) => {
    chrome.windows.create(
      {
        type: 'popup',
        url,
        focused: true,
        width: 500,
        height: 470,
      },
      (win: Record<string, unknown> | undefined) => {
        const err = chrome.runtime.lastError;
        if (err) {
          reject(new Error(err.message));
          return;
        }
        const windowId = win?.id;
        if (typeof windowId !== 'number') {
          reject(new Error('Prompt window id missing.'));
          return;
        }
        resolve(windowId);
      }
    );
  });
};

const defaultCloseWindow = async (windowId: number): Promise<void> => {
  return await new Promise<void>((resolve) => {
    chrome.windows.remove(windowId, () => resolve());
  });
};

const delay = async (ms: number): Promise<void> => {
  return await new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
};

const normalizeSite = (site: string): string => site.trim().toLowerCase();

const describeChange = (
  state: Pick<RequestState, 'kind' | 'site' | 'mode'>
) => {
  switch (state.kind) {
    case 'allow_site':
      return `Allow Browser Bridge actions on ${state.site ?? 'this site'}.`;
    case 'revoke_site':
      return `Revoke Browser Bridge actions on ${state.site ?? 'this site'}.`;
    case 'set_mode':
      return state.mode === 'bypass'
        ? 'Switch Browser Bridge to bypass mode.'
        : 'Switch Browser Bridge to granular mode.';
  }
};

const buildWarning = (
  kind: PermissionsRequestKind,
  mode?: SitePermissionsMode
): string | undefined => {
  if (kind === 'set_mode' && mode === 'bypass') {
    return 'Bypass mode lets the agent act on any website without asking first.';
  }
  return undefined;
};

export class PermissionsRequestController {
  private readonly deps: PermissionsRequestControllerDeps;
  private readonly stateByRequestId = new Map<string, RequestState>();
  private readonly stateByWindowId = new Map<number, RequestState>();

  constructor(deps?: Partial<PermissionsRequestControllerDeps>) {
    this.deps = {
      openWindow: deps?.openWindow ?? defaultOpenWindow,
      closeWindow: deps?.closeWindow ?? defaultCloseWindow,
      getDefaultWaitMs: deps?.getDefaultWaitMs ?? readPermissionPromptWaitMs,
      makeRequestId: deps?.makeRequestId ?? defaultMakeRequestId,
      now: deps?.now ?? (() => new Date().toISOString()),
      allowSite: deps?.allowSite ?? allowSiteAlways,
      revokeSite: deps?.revokeSite ?? revokeSite,
      setMode: deps?.setMode ?? writeSitePermissionsMode,
    };
  }

  async requestChange(
    request: PermissionsChangeRequest
  ): Promise<PermissionsRequestResult> {
    const state = await this.createState(request);
    const waitMs =
      typeof request.timeoutMs === 'number' && request.timeoutMs > 0
        ? request.timeoutMs
        : await this.deps.getDefaultWaitMs();
    const decision = await this.waitForDecisionOrTimeout(state, waitMs);

    if (!decision) {
      return {
        request_id: state.requestId,
        kind: state.kind,
        status: 'timed_out',
        requested_at: state.requestedAt,
        ...(state.site ? { site: state.site } : {}),
        ...(state.mode ? { mode: state.mode } : {}),
        ...(state.source ? { source: state.source } : {}),
        ...(state.warning ? { warning: state.warning } : {}),
        message: 'Permission change request timed out waiting for approval.',
      };
    }

    return {
      request_id: state.requestId,
      kind: state.kind,
      status: decision === 'approve' ? 'approved' : 'denied',
      requested_at: state.requestedAt,
      ...(state.site ? { site: state.site } : {}),
      ...(state.mode ? { mode: state.mode } : {}),
      ...(state.source ? { source: state.source } : {}),
      ...(state.warning ? { warning: state.warning } : {}),
      message:
        decision === 'approve'
          ? describeChange(state)
          : 'Permission change request was denied.',
    };
  }

  listPendingRequests(): PendingPermissionsRequest[] {
    return [...this.stateByRequestId.values()]
      .filter((state) => state.decided === null)
      .map((state) => ({
        request_id: state.requestId,
        kind: state.kind,
        status: 'pending' as const,
        requested_at: state.requestedAt,
        ...(state.site ? { site: state.site } : {}),
        ...(state.mode ? { mode: state.mode } : {}),
        ...(state.source ? { source: state.source } : {}),
        ...(state.warning ? { warning: state.warning } : {}),
      }))
      .sort((a, b) => a.requested_at.localeCompare(b.requested_at));
  }

  handleConnect(port: unknown): void {
    if (!port || typeof port !== 'object') {
      return;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const p = port as any;
    if (p.name !== PERMISSIONS_REQUEST_PORT_NAME) {
      return;
    }

    const onMessage = p.onMessage;
    if (!onMessage || typeof onMessage.addListener !== 'function') {
      return;
    }

    onMessage.addListener((message: unknown) => {
      void this.handlePortMessage(message).catch((error) => {
        console.error(
          'PermissionsRequestController handlePortMessage failed:',
          error
        );
      });
    });
  }

  handleWindowRemoved(windowId: number): void {
    const state = this.stateByWindowId.get(windowId);
    if (!state) {
      return;
    }
    this.cleanupState(state);
  }

  private async createState(
    request: PermissionsChangeRequest
  ): Promise<RequestState> {
    const requestId = this.deps.makeRequestId();
    const requestedAt = this.deps.now();
    const kind = request.kind;
    const warning = buildWarning(kind, request.mode);
    const state: RequestState = {
      requestId,
      kind,
      requestedAt,
      site: request.site ? normalizeSite(request.site) : undefined,
      mode: request.mode,
      source: request.source,
      warning,
      windowId: null,
      decided: null,
      waiters: new Set(),
    };

    this.stateByRequestId.set(requestId, state);
    const url = this.buildPromptUrl(state);
    const windowId = await this.deps.openWindow(url);
    state.windowId = windowId;
    this.stateByWindowId.set(windowId, state);

    if (state.decided) {
      await this.deps.closeWindow(windowId);
      this.cleanupState(state);
    }

    return state;
  }

  private buildPromptUrl(state: RequestState): string {
    const base = chrome.runtime.getURL('permissions-request.html');
    const url = new URL(base);
    url.searchParams.set('requestId', state.requestId);
    url.searchParams.set('kind', state.kind);
    url.searchParams.set('requestedAt', state.requestedAt);
    if (state.site) {
      url.searchParams.set('site', state.site);
    }
    if (state.mode) {
      url.searchParams.set('mode', state.mode);
    }
    if (state.source) {
      url.searchParams.set('source', state.source);
    }
    if (state.warning) {
      url.searchParams.set('warning', state.warning);
    }
    if (state.kind === 'set_mode' && state.mode === 'bypass') {
      url.searchParams.set('requireAcknowledge', '1');
    }
    return url.toString();
  }

  private async waitForDecisionOrTimeout(
    state: RequestState,
    waitMs: number
  ): Promise<ApprovalDecision | null> {
    if (state.decided) {
      return state.decided;
    }

    let waiter: ((decision: ApprovalDecision) => void) | null = null;
    const decisionPromise = new Promise<ApprovalDecision>((resolve) => {
      waiter = resolve;
      state.waiters.add(resolve);
    });

    const winner = await Promise.race([
      decisionPromise,
      delay(waitMs).then(() => null as ApprovalDecision | null),
    ]);

    if (winner === null && waiter) {
      state.waiters.delete(waiter);
    }

    return winner;
  }

  private async handlePortMessage(message: unknown): Promise<void> {
    if (!message || typeof message !== 'object') {
      return;
    }
    const m = message as Record<string, unknown>;
    if (m.type !== 'decision') {
      return;
    }

    const requestId = m.requestId;
    const decision = m.decision;
    if (typeof requestId !== 'string' || requestId.length === 0) {
      return;
    }
    if (decision !== 'approve' && decision !== 'deny') {
      return;
    }

    const state = this.stateByRequestId.get(requestId);
    if (!state) {
      return;
    }

    state.decided = decision;
    if (decision === 'approve') {
      await this.applyApprovedChange(state);
    }

    for (const waiter of state.waiters) {
      waiter(decision);
    }
    state.waiters.clear();

    if (typeof state.windowId === 'number') {
      await this.deps.closeWindow(state.windowId);
      this.cleanupState(state);
    }
  }

  private async applyApprovedChange(state: RequestState): Promise<void> {
    if (state.kind === 'allow_site') {
      if (!state.site) {
        throw new Error('allow_site request is missing site.');
      }
      await this.deps.allowSite(state.site);
      return;
    }

    if (state.kind === 'revoke_site') {
      if (!state.site) {
        throw new Error('revoke_site request is missing site.');
      }
      await this.deps.revokeSite(state.site);
      return;
    }

    if (!state.mode) {
      throw new Error('set_mode request is missing mode.');
    }
    await this.deps.setMode(state.mode);
  }

  private cleanupState(state: RequestState): void {
    this.stateByRequestId.delete(state.requestId);
    if (typeof state.windowId === 'number') {
      this.stateByWindowId.delete(state.windowId);
    }
  }
}
