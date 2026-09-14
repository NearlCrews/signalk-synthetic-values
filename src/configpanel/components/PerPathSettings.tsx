import type * as React from 'react';
import { memo, useRef, useState } from 'react';
import {
  Banner,
  CollapsibleSection,
  LabeledField,
  NumberField,
  Select,
  Stack,
  VisuallyHidden,
} from 'signalk-nearlcrews-ui';
import type { RawPathConfig, RawPathConfigPatch } from '../../config.js';
import { DEFAULT_JUMP_PERSIST_MS, DEFAULT_JUMP_PERSIST_SAMPLES } from '../../config.js';
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

// Which of a path's sources pass the include and exclude filter, matching
// `sourceAllowed` in the runtime.
function countIncludedSources(sources: string[], config: RawPathConfig): number {
  const include = config.includeSources;
  const exclude = config.excludeSources;
  return sources.filter(
    (src) => (!include?.length || include.includes(src)) && !exclude?.includes(src)
  ).length;
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

      <NumberField
        allowEmpty
        density="compact"
        inputProps={{ placeholder: `default: ${defaults.minSources}` }}
        integer
        label="Minimum sources"
        layout="inline"
        // The runtime drops a path whose minimum exceeds the tracked-source
        // cap, so the field refuses the value rather than letting a saved
        // config delete the entry.
        max={defaults.maxSourcesPerPath}
        min={1}
        value={config.minSources}
        onValueChange={(minSources) => onChange({ minSources })}
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
 * The jump-rejection rate, which switches the whole feature on and off.
 * Clearing it removes `jumpRejection` from the saved config, so the persist
 * settings ride along in a ref and are restored if the rate comes back. The
 * README promises this panel preserves those two values rather than editing
 * them, and without the ref that promise held everywhere except here.
 */
function JumpRateField({
  config,
  onChange,
}: {
  config: RawPathConfig;
  onChange: (patch: RawPathConfigPatch) => void;
}): React.ReactElement {
  const preserved = useRef({
    persistSamples: config.jumpRejection?.persistSamples ?? DEFAULT_JUMP_PERSIST_SAMPLES,
    persistMs: config.jumpRejection?.persistMs ?? DEFAULT_JUMP_PERSIST_MS,
  });
  if (config.jumpRejection) {
    preserved.current = {
      persistSamples: config.jumpRejection.persistSamples ?? preserved.current.persistSamples,
      persistMs: config.jumpRejection.persistMs ?? preserved.current.persistMs,
    };
  }

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
      onValueChange={(maxRate) =>
        onChange({
          jumpRejection: maxRate === undefined ? undefined : { maxRate, ...preserved.current },
        })
      }
    />
  );
}

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
        placeholder="default: 3"
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
        placeholder="default: π/2"
        fieldKey="angularSpreadThreshold"
        exclusiveMin
        onChange={onChange}
      />
      <PatchNumberField
        label="Trim fraction (0 to less than 0.5)"
        value={config.trimFraction}
        placeholder="default: 0.25"
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
