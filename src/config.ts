import { BOUNDS, describeBounds, inBounds, type NumberBounds } from './bounds';
import { COMBINE_METHODS, type CombineMethod } from './combine';
import type { JumpConfig } from './damping';
import { isRecord } from './guards';

/** The plugin id, which is also the source name combined values are published under. */
export const PLUGIN_ID = 'signalk-synthetic-values';

// Single source of truth for the angular-mode options, shared by the schema
// enum and the validator.
export const ANGULAR_MODES_LIST = ['auto', 'yes', 'no'] as const;
export type AngularMode = (typeof ANGULAR_MODES_LIST)[number];

// Default values shared between the schema, the validator, and the panel so
// each default lives in exactly one place.
export const DEFAULT_METHOD: CombineMethod = 'median';
export const DEFAULT_ANGULAR_MODE: AngularMode = 'auto';
export const DEFAULT_OUTLIER_REJECTION = true;
export const DEFAULT_STALENESS_MS = 1000;
export const DEFAULT_EMIT_INTERVAL_MS = 1000;
export const DEFAULT_MIN_SOURCES = 2;
export const DEFAULT_MAD_THRESHOLD = 3;
export const DEFAULT_TRIM_FRACTION = 0.25;
export const DEFAULT_ANGULAR_SPREAD_THRESHOLD = Math.PI / 2;
export const DEFAULT_JUMP_PERSIST_SAMPLES = 3;
export const DEFAULT_JUMP_PERSIST_MS = 5000;
export const DEFAULT_MAX_SOURCES_PER_PATH = 16;
export const DEFAULT_NOTIFICATIONS = true;

// The furthest the slew limiter may fall behind the combined value, measured in
// seconds of catch-up at the configured rate. Beyond it the limiter is bypassed:
// smoothing exists to suppress noise, and no amount of smoothing is worth
// misreporting a real change indefinitely. The schema description quotes it.
export const SLEW_MAX_LAG_SECONDS = 10;

/**
 * The saved jump-rejection block. Every field is optional: an absent maxRate
 * means jump rejection is off, so clearing the rate in any editor leaves the
 * persist settings beside it intact instead of deleting the whole block. The
 * validator backfills the persist fields for a config that carries only a rate.
 */
interface RawJumpRejection {
  maxRate?: number | undefined;
  persistSamples?: number | undefined;
  persistMs?: number | undefined;
}

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
  jumpRejection?: RawJumpRejection;
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

/** The top-level settings, each resolved to the value the runtime applies. */
export interface TopLevelOptions {
  defaultStalenessTimeoutMs: number;
  defaultEmitMinIntervalMs: number;
  defaultMinSources: number;
  maxSourcesPerPath: number;
  notifications: boolean;
}

export interface PluginOptions extends TopLevelOptions {
  paths: RawPathConfig[];
}

