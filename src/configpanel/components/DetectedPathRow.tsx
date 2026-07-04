import type * as React from 'react';
import { memo, useCallback, useEffect, useId, useRef, useState } from 'react';
import { NON_NUMERIC_ADVISORY } from '../../combinability.js';
import type { RawPathConfig, RawPathConfigPatch } from '../../config.js';
import { oxfordJoin, plural } from '../../textFormat.js';
import { PLUGIN_SOURCE_LABEL } from '../api-base.js';
import type { DetectedRow } from '../hooks/useDetected.js';
import { BORDER_HAIRLINE, S, TOUCH_ROW } from '../styles.js';
import { Disclosure } from './Disclosure.js';
import { KindBadge } from './KindBadge.js';
import { PerPathSettings } from './PerPathSettings.js';
import { SourceChips } from './SourceChips.js';

// Static pill variants for the row, built once. The info family marks the
// source count; the success family marks a combined path.
const PILL_SOURCE_COUNT: React.CSSProperties = {
  ...S.pillInfo,
  justifyContent: 'center',
  fontWeight: 700,
  whiteSpace: 'nowrap',
};
const PILL_COMBINED: React.CSSProperties = {
  ...S.pillSuccess,
  fontWeight: 600,
};

// Row container and header are static except for the opted-in left rail, so
// they live at module scope rather than rebuilding every render.
const ROW_OUTER: React.CSSProperties = {
  background: 'var(--skn-surface)',
  border: BORDER_HAIRLINE,
  borderRadius: 'var(--skn-radius)',
  marginBottom: 'var(--skn-space-1)',
  overflow: 'hidden',
};
const ROW_HEADER_BASE: React.CSSProperties = {
  paddingLeft: 'var(--skn-space-2)',
  paddingRight: 'var(--skn-space-2)',
  paddingTop: 'var(--skn-space-1)',
  paddingBottom: 'var(--skn-space-1)',
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: 'var(--skn-space-1)',
  minHeight: TOUCH_ROW,
};
// The header carries the rail left border so it stays a short tick and does not
// run down the Tune body.
const ROW_HEADER_OPTED: React.CSSProperties = {
  ...ROW_HEADER_BASE,
  borderLeft: 'var(--skn-rail-width) solid var(--skn-ok)',
};
const ROW_HEADER_PLAIN: React.CSSProperties = {
  ...ROW_HEADER_BASE,
  borderLeft: 'var(--skn-rail-width) solid transparent',
};

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface DetectedPathRowProps {
  row: DetectedRow;
  /**
   * Local form-state truth for whether the path is opted in. Passed separately
   * from `row` (whose server-side optedIn field lags a save) so the row object
   * keeps a stable identity and the memo below actually skips re-renders.
   */
  optedIn: boolean;
  /** Defined when the path is opted in; undefined otherwise. */
  config: RawPathConfig | undefined;
  onAdd: (path: string) => void;
  onRemove: (path: string) => void;
  onUpdate: (path: string, patch: RawPathConfigPatch) => void;
}

// ---------------------------------------------------------------------------
// Small pure sub-components (extracted to keep DetectedPathRow complexity ≤ 15)
// ---------------------------------------------------------------------------

// Hint shown when two or more sources report identical changing values, which
// usually means one feed is re-broadcast under several names (so it outvotes
// the independent sensors). Advises excluding the duplicates rather than
// excluding them automatically, since identical values can be legitimate.
function DuplicateSourcesHint({ groups }: { groups: string[][] }): React.ReactElement | null {
  if (groups.length === 0) return null;
  return (
    <div style={S.insetSubRow}>
      {groups.map((group) => (
        <span key={group.join('|')} style={S.insetSubRowTextMuted}>
          {oxfordJoin(group)} report identical values and may be the same feed re-broadcast.
          Consider combining only one of them so it does not outvote your independent sensors.
        </span>
      ))}
    </div>
  );
}

