import { useCallback, useEffect, useRef, useState } from 'react';
import type { Kind } from '../../metrics.js';
import { fetchJson, jsonEqual } from '../api-base.js';

// 10 s poll: the detected list changes only when new sources come online,
// so anything faster wastes CPU on Pi-class SK servers.
export const POLL_MS = 10_000;

export interface DetectedRow {
  path: string;
  sources: string[];
  kind: Kind | 'unknown';
  optedIn: boolean;
  /** Whether the value can be averaged at all (false for text/objects). Defaults true when absent. */
  combinable?: boolean;
  /** Whether averaging is meaningful (false for GNSS fix metadata). Defaults true when absent. */
  recommended?: boolean;
  /** Reason shown in the panel when the path is not combinable or not recommended. */
  advisory?: string;
  /** Groups of sources reporting identical changing values: likely the same feed re-broadcast. */
  duplicateGroups?: string[][];
}

interface DetectedResponse {
  paths: DetectedRow[];
}

export interface DetectedState {
  paths: DetectedRow[];
  lastChecked: number | null;
  loading: boolean;
  error: string | null;
}

export interface UseDetectedResult extends DetectedState {
  refresh: () => void;
}

function errorState(prev: DetectedState): DetectedState {
  return {
    paths: prev.paths,
    lastChecked: prev.lastChecked,
    loading: false,
    error: 'could not load detected paths',
  };
}

/**
 * Pure reducer: given the previous state and the parsed response (or null when
 * the fetch failed), compute the next state. Returns the exact same object
 * reference when the paths are unchanged so callers can use a reference
 * equality check to skip React state updates.
 *
 * Takes the already-parsed response rather than a raw string: `fetchJson` has
 * parsed the body once already, so re-stringifying and re-parsing here would be
 * wasted work on every 10 s poll. Comparing `paths` (not the whole response)
 * means an added top-level field cannot defeat the change gate.
 *
 * Exported for direct unit testing without a DOM renderer.
 */
export function nextDetectedState(
  prev: DetectedState,
  incoming: DetectedResponse | null
): DetectedState {
  if (incoming === null) {
    // Repeat failures return the same object so React bails out of the
    // update; only the first failure after a success or initial load allocates.
    if (!prev.loading && prev.error !== null) return prev;
    return errorState(prev);
  }

  const paths = incoming.paths ?? [];

  if (!prev.loading && prev.error === null && jsonEqual(paths, prev.paths)) {
    return prev;
  }

  return {
    paths,
    lastChecked: Date.now(),
    loading: false,
    error: null,
  };
}

/**
 * Polls `GET /api/detected` every 10 s while the admin tab is visible.
 * Pauses on hidden tabs and refreshes immediately on visibility restore.
 * Uses the changed-payload gate from `nextDetectedState` so an idle panel
 * does no re-renders between polls.
 */
export function useDetected(): UseDetectedResult {
  const [state, setState] = useState<DetectedState>({
    paths: [],
    lastChecked: null,
    loading: true,
    error: null,
  });
  const cancelled = useRef(false);
  // Monotonic fetch sequence: interval ticks, visibility restores, and the
  // refresh fired after every save can overlap, and a slower older response
  // must not overwrite the state a newer one already wrote.
  const fetchSeq = useRef(0);

  const doFetch = useCallback(async (): Promise<void> => {
    const seq = ++fetchSeq.current;
    const isStale = (): boolean => cancelled.current || seq !== fetchSeq.current;
    let data: DetectedResponse | null = null;
    try {
      data = await fetchJson<DetectedResponse>('/detected');
    } catch {
      if (isStale()) return;
      setState((prev) => nextDetectedState(prev, null));
      return;
    }
    if (isStale()) return;

    // nextDetectedState returns the same reference when paths are unchanged, so
    // React bails out of the update: the changed-payload gate lives entirely in
    // the reducer, no separate payload ref needed.
    setState((prev) => nextDetectedState(prev, data));
  }, []);

  const refresh = useCallback((): void => {
    void doFetch();
  }, [doFetch]);

  useEffect(() => {
    cancelled.current = false;

    const tickIfVisible = (): void => {
      if (typeof document === 'undefined' || document.visibilityState === 'visible') {
        void doFetch();
      }
    };
    tickIfVisible();
    const id = setInterval(tickIfVisible, POLL_MS);

    const onVisibility = (): void => {
      if (document.visibilityState === 'visible') void doFetch();
    };
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', onVisibility);
    }

    return () => {
      cancelled.current = true;
      clearInterval(id);
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', onVisibility);
      }
    };
  }, [doFetch]);

  return { ...state, refresh };
}