interface ResolvedConfig {
  maxSourcesPerPath: number;
  notifications: boolean;
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

/** The include and exclude lists that decide which sources reach the combiner. */
export interface SourceFilter {
  includeSources?: string[] | undefined;
  excludeSources?: string[] | undefined;
}

// Every source passes when a path sets no lists at all, which is the common
// case, so that path answers without building a closure or a Set.
const ALLOW_EVERY_SOURCE = (): boolean => true;

/**
 * Compile one path's include and exclude rule into a predicate. The runtime
 * applies it to every delta and the panel applies it to count and check the
 * sources a path would actually combine, so a single definition keeps the
 * panel from promising a combination the runtime will not run. An empty
 * include list means no filter, which is what the runtime has always done.
 */
export function sourceFilterFor(filter: SourceFilter): (sourceRef: string) => boolean {
  const include = filter.includeSources?.length ? new Set(filter.includeSources) : undefined;
  const exclude = filter.excludeSources?.length ? new Set(filter.excludeSources) : undefined;
  if (include === undefined && exclude === undefined) return ALLOW_EVERY_SOURCE;
  return (sourceRef) => (include?.has(sourceRef) ?? true) && !exclude?.has(sourceRef);
}

interface PathValidation {
  path?: PathConfig;
  errors: ConfigError[];
  advisories: ConfigError[];
}

/** The settings a path entry inherits when it does not set its own. */
interface PathDefaults {
  staleness: number;
  emitInterval: number;
  minSources: number;
}

type UnknownRecord = Record<string, unknown>;

function boundsError(label: string, bounds: NumberBounds): string {
  return `${label} must be ${describeBounds(bounds)}`;
}

/**
 * Read one number. Absent stays undefined for the caller to default; present
 * must lie inside its bounds, or an error is recorded and undefined returned so
 * the caller's default applies.
 */
function readNumber(
  raw: UnknownRecord,
  key: string,
  bounds: NumberBounds,
  errorPath: string,
  errors: ConfigError[],
  message = boundsError(key, bounds)
): number | undefined {
  const value = raw[key];
  if (value === undefined) return undefined;
  if (inBounds(value, bounds)) return value;
  errors.push({ path: errorPath, message });
  return undefined;
}

function readBoolean(
  raw: UnknownRecord,
  key: string,
  fallback: boolean,
  errorPath: string,
  errors: ConfigError[]
): boolean {
  const value = raw[key];
  if (value === undefined) return fallback;
  if (typeof value === 'boolean') return value;
  errors.push({ path: errorPath, message: `${key} must be a boolean` });
  return fallback;
}

function readEnum<T extends string>(
  id: string,
  value: unknown,
  allowed: readonly T[],
  fallback: T,
  label: string,
  errors: ConfigError[]
): T {
  if (value === undefined) return fallback;
  if (typeof value === 'string' && (allowed as readonly string[]).includes(value)) {
    return value as T;
  }
  errors.push({ path: id, message: `unknown ${label} ${String(value)}` });
  return fallback;
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
  const read = (key: 'maxRate' | 'persistSamples' | 'persistMs'): number | undefined =>
    readNumber(
      value,
      key,
      BOUNDS[key],
      id,
      errors,
      boundsError(`jumpRejection.${key}`, BOUNDS[key])
    );
  const before = errors.length;
  const maxRate = read('maxRate');
  const persistSamples = read('persistSamples');
  const persistMs = read('persistMs');
  // No rate means the feature is off. The persist settings may still be saved
  // beside it, waiting for the rate to come back.
  if (maxRate === undefined || errors.length > before) return undefined;
  return {
    maxRate,
    persistSamples: persistSamples ?? DEFAULT_JUMP_PERSIST_SAMPLES,
    persistMs: persistMs ?? DEFAULT_JUMP_PERSIST_MS,
  };
}

function validatePathEntry(
  id: string,
  raw: UnknownRecord,
  defaults: PathDefaults,
  maxSourcesPerPath: number
): PathValidation {
  const errors: ConfigError[] = [];
  const num = (key: keyof typeof BOUNDS, message?: string): number | undefined =>
    readNumber(raw, key, BOUNDS[key], id, errors, message);

  const method = readEnum(id, raw.method, COMBINE_METHODS, DEFAULT_METHOD, 'method', errors);
  const angular = readEnum(
    id,
    raw.angular,
    ANGULAR_MODES_LIST,
    DEFAULT_ANGULAR_MODE,
    'angular mode',
    errors
  );
  const trimFraction = num('trimFraction') ?? DEFAULT_TRIM_FRACTION;
  const stalenessTimeoutMs = num('stalenessTimeoutMs') ?? defaults.staleness;
  const emitMinIntervalMs = num('emitMinIntervalMs') ?? defaults.emitInterval;
  const minSources = num('minSources') ?? defaults.minSources;
  if (minSources > maxSourcesPerPath) {
    errors.push({
      path: id,
      message: `minSources cannot exceed maxSourcesPerPath (${maxSourcesPerPath})`,
    });
  }
  const includeSources = readSourceList(id, raw, 'includeSources', errors);
  const excludeSources = readSourceList(id, raw, 'excludeSources', errors);
  if (includeSources?.length && excludeSources?.length) {
    errors.push({ path: id, message: 'set either includeSources or excludeSources, not both' });
  }
  const outlierRejection = readBoolean(
    raw,
    'outlierRejection',
    DEFAULT_OUTLIER_REJECTION,
    id,
    errors
  );
  // Zero reads like "no threshold" and means the opposite: every reading with
  // any spread at all is rejected, so the path stops producing output even when
  // the sources agree. Turning rejection off is what outlierRejection is for.
  // An explicit null is not "unset": it is rejected like any other non-number.
  const madThreshold =
    num(
      'madThreshold',
      'madThreshold must be greater than zero; switch outlierRejection off to disable rejection'
    ) ?? DEFAULT_MAD_THRESHOLD;
  const rejectThreshold = num('rejectThreshold');
  const disagreeThreshold = num('disagreeThreshold');
  const angularSpreadThreshold = num('angularSpreadThreshold') ?? DEFAULT_ANGULAR_SPREAD_THRESHOLD;
  const slewLimit = num('slewLimit');
  const jumpRejection = readJumpConfig(id, raw.jumpRejection, errors);

  if (errors.length > 0) return { errors, advisories: [] };

  const advisories: ConfigError[] = [];
  if (!outlierRejection && raw.madThreshold !== undefined) {
    advisories.push({
      path: id,
      message:
        'madThreshold ignored while outlierRejection is off; rejectThreshold still applies because it is an absolute limit',
    });
  }
  // Scaled MAD needs four readings, and the unit-free split test needs three,
  // so a two-source path has nothing that can tell two sensors that agree from
  // two that are far apart. Only a threshold in the path's own units can.
  if (minSources <= 2 && rejectThreshold === undefined && disagreeThreshold === undefined) {
    advisories.push({
      path: id,
      message:
        'with two sources and neither rejectThreshold nor disagreeThreshold set, a 50/50 split between the sensors cannot be detected and the midpoint is published',
    });
  }
  return {
    path: {
      path: id,
      method,
      trimFraction,
      outlierRejection,
      madThreshold,
      rejectThreshold,
      disagreeThreshold,
      angularSpreadThreshold,
      angular,
      includeSources,
      excludeSources,
      minSources,
      stalenessTimeoutMs,
      emitMinIntervalMs,
      jumpRejection,
      slewLimit,
    },
    errors: [],
    advisories,
  };
}

/**
 * The top-level settings as the runtime applies them: each one absent or out
 * of range falls back to its default, and the reason is recorded in `errors`.
 * The panel calls it too, so its placeholders show the default that actually
 * applies rather than a value the runtime would refuse.
 */
export function resolveTopLevel(root: unknown, errors: ConfigError[] = []): TopLevelOptions {
  const raw = isRecord(root) ? root : {};
  const top = (key: keyof TopLevelOptions, bounds: NumberBounds): number | undefined =>
    readNumber(raw, key, bounds, key, errors);
  const maxSourcesPerPath =
    top('maxSourcesPerPath', BOUNDS.maxSourcesPerPath) ?? DEFAULT_MAX_SOURCES_PER_PATH;
  const notifications = readBoolean(
    raw,
    'notifications',
    DEFAULT_NOTIFICATIONS,
    'notifications',
    errors
  );
  const defaultStalenessTimeoutMs =
    top('defaultStalenessTimeoutMs', BOUNDS.stalenessTimeoutMs) ?? DEFAULT_STALENESS_MS;
  const defaultEmitMinIntervalMs =
    top('defaultEmitMinIntervalMs', BOUNDS.emitMinIntervalMs) ?? DEFAULT_EMIT_INTERVAL_MS;
  let defaultMinSources = top('defaultMinSources', BOUNDS.minSources) ?? DEFAULT_MIN_SOURCES;
  if (defaultMinSources > maxSourcesPerPath) {
    errors.push({
      path: 'defaultMinSources',
      message: `defaultMinSources cannot exceed maxSourcesPerPath (${maxSourcesPerPath})`,
    });
    // Like every other refused setting it falls back to its default, so the
    // paths that inherit it still combine wherever the cap allows two sources.
    defaultMinSources = DEFAULT_MIN_SOURCES;
  }
  return {
    defaultStalenessTimeoutMs,
    defaultEmitMinIntervalMs,
    defaultMinSources,
    maxSourcesPerPath,
    notifications,
  };
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
  const label = `paths[${index}]`;
  if (!isRecord(value)) {
    errors.push({ path: label, message: 'path entry must be an object' });
    return undefined;
  }
  const path = value.path;
  if (typeof path !== 'string' || !path.trim()) {
    // An entry without a usable path has no name of its own to report under.
    errors.push({ path: label, message: 'missing path' });
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
  defaults: PathDefaults,
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
  if (!isRecord(input)) {
    errors.push({ path: 'configuration', message: 'configuration must be an object' });
  }
  const root = isRecord(input) ? input : {};
  const top = resolveTopLevel(root, errors);
  const defaults: PathDefaults = {
    staleness: top.defaultStalenessTimeoutMs,
    emitInterval: top.defaultEmitMinIntervalMs,
    minSources: top.defaultMinSources,
  };
  const paths = validatePathEntries(
    readRawPaths(root, errors),
    defaults,
    top.maxSourcesPerPath,
    errors,
    advisories
  );

  return {
    config: { maxSourcesPerPath: top.maxSourcesPerPath, notifications: top.notifications, paths },
    errors,
    advisories,
  };
}
