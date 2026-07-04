// Tests for api-base fetchJson and the useDetected pure reducer.
// No DOM rendering; we test the pure core directly.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DetectedRow } from '../../src/configpanel/hooks/useDetected.js';

// -- fetchJson tests ----------------------------------------------------------
// We must import the module under test after stubbing global.fetch.
// Use dynamic import inside each test block so the stub is in place first.

describe('fetchJson', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('calls the correct URL for /detected', async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ paths: [] }), { status: 200 }));

    const { fetchJson } = await import('../../src/configpanel/api-base.js');
    await fetchJson('/detected');

    expect(mockFetch).toHaveBeenCalledOnce();
    const [calledUrl] = mockFetch.mock.calls[0] as [string, RequestInit?];
    expect(calledUrl).toBe('/plugins/signalk-synthetic-values/api/detected');
  });

  it('throws on a non-ok response', async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockResolvedValueOnce(new Response('Not Found', { status: 404 }));

    const { fetchJson } = await import('../../src/configpanel/api-base.js');
    await expect(fetchJson('/detected')).rejects.toThrow('HTTP 404');
  });
});

// -- nextDetectedState pure reducer tests -------------------------------------

describe('nextDetectedState', () => {
  it('returns the same state object when the incoming payload is unchanged', async () => {
    const { nextDetectedState } = await import('../../src/configpanel/hooks/useDetected.js');

    const rows: DetectedRow[] = [
      { path: 'navigation.position', sources: ['gps1', 'gps2'], kind: 'position', optedIn: false },
    ];
    const prev = {
      paths: rows,
      lastChecked: 1000,
      loading: false,
      error: null,
    };

    const next = nextDetectedState(prev, { paths: rows });
    // Same payload: no state change, returns exact same object reference.
    expect(next).toBe(prev);
  });

  it('returns a new state object when the incoming payload differs', async () => {
    const { nextDetectedState } = await import('../../src/configpanel/hooks/useDetected.js');

    const rows: DetectedRow[] = [
      { path: 'navigation.position', sources: ['gps1', 'gps2'], kind: 'position', optedIn: false },
    ];
    const prev = {
      paths: rows,
      lastChecked: 1000,
      loading: false,
      error: null,
    };
    const newRows: DetectedRow[] = [
      ...rows,
      {
        path: 'environment.depth.belowKeel',
        sources: ['depth1', 'depth2'],
        kind: 'scalar',
        optedIn: false,
      },
    ];

    const next = nextDetectedState(prev, { paths: newRows });
    // Different payload: new state object with updated paths.
    expect(next).not.toBe(prev);
    expect(next.paths).toHaveLength(2);
    expect(next.error).toBeNull();
    expect(typeof next.lastChecked).toBe('number');
  });

  it('returns an error state when the incoming payload is null (network error)', async () => {
    const { nextDetectedState } = await import('../../src/configpanel/hooks/useDetected.js');

    const prev = {
      paths: [],
      lastChecked: null,
      loading: true,
      error: null,
    };

    const next = nextDetectedState(prev, null);
    expect(next).not.toBe(prev);
    expect(next.error).not.toBeNull();
    expect(next.loading).toBe(false);
  });

  it('returns the same state object on a repeated failure (no wasted re-render)', async () => {
    const { nextDetectedState } = await import('../../src/configpanel/hooks/useDetected.js');

    const prev = {
      paths: [],
      lastChecked: 5,
      loading: false,
      error: 'could not load detected paths',
    };

    expect(nextDetectedState(prev, null)).toBe(prev);
  });
});
