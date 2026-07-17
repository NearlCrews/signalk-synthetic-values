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
export const MAX_SOURCES_PER_PATH = 64;

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

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readSourceList(
  id: string,
  raw: UnknownRecord,
  key: 'includeSources' | 'excludeSources',
  errors: ConfigError[]
): string[] | undefined {
  const value = raw[key];
  if (value === undefined) return undefined;
  if (
    !Array.isArray(value) ||
    value.some((source) => typeof source !== 'string' || !source.trim())
  ) {
    errors.push({ path: id, message: `${key} must contain only non-empty strings` });
    return undefined;
  }
  if (new Set(value).size !== value.length) {
    errors.push({ path: id, message: `${key} must not contain duplicate sources` });
    return undefined;
  }
  return [...value];
}

function readJumpConfig(id: string, value: unknown, errors: ConfigError[]): JumpConfig | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) {
    errors.push({ path: id, message: 'jumpRejection must be an object' });
    return undefined;
  }
  const maxRate = value.maxRate;
  const persistSamples = value.persistSamples;
  const persistMs = value.persistMs;
  if (!positive(maxRate)) {
    errors.push({ path: id, message: 'jumpRejection.maxRate must be positive' });
  }
  if (persistSamples !== undefined && !positiveInt(persistSamples)) {
    errors.push({ path: id, message: 'jumpRejection.persistSamples must be a positive integer' });
  }
  if (persistMs !== undefined && !nonNegative(persistMs)) {
    errors.push({ path: id, message: 'jumpRejection.persistMs must be a non-negative number' });
  }
  if (!positive(maxRate)) return undefined;
  if (persistSamples !== undefined && !positiveInt(persistSamples)) return undefined;
  if (persistMs !== undefined && !nonNegative(persistMs)) return undefined;
  return {
    maxRate,
    persistSamples: persistSamples ?? DEFAULT_JUMP_PERSIST_SAMPLES,
    persistMs: persistMs ?? DEFAULT_JUMP_PERSIST_MS,
  };
}

function readOptionalNumber(
  id: string,
  raw: UnknownRecord,
  key: 'rejectThreshold' | 'disagreeThreshold' | 'angularSpreadThreshold' | 'slewLimit',
  errors: ConfigError[]
): number | undefined {
  const value = raw[key];
  if (value === undefined) return undefined;
  if (!positive(value)) {
    errors.push({ path: id, message: `${key} must be positive when set` });
    return undefined;
  }
  return value;
}

function readMethod(
  id: string,
  value: unknown,
  fallback: CombineMethod,
  errors: ConfigError[]
): CombineMethod {
  if (value === undefined) return fallback;
  if (typeof value === 'string' && METHODS.has(value)) return value as CombineMethod;
  errors.push({ path: id, message: `unknown method ${String(value)}` });
  return fallback;
}

function readAngularMode(
  id: string,
  value: unknown,
  fallback: AngularMode,
  errors: ConfigError[]
): AngularMode {
  if (value === undefined) return fallback;
  if (typeof value === 'string' && ANGULAR_MODES.has(value)) return value as AngularMode;
  errors.push({ path: id, message: `unknown angular mode ${String(value)}` });
  return fallback;
}

function readPathNumber(
  id: string,
  raw: UnknownRecord,
  key: 'trimFraction' | 'stalenessTimeoutMs' | 'emitMinIntervalMs' | 'minSources',
  fallback: number,
  valid: (value: unknown) => value is number,
  message: string,
  errors: ConfigError[]
): number {
  const value = raw[key];
  if (value === undefined) return fallback;
  if (valid(value)) return value;
  errors.push({ path: id, message });
  return fallback;
}

function validTrimFraction(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value < 0.5;
}

