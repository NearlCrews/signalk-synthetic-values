import type * as React from 'react';
import { memo, useEffect, useState } from 'react';
import {
  Banner,
  CollapsibleSection,
  LabeledField,
  NumberInput,
  Select,
  Stack,
} from 'signalk-nearlcrews-ui';
import type { RawPathConfig, RawPathConfigPatch } from '../../config.js';
import { DEFAULT_JUMP_PERSIST_MS, DEFAULT_JUMP_PERSIST_SAMPLES } from '../../config.js';
import { plural } from '../../textFormat.js';
import { usePanelDefaults } from '../defaultsContext.js';
import type { DetectedRow } from '../hooks/useDetected.js';
import utilities from '../utilities.module.css';
import { SourceChecklist } from './SourceChecklist.js';

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
  const value = Number(raw);
  const belowBound = opts.exclusiveMin ? value <= opts.min : value < opts.min;
  const aboveBound =
    opts.max !== undefined && (opts.exclusiveMax ? value >= opts.max : value > opts.max);
  if (
    !Number.isFinite(value) ||
    belowBound ||
    aboveBound ||
    (opts.integer && !Number.isInteger(value))
  ) {
    return null;
  }
  return value;
}

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

export function PerPathSettings({ row, config, onChange, idPrefix }: Props): React.ReactElement {
  const defaults = usePanelDefaults();
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [draftMinSources, setDraftMinSources] = useState<number | undefined>(config.minSources);

  const sourceCount = row.sources.length;
  const effectiveMinSources = draftMinSources ?? config.minSources;
  const showMinSourcesWarning =
    effectiveMinSources !== undefined && effectiveMinSources > sourceCount;

  useEffect(() => {
    setDraftMinSources(config.minSources);
  }, [config.minSources]);

  const methodId = `${idPrefix}-method`;
  const minSourcesId = `${idPrefix}-min-sources`;

  return (
    <Stack gap={3}>
      <SelectField
        id={methodId}
        label="Method"
        value={config.method ?? 'median'}
        choices={METHOD_CHOICES}
        onChange={(method) => onChange({ method })}
      />

      <LabeledField density="compact" label="Minimum sources" layout="inline">
        <NumberInput
          id={minSourcesId}
          min={1}
          step={1}
          value={draftMinSources ?? ''}
          placeholder={`default: ${defaults.minSources}`}
          onChange={(event) => {
            const parsed = parseNumericInput(event.target.value, { min: 1, integer: true });
            if (parsed === null) return;
            setDraftMinSources(parsed);
            onChange({ minSources: parsed });
          }}
        />
      </LabeledField>

      {showMinSourcesWarning ? (
        <Banner live="polite" tone="warning">
          This path has {sourceCount} source{plural(sourceCount)}. Requiring {effectiveMinSources}{' '}
          means it will not combine until more sources come online.
        </Banner>
      ) : null}

      {row.sources.length > 0 ? (
        <SourceChecklist
          sources={row.sources}
          includeSources={config.includeSources}
          excludeSources={config.excludeSources}
          onChange={onChange}
          idPrefix={idPrefix}
        />
      ) : null}

      <CollapsibleSection
        headingLevel={4}
        mountStrategy="lazy-retain"
        open={advancedOpen}
        onOpenChange={setAdvancedOpen}
        title={
          <>
            Advanced<span className={utilities.visuallyHidden}> settings for {row.path}</span>
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

interface NumberFieldProps {
  id: string;
  label: string;
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
    <LabeledField density="compact" label={label} layout="inline">
      <NumberInput
        id={id}
        min={min}
        max={max}
        step="any"
        value={value ?? ''}
        placeholder={placeholder}
        onChange={(event) => {
          const parsed = parseNumericInput(event.target.value, {
            min,
            ...(max !== undefined ? { max } : {}),
            exclusiveMin,
            exclusiveMax,
          });
          if (parsed !== null) onChange({ [fieldKey]: parsed });
        }}
      />
    </LabeledField>
  );
});

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
    <Stack gap={3}>
      <NumberField
        id={`${idPrefix}-mad`}
        label="Outlier threshold (MAD multiplier)"
        value={config.madThreshold}
        placeholder="default: 3"
        fieldKey="madThreshold"
        onChange={onChange}
      />
      <NumberField
        id={`${idPrefix}-reject`}
        label="Reject threshold (absolute distance)"
        value={config.rejectThreshold}
        placeholder="not set"
        fieldKey="rejectThreshold"
        exclusiveMin
        onChange={onChange}
      />
      <NumberField
        id={`${idPrefix}-disagree`}
        label="Disagree threshold (max spread)"
        value={config.disagreeThreshold}
        placeholder="not set"
        fieldKey="disagreeThreshold"
        exclusiveMin
        onChange={onChange}
      />
      <NumberField
        id={`${idPrefix}-angular-spread`}
        label="Angular spread threshold (radians)"
        value={config.angularSpreadThreshold}
        placeholder="default: π/2"
        fieldKey="angularSpreadThreshold"
        exclusiveMin
        onChange={onChange}
      />
      <NumberField
        id={`${idPrefix}-trim`}
        label="Trim fraction (0 to less than 0.5)"
        value={config.trimFraction}
        placeholder="default: 0.25"
        fieldKey="trimFraction"
        max={0.5}
        exclusiveMax
        onChange={onChange}
      />

      <SelectField
        id={angularId}
        label="Angular (circular averaging)"
        value={config.angular ?? 'auto'}
        choices={ANGULAR_CHOICES}
        onChange={(angular) => onChange({ angular })}
      />

      <LabeledField density="compact" label="Jump rejection max rate" layout="inline">
        <NumberInput
          id={jumpMaxRateId}
          min={0}
          value={config.jumpRejection?.maxRate ?? ''}
          placeholder="disabled"
          onChange={(event) => {
            const parsed = parseNumericInput(event.target.value, { min: 0, exclusiveMin: true });
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
      </LabeledField>

      <NumberField
        id={`${idPrefix}-slew`}
        label="Slew limit (units/sec)"
        value={config.slewLimit}
        placeholder="disabled"
        fieldKey="slewLimit"
        exclusiveMin
        onChange={onChange}
      />
      <NumberField
        id={`${idPrefix}-staleness`}
        label="Staleness timeout (ms)"
        value={config.stalenessTimeoutMs}
        placeholder={`default: ${defaults.stalenessTimeoutMs}`}
        fieldKey="stalenessTimeoutMs"
        exclusiveMin
        onChange={onChange}
      />
      <NumberField
        id={`${idPrefix}-emit-interval`}
        label="Emit min interval (ms)"
        value={config.emitMinIntervalMs}
        placeholder={`default: ${defaults.emitMinIntervalMs}`}
        fieldKey="emitMinIntervalMs"
        onChange={onChange}
      />
    </Stack>
  );
}
