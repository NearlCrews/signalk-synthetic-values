import type * as React from 'react';
import { Fragment, memo, useCallback, useId, useState } from 'react';
import { Badge, Button, Card, Cluster, CollapsibleSection, Stack } from 'signalk-nearlcrews-ui';
import { NON_NUMERIC_ADVISORY } from '../../combinability.js';
import type { RawPathConfig, RawPathConfigPatch } from '../../config.js';
import { oxfordJoin, plural } from '../../textFormat.js';
import { PLUGIN_SOURCE_LABEL } from '../api-base.js';
import type { DetectedRow } from '../hooks/useDetected.js';
import utilities from '../utilities.module.css';
import styles from './DetectedPathRow.module.css';
import { KindBadge } from './KindBadge.js';
import { PerPathSettings } from './PerPathSettings.js';
import { SourceChips } from './SourceChips.js';

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
  const groupsByKey = new Map(groups.map((group) => [JSON.stringify(group), group]));

  return (
    <Stack className={styles.subRow} gap={1}>
      {[...groupsByKey].map(([key, group]) => (
        <span key={key} className={styles.duplicateHint}>
          {oxfordJoin(group)} report identical values and may be the same feed re-broadcast.
          Consider combining only one of them so it does not outvote your independent sensors.
        </span>
      ))}
    </Stack>
  );
}

function SourceCountBadge({ count }: { count: number }): React.ReactElement {
  const label = `${count} source${plural(count)}`;
  return (
    <Badge tone="info">
      <span aria-hidden="true">{count}</span>
      <span className={utilities.visuallyHidden}>{label}</span>
    </Badge>
  );
}

function BreakablePath({ path }: { path: string }): React.ReactElement {
  let prefix = '';
  return (
    <>
      {path.split('.').map((segment, segmentIndex) => {
        prefix = prefix ? `${prefix}.${segment}` : segment;
        return (
          <Fragment key={prefix}>
            {segmentIndex > 0 ? (
              <>
                .<wbr />
              </>
            ) : null}
            {segment}
          </Fragment>
        );
      })}
    </>
  );
}

function PriorityInstruction({ path }: { path: string }): React.ReactElement {
  return (
    <div className={styles.priorityInstruction}>
      Source priority required: rank <strong>{PLUGIN_SOURCE_LABEL}</strong> first in its group. Add
      a <a href={`#/data/priorities?path=${encodeURIComponent(path)}`}>path-level override</a> only
      if this path needs a different order.
    </div>
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
    <CollapsibleSection
      className={styles.tune}
      headingLevel={3}
      mountStrategy="lazy-retain"
      open={open}
      onOpenChange={onOpenChange}
      title={
        <>
          Tune<span className={utilities.visuallyHidden}> settings for {row.path}</span>
        </>
      }
    >
      <PerPathSettings row={row} config={config} onChange={onUpdate} idPrefix={idPrefix} />
    </CollapsibleSection>
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
      <Button aria-label={`Remove ${path}`} onClick={onRemove}>
        Remove
      </Button>
    );
  }

  return (
    <Button
      variant="primary"
      disabled={!canCombine}
      aria-label={`Combine ${path}`}
      aria-describedby={advisoryId}
      onClick={onAdd}
    >
      Combine
    </Button>
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
      className={`${styles.row} ${optedIn ? styles.rowCombined : styles.rowAvailable}`}
      data-detected-path-row=""
      data-combined={optedIn ? 'true' : undefined}
      role="group"
      aria-labelledby={pathId}
    >
      <Cluster className={styles.header} gap={2}>
        <PathAction
          advisoryId={advisory ? reasonId : undefined}
          canCombine={canCombine}
          optedIn={optedIn}
          path={path}
          onAdd={handleAdd}
          onRemove={handleRemove}
        />

        <span
          id={pathId}
          className={`${styles.path} ${canCombine ? '' : styles.pathUnavailable}`}
          title={path}
        >
          <BreakablePath path={path} />
        </span>

        <Cluster className={styles.metadata} gap={1}>
          <SourceCountBadge count={sources.length} />
          <SourceChips sources={sources} />
          <KindBadge kind={kind} />
          {optedIn ? <Badge tone="success">combined</Badge> : null}
        </Cluster>
      </Cluster>

      {advisory ? (
        <div className={styles.subRow}>
          <span id={reasonId} className={styles.advisory}>
            {advisory}
          </span>
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
