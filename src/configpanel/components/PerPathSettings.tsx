import type * as React from 'react';
import { useState } from 'react';
import type { RawPathConfig } from '../../config.js';
import type { DetectedRow } from '../hooks/useDetected.js';
import { S } from '../styles.js';
import { SourceChecklist } from './SourceChecklist.js';

interface Props {
  row: DetectedRow;
  config: RawPathConfig;
  onChange: (patch: Partial<RawPathConfig>) => void;
}

const METHOD_CHOICES = [
  { value: 'median', label: 'Median' },
  { value: 'trimmedMean', label: 'Trimmed mean' },
  { value: 'mean', label: 'Mean' },
] as const;

const ANGULAR_CHOICES = [
  { value: 'auto', label: 'Auto' },
  { value: 'yes', label: 'Yes' },
  { value: 'no', label: 'No' },
] as const;

/**
 * Per-path tuning tiers. Tier 1 (always shown when this component mounts):
 * method, minSources, and the SourceChecklist. Tier 2 (Advanced, collapsed
 * by default): the full set of threshold and timing overrides.
 *
 * Raising minSources above the row's live source count shows an inline
 * warning but does not block the onChange.
 */
export function PerPathSettings({ row, config, onChange }: Props): React.ReactElement {
  const [advancedOpen, setAdvancedOpen] = useState(false);
  // Track the draft minSources value locally so the warning shows immediately
  // as the user types, before the parent re-renders with the new prop.
  const [draftMinSources, setDraftMinSources] = useState<number | undefined>(config.minSources);

  const sourceCount = row.sources.length;
  // Use the draft value for the warning check so it responds on keypress.
  const effectiveMinSources = draftMinSources ?? config.minSources;
  const showMinSourcesWarning =
    effectiveMinSources !== undefined && effectiveMinSources > sourceCount;

  // --- Tier 1 controls ---

  const fieldRowStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--skn-space-2)',
    marginBottom: 'var(--skn-space-1)',
    flexWrap: 'wrap',
  };

  const labelStyle: React.CSSProperties = {
    fontSize: 'var(--skn-font-body)',
    color: 'var(--skn-text-muted)',
    flex: '0 1 180px',
  };

  // --- Tier 2 advanced disclosure ---

  const caretChar = advancedOpen ? '▾' : '▸';

  return (
    <div>
      {/* Tier 1: method */}
      <div style={fieldRowStyle}>
        <label htmlFor="skn-method" style={labelStyle}>
          Method
        </label>
        <select
          id="skn-method"
          aria-label="Method"
          style={S.select}
          value={config.method ?? 'median'}
          onChange={(e) =>
            onChange({ method: e.target.value as 'median' | 'trimmedMean' | 'mean' })
          }
        >
          {METHOD_CHOICES.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
      </div>

      {/* Tier 1: minSources */}
      <div style={fieldRowStyle}>
        <label htmlFor="skn-min-sources" style={labelStyle}>
          Minimum sources
        </label>
        <input
          id="skn-min-sources"
          type="number"
          min={1}
          aria-label="Minimum sources"
          style={S.input}
          value={draftMinSources ?? config.minSources ?? ''}
          placeholder="default"
          onChange={(e) => {
            const n = Number(e.target.value);
            if (e.target.value.trim() === '') {
              setDraftMinSources(undefined);
              // Omit the key entirely to satisfy exactOptionalPropertyTypes.
              onChange({});
            } else if (Number.isFinite(n) && n >= 1) {
              const truncated = Math.trunc(n);
              setDraftMinSources(truncated);
              onChange({ minSources: truncated });
            }
          }}
        />
      </div>

      {/* Inline warning when minSources exceeds live source count */}
      {showMinSourcesWarning && (
        <div role="alert" style={{ ...S.note, marginTop: 4 }}>
          This path has {sourceCount} source{sourceCount !== 1 ? 's' : ''}. Requiring{' '}
          {effectiveMinSources} means it will not combine until more sources come online.
        </div>
      )}

      {/* Tier 1: source checklist */}
      {row.sources.length > 0 && (
        <div style={{ marginTop: 'var(--skn-space-1)' }}>
          <SourceChecklist
            sources={row.sources}
            includeSources={config.includeSources}
            excludeSources={config.excludeSources}
            onChange={onChange}
          />
        </div>
      )}

      {/* Tier 2: Advanced (collapsed by default) */}
      <div style={{ marginTop: 'var(--skn-space-2)' }}>
        <button
          type="button"
          style={S.disclosureToggle}
          aria-expanded={advancedOpen}
          aria-controls="skn-advanced-body"
          onClick={() => setAdvancedOpen((o) => !o)}
        >
          <span aria-hidden="true" style={{ marginRight: 6 }}>
            {caretChar}
          </span>
          Advanced
        </button>

        {advancedOpen ? (
          <div id="skn-advanced-body" style={S.disclosureBody}>
            <AdvancedFields config={config} onChange={onChange} />
          </div>
        ) : (
          <div id="skn-advanced-body" hidden />
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Advanced tier: threshold and timing overrides
// ---------------------------------------------------------------------------

interface AdvancedFieldsProps {
  config: RawPathConfig;
  onChange: (patch: Partial<RawPathConfig>) => void;
}

function AdvancedFields({ config, onChange }: AdvancedFieldsProps): React.ReactElement {
  const fieldRowStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--skn-space-2)',
    marginBottom: 'var(--skn-space-1)',
    flexWrap: 'wrap',
  };

  const labelStyle: React.CSSProperties = {
    fontSize: 'var(--skn-font-body)',
    color: 'var(--skn-text-muted)',
    flex: '0 1 220px',
  };

  function numberField(
    label: string,
    id: string,
    ariaLabel: string,
    value: number | undefined,
    placeholder: string,
    key: keyof Pick<
      RawPathConfig,
      | 'madThreshold'
      | 'rejectThreshold'
      | 'disagreeThreshold'
      | 'angularSpreadThreshold'
      | 'trimFraction'
      | 'stalenessTimeoutMs'
      | 'emitMinIntervalMs'
      | 'slewLimit'
    >
  ): React.ReactElement {
    return (
      <div style={fieldRowStyle}>
        <label htmlFor={id} style={labelStyle}>
          {label}
        </label>
        <input
          id={id}
          type="number"
          min={0}
          aria-label={ariaLabel}
          style={S.input}
          value={value ?? ''}
          placeholder={placeholder}
          onChange={(e) => {
            const n = Number(e.target.value);
            if (e.target.value.trim() === '') {
              // Omit the key to satisfy exactOptionalPropertyTypes.
              onChange({});
            } else if (Number.isFinite(n)) {
              onChange({ [key]: n });
            }
          }}
        />
      </div>
    );
  }

  return (
    <div>
      {numberField(
        'Outlier threshold (MAD multiplier)',
        'skn-mad',
        'MAD threshold',
        config.madThreshold,
        'default: 3',
        'madThreshold'
      )}
      {numberField(
        'Reject threshold (absolute distance)',
        'skn-reject',
        'Reject threshold',
        config.rejectThreshold,
        'not set',
        'rejectThreshold'
      )}
      {numberField(
        'Disagree threshold (max spread)',
        'skn-disagree',
        'Disagree threshold',
        config.disagreeThreshold,
        'not set',
        'disagreeThreshold'
      )}
      {numberField(
        'Angular spread threshold (radians)',
        'skn-angular-spread',
        'Angular spread threshold',
        config.angularSpreadThreshold,
        'default: π/2',
        'angularSpreadThreshold'
      )}
      {numberField(
        'Trim fraction (0 to 0.5)',
        'skn-trim',
        'Trim fraction',
        config.trimFraction,
        'default: 0.25',
        'trimFraction'
      )}

      {/* Angular override */}
      <div style={fieldRowStyle}>
        <label htmlFor="skn-angular" style={labelStyle}>
          Angular (circular averaging)
        </label>
        <select
          id="skn-angular"
          aria-label="Angular mode"
          style={S.select}
          value={config.angular ?? 'auto'}
          onChange={(e) => onChange({ angular: e.target.value as 'auto' | 'yes' | 'no' })}
        >
          {ANGULAR_CHOICES.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
      </div>

      {/* Jump rejection: just maxRate for now */}
      <div style={fieldRowStyle}>
        <label htmlFor="skn-jump-max-rate" style={labelStyle}>
          Jump rejection max rate
        </label>
        <input
          id="skn-jump-max-rate"
          type="number"
          min={0}
          aria-label="Jump rejection max rate"
          style={S.input}
          value={config.jumpRejection?.maxRate ?? ''}
          placeholder="disabled"
          onChange={(e) => {
            const n = Number(e.target.value);
            if (e.target.value.trim() === '') {
              // Omit the key to satisfy exactOptionalPropertyTypes.
              onChange({});
            } else if (Number.isFinite(n) && n > 0) {
              onChange({
                jumpRejection: {
                  maxRate: n,
                  persistSamples: config.jumpRejection?.persistSamples ?? 3,
                  persistMs: config.jumpRejection?.persistMs ?? 5000,
                },
              });
            }
          }}
        />
      </div>

      {numberField(
        'Slew limit (units/sec)',
        'skn-slew',
        'Slew limit',
        config.slewLimit,
        'disabled',
        'slewLimit'
      )}
      {numberField(
        'Staleness timeout (ms)',
        'skn-staleness',
        'Staleness timeout ms',
        config.stalenessTimeoutMs,
        'default: 5000',
        'stalenessTimeoutMs'
      )}
      {numberField(
        'Emit min interval (ms)',
        'skn-emit-interval',
        'Emit min interval ms',
        config.emitMinIntervalMs,
        'default: 500',
        'emitMinIntervalMs'
      )}
    </div>
  );
}
