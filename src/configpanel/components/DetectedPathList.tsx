import type * as React from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Banner,
  Button,
  Cluster,
  CollapsibleSection,
  FreshnessNote,
  formatCount,
  InlineConfirm,
  RELATIVE_AGE_EN,
  Section,
  Stack,
  usePanelAnnouncer,
  usePollFreshness,
} from 'signalk-nearlcrews-ui';
import { EmptyState } from 'signalk-nearlcrews-ui/composites';
import type { RawPathConfig, RawPathConfigPatch } from '../../config.js';
import { type DetectedRow, POLL_MS } from '../hooks/useDetected.js';
import styles from './DetectedPathList.module.css';
import { DetectedPathRow } from './DetectedPathRow.js';

// Three missed polls before the list reads as out of date: one slow response
// is not news, a list that has stopped updating is.
const STALE_AFTER_MS = 3 * POLL_MS;

// A configured path that no live source has reported yet still gets a row, so
// it can be tuned or removed. One object per path, kept across renders, so the
// memoized row does not re-render on every keystroke elsewhere in the panel.
function waitingRow(path: string): DetectedRow {
  return {
    path,
    sources: [],
    freshSources: [],
    kind: 'unknown',
    optedIn: true,
    combinable: true,
    recommended: true,
    duplicateGroups: [],
    advisory: 'Waiting for live sources to report this configured path.',
  };
}

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

interface LastCheckedNoteProps {
  lastChecked: number | null;
  pollingSince: number | null;
}

function LastCheckedNote({ lastChecked, pollingSince }: LastCheckedNoteProps): React.ReactElement {
  // The poll pauses while the tab is hidden, so staleness counts from the later
  // of the last check and the moment polling resumed: time spent away from the
  // tab is not the list falling behind, and must not be announced as if it were.
  const reference =
    lastChecked === null || pollingSince === null
      ? lastChecked
      : Math.max(lastChecked, pollingSince);
  const { stale } = usePollFreshness(reference, { staleAfterMs: STALE_AFTER_MS });
  // The note stays on one line so the header actions wrap it whole. Every
  // other string in this panel is English, so the age does not follow the
  // browser locale: "checked hace 5 minutos" would read as a defect, and the
  // pin also keeps the browser assertions independent of the runner.
  return (
    <FreshnessNote
      className={styles.freshness}
      options={RELATIVE_AGE_EN}
      since={lastChecked}
      stale={pollingSince !== null && stale}
    />
  );
}

interface HeaderActionsProps extends LastCheckedNoteProps {
  loading: boolean;
  onRefresh: () => void;
}

