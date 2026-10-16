import type * as React from 'react';
import { memo, useCallback, useId, useMemo, useState } from 'react';
import {
  Badge,
  Button,
  Card,
  Cluster,
  Code,
  CollapsibleSection,
  formatCount,
  joinList,
  Stack,
  Text,
  VisuallyHidden,
} from 'signalk-nearlcrews-ui';
import { PLUGIN_ID, type RawPathConfig, type RawPathConfigPatch } from '../../config.js';
import type { DetectedRow } from '../hooks/useDetected.js';
import { useSourceSplit } from '../hooks/useSourceSplit.js';
import styles from './DetectedPathRow.module.css';
import { KindBadge } from './KindBadge.js';
import { PerPathSettings } from './PerPathSettings.js';
import { type SourceChip, SourceChips, sourceChips } from './SourceChips.js';

export interface DetectedPathRowProps {
  row: DetectedRow;
  optedIn: boolean;
  config: RawPathConfig | undefined;
  onAdd: (path: string) => void;
  onRemove: (path: string) => void;
  onUpdate: (path: string, patch: RawPathConfigPatch) => void;
}

function DuplicateSourcesHint({ groups }: { groups: string[][] }): React.ReactElement | null {
  // The route can report one group twice, so the render is keyed on the members
  // themselves. A delimiter join is the key: serializing every group buys
  // nothing a separator that cannot appear in a source name does.
  const unique = useMemo(
    () => [...new Map(groups.map((group) => [group.join('\u0000'), group]))],
    [groups]
  );
  if (unique.length === 0) return null;

  return (
    <Stack className={styles.subRow} gap={1}>
      {unique.map(([key, group]) => (
        <Text key={key} as="div" size="xs" tone="muted">
          {joinList(group)} look like one sensor reported under several names, either the same NMEA
          2000 device or identical changing values, so a combination counts them once.
        </Text>
      ))}
    </Stack>
  );
}

// A plain count carries no severity, so it takes the neutral tone. An `info`
// tone would draw the shared glyph and announce "Information." over what is
// only a number.
function SourceCountBadge({ live, total }: { live: number; total: number }): React.ReactElement {
  const label =
    live === total ? formatCount(total, 'source') : `${live} of ${total} sources combining`;
  return (
    <Badge>
      <span aria-hidden="true">{live === total ? total : `${live}/${total}`}</span>
      <VisuallyHidden>{label}</VisuallyHidden>
    </Badge>
  );
}

function PriorityInstruction({ path }: { path: string }): React.ReactElement {
  return (
    <Text as="div" className={styles.priorityInstruction} size="xs" tone="muted">
      Source priority required: rank <strong>{PLUGIN_ID}</strong> first in its group. Add a{' '}
      <a href={`#/data/priorities?path=${encodeURIComponent(path)}`}>
        path-level override
        <VisuallyHidden> for {path}</VisuallyHidden>
      </a>{' '}
      only if this path needs a different order.
    </Text>
  );
}

interface TuneSectionProps {
  row: DetectedRow;
  config: RawPathConfig;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUpdate: (patch: RawPathConfigPatch) => void;
  idPrefix: string;
}

function TuneSection({
  row,
  config,
  open,
  onOpenChange,
  onUpdate,
  idPrefix,
}: TuneSectionProps): React.ReactElement {
  return (
    <div className={styles.tune}>
      <CollapsibleSection
        headingLevel={4}
        mountStrategy="lazy-retain"
        open={open}
        onOpenChange={onOpenChange}
        title={
          <>
            Tune<VisuallyHidden> settings for {row.path}</VisuallyHidden>
          </>
        }
        variant="embedded"
      >
        <PerPathSettings row={row} config={config} onChange={onUpdate} idPrefix={idPrefix} />
      </CollapsibleSection>
    </div>
  );
}

interface PathActionProps {
  advisoryId: string | undefined;
  canCombine: boolean;
  optedIn: boolean;
  path: string;
  onAdd: () => void;
  onRemove: () => void;
}

function PathAction({
  advisoryId,
  canCombine,
  optedIn,
  path,
  onAdd,
  onRemove,
}: PathActionProps): React.ReactElement {
  if (optedIn) {
    return (
      <Button className={styles.action} aria-label={`Remove ${path}`} onClick={onRemove}>
        Remove
      </Button>
    );
  }

  return (
    // ariaDisabled rather than disabled: the button keeps its place in the tab
    // order, so the description explaining why it is unavailable is reachable,
    // and focus does not drop to the document body when a poll flips a path to
    // a non-combinable kind while the button is focused.
    <Button
      className={styles.action}
      variant="primary"
      ariaDisabled={!canCombine}
      aria-label={`Combine ${path}`}
      aria-describedby={advisoryId}
      onClick={onAdd}
    >
      Combine
    </Button>
  );
}

