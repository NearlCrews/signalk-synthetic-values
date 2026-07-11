import type * as React from 'react';
import { memo, useEffect, useState } from 'react';
import type { RawPathConfig, RawPathConfigPatch } from '../../config.js';
import { DEFAULT_JUMP_PERSIST_MS, DEFAULT_JUMP_PERSIST_SAMPLES } from '../../config.js';
import { plural } from '../../textFormat.js';
import { usePanelDefaults } from '../defaultsContext.js';
import type { DetectedRow } from '../hooks/useDetected.js';
import { S } from '../styles.js';
import { Disclosure } from './Disclosure.js';
import { SourceChecklist } from './SourceChecklist.js';

// Parse a numeric input string. Returns undefined for blank (clear the key),
// a number when finite and within the bound, or null to ignore the keystroke
// (non-finite or out of range). Shared by every numeric input below so the
// parse-or-clear skeleton lives in one place.
function parseNumericInput(
  raw: string,
  opts: {
    min: number;
    max?: number;
    integer?: boolean;
    exclusiveMin?: boolean;
    exclusiveMax?: boolean;
  }
): number | undefined | null {
  if (raw.trim() === '') return undefined;
  const n = Number(raw);
  const belowBound = opts.exclusiveMin ? n <= opts.min : n < opts.min;
  const aboveBound = opts.max !== undefined && (opts.exclusiveMax ? n >= opts.max : n > opts.max);
  if (!Number.isFinite(n) || belowBound || aboveBound || (opts.integer && !Number.isInteger(n))) {
    return null;
  }
  return n;
}

// Labeled <select> over a fixed choice list. Collapses the duplicated
// label-plus-select markup the Method and Angular fields would otherwise repeat.
interface SelectFieldProps<V extends string> {
  id: string;
  label: string;
  ariaLabel?: string | undefined;
  value: V;
  choices: ReadonlyArray<{ value: V; label: string }>;
  labelStyle: React.CSSProperties | undefined;
  onChange: (value: V) => void;
}

