import { describe, expect, it } from 'vitest';
import {
  applyAxSnapshotFilters,
  getAxNodes,
  truncateAxSnapshot,
} from './ax-snapshot';

describe('ax-snapshot helpers', () => {
  it('truncates AX snapshots with maxNodes and keeps childIds consistent', () => {
    const axNodes = [
      { nodeId: '1', role: 'root', name: '', childIds: ['2', '3'] },
      { nodeId: '2', role: 'group', name: '', childIds: ['4'] },
      { nodeId: '3', role: 'button', name: 'Ok', childIds: [] },
      { nodeId: '4', role: 'text', name: 'Hidden', childIds: [] },
    ];

    const result = truncateAxSnapshot({ nodes: axNodes }, 3);
    expect(result.truncated).toBe(true);

    const nodes = getAxNodes(result.snapshot);
    expect(nodes.length).toBeLessThanOrEqual(3);

    const keptIds = new Set(nodes.map((node) => node.nodeId).filter(Boolean));
    for (const node of nodes) {
      for (const childId of node.childIds ?? []) {
        expect(keptIds.has(childId)).toBe(true);
      }
    }
  });

  it('filters to interactive nodes when interactiveOnly is set', () => {
    const snapshot = {
      nodes: [
        { nodeId: '1', role: 'root', name: '', childIds: ['2', '3'] },
        { nodeId: '2', role: 'text', name: 'Hello', childIds: [] },
        { nodeId: '3', role: 'button', name: 'Ok', childIds: [] },
      ],
    };

    const filtered = applyAxSnapshotFilters(snapshot, {
      interactiveOnly: true,
    });
    const nodes = getAxNodes(filtered);
    expect(nodes.map((node) => node.nodeId)).toEqual(['3']);
  });

  it('compacts AX snapshots to a stable set of meaningful nodes', () => {
    const snapshot = {
      nodes: [
        { nodeId: '1', role: 'root', name: '', childIds: ['2', '3'] },
        { nodeId: '2', role: 'generic', name: '', childIds: [] },
        { nodeId: '3', role: 'button', name: 'Ok', childIds: [] },
      ],
    };

    const filtered = applyAxSnapshotFilters(snapshot, { compact: true });
    const nodes = getAxNodes(filtered);

    expect(nodes.map((node) => node.nodeId)).toEqual(['1', '3']);
    expect(nodes[0].childIds).toEqual(['3']);
  });
});
