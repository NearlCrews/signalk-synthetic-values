import type * as React from 'react';
import { memo, useCallback, useId, useState } from 'react';
import {
  Badge,
  Button,
  Card,
  Cluster,
  Code,
  CollapsibleSection,
  Stack,
  Text,
  VisuallyHidden,
} from 'signalk-nearlcrews-ui';
import { NON_NUMERIC_ADVISORY } from '../../combinability.js';
import type { RawPathConfig, RawPathConfigPatch } from '../../config.js';
import { oxfordJoin, plural } from '../../textFormat.js';
import { PLUGIN_SOURCE_LABEL } from '../api-base.js';
import type { DetectedRow } from '../hooks/useDetected.js';
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
  if (groups.length === 0) return null;
  // The route can report one group twice, so the render is keyed on the members
  // themselves. A delimiter join is the key: serializing every group on every
  // render buys nothing a separator that cannot appear in a source name does.
  const groupsByKey = new Map(groups.map((group) => [group.join('\u0000'), group]));

  return (
    <Stack className={styles.subRow} gap={1}>
      {[...groupsByKey].map(([key, group]) => (
        <Text key={key} as="div" size="xs" tone="muted">
          {oxfordJoin(group)} report identical values and may be the same feed re-broadcast.
          Consider combining only one of them so it does not outvote your independent sensors.
        </Text>
      ))}
    </Stack>
  );
}

// A plain count carries no severity, so it takes the neutral tone. An `info`
// tone would draw the shared glyph and announce "Information." over what is
// only a number.
function SourceCountBadge({ chips }: { chips: SourceChip[] }): React.ReactElement {
  const total = chips.length;
  const live = chips.filter((chip) => chip.state === 'live').length;
  const label =
    live === total ? `${total} source${plural(total)}` : `${live} of ${total} sources combining`;
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
      Source priority required: rank <strong>{PLUGIN_SOURCE_LABEL}</strong> first in its group. Add
      a{' '}
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
  kind: DetectedRow['kind'];
  rowState: RowState;
}

function RowMetadata({ chips, kind, rowState }: RowMetadataProps): React.ReactElement {
  return (
    <Cluster className={styles.metadata} gap={1}>
      <SourceCountBadge chips={chips} />
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
  const { path, sources, kind } = row;
  const chips = sourceChips(sources, row.freshSources, row.excludedSources, optedIn);
  // A combined path with nothing live is not combining. The accent bar and the
  // badge follow the live state so a green row never means "this value stopped
  // updating a minute ago", and the badge text carries the difference so the
  // colour is not the only cue.
  const rowState: RowState = optedIn
    ? chips.some((chip) => chip.state === 'live')
      ? 'combining'
      : 'stalled'
    : 'inactive';
  const canCombine = row.combinable !== false && kind !== 'other';
  const advisory = row.advisory ?? (kind === 'other' ? NON_NUMERIC_ADVISORY : undefined);
  const [tuneOpen, setTuneOpen] = useState(false);
  const uid = useId();
  const reasonId = `${uid}-reason`;
  const pathId = `${uid}-path`;

  const handleAdd = useCallback(() => {
    if (canCombine) onAdd(path);
  }, [canCombine, onAdd, path]);

  const handleRemove = useCallback(() => {
    onRemove(path);
  }, [onRemove, path]);

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
      role="group"
      aria-labelledby={pathId}
    >
      {/* The path leads so the row names its subject before the action. */}
      <Cluster className={styles.header} gap={2}>
        <Code
          break="segments"
          id={pathId}
          className={canCombine ? styles.path : `${styles.path} ${styles.pathUnavailable}`}
        >
          {path}
        </Code>

        <RowMetadata chips={chips} kind={kind} rowState={rowState} />

        <PathAction
          advisoryId={advisory ? reasonId : undefined}
          canCombine={canCombine}
          optedIn={optedIn}
          path={path}
          onAdd={handleAdd}
          onRemove={handleRemove}
        />
      </Cluster>

      {advisory ? (
        <div className={styles.subRow}>
          <Text as="div" id={reasonId} size="xs" tone="muted">
            {advisory}
          </Text>
        </div>
      ) : null}

      <DuplicateSourcesHint groups={row.duplicateGroups ?? []} />

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
