import type * as React from 'react';
import { memo, useEffect, useState } from 'react';
import type { CombineMethod } from '../../combine.js';
import type { AngularMode, RawPathConfig, RawPathConfigPatch } from '../../config.js';
import type { DetectedRow } from '../hooks/useDetected.js';
import { S } from '../styles.js';
import { SourceChecklist } from './SourceChecklist.js';

interface Props {
  row: DetectedRow;
  config: RawPathConfig;
  onChange: (patch: RawPathConfigPatch) => void;
  /** Prefix for all DOM ids in this instance to avoid duplicates across rows. */
  idPrefix: string;
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
export function PerPathSettings({ row, config, onChange, idPrefix }: Props): React.ReactElement {
  const [advancedOpen, setAdvancedOpen] = useState(false);
  // Track the draft minSources value locally so the warning shows immediately
  // as the user types, before the parent re-renders with the new prop.
  const [draftMinSources, setDraftMinSources] = useState<number | undefined>(config.minSources);

  const sourceCount = row.sources.length;
  // Use the draft value for the warning check so it responds on keypress.
  const effectiveMinSources = draftMinSources ?? config.minSources;
  const showMinSourcesWarning =
    effectiveMinSources !== undefined && effectiveMinSources > sourceCount;

  // Sync the draft when the incoming prop changes (e.g. after a save round-trip).
  useEffect(() => {
    setDraftMinSources(config.minSources);
  }, [config.minSources]);

  // --- Tier 2 advanced disclosure ---

  const caretChar = advancedOpen ? '▾' : '▸';
  const methodId = `${idPrefix}-method`;
  const minSourcesId = `${idPrefix}-min-sources`;
  const advancedBodyId = `${idPrefix}-advanced-body`;

  return (
    <div>
      {/* Tier 1: method */}
      <div style={S.fieldRow}>
        <label htmlFor={methodId} style={S.labelNarrow}>
          Method
        </label>
        <select
          id={methodId}
          style={S.select}
          value={config.method ?? 'median'}
          onChange={(e) => onChange({ method: e.target.value as CombineMethod })}
        >
          {METHOD_CHOICES.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
      </div>

      {/* Tier 1: minSources */}
      <div style={S.fieldRow}>
        <label htmlFor={minSourcesId} style={S.labelNarrow}>
          Minimum sources
        </label>
        <input
          id={minSourcesId}
          type="number"
          min={1}
          style={S.input}
          value={draftMinSources ?? ''}
          placeholder="default"
          onChange={(e) => {
            const n = Number(e.target.value);
            if (e.target.value.trim() === '') {
              setDraftMinSources(undefined);
              onChange({ minSources: undefined });
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
        <div role="alert" style={{ ...S.note, marginTop: 'var(--skn-space-1)' }}>
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
            idPrefix={idPrefix}
          />
        </div>
      )}

      {/* Tier 2: Advanced (collapsed by default) */}
      <div style={{ marginTop: 'var(--skn-space-2)' }}>
        <button
          type="button"
          style={S.disclosureToggle}
          aria-expanded={advancedOpen}
          aria-controls={advancedBodyId}
          onClick={() => setAdvancedOpen((o) => !o)}
        >
          <span aria-hidden="true" style={{ marginRight: 6 }}>
            {caretChar}
          </span>
          Advanced
        </button>

        {advancedOpen ? (
          <div id={advancedBodyId} style={S.disclosureBody}>
            <AdvancedFields config={config} onChange={onChange} idPrefix={idPrefix} />
          </div>
        ) : (
          <div id={advancedBodyId} hidden />
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Memoized NumberField: encapsulates the parse-or-clear pattern shared by all
// numeric inputs. Emits { [key]: undefined } when the field is cleared and
// { [key]: n } when a finite number is entered; ignores non-finite strings.
// ---------------------------------------------------------------------------

type NumericKey = keyof Pick<
  RawPathConfig,
  | 'madThreshold'
  | 'rejectThreshold'
  | 'disagreeThreshold'
  | 'angularSpreadThreshold'
  | 'trimFraction'
  | 'stalenessTimeoutMs'
  | 'emitMinIntervalMs'
  | 'slewLimit'
>;

interface NumberFieldProps {
  id: string;
  label: string;
  ariaLabel: string;
  value: number | undefined;
  placeholder: string;
  fieldKey: NumericKey;
  onChange: (patch: RawPathConfigPatch) => void;
}

const NumberField = memo(function NumberField({
  id,
  label,
  ariaLabel,
  value,
  placeholder,
  fieldKey,
  onChange,
}: NumberFieldProps): React.ReactElement {
  return (
    <div style={S.fieldRow}>
      <label htmlFor={id} style={S.labelWide}>
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
            onChange({ [fieldKey]: undefined });
          } else if (Number.isFinite(n) && n >= 0) {
            // Negatives are rejected by validateConfig (positive/nonNegative);
            // do not send them so the panel and plugin agree.
            onChange({ [fieldKey]: n });
          }
        }}
      />
    </div>
  );
});

// ---------------------------------------------------------------------------
// Advanced tier: threshold and timing overrides
// ---------------------------------------------------------------------------

interface AdvancedFieldsProps {
  config: RawPathConfig;
  onChange: (patch: RawPathConfigPatch) => void;
  idPrefix: string;
}

function AdvancedFields({ config, onChange, idPrefix }: AdvancedFieldsProps): React.ReactElement {
  const angularId = `${idPrefix}-angular`;
  const jumpMaxRateId = `${idPrefix}-jump-max-rate`;

  return (
    <div>
      <NumberField
        id={`${idPrefix}-mad`}
        label="Outlier threshold (MAD multiplier)"
        ariaLabel="MAD threshold"
        value={config.madThreshold}
        placeholder="default: 3"
        fieldKey="madThreshold"
        onChange={onChange}
      />
      <NumberField
        id={`${idPrefix}-reject`}
        label="Reject threshold (absolute distance)"
        ariaLabel="Reject threshold"
        value={config.rejectThreshold}
        placeholder="not set"
        fieldKey="rejectThreshold"
        onChange={onChange}
      />
      <NumberField
        id={`${idPrefix}-disagree`}
        label="Disagree threshold (max spread)"
        ariaLabel="Disagree threshold"
        value={config.disagreeThreshold}
        placeholder="not set"
        fieldKey="disagreeThreshold"
        onChange={onChange}
      />
      <NumberField
        id={`${idPrefix}-angular-spread`}
        label="Angular spread threshold (radians)"
        ariaLabel="Angular spread threshold"
        value={config.angularSpreadThreshold}
        placeholder="default: π/2"
        fieldKey="angularSpreadThreshold"
        onChange={onChange}
      />
      <NumberField
        id={`${idPrefix}-trim`}
        label="Trim fraction (0 to 0.5)"
        ariaLabel="Trim fraction"
        value={config.trimFraction}
        placeholder="default: 0.25"
        fieldKey="trimFraction"
        onChange={onChange}
      />

      {/* Angular override */}
      <div style={S.fieldRow}>
        <label htmlFor={angularId} style={S.labelWide}>
          Angular (circular averaging)
        </label>
        <select
          id={angularId}
          aria-label="Angular mode"
          style={S.select}
          value={config.angular ?? 'auto'}
          onChange={(e) => onChange({ angular: e.target.value as AngularMode })}
        >
          {ANGULAR_CHOICES.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
      </div>

      {/* Jump rejection: just maxRate for now */}
      <div style={S.fieldRow}>
        <label htmlFor={jumpMaxRateId} style={S.labelWide}>
          Jump rejection max rate
        </label>
        <input
          id={jumpMaxRateId}
          type="number"
          min={0}
          aria-label="Jump rejection max rate"
          style={S.input}
          value={config.jumpRejection?.maxRate ?? ''}
          placeholder="disabled"
          onChange={(e) => {
            const n = Number(e.target.value);
            if (e.target.value.trim() === '') {
              onChange({ jumpRejection: undefined });
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

      <NumberField
        id={`${idPrefix}-slew`}
        label="Slew limit (units/sec)"
        ariaLabel="Slew limit"
        value={config.slewLimit}
        placeholder="disabled"
        fieldKey="slewLimit"
        onChange={onChange}
      />
      <NumberField
        id={`${idPrefix}-staleness`}
        label="Staleness timeout (ms)"
        ariaLabel="Staleness timeout ms"
        value={config.stalenessTimeoutMs}
        placeholder="default: 5000"
        fieldKey="stalenessTimeoutMs"
        onChange={onChange}
      />
      <NumberField
        id={`${idPrefix}-emit-interval`}
        label="Emit min interval (ms)"
        ariaLabel="Emit min interval ms"
        value={config.emitMinIntervalMs}
        placeholder="default: 500"
        fieldKey="emitMinIntervalMs"
        onChange={onChange}
      />
    </div>
  );
}
