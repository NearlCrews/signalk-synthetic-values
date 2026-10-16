import type * as React from 'react';
import { memo, useState } from 'react';
import {
  Banner,
  CollapsibleSection,
  formatCount,
  LabeledField,
  NumberField,
  Select,
  Stack,
  VisuallyHidden,
} from 'signalk-nearlcrews-ui';
import { BOUNDS, type NumberBounds } from '../../bounds.js';
import { COMBINE_METHODS, type CombineMethod } from '../../combine.js';
import {
  ANGULAR_MODES_LIST,
  type AngularMode,
  DEFAULT_ANGULAR_MODE,
  DEFAULT_MAD_THRESHOLD,
  DEFAULT_METHOD,
  DEFAULT_TRIM_FRACTION,
  type RawPathConfig,
  type RawPathConfigPatch,
} from '../../config.js';
import { usePanelDefaults } from '../defaultsContext.js';
import type { DetectedRow } from '../hooks/useDetected.js';
import { useSourceSplit } from '../hooks/useSourceSplit.js';
import { SourceChecklist } from './SourceChecklist.js';

interface SelectFieldProps<V extends string> {
  id: string;
  label: string;
  value: V;
  choices: ReadonlyArray<{ value: V; label: string }>;
  onChange: (value: V) => void;
}

function SelectField<V extends string>({
  id,
  label,
  value,
  choices,
  onChange,
}: SelectFieldProps<V>): React.ReactElement {
  return (
    <LabeledField density="compact" label={label} layout="inline">
      <Select id={id} value={value} onChange={(event) => onChange(event.target.value as V)}>
        {choices.map((choice) => (
          <option key={choice.value} value={choice.value}>
            {choice.label}
          </option>
        ))}
      </Select>
    </LabeledField>
  );
}

interface Props {
  row: DetectedRow;
  config: RawPathConfig;
  onChange: (patch: RawPathConfigPatch) => void;
  idPrefix: string;
}

// Only the display labels live here. The values come from the modules that own
// them, so a new combine method or angular mode fails to compile until it is
// given a label rather than silently missing from the panel.
const METHOD_LABELS: Record<CombineMethod, string> = {
  median: 'Median',
  trimmedMean: 'Trimmed mean',
  mean: 'Mean',
};

const ANGULAR_LABELS: Record<AngularMode, string> = {
  auto: 'Auto',
  yes: 'Yes',
  no: 'No',
};

const METHOD_CHOICES = COMBINE_METHODS.map((value) => ({ value, label: METHOD_LABELS[value] }));

const ANGULAR_CHOICES = ANGULAR_MODES_LIST.map((value) => ({
  value,
  label: ANGULAR_LABELS[value],
}));

export function PerPathSettings({ row, config, onChange, idPrefix }: Props): React.ReactElement {
  const defaults = usePanelDefaults();
  const [advancedOpen, setAdvancedOpen] = useState(false);

  // Count the sources that would actually reach the combiner, not every source
  // the path has ever reported: excluding two of three sources with a minimum
  // of two leaves a path that cannot combine, and the warning has to see that.
  const includedCount = useSourceSplit(row.sources, config).included.length;
  // Compare against the value in force, which is the resolved default when the
  // field is empty. A path detected with one source under a default minimum of
  // two will never combine, and that is exactly the case worth warning about.
  const effectiveMinSources = config.minSources ?? defaults.minSources;
  // Every valid keystroke commits upward, so the committed value is the one
  // the field shows and the warning follows it directly.
  const showMinSourcesWarning = effectiveMinSources > includedCount;

  return (
    <Stack gap={3}>
      <SelectField
        id={`${idPrefix}-method`}
        label="Method"
        value={config.method ?? DEFAULT_METHOD}
        choices={METHOD_CHOICES}
        onChange={(method) => onChange({ method })}
      />

      <PatchNumberField
        label="Minimum sources"
        value={config.minSources}
        placeholder={`default: ${defaults.minSources}`}
        fieldKey="minSources"
        // The runtime drops a path whose minimum exceeds the tracked-source
        // cap, so the field refuses the value rather than letting a saved
        // config delete the entry.
        max={defaults.maxSourcesPerPath}
        onChange={onChange}
      />

      {/* The region stays mounted so a warning that appears later is announced.
          One present when the settings open is state, not news. */}
      <Banner deferFirstMessage={false} live="polite" tone="warning">
        {showMinSourcesWarning ? (
          <>
            This path has {formatCount(includedCount, 'selected source')}. Requiring{' '}
            {effectiveMinSources} means it will not combine until more sources come online.
          </>
        ) : null}
      </Banner>

      {row.sources.length > 0 ? (
        <SourceChecklist
          sources={row.sources}
          includeSources={config.includeSources}
          excludeSources={config.excludeSources}
          onChange={onChange}
        />
      ) : null}

      <CollapsibleSection
        headingLevel={5}
        mountStrategy="lazy-retain"
        open={advancedOpen}
        onOpenChange={setAdvancedOpen}
        title={
          <>
            Advanced<VisuallyHidden> settings for {row.path}</VisuallyHidden>
          </>
        }
      >
        <AdvancedFields config={config} onChange={onChange} idPrefix={idPrefix} />
      </CollapsibleSection>
    </Stack>
  );
}

// The per-path numbers that live at the top level of a path entry.
type NumericKey =
  | 'minSources'
  | 'madThreshold'
  | 'rejectThreshold'
  | 'disagreeThreshold'
  | 'angularSpreadThreshold'
  | 'trimFraction'
  | 'stalenessTimeoutMs'
  | 'emitMinIntervalMs'
  | 'slewLimit';

