import type * as React from 'react';
import { memo, useState } from 'react';
import {
  Banner,
  CollapsibleSection,
  LabeledField,
  NumberField,
  Select,
  Stack,
  VisuallyHidden,
} from 'signalk-nearlcrews-ui';
import { COMBINE_METHODS, type CombineMethod } from '../../combine.js';
import type { RawPathConfig, RawPathConfigPatch } from '../../config.js';
import {
  ANGULAR_MODES_LIST,
  DEFAULT_ANGULAR_SPREAD_THRESHOLD,
  DEFAULT_MAD_THRESHOLD,
  DEFAULT_TRIM_FRACTION,
  sourceFilterFor,
} from '../../config.js';
import { plural } from '../../textFormat.js';
import { usePanelDefaults } from '../defaultsContext.js';
import type { DetectedRow } from '../hooks/useDetected.js';
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

type AngularMode = (typeof ANGULAR_MODES_LIST)[number];

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

// Which of a path's sources pass the include and exclude filter, using the same
// compiled rule the runtime applies to every delta.
function countIncludedSources(sources: string[], config: RawPathConfig): number {
  return sources.filter(sourceFilterFor(config)).length;
}

export function PerPathSettings({ row, config, onChange, idPrefix }: Props): React.ReactElement {
  const defaults = usePanelDefaults();
  const [advancedOpen, setAdvancedOpen] = useState(false);

  // Count the sources that would actually reach the combiner, not every source
  // the path has ever reported: excluding two of three sources with a minimum
  // of two leaves a path that cannot combine, and the warning has to see that.
  const includedCount = countIncludedSources(row.sources, config);
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
        value={config.method ?? 'median'}
        choices={METHOD_CHOICES}
        onChange={(method) => onChange({ method })}
      />

      <PatchNumberField
        label="Minimum sources"
        value={config.minSources}
        placeholder={`default: ${defaults.minSources}`}
        fieldKey="minSources"
        integer
        // The runtime drops a path whose minimum exceeds the tracked-source
        // cap, so the field refuses the value rather than letting a saved
        // config delete the entry.
        max={defaults.maxSourcesPerPath}
        min={1}
        onChange={onChange}
      />

      {showMinSourcesWarning ? (
        <Banner live="polite" tone="warning">
          This path has {includedCount} selected source{plural(includedCount)}. Requiring{' '}
          {effectiveMinSources} means it will not combine until more sources come online.
        </Banner>
      ) : null}

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

type NumericKey = keyof Pick<
  RawPathConfig,
  | 'minSources'
  | 'madThreshold'
  | 'rejectThreshold'
  | 'disagreeThreshold'
  | 'angularSpreadThreshold'
  | 'trimFraction'
  | 'stalenessTimeoutMs'
  | 'emitMinIntervalMs'
  | 'slewLimit'
>;

interface PatchNumberFieldProps {
  label: string;
  value: number | undefined;
  placeholder: string;
  fieldKey: NumericKey;
  unit?: string | undefined;
  integer?: boolean | undefined;
  min?: number | undefined;
  max?: number | undefined;
  exclusiveMin?: boolean | undefined;
  exclusiveMax?: boolean | undefined;
  onChange: (patch: RawPathConfigPatch) => void;
}

/** An optional per-path number that clears back to the plugin default. */
const PatchNumberField = memo(function PatchNumberField({
  label,
  value,
  placeholder,
  fieldKey,
  unit,
  integer,
  min = 0,
  max,
  exclusiveMin,
  exclusiveMax,
  onChange,
}: PatchNumberFieldProps): React.ReactElement {
  return (
    <NumberField
      allowEmpty
      density="compact"
      exclusiveMax={exclusiveMax}
      exclusiveMin={exclusiveMin}
      inputProps={{ placeholder }}
      integer={integer}
      label={label}
      layout="inline"
      max={max}
      min={min}
      unit={unit}
      value={value}
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
    <NumberField
      allowEmpty
      density="compact"
      exclusiveMin
      inputProps={{ placeholder: 'disabled' }}
      label="Jump rejection max rate"
      layout="inline"
      min={0}
      unit="per second"
      value={config.jumpRejection?.maxRate}
      onValueChange={(maxRate) => onChange({ jumpRejection: { ...config.jumpRejection, maxRate } })}
    />
  );
}

// The default angular spread reads as a quarter turn rather than as
// 1.5707963267948966, but only while it is one: a changed constant prints
// itself instead of leaving the panel naming a value the schema no longer uses.
const ANGULAR_SPREAD_PLACEHOLDER =
  DEFAULT_ANGULAR_SPREAD_THRESHOLD === Math.PI / 2
    ? 'default: \u03c0/2'
    : `default: ${DEFAULT_ANGULAR_SPREAD_THRESHOLD}`;

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
        exclusiveMin
        onChange={onChange}
      />
      <PatchNumberField
        label="Disagree threshold (max spread)"
        value={config.disagreeThreshold}
        placeholder="not set"
        fieldKey="disagreeThreshold"
        exclusiveMin
        onChange={onChange}
      />
      <PatchNumberField
        label="Angular spread threshold"
        unit="radians"
        value={config.angularSpreadThreshold}
        placeholder={ANGULAR_SPREAD_PLACEHOLDER}
        fieldKey="angularSpreadThreshold"
        exclusiveMin
        onChange={onChange}
      />
      <PatchNumberField
        label="Trim fraction (0 to less than 0.5)"
        value={config.trimFraction}
        placeholder={`default: ${DEFAULT_TRIM_FRACTION}`}
        fieldKey="trimFraction"
        max={0.5}
        exclusiveMax
        onChange={onChange}
      />

      <SelectField
        id={`${idPrefix}-angular`}
        label="Angular (circular averaging)"
        value={config.angular ?? 'auto'}
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
        exclusiveMin
        onChange={onChange}
      />
      <PatchNumberField
        label="Staleness timeout"
        unit="ms"
        value={config.stalenessTimeoutMs}
        placeholder={`default: ${defaults.stalenessTimeoutMs}`}
        fieldKey="stalenessTimeoutMs"
        exclusiveMin
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
