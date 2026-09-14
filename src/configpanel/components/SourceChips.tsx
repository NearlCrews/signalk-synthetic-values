import type * as React from 'react';
import { Badge, Button, Cluster } from 'signalk-nearlcrews-ui';
import { useDisclosure } from 'signalk-nearlcrews-ui/composites';
import { plural } from '../../textFormat.js';
import styles from './SourceChips.module.css';

export interface SourceChip {
  sourceRef: string;
  /** How this source stands in relation to the combination running on the path. */
  state: 'live' | 'stale' | 'excluded';
}

interface SourceChipsProps {
  chips: SourceChip[];
}

const VISIBLE_MAX = 3;

/**
 * Work out how each detected source stands. Freshness only means something on a
 * path that is combining: an unconfigured path runs no combination, so every
 * source it reports is simply listed.
 */
export function sourceChips(
  sources: string[],
  freshSources: string[] | undefined,
  excludedSources: string[] | undefined,
  optedIn: boolean
): SourceChip[] {
  const excluded = new Set(excludedSources ?? []);
  // Freshness only means something on a path that is combining, and only when
  // the route reported it at all.
  const fresh = optedIn && freshSources !== undefined ? new Set(freshSources) : undefined;
  return sources.map((sourceRef) => ({
    sourceRef,
    state: excluded.has(sourceRef)
      ? 'excluded'
      : fresh === undefined || fresh.has(sourceRef)
        ? 'live'
        : 'stale',
  }));
}

// The suffix, not the tone, is what tells a source apart: a chip that reads
// "gps1, no data" says the same thing to a reader who cannot see the colour or
// the glyph as it does to one who can.
function chipLabel({ sourceRef, state }: SourceChip): string {
  if (state === 'stale') return `${sourceRef}, no data`;
  if (state === 'excluded') return `${sourceRef}, excluded`;
  return sourceRef;
}

function SourceChipBadge({ chip }: { chip: SourceChip }): React.ReactElement {
  // No wrapping override: a source reference can be long (`n2k-1.35`,
  // `nmea0183.GP.RMC`), and the package badge already wraps inside itself.
  return <Badge tone={chip.state === 'stale' ? 'warning' : 'neutral'}>{chipLabel(chip)}</Badge>;
}

/**
 * The sources on a path, the first three inline and the rest behind a
 * disclosure. The overflow used to be a `title` tooltip, which a touch or
 * keyboard user never sees, so it is a real control now.
 */
export function SourceChips({ chips }: SourceChipsProps): React.ReactElement | null {
  const overflow = chips.length - VISIBLE_MAX;
  const { panelProps, open, triggerProps } = useDisclosure();
  if (chips.length === 0) return null;

  return (
    <Cluster gap={1}>
      {chips.slice(0, VISIBLE_MAX).map((chip) => (
        <SourceChipBadge key={chip.sourceRef} chip={chip} />
      ))}
      {overflow > 0 ? (
        <>
          <Button size="compact" variant="ghost" {...triggerProps}>
            {open ? 'Show fewer' : `${overflow} more source${plural(overflow)}`}
          </Button>
          {/* A plain div carries the panel props: `hidden` only hides an
              element the cascade leaves at its default display, and a Cluster
              sets display: flex, which would keep the closed panel on screen. */}
          <div className={styles.overflow} {...panelProps}>
            <Cluster gap={1}>
              {chips.slice(VISIBLE_MAX).map((chip) => (
                <SourceChipBadge key={chip.sourceRef} chip={chip} />
              ))}
            </Cluster>
          </div>
        </>
      ) : null}
    </Cluster>
  );
}
