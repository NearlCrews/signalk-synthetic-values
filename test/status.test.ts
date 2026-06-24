import { describe, expect, it } from 'vitest';
import type { CombineResult, Outcome } from '../src/combine';
import { aggregateStatus, pathStatus } from '../src/status';

const res = (outcome: any, n = 3, spread?: number): CombineResult => ({
  outcome,
  usedSources: [],
  freshCount: n,
  value: 0,
  spread,
});

describe('pathStatus', () => {
  it('asks for priority', () => {
    const s = pathStatus('navigation.position', res('ok'), 'signalk-synthetic-values', 2, 'median');
    expect(s).toContain('Set this path');
    expect(s).toContain('signalk-synthetic-values');
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
    expect(s).toContain('?');
    expect(s).toContain('trimmedMean');
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
  const outcomes = (...os: Outcome[]): Map<string, Outcome> =>
    new Map(os.map((o, i) => [`p${i}`, o]));

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
