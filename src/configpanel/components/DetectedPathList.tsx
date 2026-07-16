import type * as React from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Banner,
  Button,
  Cluster,
  Disclosure,
  InlineConfirm,
  Section,
  Stack,
} from 'signalk-nearlcrews-ui';
import type { RawPathConfig, RawPathConfigPatch } from '../../config.js';
import { plural } from '../../textFormat.js';
import { type DetectedRow, isRecommendedCombinable } from '../hooks/useDetected.js';
import utilities from '../utilities.module.css';
import styles from './DetectedPathList.module.css';
import { DetectedPathRow } from './DetectedPathRow.js';

function FunnelIcon(): React.ReactElement {
  return (
    <svg
      aria-hidden="true"
      className={styles.funnel}
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="currentColor"
    >
      <path d="M1.5 1.5A.5.5 0 0 1 2 1h12a.5.5 0 0 1 .39.813L9.5 9.18V13.5a.5.5 0 0 1-.277.447l-3 1.5A.5.5 0 0 1 5.5 15V9.18L1.61 2.313A.5.5 0 0 1 1.5 1.5z" />
    </svg>
  );
}

function LastCheckedStamp({ lastChecked }: { lastChecked: number | null }): React.ReactElement {
  if (lastChecked === null) {
    return <span className={styles.timestamp}>never checked</span>;
  }
  const diffSeconds = Math.round((Date.now() - lastChecked) / 1000);
  const label =
    diffSeconds < 5
      ? 'just now'
      : diffSeconds < 60
        ? `${diffSeconds}s ago`
        : `${Math.round(diffSeconds / 60)}m ago`;
  return <span className={styles.timestamp}>last checked {label}</span>;
}

interface HeaderActionsProps {
  lastChecked: number | null;
  loading: boolean;
  onRefresh: () => void;
}

function HeaderActions({
  lastChecked,
  loading,
  onRefresh,
}: HeaderActionsProps): React.ReactElement {
  return (
    <Cluster gap={2} justify="end">
      <LastCheckedStamp lastChecked={lastChecked} />
      <Button
        size="compact"
        aria-label="Refresh detected paths"
        loading={loading}
        loadingLabel={lastChecked === null ? 'Checking' : 'Refreshing'}
        onClick={onRefresh}
      >
        Refresh
      </Button>
    </Cluster>
  );
}

interface NotRecommendedGroupProps {
  rows: DetectedRow[];
  configByPath: Map<string, RawPathConfig>;
  onAdd: (path: string) => void;
  onRemove: (path: string) => void;
  onUpdate: (path: string, patch: RawPathConfigPatch) => void;
}

function NotRecommendedGroup({
  rows,
  configByPath,
  onAdd,
  onRemove,
  onUpdate,
}: NotRecommendedGroupProps): React.ReactElement | null {
  const [open, setOpen] = useState(false);
  if (rows.length === 0) return null;

  return (
    <Disclosure
      title={`Detected but not recommended (${rows.length})`}
      open={open}
      onOpenChange={setOpen}
    >
      <Stack gap={2}>
        {rows.map((row) => (
          <DetectedPathRow
            key={row.path}
            row={row}
            optedIn={configByPath.has(row.path)}
            config={configByPath.get(row.path)}
            onAdd={onAdd}
            onRemove={onRemove}
            onUpdate={onUpdate}
          />
        ))}
      </Stack>
    </Disclosure>
  );
}

interface CombineAllBarProps {
  rows: DetectedRow[];
  completionFocusRef: React.RefObject<HTMLElement | null>;
  onAddAll: (rows: DetectedRow[]) => void;
}

function CombineAllBar({
  rows,
  completionFocusRef,
  onAddAll,
}: CombineAllBarProps): React.ReactElement | null {
  const count = rows.length;
  const [confirming, setConfirming] = useState(false);

  const handleConfirm = useCallback(() => {
    setConfirming(false);
    onAddAll(rows);
    queueMicrotask(() => completionFocusRef.current?.focus());
  }, [completionFocusRef, onAddAll, rows]);

  if (count === 0) return null;

  return (
    <Stack gap={2}>
      <Cluster>
        <Button ariaDisabled={confirming} onClick={() => setConfirming(true)}>
          Combine all ({count})
        </Button>
      </Cluster>
      <InlineConfirm
        confirmLabel="Confirm"
        confirmVariant="primary"
        headingLevel={3}
        message={
          <>
            Combine {count} detected path{plural(count)} with default settings? You can exclude
            individual sources afterward.
          </>
        }
        onCancel={() => setConfirming(false)}
        onConfirm={handleConfirm}
        open={confirming}
        title="Combine all detected paths"
      />
    </Stack>
  );
}