// Fallback reason for a blocked Combine when the server sent no advisory.
const UNAVAILABLE_ADVISORY = 'This path cannot be combined.';

/**
 * The note under a row, which the server writes. A blocked Combine always has a
 * reason to point at, so the button never stays blocked without one.
 */
function advisoryFor(row: DetectedRow): string | undefined {
  return row.advisory || (row.combinable ? undefined : UNAVAILABLE_ADVISORY);
}

/**
 * Where a row stands: `combining` is opted in with at least one live source,
 * `stalled` is opted in with none, and `inactive` is a path nobody opted in to.
 * Decided once, so the accent colour and the badge cannot disagree.
 */
type RowState = 'combining' | 'stalled' | 'inactive';

const ROW_STATE_BADGE: Record<RowState, React.ReactElement | null> = {
  combining: <Badge tone="success">combined</Badge>,
  stalled: <Badge tone="warning">no live sources</Badge>,
  inactive: null,
};

const ROW_STATE_ACCENT: Record<RowState, 'success' | 'warning' | undefined> = {
  combining: 'success',
  stalled: 'warning',
  inactive: undefined,
};

interface RowMetadataProps {
  chips: SourceChip[];
  liveCount: number;
  kind: DetectedRow['kind'];
  rowState: RowState;
}

function RowMetadata({ chips, liveCount, kind, rowState }: RowMetadataProps): React.ReactElement {
  return (
    <Cluster className={styles.metadata} gap={1}>
      <SourceCountBadge live={liveCount} total={chips.length} />
      <SourceChips chips={chips} />
      <KindBadge kind={kind} />
      {ROW_STATE_BADGE[rowState]}
    </Cluster>
  );
}

export const DetectedPathRow = memo(function DetectedPathRow({
  row,
  optedIn,
  config,
  onAdd,
  onRemove,
  onUpdate,
}: DetectedPathRowProps): React.ReactElement {
  const { path, sources, kind, combinable } = row;
  // Exclusion follows the panel's own copy of the config, so a chip changes
  // the moment its checkbox does rather than after the next save and poll.
  const { excluded } = useSourceSplit(sources, config);
  const chips = sourceChips(sources, row.freshSources, excluded, optedIn);
  const liveCount = chips.filter((chip) => chip.state === 'live').length;
  // A combined path with nothing live is not combining. The accent bar and the
  // badge follow the live state so a green row never means "this value stopped
  // updating a minute ago", and the badge text carries the difference so the
  // colour is not the only cue.
  const rowState: RowState = optedIn ? (liveCount > 0 ? 'combining' : 'stalled') : 'inactive';
  const advisory = advisoryFor(row);
  const [tuneOpen, setTuneOpen] = useState(false);
  const uid = useId();
  const reasonId = `${uid}-reason`;
  const pathId = `${uid}-path`;

  // Only the settings fields are memoized, so only their callback needs a
  // stable identity.
  const handleUpdate = useCallback(
    (patch: RawPathConfigPatch) => {
      onUpdate(path, patch);
    },
    [onUpdate, path]
  );

  return (
    <Card
      accent={ROW_STATE_ACCENT[rowState]}
      className={styles.row}
      density="flush"
      data-detected-path-row=""
      data-combined={optedIn ? 'true' : undefined}
      aria-labelledby={pathId}
    >
      {/* The path leads so the row names its subject before the action. */}
      <Cluster className={styles.header} gap={2}>
        <Code
          break="segments"
          id={pathId}
          className={combinable ? styles.path : `${styles.path} ${styles.pathUnavailable}`}
        >
          {path}
        </Code>

        <RowMetadata chips={chips} liveCount={liveCount} kind={kind} rowState={rowState} />

        <PathAction
          advisoryId={advisory ? reasonId : undefined}
          canCombine={combinable}
          optedIn={optedIn}
          path={path}
          onAdd={() => onAdd(path)}
          onRemove={() => onRemove(path)}
        />
      </Cluster>

      {advisory ? (
        <div className={styles.subRow}>
          <Text as="div" id={reasonId} size="xs" tone="muted">
            {advisory}
          </Text>
        </div>
      ) : null}

      <DuplicateSourcesHint groups={row.duplicateGroups} />

      {optedIn ? <PriorityInstruction path={path} /> : null}
      {optedIn && config ? (
        <TuneSection
          row={row}
          config={config}
          open={tuneOpen}
          onOpenChange={setTuneOpen}
          onUpdate={handleUpdate}
          idPrefix={uid}
        />
      ) : null}
    </Card>
  );
});