interface BoundedNumberFieldProps {
  label: string;
  value: number | undefined;
  placeholder: string;
  bounds: NumberBounds;
  unit?: string | undefined;
  /** A tighter maximum than the bound's own, known only at run time. */
  max?: number | undefined;
  onValueChange: (next: number | undefined) => void;
}

/**
 * An optional number whose limits come from the same table the validator and
 * the schema read, so the field cannot accept a value the runtime refuses.
 */
function BoundedNumberField({
  label,
  value,
  placeholder,
  bounds,
  unit,
  max = bounds.max,
  onValueChange,
}: BoundedNumberFieldProps): React.ReactElement {
  return (
    <NumberField
      allowEmpty
      density="compact"
      // A run-time maximum is inclusive; only the bound's own may exclude itself.
      exclusiveMax={max === bounds.max ? bounds.exclusiveMax : undefined}
      exclusiveMin={bounds.exclusiveMin}
      inputProps={{ placeholder }}
      integer={bounds.integer}
      label={label}
      layout="inline"
      max={max}
      min={bounds.min}
      unit={unit}
      value={value}
      onValueChange={onValueChange}
    />
  );
}

interface PatchNumberFieldProps {
  label: string;
  value: number | undefined;
  placeholder: string;
  fieldKey: NumericKey;
  unit?: string | undefined;
  max?: number | undefined;
  onChange: (patch: RawPathConfigPatch) => void;
}

/** An optional per-path number that clears back to the plugin default. */
const PatchNumberField = memo(function PatchNumberField({
  fieldKey,
  onChange,
  ...field
}: PatchNumberFieldProps): React.ReactElement {
  return (
    <BoundedNumberField
      {...field}
      bounds={BOUNDS[fieldKey]}
      onValueChange={(next) => onChange({ [fieldKey]: next })}
    />
  );
});

/**
 * The jump-rejection rate, which switches the whole feature on and off. An
 * absent rate means off, so clearing the field writes one key and leaves the
 * persist settings saved beside it, which is what the README promises and what
 * every other editor of the same config now gets too.
 */
function JumpRateField({
  config,
  onChange,
}: {
  config: RawPathConfig;
  onChange: (patch: RawPathConfigPatch) => void;
}): React.ReactElement {
  return (
    <BoundedNumberField
      bounds={BOUNDS.maxRate}
      label="Jump rejection max rate"
      placeholder="disabled"
      unit="per second"
      value={config.jumpRejection?.maxRate}
      onValueChange={(maxRate) => onChange({ jumpRejection: { ...config.jumpRejection, maxRate } })}
    />
  );
}

// The default angular spread reads as a quarter turn rather than as
// 1.5707963267948966. A test pins DEFAULT_ANGULAR_SPREAD_THRESHOLD to pi/2, so
// a changed constant fails there instead of leaving this naming a stale value.
const ANGULAR_SPREAD_PLACEHOLDER = 'default: \u03c0/2';

interface AdvancedFieldsProps {
  config: RawPathConfig;
  onChange: (patch: RawPathConfigPatch) => void;
  idPrefix: string;
}

function AdvancedFields({ config, onChange, idPrefix }: AdvancedFieldsProps): React.ReactElement {
  const defaults = usePanelDefaults();

  return (
    <Stack gap={3}>
      <PatchNumberField
        label="Outlier threshold (MAD multiplier)"
        value={config.madThreshold}
        placeholder={`default: ${DEFAULT_MAD_THRESHOLD}`}
        fieldKey="madThreshold"
        onChange={onChange}
      />
      <PatchNumberField
        label="Reject threshold (absolute distance)"
        value={config.rejectThreshold}
        placeholder="not set"
        fieldKey="rejectThreshold"
        onChange={onChange}
      />
      <PatchNumberField
        label="Disagree threshold (max spread)"
        value={config.disagreeThreshold}
        placeholder="not set"
        fieldKey="disagreeThreshold"
        onChange={onChange}
      />
      <PatchNumberField
        label="Angular spread threshold"
        unit="radians"
        value={config.angularSpreadThreshold}
        placeholder={ANGULAR_SPREAD_PLACEHOLDER}
        fieldKey="angularSpreadThreshold"
        onChange={onChange}
      />
      <PatchNumberField
        label="Trim fraction (0 to less than 0.5)"
        value={config.trimFraction}
        placeholder={`default: ${DEFAULT_TRIM_FRACTION}`}
        fieldKey="trimFraction"
        onChange={onChange}
      />

      <SelectField
        id={`${idPrefix}-angular`}
        label="Angular (circular averaging)"
        value={config.angular ?? DEFAULT_ANGULAR_MODE}
        choices={ANGULAR_CHOICES}
        onChange={(angular) => onChange({ angular })}
      />

      <JumpRateField config={config} onChange={onChange} />

      <PatchNumberField
        label="Slew limit"
        unit="per second"
        value={config.slewLimit}
        placeholder="disabled"
        fieldKey="slewLimit"
        onChange={onChange}
      />
      <PatchNumberField
        label="Staleness timeout"
        unit="ms"
        value={config.stalenessTimeoutMs}
        placeholder={`default: ${defaults.stalenessTimeoutMs}`}
        fieldKey="stalenessTimeoutMs"
        onChange={onChange}
      />
      <PatchNumberField
        label="Emit min interval"
        unit="ms"
        value={config.emitMinIntervalMs}
        placeholder={`default: ${defaults.emitMinIntervalMs}`}
        fieldKey="emitMinIntervalMs"
        onChange={onChange}
      />
    </Stack>
  );
}
