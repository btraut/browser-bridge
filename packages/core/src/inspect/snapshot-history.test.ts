import { describe, expect, it } from 'vitest';
import { SnapshotHistory } from './snapshot-history';

describe('SnapshotHistory', () => {
  it('diffs successive HTML snapshots', () => {
    const history = new SnapshotHistory({
      maxSnapshotsPerSession: 10,
      maxSnapshotHistory: 100,
    });

    history.record('s1', {
      format: 'html',
      snapshot: `<div id="a"></div>`,
    });
    history.record('s1', {
      format: 'html',
      snapshot: `<div id="a" class="x"></div><span id="b"></span>`,
    });

    const diff = history.diff('s1');
    expect(diff.added).toContain('span#b');
    expect(diff.changed).toContain('div#a');
    expect(diff.removed).toEqual([]);
  });
});