function resolveScalars(
  id: string,
  raw: UnknownRecord,
  defaults: ResolvedScalars,
  maxSourcesPerPath: number,
  errors: ConfigError[]
): ResolvedScalars {
  const method = readMethod(id, raw.method, defaults.method, errors);
  const angular = readAngularMode(id, raw.angular, defaults.angular, errors);
  const trimFraction = readPathNumber(
    id,
    raw,
    'trimFraction',
    defaults.trimFraction,
    validTrimFraction,
    'trimFraction must be in [0, 0.5)',
    errors
  );
  const staleness = readPathNumber(
    id,
    raw,
    'stalenessTimeoutMs',
    defaults.staleness,
    positive,
    'stalenessTimeoutMs must be a positive number',
    errors
  );
  const emitInterval = readPathNumber(
    id,
    raw,
    'emitMinIntervalMs',
    defaults.emitInterval,
    nonNegative,
    'emitMinIntervalMs must be a non-negative number',
    errors
  );
  const minSources = readPathNumber(
    id,
    raw,
    'minSources',
    defaults.minSources,
    positiveInt,
    'minSources must be a positive integer',
    errors
  );
  if (minSources > maxSourcesPerPath) {
    errors.push({
      path: id,
      message: `minSources cannot exceed maxSourcesPerPath (${maxSourcesPerPath})`,
    });
  }

  return {
    method,
    angular,
    trimFraction,
    staleness,
    emitInterval,
    minSources,
  };
}

function validatePathEntry(
  id: string,
  raw: UnknownRecord,
  defaults: ResolvedScalars,
  maxSourcesPerPath: number
): PathValidation {
  const errors: ConfigError[] = [];
  const scalars = resolveScalars(id, raw, defaults, maxSourcesPerPath, errors);
  const includeSources = readSourceList(id, raw, 'includeSources', errors);
  const excludeSources = readSourceList(id, raw, 'excludeSources', errors);
  if (includeSources?.length && excludeSources?.length) {
    errors.push({ path: id, message: 'set either includeSources or excludeSources, not both' });
  }

  const outlierValue = raw.outlierRejection;
  if (outlierValue !== undefined && typeof outlierValue !== 'boolean') {
    errors.push({ path: id, message: 'outlierRejection must be a boolean' });
  }
  const outlierRejection = typeof outlierValue === 'boolean' ? outlierValue : true;

  const madThreshold = raw.madThreshold === undefined ? DEFAULT_MAD_THRESHOLD : raw.madThreshold;
  if (!nonNegative(madThreshold)) {
    errors.push({ path: id, message: 'madThreshold must be a non-negative number' });
  }

  const rejectThreshold = readOptionalNumber(id, raw, 'rejectThreshold', errors);
  const disagreeThreshold = readOptionalNumber(id, raw, 'disagreeThreshold', errors);
  const angularSpreadThreshold =
    readOptionalNumber(id, raw, 'angularSpreadThreshold', errors) ??
    DEFAULT_ANGULAR_SPREAD_THRESHOLD;
  const slewLimit = readOptionalNumber(id, raw, 'slewLimit', errors);
  const jumpRejection = readJumpConfig(id, raw.jumpRejection, errors);

  if (errors.length > 0) return { errors, advisories: [] };

  const advisories: ConfigError[] = [];
  if (!outlierRejection && raw.madThreshold !== undefined) {
    advisories.push({ path: id, message: 'madThreshold ignored while outlierRejection is off' });
  }
  return {
    path: {
      path: id,
      method: scalars.method,
      trimFraction: scalars.trimFraction,
      outlierRejection,
      madThreshold: madThreshold as number,
      rejectThreshold,
      disagreeThreshold,
      angularSpreadThreshold,
      angular: scalars.angular,
      includeSources,
      excludeSources,
      minSources: scalars.minSources,
      stalenessTimeoutMs: scalars.staleness,
      emitMinIntervalMs: scalars.emitInterval,
      jumpRejection,
      slewLimit,
    },
    errors: [],
    advisories,
  };
}

function readTopLevelNumber(
  root: UnknownRecord,
  key: 'defaultStalenessTimeoutMs' | 'defaultEmitMinIntervalMs' | 'defaultMinSources',
  fallback: number,
  valid: (value: unknown) => value is number,
  message: string,
  errors: ConfigError[]
): number {
  const value = root[key];
  if (value === undefined) return fallback;
  if (valid(value)) return value;
  errors.push({ path: key, message });
  return fallback;
}

function readRoot(input: unknown, errors: ConfigError[]): UnknownRecord {
  if (isRecord(input)) return input;
  errors.push({ path: 'configuration', message: 'configuration must be an object' });
  return {};
}

