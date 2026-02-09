import {
  allowSiteAlways,
  readPermissionPromptWaitMs,
} from './site-permissions.js';

export const PERMISSION_PROMPT_PORT_NAME = 'permission_prompt';

export type PermissionPromptDecision = 'allow_once' | 'allow_always' | 'deny';

export type PermissionPromptResult =
  | { kind: PermissionPromptDecision }
  | { kind: 'timed_out'; waitMs: number };

export type PermissionPromptRequest = {
  siteKey: string;
  action: string;
};

type PromptState = {
  siteKey: string;
  action: string;
  requestId: string;
  windowId: number | null;
  decided: PermissionPromptDecision | null;
  waiters: Set<(decision: PermissionPromptDecision) => void>;
};

export type PermissionPromptControllerDeps = {
  openWindow: (url: string) => Promise<number>;
  closeWindow: (windowId: number) => Promise<void>;
  getWaitMs: () => Promise<number>;
  persistAlwaysAllow: (siteKey: string) => Promise<void>;
  makeRequestId: () => string;
};

const defaultMakeRequestId = (): string => {
  if (
    typeof crypto !== 'undefined' &&
    typeof crypto.randomUUID === 'function'
  ) {
    return crypto.randomUUID();
  }
  return `perm-${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

const defaultOpenWindow = async (url: string): Promise<number> => {
  return await new Promise<number>((resolve, reject) => {
    chrome.windows.create(
      {
        type: 'popup',
        url,
        focused: true,
        width: 460,
        height: 420,
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

export class PermissionPromptController {
  private deps: PermissionPromptControllerDeps;
  private stateBySite = new Map<string, PromptState>();
  private stateByRequestId = new Map<string, PromptState>();
  private stateByWindowId = new Map<number, PromptState>();

  constructor(deps?: Partial<PermissionPromptControllerDeps>) {
    this.deps = {
      openWindow: deps?.openWindow ?? defaultOpenWindow,
      closeWindow: deps?.closeWindow ?? defaultCloseWindow,
      getWaitMs: deps?.getWaitMs ?? readPermissionPromptWaitMs,
      persistAlwaysAllow: deps?.persistAlwaysAllow ?? allowSiteAlways,
      makeRequestId: deps?.makeRequestId ?? defaultMakeRequestId,
    };
  }

  async requestPermission(
    request: PermissionPromptRequest
  ): Promise<PermissionPromptResult> {
    const siteKey = request.siteKey.toLowerCase();

    let state = this.stateBySite.get(siteKey);
    if (!state) {
      const requestId = this.deps.makeRequestId();
      state = {
        siteKey,
        action: request.action,
        requestId,
        windowId: null,
        decided: null,
        waiters: new Set(),
      };
      this.stateBySite.set(siteKey, state);
      this.stateByRequestId.set(requestId, state);

      const url = this.buildPromptUrl(state);
      const windowId = await this.deps.openWindow(url);
      state.windowId = windowId;
      this.stateByWindowId.set(windowId, state);

      // In tests (or in rare races), a decision could be processed before the
      // window id is set. If so, close and clean up now.
      if (state.decided) {
        await this.deps.closeWindow(windowId);
        this.cleanupState(state);
      }
    }

    const waitMs = await this.deps.getWaitMs();
    const decision = await this.waitForDecisionOrTimeout(state, waitMs);
    if (!decision) {
      return { kind: 'timed_out', waitMs };
    }
    return { kind: decision };
  }

  handleConnect(port: unknown): void {
    if (!port || typeof port !== 'object') {
      return;
    }

    // We keep this loosely typed; MV3 provides the real shape at runtime.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const p = port as any;
    if (p.name !== PERMISSION_PROMPT_PORT_NAME) {
      return;
    }

    const onMessage = p.onMessage;
    if (!onMessage || typeof onMessage.addListener !== 'function') {
      return;
    }

    onMessage.addListener((message: unknown) => {
      void this.handlePortMessage(message).catch((error) => {
        console.error(
          'PermissionPromptController handlePortMessage failed:',
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

  private buildPromptUrl(state: PromptState): string {
    const base = chrome.runtime.getURL('permission.html');
    const u = new URL(base);
    u.searchParams.set('requestId', state.requestId);
    u.searchParams.set('site', state.siteKey);
    u.searchParams.set('action', state.action);
    return u.toString();
  }

  private async waitForDecisionOrTimeout(
    state: PromptState,
    waitMs: number
  ): Promise<PermissionPromptDecision | null> {
    if (state.decided) {
      return state.decided;
    }

    let waiter: ((decision: PermissionPromptDecision) => void) | null = null;
    const decisionPromise = new Promise<PermissionPromptDecision>((resolve) => {
      waiter = resolve;
      state.waiters.add(resolve);
    });

    const winner = await Promise.race([
      decisionPromise,
      delay(waitMs).then(() => null as PermissionPromptDecision | null),
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
    if (
      decision !== 'allow_once' &&
      decision !== 'allow_always' &&
      decision !== 'deny'
    ) {
      return;
    }

    const state = this.stateByRequestId.get(requestId);
    if (!state) {
      return;
    }

    state.decided = decision;
    if (decision === 'allow_always') {
      await this.deps.persistAlwaysAllow(state.siteKey);
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

  private cleanupState(state: PromptState): void {
    this.stateBySite.delete(state.siteKey);
    this.stateByRequestId.delete(state.requestId);
    if (typeof state.windowId === 'number') {
      this.stateByWindowId.delete(state.windowId);
    }
  }
}
