import { describe, expect, it } from 'vitest';
import {
  applySnapshotRefs,
  assignRefsToAxSnapshot,
  pruneUnappliedRefsFromSnapshot,
  resolveNodeIdForSelector,
} from './snapshot-refs';

describe('snapshot ref helpers', () => {
  it('assignRefsToAxSnapshot mutates nodes and returns a backendId->ref map', () => {
    const snapshot = {
      nodes: [
        {
          nodeId: '1',
          backendDOMNodeId: 10,
          role: { value: 'link' },
          name: { value: 'Untitled deck' },
          properties: [
            { name: 'url', value: { value: 'https://example.com/decks/1' } },
          ],
        },
        { nodeId: '2', backendDOMNodeId: 11, ignored: true },
        { nodeId: '3', backendDOMNodeId: 12 },
      ],
    };

    const refs = assignRefsToAxSnapshot(snapshot);
    expect(Array.from(refs.entries())).toEqual([
      [
        10,
        {
          ref: '@e1',
          role: 'link',
          name: 'Untitled deck',
          url: 'https://example.com/decks/1',
        },
      ],
      [12, { ref: '@e2' }],
    ]);

    const nodes = (snapshot as { nodes: Array<{ ref?: string }> }).nodes;
    expect(nodes[0].ref).toBe('@e1');
    expect(nodes[1].ref).toBeUndefined();
    expect(nodes[2].ref).toBe('@e2');
  });

  it('resolveNodeIdForSelector returns warnings when selector is not found', async () => {
    const result = await resolveNodeIdForSelector(
      1,
      '.missing',
      async (_tabId, method) => {
        if (method === 'DOM.getDocument') {
          return { root: { nodeId: 1 } };
        }
        if (method === 'DOM.querySelector') {
          return { nodeId: 0 };
        }
        return {};
      }
    );

    expect(result.nodeId).toBeUndefined();
    expect(result.warnings).toEqual(['Selector not found: .missing']);
  });

  it('applySnapshotRefs reports a warning when it cannot clear prior refs', async () => {
    const calls: string[] = [];
    const result = await applySnapshotRefs(
      1,
      new Map(),
      async (_tabId, method) => {
        calls.push(method);
        if (method === 'Runtime.evaluate') {
          throw Object.assign(new Error('boom'), { name: 'InspectError' });
        }
        return {};
      }
    );

    expect(calls).toContain('DOM.enable');
    expect(calls).toContain('Runtime.enable');
    expect(result.warnings).toContain('Failed to clear prior snapshot refs.');
    expect(result.appliedRefs.size).toBe(0);
  });

  it('prunes refs that were never applied to the DOM', () => {
    const snapshot = {
      nodes: [{ ref: '@e1' }, { ref: '@e2' }, {}],
    };

    pruneUnappliedRefsFromSnapshot(snapshot, new Set(['@e2']));

    expect(snapshot).toEqual({
      nodes: [{}, { ref: '@e2' }, {}],
    });
  });
});