function SourceCountBadge({ count }: { count: number }): React.ReactElement {
  const label = `${count} source${plural(count)}`;
  return (
    <span style={PILL_SOURCE_COUNT}>
      {/* aria-label on a plain <span> is not allowed without a role.
          Instead we show the number visually and append a visually-hidden
          label so assistive technology reads the full count. */}
      <span aria-hidden="true">{count}</span>
      <span style={S.visuallyHidden}>{label}</span>
    </span>
  );
}

function CombinedPill(): React.ReactElement {
  return <span style={PILL_COMBINED}>combined</span>;
}

function PriorityInstruction(): React.ReactElement {
  return (
    <div
      style={{
        fontSize: 'var(--skn-font-small)',
        color: 'var(--skn-text-muted)',
        padding: 'var(--skn-space-1) var(--skn-space-2)',
        borderTop: BORDER_HAIRLINE,
      }}
    >
      Priority not set: the boat is not using this yet. Set <strong>{PLUGIN_SOURCE_LABEL}</strong>{' '}
      as top priority for this path in Signal K under Data, Source priorities.
    </div>
  );
}

interface TuneSectionProps {
  row: DetectedRow;
  config: RawPathConfig;
  tuneOpen: boolean;
  tuneBodyId: string;
  tuneToggleRef: React.RefObject<HTMLButtonElement | null>;
  onToggle: () => void;
  onUpdate: (patch: RawPathConfigPatch) => void;
  idPrefix: string;
}

function TuneSection({
  row,
  config,
  tuneOpen,
  tuneBodyId,
  tuneToggleRef,
  onToggle,
  onUpdate,
  idPrefix,
}: TuneSectionProps): React.ReactElement {
  return (
    <div style={{ borderTop: BORDER_HAIRLINE }}>
      <Disclosure
        label="Tune"
        bodyId={tuneBodyId}
        open={tuneOpen}
        onToggle={onToggle}
        toggleRef={tuneToggleRef}
        toggleStyle={{ padding: '6px var(--skn-space-2)', fontSize: 'var(--skn-font-small)' }}
        bodyStyle={{ padding: 'var(--skn-space-1) var(--skn-space-2) var(--skn-space-2)' }}
      >
        <PerPathSettings row={row} config={config} onChange={onUpdate} idPrefix={idPrefix} />
      </Disclosure>
    </div>
  );
}

// ---------------------------------------------------------------------------
// DetectedPathRow
// ---------------------------------------------------------------------------

/**
 * One row in the DetectedPathList. Handles three states:
 *
 * - available (optedIn=false, kind != 'other'): primary "Combine" button.
 * - opted-in (optedIn=true): secondary "Remove" button, "combined" pill,
 *   priority instruction, and expandable "Tune" section.
 * - non-combinable (kind === 'other'): disabled "Combine" with a reason in
 *   aria-describedby.
 *
 * Left rail: solid --skn-ok when opted-in, transparent otherwise. Three
 * redundant cues per state so the night-red theme (where hues collapse) stays
 * legible: token family + text label + structural cue.
 *
 * Memoized: rows receive stable row objects and stable callbacks, so
 * list-level state changes (an announcement tick, the poll's loading toggle)
 * skip re-rendering untouched rows.
 */
