import { describe, expect, it } from 'vitest';
import type { CombineResult, Outcome } from '../src/combine';
import type { PathState } from '../src/status';
import { aggregateStatus, pathStatus } from '../src/status';

const res = (outcome: Outcome, n = 3, spread?: number): CombineResult => ({
  outcome,
  usedSources: [],
  freshCount: n,
  value: 0,
  ...(spread === undefined ? {} : { spread }),
});

describe('pathStatus', () => {
  it('asks for priority', () => {
    const s = pathStatus('navigation.position', res('ok'), 'signalk-synthetic-values', 2, 'median');
    expect(s).toContain('Set this path');
    expect(s).toContain('signalk-synthetic-values');
    // Data is a top-level sidebar item, not a child of Server.
    expect(s).toContain('in Data, Priorities');
    expect(s).not.toContain('Server, Data');
  });
  it('reports single source', () => {
    expect(pathStatus('p', res('singleSource', 1), 'sv', 2, 'median')).toContain(
      'running on 1 source'
    );
  });
  it('reports divergence', () => {
    expect(pathStatus('p', res('diverged'), 'sv', 2, 'median')).toContain('sources diverge');
  });
  it('reports disagreement with spread and method', () => {
    const s = pathStatus('p', res('disagree', 3, 0.05), 'sv', 2, 'median');
    expect(s).toContain('sources disagree');
    expect(s).toContain('max spread');
    expect(s).toContain('0.05000');
    expect(s).toContain('median');
  });
  it('reports disagreement without spread gracefully', () => {
    const s = pathStatus('p', res('disagree', 3, undefined), 'sv', 2, 'trimmedMean');
    expect(s).toContain('sources disagree');
    expect(s).toContain('unknown');
    expect(s).toContain('trimmedMean');
  });
  it('names the unit of the spread for each kind', () => {
    expect(pathStatus('p', res('disagree', 3, 28), 'sv', 2, 'median', 'position')).toContain(
      '28.00 m'
    );
    expect(pathStatus('p', res('disagree', 3, 0.5), 'sv', 2, 'median', 'angular')).toContain(
      '0.5000 rad'
    );
    expect(pathStatus('p', res('disagree', 3, 0.5), 'sv', 2, 'median', 'attitude')).toContain(
      '0.5000 rad'
    );
    expect(pathStatus('p', res('disagree', 3, 28), 'sv', 2, 'median', 'scalar')).toContain(
      '28.00 in the path units'
    );
  });
  it('describes a split sensor set and names the setting that suppresses it', () => {
    const s = pathStatus(
      'p',
      { ...res('disagree', 4, 28.1), unsupported: true },
      'sv',
      2,
      'median'
    );
    expect(s).toContain('split into groups');
    expect(s).toContain('disagreement distance');
  });
  it('reports a lagging slew-limited output as lagging, not as normal', () => {
    expect(pathStatus('p', res('slewLimited'), 'sv', 2, 'median')).toContain('lags');
  });
  it('names the used and fresh counts when rejection dropped a source', () => {
    const s = pathStatus('p', { ...res('ok', 4), usedSources: ['a', 'b', 'c'] }, 'sv', 2, 'median');
    expect(s).toContain('3 of 4 sources');
  });
  it('reports waiting below min', () => {
    expect(pathStatus('p', res('belowMin', 1), 'sv', 2, 'median')).toContain(
      'waiting for 2 sources'
    );
  });
  it('reports all sources stale distinctly from below-min', () => {
    expect(pathStatus('p', res('allStale', 0), 'sv', 2, 'median')).toContain('all sources stale');
  });
  it('contains no em dash or ampersand', () => {
    const s = pathStatus('p', res('ok'), 'sv', 2, 'median');
    expect(s).not.toMatch(/[—&]/);
  });
});

describe('aggregateStatus', () => {
  const outcomes = (...os: Outcome[]): Map<string, PathState> =>
    new Map(os.map((o, i) => [`p${i}`, { outcome: o, rejectedCount: 0 }]));

  it('reports nothing detected when no paths are configured or detected', () => {
    expect(aggregateStatus(0, new Map(), 0, [])).toContain('No multi-source paths detected');
  });

  it('prompts to add detected paths when none are configured', () => {
    const s = aggregateStatus(0, new Map(), 3, []);
    expect(s).toContain('3 multi-source paths detected');
    expect(s).toContain('config panel');
  });

  it('counts how many of the configured paths are combining', () => {
    const s = aggregateStatus(3, outcomes('ok', 'ok', 'belowMin'), 0, []);
    expect(s).toContain('Combining 2 of 3 paths.');
    expect(s).toContain('1 waiting for sources');
  });

  it('surfaces divergence and disagreement as stable counts', () => {
    const s = aggregateStatus(2, outcomes('diverged', 'disagree'), 0, []);
    expect(s).toContain('Combining 1 of 2 paths.');
    expect(s).toContain('1 diverging');
    expect(s).toContain('1 disagreeing');
  });

  it('uses the Oxford comma when listing three or more notes', () => {
    const s = aggregateStatus(
      4,
      outcomes('belowMin', 'diverged', 'disagree', 'singleSource'),
      0,
      []
    );
    expect(s).toContain(
      '1 waiting for sources, 1 diverging, 1 disagreeing, and 1 on a single source'
    );
  });

  it('counts a path with a rejected source', () => {
    const s = aggregateStatus(
      1,
      new Map([['p', { outcome: 'ok' as Outcome, rejectedCount: 1 }]]),
      0,
      []
    );
    expect(s).toContain('1 with a rejected source');
  });

  it('counts a path held back by the slew limit', () => {
    expect(aggregateStatus(1, outcomes('slewLimited'), 0, [])).toContain(
      '1 held back by the slew limit'
    );
  });

  it('names paths whose angular wrapping could not be confirmed', () => {
    const s = aggregateStatus(1, outcomes('ok'), 0, [], ['vendor.custom.someBearing']);
    expect(s).toContain('Set angular wrapping on: vendor.custom.someBearing.');
  });

  it('lists skipped paths', () => {
    expect(aggregateStatus(1, outcomes('ok'), 0, [{ path: 'x', reason: 'non-numeric' }])).toContain(
      'skipped: x (non-numeric)'
    );
  });

  it('contains no em dash or ampersand', () => {
    const s = aggregateStatus(2, outcomes('ok', 'diverged'), 0, [{ path: 'x', reason: 'bad' }]);
    expect(s).not.toMatch(/[—&]/);
  });
});
