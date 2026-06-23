import { describe, expect, it } from 'vitest';
import type { CombineResult } from '../src/combine';
import { pathStatus, summaryStatus } from '../src/status';

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
  it('contains no em dash or ampersand', () => {
    const s = pathStatus('p', res('ok'), 'sv', 2, 'median');
    expect(s).not.toMatch(/[—&]/);
  });
});

describe('summaryStatus', () => {
  it('reports nothing detected', () => {
    expect(summaryStatus(0, 0, [])).toContain('No multi-source paths detected');
  });
  it('lists skipped paths', () => {
    expect(summaryStatus(1, 2, [{ path: 'x', reason: 'non-numeric' }])).toContain(
      'skipped: x (non-numeric)'
    );
  });
});
