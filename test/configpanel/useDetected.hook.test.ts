// @vitest-environment jsdom
// Hook-level tests for useDetected: interval polling, unmount cleanup, and
// out-of-order response protection. The pure reducer is covered in
// useDetected.test.ts.
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DetectedRow } from '../../src/configpanel/hooks/useDetected.js';
import { POLL_MS, useDetected } from '../../src/configpanel/hooks/useDetected.js';

function row(path: string): DetectedRow {
  return { path, sources: ['a', 'b'], kind: 'scalar', optedIn: false };
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200 });
}

describe('useDetected hook', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('fetches on mount, polls on the interval, and stops after unmount', async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockImplementation(() => Promise.resolve(jsonResponse({ paths: [] })));

    const { unmount } = renderHook(() => useDetected());
    expect(mockFetch).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_MS);
    });
    expect(mockFetch).toHaveBeenCalledTimes(2);

    unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_MS * 3);
    });
    // The cleanup cleared the interval: no further fetches.
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('a slow stale response cannot overwrite a newer one', async () => {
    const mockFetch = vi.mocked(fetch);
    let resolveSlow: (r: Response) => void = () => {};
    const slow = new Promise<Response>((resolve) => {
      resolveSlow = resolve;
    });
    // Mount fetch hangs; the manual refresh resolves immediately with newer data.
    mockFetch
      .mockReturnValueOnce(slow)
      .mockReturnValueOnce(Promise.resolve(jsonResponse({ paths: [row('new.path')] })));

    const { result } = renderHook(() => useDetected());
    act(() => {
      void result.current.refresh();
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.paths.map((p) => p.path)).toEqual(['new.path']);

    // The stale first response lands late with older (empty) data: it must be
    // dropped by the fetch sequence guard, not clobber the newer state.
    resolveSlow(jsonResponse({ paths: [] }));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(result.current.paths.map((p) => p.path)).toEqual(['new.path']);
  });

  it('shows loading during a manual refresh and clears it after success', async () => {
    const mockFetch = vi.mocked(fetch);
    let resolveRefresh: (response: Response) => void = () => {};
    const refreshResponse = new Promise<Response>((resolve) => {
      resolveRefresh = resolve;
    });
    mockFetch
      .mockResolvedValueOnce(jsonResponse({ paths: [] }))
      .mockReturnValueOnce(refreshResponse);

    const { result } = renderHook(() => useDetected());
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(result.current.loading).toBe(false);

    let refreshPromise: Promise<boolean> | undefined;
    act(() => {
      refreshPromise = result.current.refresh();
    });
    expect(result.current.loading).toBe(true);

    resolveRefresh(jsonResponse({ paths: [row('refreshed.path')] }));
    await act(async () => {
      await refreshPromise;
    });
    expect(result.current.loading).toBe(false);
    expect(result.current.paths.map((item) => item.path)).toEqual(['refreshed.path']);
  });

  it('retains previous rows and surfaces an error for a malformed payload', async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch
      .mockResolvedValueOnce(jsonResponse({ paths: [row('healthy.path')] }))
      .mockResolvedValueOnce(jsonResponse({ paths: 'invalid' }));

    const { result } = renderHook(() => useDetected());
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(result.current.paths.map((item) => item.path)).toEqual(['healthy.path']);

    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.paths.map((item) => item.path)).toEqual(['healthy.path']);
    expect(result.current.error).toBe('Could not load detected paths.');
  });

  it('does not start a refresh after unmount', async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockResolvedValue(jsonResponse({ paths: [] }));

    const { result, unmount } = renderHook(() => useDetected());
    const refresh = result.current.refresh;
    unmount();

    await expect(refresh()).resolves.toBe(false);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});