function SelectField<V extends string>({
  id,
  label,
  ariaLabel,
  value,
  choices,
  labelStyle,
  onChange,
}: SelectFieldProps<V>): React.ReactElement {
  return (
    <div style={S.fieldRow}>
      <label htmlFor={id} style={labelStyle}>
        {label}
      </label>
      <select
        id={id}
        aria-label={ariaLabel}
        style={S.select}
        value={value}
        onChange={(e) => onChange(e.target.value as V)}
      >
        {choices.map((c) => (
          <option key={c.value} value={c.value}>
            {c.label}
          </option>
        ))}
      </select>
    </div>
  );
}

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
  const defaults = usePanelDefaults();
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

  const methodId = `${idPrefix}-method`;
  const minSourcesId = `${idPrefix}-min-sources`;
  const advancedBodyId = `${idPrefix}-advanced-body`;

  return (
    <div>
      {/* Tier 1: method */}
      <SelectField
        id={methodId}
        label="Method"
        value={config.method ?? 'median'}
        choices={METHOD_CHOICES}
        labelStyle={S.labelNarrow}
        onChange={(method) => onChange({ method })}
      />

      {/* Tier 1: minSources */}
      <div style={S.fieldRow}>
        <label htmlFor={minSourcesId} style={S.labelNarrow}>
          Minimum sources
        </label>
        <input
          id={minSourcesId}
          type="number"
          min={1}
          step={1}
          style={S.input}
          value={draftMinSources ?? ''}
          placeholder={`default: ${defaults.minSources}`}
          onChange={(e) => {
            const parsed = parseNumericInput(e.target.value, { min: 1, integer: true });
            if (parsed === null) return;
            setDraftMinSources(parsed);
            onChange({ minSources: parsed });
          }}
        />
      </div>

      {/* Inline warning when minSources exceeds live source count */}
      {showMinSourcesWarning && (
        <div role="alert" style={{ ...S.note, marginTop: 'var(--skn-space-1)' }}>
          This path has {sourceCount} source{plural(sourceCount)}. Requiring {effectiveMinSources}{' '}
          means it will not combine until more sources come online.
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
        <Disclosure
          label="Advanced"
          bodyId={advancedBodyId}
          open={advancedOpen}
          onToggle={() => setAdvancedOpen((o) => !o)}
          bodyStyle={S.disclosureBody}
        >
          <AdvancedFields config={config} onChange={onChange} idPrefix={idPrefix} />
        </Disclosure>
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
  min?: number | undefined;
  max?: number | undefined;
  exclusiveMin?: boolean | undefined;
  exclusiveMax?: boolean | undefined;
  onChange: (patch: RawPathConfigPatch) => void;
}

const NumberField = memo(function NumberField({
  id,
  label,
  ariaLabel,
  value,
  placeholder,
  fieldKey,
  min = 0,
  max,
  exclusiveMin = false,
  exclusiveMax = false,
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
        min={min}
        max={max}
        step="any"
        aria-label={ariaLabel}
        style={S.input}
        value={value ?? ''}
        placeholder={placeholder}
        onChange={(e) => {
          // Negatives are rejected by validateConfig (positive/nonNegative);
          // do not send them so the panel and plugin agree.
          const parsed = parseNumericInput(e.target.value, {
            min,
            ...(max !== undefined ? { max } : {}),
            exclusiveMin,
            exclusiveMax,
          });
          if (parsed !== null) onChange({ [fieldKey]: parsed });
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
  const defaults = usePanelDefaults();
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
        exclusiveMin
        onChange={onChange}
      />
      <NumberField
        id={`${idPrefix}-disagree`}
        label="Disagree threshold (max spread)"
        ariaLabel="Disagree threshold"
        value={config.disagreeThreshold}
        placeholder="not set"
        fieldKey="disagreeThreshold"
        exclusiveMin
        onChange={onChange}
      />
      <NumberField
        id={`${idPrefix}-angular-spread`}
        label="Angular spread threshold (radians)"
        ariaLabel="Angular spread threshold"
        value={config.angularSpreadThreshold}
        placeholder="default: π/2"
        fieldKey="angularSpreadThreshold"
        exclusiveMin
        onChange={onChange}
      />
      <NumberField
        id={`${idPrefix}-trim`}
        label="Trim fraction (0 to 0.5)"
        ariaLabel="Trim fraction"
        value={config.trimFraction}
        placeholder="default: 0.25"
        fieldKey="trimFraction"
        max={0.5}
        exclusiveMax
        onChange={onChange}
      />

      {/* Angular override */}
      <SelectField
        id={angularId}
        label="Angular (circular averaging)"
        ariaLabel="Angular mode"
        value={config.angular ?? 'auto'}
        choices={ANGULAR_CHOICES}
        labelStyle={S.labelWide}
        onChange={(angular) => onChange({ angular })}
      />

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
            const parsed = parseNumericInput(e.target.value, { min: 0, exclusiveMin: true });
            if (parsed === null) return;
            onChange({
              jumpRejection:
                parsed === undefined
                  ? undefined
                  : {
                      maxRate: parsed,
                      persistSamples:
                        config.jumpRejection?.persistSamples ?? DEFAULT_JUMP_PERSIST_SAMPLES,
                      persistMs: config.jumpRejection?.persistMs ?? DEFAULT_JUMP_PERSIST_MS,
                    },
            });
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
        exclusiveMin
        onChange={onChange}
      />
      <NumberField
        id={`${idPrefix}-staleness`}
        label="Staleness timeout (ms)"
        ariaLabel="Staleness timeout ms"
        value={config.stalenessTimeoutMs}
        placeholder={`default: ${defaults.stalenessTimeoutMs}`}
        fieldKey="stalenessTimeoutMs"
        exclusiveMin
        onChange={onChange}
      />
      <NumberField
        id={`${idPrefix}-emit-interval`}
        label="Emit min interval (ms)"
        ariaLabel="Emit min interval ms"
        value={config.emitMinIntervalMs}
        placeholder={`default: ${defaults.emitMinIntervalMs}`}
        fieldKey="emitMinIntervalMs"
        onChange={onChange}
      />
    </div>
  );
}
