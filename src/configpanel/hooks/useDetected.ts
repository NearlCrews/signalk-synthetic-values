import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchJson } from '../api-base.js';

// 10 s poll: the detected list changes only when new sources come online,
// so anything faster wastes CPU on Pi-class SK servers.
export const POLL_MS = 10_000;

export interface DetectedRow {
  path: string;
  sources: string[];
  kind: string;
  optedIn: boolean;
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

/**
 * Pure reducer: given the previous state and the new raw payload string
 * (or null on error), compute the next state. Returns the exact same object
 * reference when the payload is unchanged so callers can use a reference
 * equality check to skip React state updates.
 *
 * Exported for direct unit testing without a DOM renderer.
 */
export function nextDetectedState(prev: DetectedState, incoming: string | null): DetectedState {
  if (incoming === null) {
    return {
      paths: prev.paths,
      lastChecked: prev.lastChecked,
      loading: false,
      error: 'invalid JSON in detected response',
    };
  }

  // Changed-payload gate: return the same object when nothing changed.
  const prevSerialized = JSON.stringify({ paths: prev.paths });
  if (incoming === prevSerialized && !prev.loading && prev.error === null) {
    return prev;
  }

  let parsed: DetectedResponse;
  try {
    parsed = JSON.parse(incoming) as DetectedResponse;
  } catch {
    return {
      paths: prev.paths,
      lastChecked: prev.lastChecked,
      loading: false,
      error: 'invalid JSON in detected response',
    };
  }

  return {
    paths: parsed.paths ?? [],
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
  // The last serialized payload for the changed-payload gate.
  const lastPayloadRef = useRef<string | null>(null);
  const cancelled = useRef(false);
  const stateRef = useRef(state);
  stateRef.current = state;

  const doFetch = useCallback(async (): Promise<void> => {
    let incoming: string | null = null;
    try {
      const data = await fetchJson<DetectedResponse>('/detected');
      incoming = JSON.stringify(data);
    } catch {
      if (cancelled.current) return;
      setState((prev) => nextDetectedState(prev, null));
      return;
    }
    if (cancelled.current) return;

    // Only update state when the payload actually changed.
    if (
      incoming !== lastPayloadRef.current ||
      stateRef.current.loading ||
      stateRef.current.error !== null
    ) {
      lastPayloadRef.current = incoming;
      setState((prev) => nextDetectedState(prev, incoming));
    }
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
