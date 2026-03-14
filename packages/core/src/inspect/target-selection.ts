import type { DriveTabInfo } from '../drive-protocol';
import { SessionRegistry } from '../session';
import { pickBestTarget, type TargetHint } from '../target-matching';
import { InspectError } from './errors';
import { deriveHintFromTabs } from '../routes/shared';

type ExtensionBridgeLike = {
  isConnected: () => boolean;
  getStatus: () => { tabs: DriveTabInfo[] };
};

export type TargetHintInput = {
  url?: string;
  title?: string;
  tab_id?: number;
  tabId?: number;
  last_active_at?: string;
  lastActiveAt?: string;
};

export const readTargetHintInput = (
  target?: TargetHintInput
): TargetHint | undefined => {
  if (!target) {
    return undefined;
  }
  const url = typeof target.url === 'string' ? target.url : undefined;
  const title = typeof target.title === 'string' ? target.title : undefined;
  const tabIdRaw = target.tab_id ?? target.tabId;
  const tabId = typeof tabIdRaw === 'number' ? tabIdRaw : undefined;
  const lastActiveAtRaw = target.last_active_at ?? target.lastActiveAt;
  const lastActiveAt =
    typeof lastActiveAtRaw === 'string' ? lastActiveAtRaw : undefined;
  if (!url && !title && tabId === undefined && !lastActiveAt) {
    return undefined;
  }
  return { url, title, tabId, lastActiveAt };
};

export const readSessionTargetHint = (
  registry: SessionRegistry,
  sessionId?: string
): TargetHint | undefined => {
  if (typeof sessionId !== 'string') {
    return undefined;
  }
  const selectedTabId = registry.get(sessionId)?.selectedTabId;
  return typeof selectedTabId === 'number' && Number.isFinite(selectedTabId)
    ? { tabId: selectedTabId }
    : undefined;
};

export const resolveInspectTargetHint = (options: {
  sessionId: string;
  target?: TargetHintInput;
  registry: SessionRegistry;
  extensionBridge?: ExtensionBridgeLike;
}): TargetHint | undefined => {
  const explicit = readTargetHintInput(options.target);
  if (explicit) {
    return explicit;
  }
  const sessionHint = readSessionTargetHint(
    options.registry,
    options.sessionId
  );
  if (sessionHint) {
    return sessionHint;
  }
  const tabs = options.extensionBridge?.getStatus().tabs ?? [];
  return deriveHintFromTabs(tabs);
};

export const selectInspectTab = (options: {
  sessionId?: string;
  targetHint?: TargetHint;
  registry: SessionRegistry;
  extensionBridge?: ExtensionBridgeLike;
}): { tabId: number; tab: DriveTabInfo; warnings?: string[] } => {
  if (!options.extensionBridge || !options.extensionBridge.isConnected()) {
    throw new InspectError(
      'EXTENSION_DISCONNECTED',
      'Extension is not connected.',
      {
        retryable: true,
      }
    );
  }

  const tabs = options.extensionBridge.getStatus().tabs ?? [];
  if (!Array.isArray(tabs) || tabs.length === 0) {
    throw new InspectError('TAB_NOT_FOUND', 'No tabs available to inspect.');
  }

  const effectiveHint =
    options.targetHint ??
    readSessionTargetHint(options.registry, options.sessionId);

  if (
    typeof effectiveHint?.tabId === 'number' &&
    Number.isFinite(effectiveHint.tabId)
  ) {
    const tab = tabs.find((entry) => entry.tab_id === effectiveHint.tabId);
    if (!tab) {
      throw new InspectError(
        'TAB_NOT_FOUND',
        `No matching tab found for tab_id ${effectiveHint.tabId}.`,
        { details: { tab_id: effectiveHint.tabId } }
      );
    }
    return { tabId: effectiveHint.tabId, tab };
  }

  const candidates = tabs.map((tab) => ({
    id: String(tab.tab_id),
    url: tab.url ?? '',
    title: tab.title,
    lastSeenAt: tab.last_active_at ? Date.parse(tab.last_active_at) : undefined,
  }));

  const ranked = pickBestTarget(candidates, effectiveHint);
  if (!ranked) {
    throw new InspectError('TAB_NOT_FOUND', 'No matching tab found.');
  }

  const tabId = Number(ranked.candidate.id);
  if (!Number.isFinite(tabId)) {
    throw new InspectError('TAB_NOT_FOUND', 'Resolved tab id is invalid.');
  }

  const tab = tabs.find((entry) => entry.tab_id === tabId) ?? tabs[0];
  const warnings: string[] = [];
  if (!effectiveHint) {
    warnings.push('No target hint provided; using the most recent tab.');
  } else if (ranked.score < 20) {
    warnings.push('Weak target match; using best available tab.');
  }

  return {
    tabId,
    tab,
    warnings: warnings.length > 0 ? warnings : undefined,
  };
};
