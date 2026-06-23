import type * as React from 'react';
import { useCallback, useId, useRef, useState } from 'react';
import type { RawPathConfig } from '../../config.js';
import type { DetectedRow } from '../hooks/useDetected.js';
import { S } from '../styles.js';
import { DetectedPathRow } from './DetectedPathRow.js';

// ---------------------------------------------------------------------------
// Kinds that can be meaningfully combined. Mirrors the constant in
// usePanelConfig so that "Combine all" and the config hook agree on scope.
// ---------------------------------------------------------------------------
const COMBINABLE_KINDS = new Set(['position', 'angular', 'scalar', 'unknown']);

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
      style={{ color: 'var(--skn-ok)', flexShrink: 0 }}
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
      {loading && (
        <span style={S.textSmallMuted} aria-live="polite">
          checking...
        </span>
      )}
      <LastCheckedStamp lastChecked={lastChecked} />
      <button
        type="button"
        style={{ ...S.btnSecondarySm }}
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
  onUpdate: (path: string, patch: Partial<RawPathConfig>) => void;
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
  return (
    <div style={{ marginTop: 'var(--skn-space-2)' }}>
      <button
        type="button"
        style={S.disclosureToggle}
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={() => {
          setOpen((p) => !p);
        }}
      >
        <span aria-hidden="true">{open ? '▾' : '▸'}</span>
        <span>Detected but not combinable ({rows.length})</span>
      </button>
      {open ? (
        <div id={bodyId}>
          {rows.map((row) => {
            const cfg = configByPath.get(row.path);
            const optedIn = configByPath.has(row.path);
            return (
              <DetectedPathRow
                key={row.path}
                row={{ ...row, optedIn }}
                config={cfg}
                onAdd={onAdd}
                onRemove={onRemove}
                onUpdate={onUpdate}
              />
            );
          })}
        </div>
      ) : (
        <div id={bodyId} hidden />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Combine-all confirmation state
// ---------------------------------------------------------------------------
interface CombineAllBarProps {
  count: number;
  rows: DetectedRow[];
  onAddAll: (rows: DetectedRow[]) => void;
}

function CombineAllBar({ count, rows, onAddAll }: CombineAllBarProps): React.ReactElement | null {
  const [confirming, setConfirming] = useState(false);

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
          Combine {count} detected path{count !== 1 ? 's' : ''} with default settings? You can
          exclude individual sources afterward.
        </span>
        <button
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
      <button type="button" style={S.btnSecondary} onClick={handleRequest}>
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
  onUpdate: (path: string, patch: Partial<RawPathConfig>) => void;
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
 *   1. Not-yet-combined combinable rows, by source count descending.
 *   2. Combined rows (path is in configByPath).
 *   3. Non-combinable rows (kind === 'other'), collapsed under a disclosure.
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
  // Stable IDs for aria- relationships.
  const noncombinableBodyId = useId();
  const statusRegionId = useId();

  // Track the live-region announcement separately from render to allow the
  // browser time to process the DOM change before we update the live region.
  const prevCountRef = useRef<number | null>(null);
  const [announcement, setAnnouncement] = useState('');

  // Partition and sort rows.
  const combinableNotYetConfigured: DetectedRow[] = [];
  const combinedRows: DetectedRow[] = [];
  const nonCombinableRows: DetectedRow[] = [];

  for (const row of detected) {
    const optedIn = configByPath.has(row.path);
    if (!COMBINABLE_KINDS.has(row.kind)) {
      nonCombinableRows.push(row);
    } else if (optedIn) {
      combinedRows.push(row);
    } else {
      combinableNotYetConfigured.push(row);
    }
  }

  // Sort not-yet-combined combinable rows by source count descending.
  combinableNotYetConfigured.sort((a, b) => b.sources.length - a.sources.length);

  // Total count for the live-region announcement.
  const totalCount = detected.length;
  if (prevCountRef.current !== null && prevCountRef.current !== totalCount) {
    setAnnouncement(`${totalCount} path${totalCount !== 1 ? 's' : ''} detected.`);
  }
  prevCountRef.current = totalCount;

  return (
    <div>
      {/* Polite live region for screen-reader announcements after refresh and add/remove. */}
      <span
        id={statusRegionId}
        role="status"
        aria-live="polite"
        aria-atomic="true"
        style={S.visuallyHidden}
      >
        {announcement}
      </span>

      <ListHeader lastChecked={lastChecked} loading={loading} onRefresh={onRefresh} />

      {error !== null ? (
        <ErrorBanner error={error} onRefresh={onRefresh} />
      ) : detected.length === 0 && !loading ? (
        <EmptyState />
      ) : (
        <>
          {/* Combine all bar: only counts combinable, not-yet-configured rows. */}
          <CombineAllBar
            count={combinableNotYetConfigured.length}
            rows={combinableNotYetConfigured}
            onAddAll={onAddAll}
          />

          {/* Not-yet-combined combinable rows first, most sources at top. */}
          {combinableNotYetConfigured.map((row) => (
            <DetectedPathRow
              key={row.path}
              row={{ ...row, optedIn: false }}
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
                row={{ ...row, optedIn: true }}
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
      )}
    </div>
  );
}
