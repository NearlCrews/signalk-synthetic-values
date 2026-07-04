import type * as React from 'react';
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { RawPathConfig, RawPathConfigPatch } from '../../config.js';
import { plural } from '../../textFormat.js';
import type { DetectedRow } from '../hooks/useDetected.js';
import { S } from '../styles.js';
import { DetectedPathRow } from './DetectedPathRow.js';
import { Disclosure } from './Disclosure.js';

// ---------------------------------------------------------------------------
// Funnel glyph: an inline SVG in currentColor so it recolors per theme
// (including red at night). One header glyph only.
// ---------------------------------------------------------------------------
function FunnelIcon(): React.ReactElement {
  return (
    <svg
      aria-hidden="true"
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="currentColor"
      style={{ color: 'var(--skn-text-muted)', flexShrink: 0 }}
    >
      <path d="M1.5 1.5A.5.5 0 0 1 2 1h12a.5.5 0 0 1 .39.813L9.5 9.18V13.5a.5.5 0 0 1-.277.447l-3 1.5A.5.5 0 0 1 5.5 15V9.18L1.61 2.313A.5.5 0 0 1 1.5 1.5z" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Relative last-checked stamp
// ---------------------------------------------------------------------------
function LastCheckedStamp({ lastChecked }: { lastChecked: number | null }): React.ReactElement {
  if (lastChecked === null) {
    return <span style={S.textSmallFaint}>never checked</span>;
  }
  const diffMs = Date.now() - lastChecked;
  const diffS = Math.round(diffMs / 1000);
  let label: string;
  if (diffS < 5) {
    label = 'just now';
  } else if (diffS < 60) {
    label = `${diffS}s ago`;
  } else {
    const diffM = Math.round(diffS / 60);
    label = `${diffM}m ago`;
  }
  return <span style={S.textSmallFaint}>last checked {label}</span>;
}

// ---------------------------------------------------------------------------
// Header row: funnel glyph + title + last-checked stamp + Refresh button
// ---------------------------------------------------------------------------
interface HeaderProps {
  lastChecked: number | null;
  loading: boolean;
  onRefresh: () => void;
}

function ListHeader({ lastChecked, loading, onRefresh }: HeaderProps): React.ReactElement {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: 'var(--skn-space-1)',
        marginBottom: 'var(--skn-space-2)',
      }}
    >
      <FunnelIcon />
      <h2
        style={{
          ...S.cardTitle,
          flex: 1,
          margin: 0,
          fontSize: 'var(--skn-font-title)',
        }}
      >
        Detected multi-source paths
      </h2>
      {loading && <span style={S.textSmallMuted}>checking...</span>}
      <LastCheckedStamp lastChecked={lastChecked} />
      <button
        type="button"
        style={S.btnSecondarySm}
        onClick={onRefresh}
        aria-label="Refresh detected paths"
      >
        Refresh
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Empty state (first run)
// ---------------------------------------------------------------------------
function EmptyState(): React.ReactElement {
  return (
    <div
      style={{
        padding: 'var(--skn-space-3)',
        textAlign: 'center',
        color: 'var(--skn-text-muted)',
        fontSize: 'var(--skn-font-body)',
      }}
    >
      No duplicate paths detected yet. This plugin watches your live data for paths reported by two
      or more sources. Leave your instruments running for a minute, then refresh.
    </div>
  );
}

// ---------------------------------------------------------------------------
// Error banner
// ---------------------------------------------------------------------------
interface ErrorBannerProps {
  error: string;
  onRefresh: () => void;
}

function ErrorBanner({ error, onRefresh }: ErrorBannerProps): React.ReactElement {
  return (
    <div style={S.errorBanner} role="alert">
      <span style={{ flex: 1 }}>{error}</span>
      <button type="button" style={S.btnRetry} onClick={onRefresh}>
        Retry
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Non-combinable disclosure group
// ---------------------------------------------------------------------------
interface NonCombinableGroupProps {
  rows: DetectedRow[];
  configByPath: Map<string, RawPathConfig>;
  onAdd: (path: string) => void;
  onRemove: (path: string) => void;
  onUpdate: (path: string, patch: RawPathConfigPatch) => void;
  bodyId: string;
}

function NonCombinableGroup({
  rows,
  configByPath,
  onAdd,
  onRemove,
  onUpdate,
  bodyId,
}: NonCombinableGroupProps): React.ReactElement | null {
  const [open, setOpen] = useState(false);
  if (rows.length === 0) return null;
  // Focus-return on collapse: this top-level group disclosure does not need
  // focus-return logic because the toggle button remains visible and focused
  // throughout; it is never unmounted or moved when the group collapses, so
  // the browser naturally leaves focus on the button.
  return (
    <div style={{ marginTop: 'var(--skn-space-2)' }}>
      <Disclosure
        label={`Detected but not recommended (${rows.length})`}
        bodyId={bodyId}
        open={open}
        onToggle={() => {
          setOpen((p) => !p);
        }}
      >
        {rows.map((row) => {
          const cfg = configByPath.get(row.path);
          return (
            <DetectedPathRow
              key={row.path}
              row={row}
              optedIn={configByPath.has(row.path)}
              config={cfg}
              onAdd={onAdd}
              onRemove={onRemove}
              onUpdate={onUpdate}
            />
          );
        })}
      </Disclosure>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Combine-all confirmation state
// ---------------------------------------------------------------------------
interface CombineAllBarProps {
  rows: DetectedRow[];
  onAddAll: (rows: DetectedRow[]) => void;
}

function CombineAllBar({ rows, onAddAll }: CombineAllBarProps): React.ReactElement | null {
  const count = rows.length;
  const [confirming, setConfirming] = useState(false);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const requestRef = useRef<HTMLButtonElement>(null);
  const wasConfirming = useRef(false);

  // Focus management: the state swap unmounts the focused button, which would
  // drop focus to <body>. Move focus onto Confirm when the confirmation
  // appears and back onto the request button when it goes away.
  useEffect(() => {
    if (confirming) confirmRef.current?.focus();
    else if (wasConfirming.current) requestRef.current?.focus();
    wasConfirming.current = confirming;
  }, [confirming]);

  const handleRequest = useCallback(() => {
    setConfirming(true);
  }, []);

  const handleConfirm = useCallback(() => {
    setConfirming(false);
    onAddAll(rows);
  }, [onAddAll, rows]);

  const handleCancel = useCallback(() => {
    setConfirming(false);
  }, []);

  if (count === 0) return null;

  if (confirming) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 'var(--skn-space-1)',
          padding: 'var(--skn-space-1) 0',
          marginBottom: 'var(--skn-space-1)',
        }}
      >
        <span style={{ fontSize: 'var(--skn-font-body)', color: 'var(--skn-text)' }}>
          Combine {count} detected path{plural(count)} with default settings? You can exclude
          individual sources afterward.
        </span>
        <button
          ref={confirmRef}
          type="button"
          style={S.btnPrimary}
          onClick={handleConfirm}
          aria-label="Confirm combine all"
        >
          Confirm
        </button>
        <button type="button" style={S.btnSecondary} onClick={handleCancel}>
          Cancel
        </button>
      </div>
    );
  }

  return (
    <div style={{ marginBottom: 'var(--skn-space-1)' }}>
      <button ref={requestRef} type="button" style={S.btnSecondary} onClick={handleRequest}>
        Combine all ({count})
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface DetectedPathListProps {
  detected: DetectedRow[];
  /** Local form-state config entries keyed by path. A path present here is opted in. */
  configByPath: Map<string, RawPathConfig>;
  onAdd: (path: string) => void;
  /** Called with the exact slice of combinable, not-yet-configured rows to add. */
  onAddAll: (rows: DetectedRow[]) => void;
  onRemove: (path: string) => void;
  onUpdate: (path: string, patch: RawPathConfigPatch) => void;
  lastChecked: number | null;
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
}

// ---------------------------------------------------------------------------
// DetectedPathList
// ---------------------------------------------------------------------------

/**
 * Container for the detected multi-source paths list. Manages header, states,
 * sort, the non-combinable disclosure group, the "Combine all" bar, and the
 * live-region announcement.
 *
 * Sort order (per spec 5.3):
 *   1. Not-yet-combined recommended rows, by source count descending.
 *   2. Combined rows (path is in configByPath).
 *   3. Not-recommended rows (text values and GNSS fix metadata), collapsed
 *      under a disclosure.
 *
 * optedIn consistency rule: a row is opted-in when its path is in configByPath,
 * regardless of the server-side `row.optedIn` field, to avoid post-save flicker.
 */
export function DetectedPathList({
  detected,
  configByPath,
  onAdd,
  onAddAll,
  onRemove,
  onUpdate,
  lastChecked,
  loading,
  error,
  onRefresh,
}: DetectedPathListProps): React.ReactElement {
  // Stable ID for the non-combinable disclosure body.
  const noncombinableBodyId = useId();

  // Live-region announcement: update after commit (not during render) to avoid
  // a render-phase setState. prevCountRef tracks the last announced count so we
  // skip the first paint and only announce when the count actually changes.
  const prevCountRef = useRef<number | null>(null);
  const [announcement, setAnnouncement] = useState('');

  // Partition and sort rows. Memoized so unrelated re-renders (an announcement
  // tick) do not re-bucket the whole list.
  const { combinableNotYetConfigured, combinedRows, nonCombinableRows } = useMemo(() => {
    const notYet: DetectedRow[] = [];
    const combined: DetectedRow[] = [];
    const notRecommended: DetectedRow[] = [];
    for (const row of detected) {
      if (row.recommended === false || row.kind === 'other') notRecommended.push(row);
      else if (configByPath.has(row.path)) combined.push(row);
      else notYet.push(row);
    }
    // Not-yet-combined recommended rows sort by source count descending.
    notYet.sort((a, b) => b.sources.length - a.sources.length);
    return {
      combinableNotYetConfigured: notYet,
      combinedRows: combined,
      nonCombinableRows: notRecommended,
    };
  }, [detected, configByPath]);

  // Total count for the live-region announcement.
  const totalCount = detected.length;

  // Manual refresh flag: a user-triggered Refresh announces its completion
  // even when the list is unchanged, so screen readers get feedback for the
  // click. Interval polls only announce when the count actually changes.
  const manualRefresh = useRef(false);
  const handleRefresh = useCallback((): void => {
    manualRefresh.current = true;
    onRefresh();
  }, [onRefresh]);

  // Announce after commit so the live region update lands after the DOM is
  // stable (safe setState from useEffect, not from the render body).
  useEffect(() => {
    if (manualRefresh.current && lastChecked !== null) {
      manualRefresh.current = false;
      setAnnouncement(`Refreshed: ${totalCount} path${plural(totalCount)} detected.`);
    } else if (prevCountRef.current !== null && prevCountRef.current !== totalCount) {
      setAnnouncement(`${totalCount} path${plural(totalCount)} detected.`);
    }
    prevCountRef.current = totalCount;
  }, [totalCount, lastChecked]);

  return (
    <div>
      {/* Polite live region for screen-reader announcements after refresh and add/remove. */}
      <span role="status" aria-live="polite" aria-atomic="true" style={S.visuallyHidden}>
        {announcement}
      </span>

      <ListHeader lastChecked={lastChecked} loading={loading} onRefresh={handleRefresh} />

      {/* A failed poll keeps the previous rows (useDetected preserves them), so
          the banner renders ABOVE the retained list. Swapping the list out for
          the banner would unmount every row and lose open Tune disclosures,
          in-progress edits, and focus on a transient blip. */}
      {error !== null && <ErrorBanner error={error} onRefresh={handleRefresh} />}

      {detected.length > 0 ? (
        <>
          {/* Combine all bar: only the recommended, not-yet-configured rows. */}
          <CombineAllBar rows={combinableNotYetConfigured} onAddAll={onAddAll} />

          {/* Not-yet-combined combinable rows first, most sources at top. */}
          {combinableNotYetConfigured.map((row) => (
            <DetectedPathRow
              key={row.path}
              row={row}
              optedIn={false}
              config={undefined}
              onAdd={onAdd}
              onRemove={onRemove}
              onUpdate={onUpdate}
            />
          ))}

          {/* Combined rows next. */}
          {combinedRows.map((row) => {
            const cfg = configByPath.get(row.path);
            return (
              <DetectedPathRow
                key={row.path}
                row={row}
                optedIn={true}
                config={cfg}
                onAdd={onAdd}
                onRemove={onRemove}
                onUpdate={onUpdate}
              />
            );
          })}

          {/* Non-combinable rows collapsed under a disclosure. */}
          <NonCombinableGroup
            rows={nonCombinableRows}
            configByPath={configByPath}
            onAdd={onAdd}
            onRemove={onRemove}
            onUpdate={onUpdate}
            bodyId={noncombinableBodyId}
          />
        </>
      ) : (
        error === null && !loading && <EmptyState />
      )}
    </div>
  );
}