export interface DetectedPathListProps {
  detected: DetectedRow[];
  configByPath: Map<string, RawPathConfig>;
  headingRef?: React.RefObject<HTMLSpanElement | null>;
  onAdd: (path: string) => void;
  onAddAll: (rows: DetectedRow[]) => void;
  onRemove: (path: string) => void;
  onUpdate: (path: string, patch: RawPathConfigPatch) => void;
  lastChecked: number | null;
  loading: boolean;
  error: string | null;
  onRefresh: () => Promise<boolean>;
}

export function DetectedPathList({
  detected,
  configByPath,
  headingRef,
  onAdd,
  onAddAll,
  onRemove,
  onUpdate,
  lastChecked,
  loading,
  error,
  onRefresh,
}: DetectedPathListProps): React.ReactElement {
  const internalHeadingRef = useRef<HTMLSpanElement>(null);
  const effectiveHeadingRef = headingRef ?? internalHeadingRef;
  const prevCountRef = useRef<number | null>(null);
  const [announcement, setAnnouncement] = useState('');

  const rows = useMemo(() => {
    const merged = [...detected];
    const livePaths = new Set(detected.map((row) => row.path));
    for (const path of configByPath.keys()) {
      if (!livePaths.has(path)) {
        merged.push({
          path,
          sources: [],
          kind: 'unknown',
          optedIn: true,
          combinable: true,
          recommended: true,
          advisory: 'Waiting for live sources to report this configured path.',
        });
      }
    }
    return merged;
  }, [detected, configByPath]);

  const { combinableNotYetConfigured, combinedRows, notRecommendedRows } = useMemo(() => {
    const notYet: DetectedRow[] = [];
    const combined: DetectedRow[] = [];
    const notRecommended: DetectedRow[] = [];
    for (const row of rows) {
      if (!isRecommendedCombinable(row)) notRecommended.push(row);
      else if (configByPath.has(row.path)) combined.push(row);
      else notYet.push(row);
    }
    notYet.sort((a, b) => b.sources.length - a.sources.length);
    return {
      combinableNotYetConfigured: notYet,
      combinedRows: combined,
      notRecommendedRows: notRecommended,
    };
  }, [rows, configByPath]);

  const totalCount = detected.length;
  const handleRefresh = useCallback((): void => {
    setAnnouncement('');
    void Promise.resolve(onRefresh())
      .then((succeeded) => {
        if (succeeded !== false) {
          setAnnouncement('Detected paths refreshed.');
        }
      })
      .catch(() => undefined);
  }, [onRefresh]);

  useEffect(() => {
    if (prevCountRef.current !== null && prevCountRef.current !== totalCount) {
      setAnnouncement(`${totalCount} path${plural(totalCount)} detected.`);
    }
    prevCountRef.current = totalCount;
  }, [totalCount]);

  return (
    <Section
      actions={
        <HeaderActions lastChecked={lastChecked} loading={loading} onRefresh={handleRefresh} />
      }
      title={
        <span ref={effectiveHeadingRef} className={styles.heading} tabIndex={-1}>
          <FunnelIcon />
          <span>Detected multi-source paths</span>
        </span>
      }
    >
      <span
        className={utilities.visuallyHidden}
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {announcement}
      </span>

      {error !== null ? (
        <Banner
          actions={
            <Button loading={loading} loadingLabel="Retrying" onClick={handleRefresh}>
              Retry
            </Button>
          }
          live="assertive"
          tone="danger"
        >
          {error}
        </Banner>
      ) : null}

      {rows.length > 0 ? (
        <Stack gap={3}>
          <CombineAllBar
            rows={combinableNotYetConfigured}
            completionFocusRef={effectiveHeadingRef}
            onAddAll={onAddAll}
          />

          <Stack gap={2}>
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

            {combinedRows.map((row) => (
              <DetectedPathRow
                key={row.path}
                row={row}
                optedIn={true}
                config={configByPath.get(row.path)}
                onAdd={onAdd}
                onRemove={onRemove}
                onUpdate={onUpdate}
              />
            ))}
          </Stack>

          <NotRecommendedGroup
            rows={notRecommendedRows}
            configByPath={configByPath}
            onAdd={onAdd}
            onRemove={onRemove}
            onUpdate={onUpdate}
          />
        </Stack>
      ) : error === null && !loading ? (
        <div className={styles.empty}>
          No duplicate paths detected yet. This plugin watches your live data for paths reported by
          two or more sources. Leave your instruments running for a minute, then refresh.
        </div>
      ) : null}
    </Section>
  );
}
