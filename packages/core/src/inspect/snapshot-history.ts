import { getAxNodes } from './ax-snapshot';
import { collectHtmlEntries } from './html-snapshot';
import type { DomSnapshotResult } from './types';

type SnapshotRecord = {
  sessionId: string;
  format: 'ax' | 'html';
  entries: Map<string, string>;
  capturedAt: string;
};

export type DomDiffResult = {
  added: string[];
  removed: string[];
  changed: string[];
  summary: string;
};

export class SnapshotHistory {
  private readonly history: SnapshotRecord[] = [];
  private readonly maxSnapshotsPerSession: number;
  private readonly maxSnapshotHistory: number;

  constructor(options: {
    maxSnapshotsPerSession: number;
    maxSnapshotHistory: number;
  }) {
    this.maxSnapshotsPerSession = Math.max(0, options.maxSnapshotsPerSession);
    this.maxSnapshotHistory = Math.max(0, options.maxSnapshotHistory);
  }

  record(sessionId: string, snapshot: DomSnapshotResult): void {
    const entries = this.collectSnapshotEntries(snapshot);
    if (!entries) {
      return;
    }
    this.history.push({
      sessionId,
      format: snapshot.format,
      entries,
      capturedAt: new Date().toISOString(),
    });

    let count = 0;
    for (const record of this.history) {
      if (record.sessionId === sessionId) {
        count += 1;
      }
    }
    while (count > this.maxSnapshotsPerSession) {
      const index = this.history.findIndex(
        (record) => record.sessionId === sessionId
      );
      if (index === -1) {
        break;
      }
      this.history.splice(index, 1);
      count -= 1;
    }
    while (this.history.length > this.maxSnapshotHistory) {
      this.history.shift();
    }
  }

  diff(sessionId: string): DomDiffResult {
    const snapshots = this.history.filter(
      (record) => record.sessionId === sessionId
    );
    if (snapshots.length < 2) {
      return {
        added: [],
        removed: [],
        changed: [],
        summary: 'Not enough snapshots to diff.',
      };
    }
    const previous = snapshots[snapshots.length - 2];
    const current = snapshots[snapshots.length - 1];

    const added: string[] = [];
    const removed: string[] = [];
    const changed: string[] = [];

    for (const [key, value] of current.entries.entries()) {
      if (!previous.entries.has(key)) {
        added.push(key);
      } else if (previous.entries.get(key) !== value) {
        changed.push(key);
      }
    }
    for (const key of previous.entries.keys()) {
      if (!current.entries.has(key)) {
        removed.push(key);
      }
    }

    return {
      added,
      removed,
      changed,
      summary: `Added ${added.length}, removed ${removed.length}, changed ${changed.length}.`,
    };
  }

  private collectSnapshotEntries(
    snapshot: DomSnapshotResult
  ): Map<string, string> | null {
    if (snapshot.format === 'html' && typeof snapshot.snapshot === 'string') {
      return collectHtmlEntries(snapshot.snapshot);
    }
    if (snapshot.format === 'ax') {
      return this.collectAxEntries(snapshot.snapshot);
    }
    return null;
  }

  private collectAxEntries(snapshot: unknown): Map<string, string> {
    const entries = new Map<string, string>();
    const nodes = getAxNodes(snapshot);
    if (nodes.length === 0) {
      return entries;
    }
    nodes.forEach((node, index) => {
      if (!node || typeof node !== 'object') {
        return;
      }
      const record = node as {
        nodeId?: string;
        backendDOMNodeId?: number;
        role?: { value?: string } | string;
        name?: { value?: string } | string;
      };
      const role =
        typeof record.role === 'string'
          ? record.role
          : (record.role?.value ?? 'node');
      const name =
        typeof record.name === 'string'
          ? record.name
          : (record.name?.value ?? '');
      const nodeId =
        record.nodeId ??
        (record.backendDOMNodeId !== undefined
          ? String(record.backendDOMNodeId)
          : undefined);
      const key = nodeId ? `node-${nodeId}` : `${role}:${name}:${index}`;
      entries.set(key, `${role}:${name}`);
    });
    return entries;
  }
}
