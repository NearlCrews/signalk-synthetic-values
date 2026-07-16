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
  refresh: () => Promise<boolean>;
}

function errorState(prev: DetectedState): DetectedState {
  return {
    paths: prev.paths,
    lastChecked: prev.lastChecked,
    loading: false,
    error: 'Could not load detected paths.',
  };
}

const DETECTED_KINDS: ReadonlyArray<DetectedRow['kind']> = [
  'scalar',
  'angular',
  'position',
  'attitude',
  'other',
  'unknown',
];

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isDetectedKind(value: unknown): value is DetectedRow['kind'] {
  return typeof value === 'string' && DETECTED_KINDS.includes(value as DetectedRow['kind']);
}

function isOptionalBoolean(value: unknown): value is boolean | undefined {
  return value === undefined || typeof value === 'boolean';
}

function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === 'string';
}

function isOptionalDuplicateGroups(value: unknown): value is string[][] | undefined {
  return (
    value === undefined || (Array.isArray(value) && value.every((group) => isStringArray(group)))
  );
}

function isDetectedRow(value: unknown): value is DetectedRow {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.path === 'string' &&
    row.path.trim() !== '' &&
    isStringArray(row.sources) &&
    isDetectedKind(row.kind) &&
    typeof row.optedIn === 'boolean' &&
    isOptionalBoolean(row.combinable) &&
    isOptionalBoolean(row.recommended) &&
    isOptionalString(row.advisory) &&
    isOptionalDuplicateGroups(row.duplicateGroups)
  );
}

export function isDetectedResponse(value: unknown): value is DetectedResponse {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const response = value as Record<string, unknown>;
  return Array.isArray(response.paths) && response.paths.every((row) => isDetectedRow(row));
}

export function isRecommendedCombinable(row: DetectedRow): boolean {
  return row.kind !== 'other' && row.combinable !== false && row.recommended !== false;
}

/**
 * Pure reducer: given the previous state and the parsed response (or null when
 * the fetch failed), compute the next state. Reuses the existing paths array
 * when the payload is unchanged, while still advancing lastChecked after
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
    return errorState(prev);
  }

  const { paths } = incoming;

  return {
    paths: jsonEqual(paths, prev.paths) ? prev.paths : paths,
    lastChecked: Date.now(),
    loading: false,
    error: null,
  };
}

/**
 * Polls `GET /api/detected` every 10 s while the admin tab is visible.
 * Pauses on hidden tabs and refreshes immediately on visibility restore.
 * Reuses unchanged path data so memoized rows do not re-render during idle
 * polls, while the lightweight last-checked status remains accurate.
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

  const doFetch = useCallback(async (): Promise<boolean> => {
    if (cancelled.current) return false;
    const seq = ++fetchSeq.current;
    const isStale = (): boolean => cancelled.current || seq !== fetchSeq.current;
    let data: DetectedResponse | null = null;
    try {
      const incoming = await fetchJson<unknown>('/detected');
      if (!isDetectedResponse(incoming)) throw new Error();
      data = incoming;
    } catch {
      if (isStale()) return false;
      setState((prev) => nextDetectedState(prev, null));
      return false;
    }
    if (isStale()) return false;

    setState((prev) => nextDetectedState(prev, data));
    return true;
  }, []);

  const refresh = useCallback(async (): Promise<boolean> => {
    if (cancelled.current) return false;
    setState((prev) => (prev.loading ? prev : { ...prev, loading: true }));
    return doFetch();
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
