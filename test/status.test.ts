import { describe, expect, it } from 'vitest';
import { PLUGIN_ID } from '../src/config';
import type { Kind } from '../src/metrics';
import type { PathOutcome, PathResult, PathState } from '../src/status';
import { aggregateStatus, pathStatus } from '../src/status';

const res = (outcome: PathOutcome, n = 3, spread?: number): PathResult => ({
  outcome,
  usedSources: [],
  freshCount: n,
  rejectedSources: [],
  value: 0,
  ...(spread === undefined ? {} : { spread }),
});

// Every case below reports a scalar unless it is naming the spread unit of
// another kind, which is the one thing `kind` changes in the line.
const line = (
  path: string,
  result: PathResult,
  sourceLabel: string,
  effectiveMin: number,
  method: 'median' | 'trimmedMean' | 'mean'
): string =>
  pathStatus({
    path,
    result,
    sourceLabel,
    minSources: effectiveMin,
    method,
    kind: 'scalar',
    hasEmitted: true,
  });

const lineOf = (kind: Kind, spread: number): string =>
  pathStatus({
    path: 'p',
    result: res('disagree', 3, spread),
    sourceLabel: 'sv',
    minSources: 2,
    method: 'median',
    kind,
    hasEmitted: true,
  });

describe('pathStatus', () => {
  it('asks for priority', () => {
    const s = line('navigation.position', res('ok'), PLUGIN_ID, 2, 'median');
    expect(s).toContain('Set this path');
    expect(s).toContain(PLUGIN_ID);
    // Data is a top-level sidebar item, not a child of Server.
    expect(s).toContain('in Data, Priorities');
    expect(s).not.toContain('Server, Data');
  });
  it('reports single source', () => {
    expect(line('p', res('singleSource', 1), 'sv', 2, 'median')).toContain('running on 1 source');
  });
  it('reports divergence', () => {
    expect(line('p', res('diverged'), 'sv', 2, 'median')).toContain('sources diverge');
  });
  it('reports disagreement with spread and method', () => {
    const s = line('p', res('disagree', 3, 0.05), 'sv', 2, 'median');
    expect(s).toContain('sources disagree');
    expect(s).toContain('max spread');
    expect(s).toContain('0.05000');
    expect(s).toContain('median');
  });
  it('reports disagreement without spread gracefully', () => {
    const s = line('p', res('disagree', 3, undefined), 'sv', 2, 'trimmedMean');
    expect(s).toContain('sources disagree');
    expect(s).toContain('unknown');
    expect(s).toContain('trimmedMean');
  });
  it('names the unit of the spread for each kind', () => {
    expect(lineOf('position', 28)).toContain('28.00 m');
    expect(lineOf('angular', 0.5)).toContain('0.5000 rad');
    expect(lineOf('attitude', 0.5)).toContain('0.5000 rad');
    expect(lineOf('scalar', 28)).toContain('28.00 in the path units');
  });
  it('describes a split sensor set and names the setting that suppresses it', () => {
    const s = line('p', { ...res('disagree', 4, 28.1), unsupported: true }, 'sv', 2, 'median');
    expect(s).toContain('split into groups');
    expect(s).toContain('disagreement distance');
  });
  it('reports a lagging slew-limited output as lagging, not as normal', () => {
    expect(line('p', res('slewLimited'), 'sv', 2, 'median')).toContain('lags');
  });
  it('names the used and fresh counts when rejection dropped a source', () => {
    const s = line('p', { ...res('ok', 4), usedSources: ['a', 'b', 'c'] }, 'sv', 2, 'median');
    expect(s).toContain('3 of 4 sources');
  });
  it('reports waiting below min', () => {
    expect(line('p', res('belowMin', 1), 'sv', 2, 'median')).toContain('waiting for 2 sources');
  });
  it('reports all sources stale distinctly from below-min', () => {
    expect(line('p', res('allStale', 0), 'sv', 2, 'median')).toContain('all sources stale');
  });
  it('contains no em dash or ampersand', () => {
    const s = line('p', res('ok'), 'sv', 2, 'median');
    expect(s).not.toMatch(/[—&]/);
  });
});

describe('aggregateStatus', () => {
  const outcomes = (...os: PathOutcome[]): PathState[] =>
    os.map((outcome) => ({ outcome, rejectedCount: 0, freshCount: 3, usedCount: 3 }));

  it('reports nothing detected when no paths are configured or detected', () => {
    expect(aggregateStatus([], 0, [])).toContain('No multi-source paths detected');
  });

  it('prompts to add detected paths when none are configured', () => {
    const s = aggregateStatus([], 3, []);
    expect(s).toContain('3 multi-source paths detected');
    expect(s).toContain('config panel');
  });

  it('counts how many of the configured paths are combining', () => {
    const s = aggregateStatus(outcomes('ok', 'ok', 'belowMin'), 0, []);
    expect(s).toContain('Combining 2 of 3 paths.');
    expect(s).toContain('1 waiting for sources');
  });

  it('surfaces divergence and disagreement as stable counts', () => {
    const s = aggregateStatus(outcomes('diverged', 'disagree'), 0, []);
    expect(s).toContain('Combining 1 of 2 paths.');
    expect(s).toContain('1 diverging');
    expect(s).toContain('1 disagreeing');
  });

  it('uses the Oxford comma when listing three or more notes', () => {
    const s = aggregateStatus(outcomes('belowMin', 'diverged', 'disagree', 'singleSource'), 0, []);
    expect(s).toContain(
      '1 waiting for sources, 1 diverging, 1 disagreeing, and 1 on a single source'
    );
  });

  it('counts a path with a rejected source', () => {
    const s = aggregateStatus(
      [{ outcome: 'ok', rejectedCount: 1, freshCount: 3, usedCount: 2 }],
      0,
      []
    );
    expect(s).toContain('1 with a rejected source');
  });

  it('counts a path held back by the slew limit', () => {
    expect(aggregateStatus(outcomes('slewLimited'), 0, [])).toContain(
      '1 held back by the slew limit'
    );
  });

  it('names paths whose angular wrapping could not be confirmed', () => {
    const s = aggregateStatus(outcomes('ok'), 0, [], ['vendor.custom.someBearing']);
    expect(s).toContain('Set angular wrapping on: vendor.custom.someBearing.');
  });

  it('lists skipped paths', () => {
    expect(aggregateStatus(outcomes('ok'), 0, [{ path: 'x', reason: 'non-numeric' }])).toContain(
      'skipped: x (non-numeric)'
    );
  });

  it('contains no em dash or ampersand', () => {
    const s = aggregateStatus(outcomes('ok', 'diverged'), 0, [{ path: 'x', reason: 'bad' }]);
    expect(s).not.toMatch(/[—&]/);
  });
});
