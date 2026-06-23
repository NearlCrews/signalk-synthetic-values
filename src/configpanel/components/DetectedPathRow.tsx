import type * as React from 'react';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { NON_NUMERIC_ADVISORY } from '../../combinability.js';
import type { RawPathConfig, RawPathConfigPatch } from '../../config.js';
import type { DetectedRow } from '../hooks/useDetected.js';
import { S } from '../styles.js';
import { KindBadge } from './KindBadge.js';
import { PerPathSettings } from './PerPathSettings.js';
import { SourceChips } from './SourceChips.js';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface DetectedPathRowProps {
  row: DetectedRow;
  /** Defined when the path is opted in; undefined otherwise. */
  config: RawPathConfig | undefined;
  onAdd: (path: string) => void;
  onRemove: (path: string) => void;
  onUpdate: (path: string, patch: RawPathConfigPatch) => void;
}

// ---------------------------------------------------------------------------
// Small pure sub-components (extracted to keep DetectedPathRow complexity ≤ 15)
// ---------------------------------------------------------------------------

function SourceCountBadge({ count }: { count: number }): React.ReactElement {
  const label = `${count} source${count !== 1 ? 's' : ''}`;
  return (
    <span
      style={{
        ...S.pill,
        justifyContent: 'center',
        fontWeight: 700,
        padding: '1px 8px',
        background: 'var(--skn-info-bg)',
        color: 'var(--skn-info-fg)',
        borderColor: 'var(--skn-info-border)',
        whiteSpace: 'nowrap',
      }}
    >
      {/* aria-label on a plain <span> is not allowed without a role.
          Instead we show the number visually and append a visually-hidden
          label so assistive technology reads the full count. */}
      <span aria-hidden="true">{count}</span>
      <span style={S.visuallyHidden}>{label}</span>
    </span>
  );
}

function AddedPill(): React.ReactElement {
  return (
    <span
      style={{
        ...S.pill,
        fontWeight: 600,
        padding: '1px 8px',
        background: 'var(--skn-success-bg)',
        color: 'var(--skn-success-fg)',
        borderColor: 'var(--skn-success-border)',
      }}
    >
      added
    </span>
  );
}

function PriorityInstruction(): React.ReactElement {
  return (
    <div
      style={{
        fontSize: 'var(--skn-font-small)',
        color: 'var(--skn-text-muted)',
        padding: '4px var(--skn-space-2)',
        borderTop: '1px solid var(--skn-border)',
      }}
    >
      Priority not set, the boat is not using this yet. Set{' '}
      <strong>signalk-synthetic-values</strong> as top priority for this path in Signal K under
      Data, Source priorities.
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
    <div style={{ borderTop: '1px solid var(--skn-border)' }}>
      <button
        ref={tuneToggleRef}
        type="button"
        style={{
          ...S.disclosureToggle,
          padding: '6px var(--skn-space-2)',
          fontSize: 'var(--skn-font-small)',
        }}
        aria-expanded={tuneOpen}
        aria-controls={tuneBodyId}
        onClick={onToggle}
      >
        <span aria-hidden="true" style={{ marginRight: 6 }}>
          {tuneOpen ? '▾' : '▸'}
        </span>
        Tune
      </button>
      {tuneOpen ? (
        <div
          id={tuneBodyId}
          style={{ padding: 'var(--skn-space-1) var(--skn-space-2) var(--skn-space-2)' }}
        >
          <PerPathSettings row={row} config={config} onChange={onUpdate} idPrefix={idPrefix} />
        </div>
      ) : (
        <div id={tuneBodyId} hidden />
      )}
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
 * - opted-in (optedIn=true): secondary "Remove" button, "added" pill,
 *   priority instruction, and expandable "Tune" section.
 * - non-combinable (kind === 'other'): disabled "Combine" with a reason in
 *   aria-describedby.
 *
 * Left rail: solid --skn-ok when opted-in, transparent otherwise. Three
 * redundant cues per state so the night-red theme (where hues collapse) stays
 * legible: token family + text label + structural cue.
 */
export function DetectedPathRow({
  row,
  config,
  onAdd,
  onRemove,
  onUpdate,
}: DetectedPathRowProps): React.ReactElement {
  const { path, sources, kind, optedIn } = row;
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

  const outerStyle: React.CSSProperties = {
    background: 'var(--skn-surface)',
    border: '1px solid var(--skn-border)',
    borderRadius: 'var(--skn-radius)',
    marginBottom: 'var(--skn-space-1)',
    overflow: 'hidden',
  };

  // The header carries the rail left border so it stays a short tick and does
  // not run down the Tune body.
  const headerStyle: React.CSSProperties = {
    borderLeft: optedIn ? '3px solid var(--skn-ok)' : '3px solid transparent',
    paddingLeft: 'var(--skn-space-2)',
    paddingRight: 'var(--skn-space-2)',
    paddingTop: 'var(--skn-space-1)',
    paddingBottom: 'var(--skn-space-1)',
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 'var(--skn-space-1)',
    minHeight: 40,
  };

  return (
    <div style={outerStyle} className="skn-row">
      {/* Row header: rail + controls + badges + chips */}
      <div style={headerStyle}>
        {/* Visually-hidden accessible name: "path X, N sources, kind, added" */}
        <span className="skn-vh" style={S.visuallyHidden}>
          {path}, {sources.length} source{sources.length !== 1 ? 's' : ''}, {kind}
          {optedIn ? ', added' : ''}
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
        {optedIn && <AddedPill />}
      </div>

      {/* Advisory reason (visible below header; referenced by aria-describedby) */}
      {advisory && (
        <div
          style={{
            paddingLeft: 'calc(var(--skn-space-2) + 3px)',
            paddingRight: 'var(--skn-space-2)',
            paddingBottom: 'var(--skn-space-1)',
          }}
        >
          <span
            id={reasonId}
            style={{
              display: 'block',
              fontSize: 'var(--skn-font-small)',
              color: 'var(--skn-text-faint)',
              marginTop: 2,
            }}
          >
            {advisory}
          </span>
        </div>
      )}

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
}
