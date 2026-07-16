import { COMBINE_METHODS, type CombineMethod } from './combine';
import type { JumpConfig } from './damping';

// Single source of truth for the angular-mode options, shared by the schema
// enum and the validator.
export const ANGULAR_MODES_LIST = ['auto', 'yes', 'no'] as const;
type AngularMode = (typeof ANGULAR_MODES_LIST)[number];

// Default values shared between the schema, the validator, and the panel so
// each default lives in exactly one place.
export const DEFAULT_STALENESS_MS = 1000;
export const DEFAULT_EMIT_INTERVAL_MS = 1000;
export const DEFAULT_MIN_SOURCES = 2;
export const DEFAULT_MAD_THRESHOLD = 3;
export const DEFAULT_TRIM_FRACTION = 0.25;
export const DEFAULT_ANGULAR_SPREAD_THRESHOLD = Math.PI / 2;
export const DEFAULT_JUMP_PERSIST_SAMPLES = 3;
export const DEFAULT_JUMP_PERSIST_MS = 5000;

export interface RawPathConfig {
  path: string;
  method?: CombineMethod;
  trimFraction?: number;
  outlierRejection?: boolean;
  madThreshold?: number;
  rejectThreshold?: number;
  disagreeThreshold?: number;
  angularSpreadThreshold?: number;
  angular?: AngularMode;
  includeSources?: string[];
  excludeSources?: string[];
  minSources?: number;
  stalenessTimeoutMs?: number;
  emitMinIntervalMs?: number;
  // Saved configs may carry only maxRate (the panel's jump field, older saves,
  // or hand-edited config.json); the validator backfills the persist fields.
  jumpRejection?: { maxRate: number; persistSamples?: number; persistMs?: number };
  slewLimit?: number;
}

export interface PathConfig {
  path: string;
  method: CombineMethod;
  trimFraction: number;
  outlierRejection: boolean;
  madThreshold: number;
  rejectThreshold?: number | undefined;
  disagreeThreshold?: number | undefined;
  angularSpreadThreshold: number;
  angular: AngularMode;
  includeSources?: string[] | undefined;
  excludeSources?: string[] | undefined;
  minSources: number;
  stalenessTimeoutMs: number;
  emitMinIntervalMs: number;
  jumpRejection?: JumpConfig | undefined;
  slewLimit?: number | undefined;
}

// Used by the config panel patch/clear flow: the panel sends explicit `undefined` to delete a key
// so the plugin default re-applies. `Partial<RawPathConfig>` cannot express this under
// exactOptionalPropertyTypes, so we use a mapped type that allows the `| undefined` union.
export type RawPathConfigPatch = {
  [K in Exclude<keyof RawPathConfig, 'path'>]?: RawPathConfig[K] | undefined;
};

export interface PluginOptions {
  defaultStalenessTimeoutMs: number;
  defaultEmitMinIntervalMs: number;
  defaultMinSources: number;
  maxSourcesPerPath: number;
  paths: RawPathConfig[];
}

interface ResolvedConfig {
  maxSourcesPerPath: number;
  paths: PathConfig[];
}

interface ConfigError {
  path: string;
  message: string;
}

export interface ValidationResult {
  config: ResolvedConfig;
  errors: ConfigError[];
  advisories: ConfigError[];
}

export const DEFAULT_MAX_SOURCES_PER_PATH = 16;

const METHODS: ReadonlySet<string> = new Set(COMBINE_METHODS);
const ANGULAR_MODES: ReadonlySet<string> = new Set(ANGULAR_MODES_LIST);

function positive(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n) && n > 0;
}

function nonNegative(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n) && n >= 0;
}

function positiveInt(n: unknown): n is number {
  return typeof n === 'number' && Number.isInteger(n) && n > 0;
}

interface PathValidation {
  path?: PathConfig;
  errors: ConfigError[];
  advisories: ConfigError[];
}

interface ResolvedScalars {
  method: CombineMethod;
  angular: AngularMode;
  trimFraction: number;
  staleness: number;
  emitInterval: number;
  minSources: number;
}

function validateScalars(
  id: string,
  raw: RawPathConfig,
  options: PluginOptions
): { scalars: ResolvedScalars } | { error: ConfigError } {
  if (raw.includeSources?.length && raw.excludeSources?.length) {
    return {
      error: { path: id, message: 'set either includeSources or excludeSources, not both' },
    };
  }
  const method = raw.method ?? 'median';
  if (!METHODS.has(method)) {
    return { error: { path: id, message: `unknown method ${method}` } };
  }
  const angular = raw.angular ?? 'auto';
  if (!ANGULAR_MODES.has(angular)) {
    return { error: { path: id, message: `unknown angular mode ${angular}` } };
  }
  const trimFraction = raw.trimFraction ?? DEFAULT_TRIM_FRACTION;
  if (!(trimFraction >= 0 && trimFraction < 0.5)) {
    return { error: { path: id, message: 'trimFraction must be in [0, 0.5)' } };
  }
  // Fall back to the shipped defaults when the top-level default is missing
  // (REST-written or hand-edited configs may omit the globals entirely), the
  // same way maxSourcesPerPath falls back in validateConfig.
  const staleness =
    raw.stalenessTimeoutMs ?? options.defaultStalenessTimeoutMs ?? DEFAULT_STALENESS_MS;
  const emitInterval =
    raw.emitMinIntervalMs ?? options.defaultEmitMinIntervalMs ?? DEFAULT_EMIT_INTERVAL_MS;
  const minSources = raw.minSources ?? options.defaultMinSources ?? DEFAULT_MIN_SOURCES;
  if (!positive(staleness)) {
    return { error: { path: id, message: 'stalenessTimeoutMs must be a positive number' } };
  }
  if (!nonNegative(emitInterval)) {
    return { error: { path: id, message: 'emitMinIntervalMs must be a non-negative number' } };
  }
  if (!positiveInt(minSources)) {
    return { error: { path: id, message: 'minSources must be a positive integer' } };
  }
  return { scalars: { method, angular, trimFraction, staleness, emitInterval, minSources } };
}

