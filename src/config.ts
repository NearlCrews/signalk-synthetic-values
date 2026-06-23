import type { CombineMethod } from './combine';
import type { JumpConfig } from './damping';

export interface RawPathConfig {
  path: string;
  method?: CombineMethod;
  trimFraction?: number;
  outlierRejection?: boolean;
  madThreshold?: number;
  rejectThreshold?: number;
  disagreeThreshold?: number;
  angularSpreadThreshold?: number;
  angular?: 'auto' | 'yes' | 'no';
  includeSources?: string[];
  excludeSources?: string[];
  minSources?: number;
  stalenessTimeoutMs?: number;
  emitMinIntervalMs?: number;
  jumpRejection?: JumpConfig;
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
  angular: 'auto' | 'yes' | 'no';
  includeSources?: string[] | undefined;
  excludeSources?: string[] | undefined;
  minSources: number;
  stalenessTimeoutMs: number;
  emitMinIntervalMs: number;
  jumpRejection?: JumpConfig | undefined;
  slewLimit?: number | undefined;
}

export interface PluginOptions {
  defaultStalenessTimeoutMs: number;
  defaultEmitMinIntervalMs: number;
  defaultMinSources: number;
  maxSourcesPerPath: number;
  paths: RawPathConfig[];
}

export interface ResolvedConfig {
  maxSourcesPerPath: number;
  paths: PathConfig[];
}

export interface ConfigError {
  path: string;
  message: string;
}

export interface ValidationResult {
  config: ResolvedConfig;
  errors: ConfigError[];
  advisories: ConfigError[];
}

export const DEFAULT_MAX_SOURCES_PER_PATH = 16;

const METHODS: CombineMethod[] = ['median', 'trimmedMean', 'mean'];
const ANGULAR_MODES = ['auto', 'yes', 'no'];

function positive(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n) && n > 0;
}

function nonNegative(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n) && n >= 0;
}

interface PathValidation {
  path?: PathConfig;
  errors: ConfigError[];
  advisories: ConfigError[];
}

interface ResolvedScalars {
  method: CombineMethod;
  angular: 'auto' | 'yes' | 'no';
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
  if (!METHODS.includes(method)) {
    return { error: { path: id, message: `unknown method ${method}` } };
  }
  const angular = raw.angular ?? 'auto';
  if (!ANGULAR_MODES.includes(angular)) {
    return { error: { path: id, message: `unknown angular mode ${angular}` } };
  }
  const trimFraction = raw.trimFraction ?? 0.25;
  if (!(trimFraction >= 0 && trimFraction < 0.5)) {
    return { error: { path: id, message: 'trimFraction must be in [0, 0.5)' } };
  }
  const staleness = raw.stalenessTimeoutMs ?? options.defaultStalenessTimeoutMs;
  const emitInterval = raw.emitMinIntervalMs ?? options.defaultEmitMinIntervalMs;
  const minSources = raw.minSources ?? options.defaultMinSources;
  if (!positive(staleness) || !nonNegative(emitInterval) || !positive(minSources)) {
    return {
      error: {
        path: id,
        message: 'staleness and minSources must be positive; emit interval must be non-negative',
      },
    };
  }
  return { scalars: { method, angular, trimFraction, staleness, emitInterval, minSources } };
}

function validatePathEntry(raw: RawPathConfig, options: PluginOptions): PathValidation {
  const id = raw.path;
  if (!id || typeof id !== 'string') {
    return { errors: [{ path: String(id), message: 'missing path' }], advisories: [] };
  }

  const scalarsResult = validateScalars(id, raw, options);
  if ('error' in scalarsResult) {
    return { errors: [scalarsResult.error], advisories: [] };
  }
  const { method, angular, trimFraction, staleness, emitInterval, minSources } =
    scalarsResult.scalars;

  const errors: ConfigError[] = [];
  for (const [k, v] of [
    ['rejectThreshold', raw.rejectThreshold],
    ['disagreeThreshold', raw.disagreeThreshold],
    ['angularSpreadThreshold', raw.angularSpreadThreshold],
  ] as const) {
    if (v != null && !positive(v)) {
      errors.push({ path: id, message: `${k} must be positive when set` });
    }
  }
  if (raw.jumpRejection && !positive(raw.jumpRejection.maxRate)) {
    errors.push({ path: id, message: 'jumpRejection.maxRate must be positive' });
  }
  if (errors.length > 0) return { errors, advisories: [] };

  const advisories: ConfigError[] = [];
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
      madThreshold: raw.madThreshold ?? 3,
      rejectThreshold: raw.rejectThreshold,
      disagreeThreshold: raw.disagreeThreshold,
      angularSpreadThreshold: raw.angularSpreadThreshold ?? Math.PI / 2,
      angular,
      includeSources: raw.includeSources,
      excludeSources: raw.excludeSources,
      minSources,
      stalenessTimeoutMs: staleness,
      emitMinIntervalMs: emitInterval,
      jumpRejection: raw.jumpRejection,
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
    const result = validatePathEntry(raw, options);
    errors.push(...result.errors);
    advisories.push(...result.advisories);
    if (result.path) paths.push(result.path);
  }

  const maxSourcesPerPath = positive(options.maxSourcesPerPath)
    ? options.maxSourcesPerPath
    : DEFAULT_MAX_SOURCES_PER_PATH;
  return { config: { maxSourcesPerPath, paths }, errors, advisories };
}
