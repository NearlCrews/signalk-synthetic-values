import { useCallback, useEffect, useRef, useState } from 'react';
import type { DetectedRow } from '../../detected.js';
import { isRecord } from '../../guards.js';
import { type DetectedKind, KINDS } from '../../metrics.js';
import { fetchJson, jsonEqual } from '../api-base.js';

// The row shape is declared once beside the route that serves it, so a new wire
// field cannot reach the server and miss the panel.
export type { DetectedRow };

// 10 s poll: the detected list changes only when new sources come online,
// so anything faster wastes CPU on Pi-class SK servers.
export const POLL_MS = 10_000;

export interface DetectedResponse {
  paths: DetectedRow[];
}

export interface DetectedState {
  paths: DetectedRow[];
  lastChecked: number | null;
  loading: boolean;
  error: string | null;
}

export interface UseDetectedResult extends DetectedState {
  /** When polling last started, or null while the tab is hidden and it is paused. */
  pollingSince: number | null;
  refresh: () => Promise<boolean>;
}

const LOAD_ERROR = 'Could not load detected paths.';

// Built from the tuple the Kind type is derived from, and hashed once at module
// load because every row of every poll is checked against it.
const DETECTED_KINDS: ReadonlySet<string> = new Set<DetectedKind>([...KINDS, 'unknown']);

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isDetectedRow(value: unknown): value is DetectedRow {
  if (!isRecord(value)) return false;
  return (
    typeof value.path === 'string' &&
    value.path.trim() !== '' &&
    isStringArray(value.sources) &&
    isStringArray(value.freshSources) &&
    typeof value.kind === 'string' &&
    DETECTED_KINDS.has(value.kind) &&
    typeof value.optedIn === 'boolean' &&
    typeof value.combinable === 'boolean' &&
    typeof value.recommended === 'boolean' &&
    Array.isArray(value.duplicateGroups) &&
    value.duplicateGroups.every(isStringArray) &&
    (value.advisory === undefined || typeof value.advisory === 'string')
  );
}

export function isDetectedResponse(value: unknown): value is DetectedResponse {
  return isRecord(value) && Array.isArray(value.paths) && value.paths.every(isDetectedRow);
}

/**
 * Keep each unchanged row's previous object, so a memoized row re-renders only
 * when its own data moved, and keep the previous array when no row did.
 */
function reconcileRows(prev: DetectedRow[], next: DetectedRow[]): DetectedRow[] {
  const prevByPath = new Map(prev.map((row) => [row.path, row]));
  let unchanged = prev.length === next.length;
  const rows = next.map((row, i) => {
    const old = prevByPath.get(row.path);
    const kept = old !== undefined && jsonEqual(old, row) ? old : row;
    if (kept !== prev[i]) unchanged = false;
    return kept;
  });
  return unchanged ? prev : rows;
}

/**
 * Pure reducer: given the previous state and the parsed response (or null when
 * the fetch failed), compute the next state. Reuses unchanged rows, and the
 * whole array when nothing changed, while still advancing lastChecked after
 * every successful request.
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
    return { ...prev, loading: false, error: LOAD_ERROR };
  }
  return {
    paths: reconcileRows(prev.paths, incoming.paths),
    lastChecked: Date.now(),
    loading: false,
    error: null,
  };
}

/**
 * Polls `GET /api/detected` every 10 s while the admin tab is visible. A hidden
 * tab holds no timer at all; becoming visible fetches at once and restarts the
 * cadence. Reuses unchanged path data so memoized rows do not re-render during
 * idle polls, while the lightweight last-checked status remains accurate.
 */
export function useDetected(): UseDetectedResult {
  const [state, setState] = useState<DetectedState>({
    paths: [],
    lastChecked: null,
    loading: true,
    error: null,
  });
  // When polling last started, or null while the tab is hidden and it is paused.
  const [pollingSince, setPollingSince] = useState<number | null>(null);
  // Set on unmount, so neither a late response nor a refresh called afterward
  // touches state.
  const cancelled = useRef(false);
  // Monotonic fetch sequence: interval ticks, visibility restores, and manual
  // or post-action refreshes can overlap. A slower older response must not
  // overwrite the state a newer one already wrote.
  const fetchSeq = useRef(0);

  const doFetch = useCallback(async (): Promise<boolean> => {
    if (cancelled.current) return false;
    const seq = ++fetchSeq.current;
    let incoming: unknown = null;
    try {
      incoming = await fetchJson<unknown>('/detected');
    } catch {
      // A failed request reads the same as a malformed one: no response.
    }
    if (cancelled.current || seq !== fetchSeq.current) return false;
    const next = isDetectedResponse(incoming) ? incoming : null;
    setState((prev) => nextDetectedState(prev, next));
    return next !== null;
  }, []);

  const refresh = useCallback(async (): Promise<boolean> => {
    if (cancelled.current) return false;
    setState((prev) => (prev.loading ? prev : { ...prev, loading: true }));
    return doFetch();
  }, [doFetch]);

  useEffect(() => {
    cancelled.current = false;
    let timer: ReturnType<typeof setInterval> | undefined;
    const stopPolling = (): void => {
      clearInterval(timer);
      timer = undefined;
    };
    const syncToVisibility = (): void => {
      stopPolling();
      if (document.visibilityState !== 'visible') {
        setPollingSince(null);
        return;
      }
      setPollingSince(Date.now());
      void doFetch();
      timer = setInterval(() => void doFetch(), POLL_MS);
    };
    syncToVisibility();
    document.addEventListener('visibilitychange', syncToVisibility);

    return () => {
      cancelled.current = true;
      stopPolling();
      document.removeEventListener('visibilitychange', syncToVisibility);
    };
  }, [doFetch]);

  return { ...state, pollingSince, refresh };
}