function readMaxSources(root: UnknownRecord, errors: ConfigError[]): number {
  const value = root.maxSourcesPerPath;
  if (value === undefined) return DEFAULT_MAX_SOURCES_PER_PATH;
  if (positiveInt(value) && value <= MAX_SOURCES_PER_PATH) return value;
  errors.push({
    path: 'maxSourcesPerPath',
    message: `maxSourcesPerPath must be an integer from 1 to ${MAX_SOURCES_PER_PATH}`,
  });
  return DEFAULT_MAX_SOURCES_PER_PATH;
}

function readDefaults(
  root: UnknownRecord,
  maxSourcesPerPath: number,
  errors: ConfigError[]
): ResolvedScalars {
  const defaults: ResolvedScalars = {
    method: 'median',
    angular: 'auto',
    trimFraction: DEFAULT_TRIM_FRACTION,
    staleness: readTopLevelNumber(
      root,
      'defaultStalenessTimeoutMs',
      DEFAULT_STALENESS_MS,
      positive,
      'defaultStalenessTimeoutMs must be a positive number',
      errors
    ),
    emitInterval: readTopLevelNumber(
      root,
      'defaultEmitMinIntervalMs',
      DEFAULT_EMIT_INTERVAL_MS,
      nonNegative,
      'defaultEmitMinIntervalMs must be a non-negative number',
      errors
    ),
    minSources: readTopLevelNumber(
      root,
      'defaultMinSources',
      DEFAULT_MIN_SOURCES,
      positiveInt,
      'defaultMinSources must be a positive integer',
      errors
    ),
  };
  if (defaults.minSources > maxSourcesPerPath) {
    errors.push({
      path: 'defaultMinSources',
      message: `defaultMinSources cannot exceed maxSourcesPerPath (${maxSourcesPerPath})`,
    });
  }
  return defaults;
}

function readRawPaths(root: UnknownRecord, errors: ConfigError[]): unknown[] {
  if (root.paths === undefined) return [];
  if (Array.isArray(root.paths)) return root.paths;
  errors.push({ path: 'paths', message: 'paths must be an array' });
  return [];
}

function readPathEntry(
  value: unknown,
  index: number,
  errors: ConfigError[]
): { id: string; raw: UnknownRecord } | undefined {
  if (!isRecord(value)) {
    errors.push({ path: `paths[${index}]`, message: 'path entry must be an object' });
    return undefined;
  }
  const path = value.path;
  if (typeof path !== 'string' || !path.trim()) {
    errors.push({ path: String(path), message: 'missing path' });
    return undefined;
  }
  if (path !== path.trim()) {
    errors.push({ path, message: 'path must not have surrounding whitespace' });
    return undefined;
  }
  return { id: path, raw: value };
}

function validatePathEntries(
  rawPaths: unknown[],
  defaults: ResolvedScalars,
  maxSourcesPerPath: number,
  errors: ConfigError[],
  advisories: ConfigError[]
): PathConfig[] {
  const paths: PathConfig[] = [];
  const seen = new Set<string>();
  for (const [index, value] of rawPaths.entries()) {
    const entry = readPathEntry(value, index, errors);
    if (!entry) continue;
    const { id, raw } = entry;
    if (seen.has(id)) {
      errors.push({ path: id, message: 'duplicate path entry ignored' });
      continue;
    }
    seen.add(id);
    const result = validatePathEntry(id, raw, defaults, maxSourcesPerPath);
    errors.push(...result.errors);
    advisories.push(...result.advisories);
    if (result.path) paths.push(result.path);
  }
  return paths;
}

export function validateConfig(input: unknown): ValidationResult {
  const errors: ConfigError[] = [];
  const advisories: ConfigError[] = [];
  const root = readRoot(input, errors);
  const maxSourcesPerPath = readMaxSources(root, errors);
  const defaults = readDefaults(root, maxSourcesPerPath, errors);
  const paths = validatePathEntries(
    readRawPaths(root, errors),
    defaults,
    maxSourcesPerPath,
    errors,
    advisories
  );

  return { config: { maxSourcesPerPath, paths }, errors, advisories };
}