// Validate the optional threshold and damping fields. Split from
// validatePathEntry to keep each function's branch count readable.
function validateThresholds(id: string, raw: RawPathConfig): ConfigError[] {
  const errors: ConfigError[] = [];
  for (const [k, v] of [
    ['rejectThreshold', raw.rejectThreshold],
    ['disagreeThreshold', raw.disagreeThreshold],
    ['angularSpreadThreshold', raw.angularSpreadThreshold],
    ['slewLimit', raw.slewLimit],
  ] as const) {
    if (v != null && !positive(v)) {
      errors.push({ path: id, message: `${k} must be positive when set` });
    }
  }
  if (raw.madThreshold != null && !nonNegative(raw.madThreshold)) {
    errors.push({ path: id, message: 'madThreshold must be a non-negative number' });
  }
  if (raw.jumpRejection) {
    if (!positive(raw.jumpRejection.maxRate)) {
      errors.push({ path: id, message: 'jumpRejection.maxRate must be positive' });
    }
    const { persistSamples, persistMs } = raw.jumpRejection;
    if (persistSamples != null && !positiveInt(persistSamples)) {
      errors.push({ path: id, message: 'jumpRejection.persistSamples must be a positive integer' });
    }
    if (persistMs != null && !nonNegative(persistMs)) {
      errors.push({ path: id, message: 'jumpRejection.persistMs must be a non-negative number' });
    }
  }
  return errors;
}

function validatePathEntry(id: string, raw: RawPathConfig, options: PluginOptions): PathValidation {
  const scalarsResult = validateScalars(id, raw, options);
  if ('error' in scalarsResult) {
    return { errors: [scalarsResult.error], advisories: [] };
  }
  const { method, angular, trimFraction, staleness, emitInterval, minSources } =
    scalarsResult.scalars;

  const errors = validateThresholds(id, raw);
  if (errors.length > 0) return { errors, advisories: [] };

  const advisories: ConfigError[] = [];
  // Defaults to true: outlier rejection is on unless the user explicitly disables it.
  const outlierRejection = raw.outlierRejection ?? true;
  if (!outlierRejection && raw.madThreshold != null) {
    advisories.push({ path: id, message: 'madThreshold ignored while outlierRejection is off' });
  }
  return {
    path: {
      path: id,
      method,
      trimFraction,
      outlierRejection,
      madThreshold: raw.madThreshold ?? DEFAULT_MAD_THRESHOLD,
      rejectThreshold: raw.rejectThreshold,
      disagreeThreshold: raw.disagreeThreshold,
      angularSpreadThreshold: raw.angularSpreadThreshold ?? DEFAULT_ANGULAR_SPREAD_THRESHOLD,
      angular,
      includeSources: raw.includeSources,
      excludeSources: raw.excludeSources,
      minSources,
      stalenessTimeoutMs: staleness,
      emitMinIntervalMs: emitInterval,
      // Normalize to a complete JumpConfig: damping's persistence check reads
      // both persist fields, and an undefined there would never satisfy it,
      // freezing the accepted value after the first rate-exceeding sample.
      jumpRejection: raw.jumpRejection
        ? {
            maxRate: raw.jumpRejection.maxRate,
            persistSamples: raw.jumpRejection.persistSamples ?? DEFAULT_JUMP_PERSIST_SAMPLES,
            persistMs: raw.jumpRejection.persistMs ?? DEFAULT_JUMP_PERSIST_MS,
          }
        : undefined,
      slewLimit: raw.slewLimit,
    },
    errors: [],
    advisories,
  };
}

export function validateConfig(options: PluginOptions): ValidationResult {
  const errors: ConfigError[] = [];
  const advisories: ConfigError[] = [];
  const paths: PathConfig[] = [];
  const seen = new Set<string>();

  for (const raw of options.paths ?? []) {
    const id = raw.path;
    if (!id || typeof id !== 'string') {
      errors.push({ path: String(id), message: 'missing path' });
      continue;
    }
    if (seen.has(id)) {
      errors.push({ path: id, message: 'duplicate path entry ignored' });
      continue;
    }
    seen.add(id);
    const result = validatePathEntry(id, raw, options);
    errors.push(...result.errors);
    advisories.push(...result.advisories);
    if (result.path) paths.push(result.path);
  }

  const maxSourcesPerPath = positiveInt(options.maxSourcesPerPath)
    ? options.maxSourcesPerPath
    : DEFAULT_MAX_SOURCES_PER_PATH;
  return { config: { maxSourcesPerPath, paths }, errors, advisories };
}