export const DetectedPathRow = memo(function DetectedPathRow({
  row,
  optedIn,
  config,
  onAdd,
  onRemove,
  onUpdate,
}: DetectedPathRowProps): React.ReactElement {
  const { path, sources, kind } = row;
  // canCombine drives the disabled state of the Combine button: false only for
  // text and objects, which cannot be averaged at all. GNSS fix metadata stays
  // combinable but carries an advisory and is excluded from "Combine all".
  const canCombine = row.combinable !== false && kind !== 'other';
  // Reason to show: the server advisory if present, else the default
  // not-a-number message for an un-classified text/object value.
  const advisory = row.advisory ?? (kind === 'other' ? NON_NUMERIC_ADVISORY : undefined);
  const [tuneOpen, setTuneOpen] = useState(false);
  const tuneToggleRef = useRef<HTMLButtonElement>(null);
  const wasTuneOpen = useRef(false);

  // Collision-safe ids: useId() guarantees uniqueness across concurrent rows,
  // even when two paths produce the same slug (e.g. "a.b" and "a/b" both
  // become "a-b"). All aria- linkages (reasonId, tuneBodyId) and the idPrefix
  // passed to PerPathSettings and SourceChecklist use this uid as their base.
  const uid = useId();
  const reasonId = `${uid}-reason`;
  const tuneBodyId = `${uid}-tune-body`;

  const handleAdd = useCallback(() => {
    if (canCombine) onAdd(path);
  }, [canCombine, onAdd, path]);

  const handleRemove = useCallback(() => {
    onRemove(path);
  }, [onRemove, path]);

  const handleTuneToggle = useCallback(() => {
    setTuneOpen((prev) => !prev);
  }, []);

  const handleUpdate = useCallback(
    (patch: RawPathConfigPatch) => {
      onUpdate(path, patch);
    },
    [onUpdate, path]
  );

  // Focus-return: when Tune collapses and focus fell inside the detail panel,
  // return it to the toggle button (mirrors the cannon ConversionRow pattern).
  useEffect(() => {
    if (wasTuneOpen.current && !tuneOpen) {
      const active = document.activeElement;
      if (!active || active === document.body) tuneToggleRef.current?.focus();
    }
    wasTuneOpen.current = tuneOpen;
  }, [tuneOpen]);

  return (
    <div style={ROW_OUTER} className="skn-row">
      {/* Row header: rail + controls + badges + chips */}
      <div style={optedIn ? ROW_HEADER_OPTED : ROW_HEADER_PLAIN}>
        {/* Visually-hidden accessible name: "path X, N sources, kind, combined" */}
        <span style={S.visuallyHidden}>
          {path}, {sources.length} source{plural(sources.length)}, {kind}
          {optedIn ? ', combined' : ''}
        </span>

        {/* Opt-in control */}
        {optedIn ? (
          <button type="button" style={S.btnSecondaryRow} onClick={handleRemove}>
            Remove
          </button>
        ) : (
          <button
            type="button"
            style={S.btnPrimaryRow}
            disabled={!canCombine}
            aria-describedby={advisory ? reasonId : undefined}
            onClick={handleAdd}
          >
            Combine
          </button>
        )}

        {/* Path label (truncating) */}
        <span
          style={{
            flex: 1,
            minWidth: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            fontSize: 'var(--skn-font-body)',
            color: canCombine ? 'var(--skn-text)' : 'var(--skn-text-faint)',
            fontFamily: 'var(--skn-font-mono)',
          }}
          title={path}
        >
          {path}
        </span>

        <SourceCountBadge count={sources.length} />
        <SourceChips sources={sources} />
        <KindBadge kind={kind} />
        {optedIn && <CombinedPill />}
      </div>

      {/* Advisory reason (visible below header; referenced by aria-describedby) */}
      {advisory && (
        <div style={S.insetSubRow}>
          <span id={reasonId} style={S.insetSubRowText}>
            {advisory}
          </span>
        </div>
      )}

      {/* Likely-duplicate sources hint */}
      <DuplicateSourcesHint groups={row.duplicateGroups ?? []} />

      {/* Opted-in sub-states */}
      {optedIn && <PriorityInstruction />}
      {optedIn && config && (
        <TuneSection
          row={row}
          config={config}
          tuneOpen={tuneOpen}
          tuneBodyId={tuneBodyId}
          tuneToggleRef={tuneToggleRef}
          onToggle={handleTuneToggle}
          onUpdate={handleUpdate}
          idPrefix={uid}
        />
      )}
    </div>
  );
});