function HeaderActions({
  lastChecked,
  pollingSince,
  loading,
  onRefresh,
}: HeaderActionsProps): React.ReactElement {
  return (
    <Cluster gap={2} justify="end">
      <LastCheckedNote lastChecked={lastChecked} pollingSince={pollingSince} />
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

interface RowListProps {
  rows: DetectedRow[];
  configByPath: Map<string, RawPathConfig>;
  onAdd: (path: string) => void;
  onRemove: (path: string) => void;
  onUpdate: (path: string, patch: RawPathConfigPatch) => void;
}

/**
 * A run of detected rows. Whether a row is opted in is the presence of its
 * saved config, so every list asks the same question of the same map rather
 * than each caller asserting an answer it happens to know.
 */
function RowList({
  rows,
  configByPath,
  onAdd,
  onRemove,
  onUpdate,
}: RowListProps): React.ReactElement {
  return (
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
  );
}

function NotRecommendedGroup(props: RowListProps): React.ReactElement | null {
  const [open, setOpen] = useState(false);
  if (props.rows.length === 0) return null;

  return (
    <CollapsibleSection
      headingLevel={4}
      mountStrategy="lazy-retain"
      title={`Detected but not recommended (${props.rows.length})`}
      open={open}
      onOpenChange={setOpen}
    >
      <RowList {...props} />
    </CollapsibleSection>
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
        <Button
          ariaDisabled={confirming}
          disabledReason="Answer the question below first."
          onClick={() => setConfirming(true)}
        >
          Combine all ({count})
        </Button>
      </Cluster>
      <InlineConfirm
        confirmLabel={`Combine ${formatCount(count, 'path')}`}
        confirmVariant="primary"
        message="Each path starts with default settings. You can exclude individual sources afterward."
        onCancel={() => setConfirming(false)}
        onConfirm={handleConfirm}
        open={confirming}
        title={`Combine all ${formatCount(count, 'detected path')}?`}
      />
    </Stack>
  );
}

export interface DetectedPathListProps {
  detected: DetectedRow[];
  configByPath: Map<string, RawPathConfig>;
  headingRef: React.RefObject<HTMLSpanElement | null>;
  onAdd: (path: string) => void;
  onAddAll: (rows: DetectedRow[]) => void;
  onRemove: (path: string) => void;
  onUpdate: (path: string, patch: RawPathConfigPatch) => void;
  lastChecked: number | null;
  /** When the detection poll last started, or null while it is paused. */
  pollingSince: number | null;
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
  pollingSince,
  loading,
  error,
  onRefresh,
}: DetectedPathListProps): React.ReactElement {
  const announce = usePanelAnnouncer();
  const prevCountRef = useRef<number | null>(null);

  // Combine and Remove swap the same button in place, so its label changes
  // under the pointer or the caret with nothing else to say what happened.
  const handleAdd = useCallback(
    (path: string): void => {
      announce(`Combining ${path}.`);
      onAdd(path);
    },
    [announce, onAdd]
  );
  const handleRemove = useCallback(
    (path: string): void => {
      announce(`Removed ${path}.`);
      onRemove(path);
    },
    [announce, onRemove]
  );

  const waitingRows = useRef(new Map<string, DetectedRow>());
  const rows = useMemo(() => {
    const merged = [...detected];
    const livePaths = new Set(detected.map((row) => row.path));
    const cache = waitingRows.current;
    for (const path of configByPath.keys()) {
      if (livePaths.has(path)) continue;
      let row = cache.get(path);
      if (row === undefined) {
        row = waitingRow(path);
        cache.set(path, row);
      }
      merged.push(row);
    }
    return merged;
  }, [detected, configByPath]);

  const { combinableNotYetConfigured, orderedRows, notRecommendedRows } = useMemo(() => {
    const notYet: DetectedRow[] = [];
    const combined: DetectedRow[] = [];
    const notRecommended: DetectedRow[] = [];
    for (const row of rows) {
      if (!row.recommended) notRecommended.push(row);
      else if (configByPath.has(row.path)) combined.push(row);
      else notYet.push(row);
    }
    notYet.sort((a, b) => b.sources.length - a.sources.length);
    return {
      combinableNotYetConfigured: notYet,
      // Paths waiting to be combined lead, then the ones already combining.
      orderedRows: [...notYet, ...combined],
      notRecommendedRows: notRecommended,
    };
  }, [rows, configByPath]);

  const totalCount = detected.length;
  // Retry lives inside the error banner, and a successful refresh unmounts the
  // banner with the pressed button inside it. Send focus to the section heading
  // the way the Combine all confirmation does, so it never lands on the body.
  const errorRef = useRef(error);
  errorRef.current = error;
  const handleRefresh = useCallback((): void => {
    const hadError = errorRef.current !== null;
    // A refresh never rejects: a failed one resolves false.
    void onRefresh().then((succeeded) => {
      if (!succeeded) return;
      announce(hadError ? 'Detected paths loaded.' : 'Detected paths refreshed.');
      if (hadError) {
        queueMicrotask(() => headingRef.current?.focus());
      }
    });
  }, [announce, headingRef, onRefresh]);

  useEffect(() => {
    if (prevCountRef.current !== null && prevCountRef.current !== totalCount) {
      announce(`${formatCount(totalCount, 'path')} detected.`);
    }
    prevCountRef.current = totalCount;
  }, [announce, totalCount]);

  return (
    <Section
      headingLevel={3}
      actions={
        <HeaderActions
          lastChecked={lastChecked}
          pollingSince={pollingSince}
          loading={loading}
          onRefresh={handleRefresh}
        />
      }
      title={
        <span ref={headingRef} className={styles.heading} tabIndex={-1}>
          <FunnelIcon />
          <span>Detected multi-source paths</span>
        </span>
      }
    >
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
            completionFocusRef={headingRef}
            onAddAll={onAddAll}
          />

          <RowList
            rows={orderedRows}
            configByPath={configByPath}
            onAdd={handleAdd}
            onRemove={handleRemove}
            onUpdate={onUpdate}
          />

          <NotRecommendedGroup
            rows={notRecommendedRows}
            configByPath={configByPath}
            onAdd={handleAdd}
            onRemove={handleRemove}
            onUpdate={onUpdate}
          />
        </Stack>
      ) : error === null ? (
        // The first poll used to render nothing at all, so a busy server showed
        // an empty section with only the header spinner. Later polls keep the
        // rows already on screen, so this only ever fills the opening gap.
        <EmptyState
          title={
            lastChecked === null
              ? 'Checking for multi-source paths'
              : 'No duplicate paths detected yet'
          }
          description="This plugin watches your live data for paths reported by two or more sources. Leave your instruments running for a minute, then refresh."
          action={
            lastChecked === null ? undefined : (
              <Button loading={loading} loadingLabel="Refreshing" onClick={handleRefresh}>
                Refresh
              </Button>
            )
          }
        />
      ) : null}
    </Section>
  );
}
