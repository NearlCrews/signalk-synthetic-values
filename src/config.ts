import { CombineMethod } from './combine'
import { JumpConfig } from './damping'

export interface RawPathConfig {
  path: string
  method?: CombineMethod
  trimFraction?: number
  outlierRejection?: boolean
  madThreshold?: number
  rejectThreshold?: number
  disagreeThreshold?: number
  angularSpreadThreshold?: number
  angular?: 'auto' | 'yes' | 'no'
  includeSources?: string[]
  excludeSources?: string[]
  minSources?: number
  stalenessTimeoutMs?: number
  emitMinIntervalMs?: number
  jumpRejection?: JumpConfig
  slewLimit?: number
}

export interface PathConfig {
  path: string
  method: CombineMethod
  trimFraction: number
  outlierRejection: boolean
  madThreshold: number
  rejectThreshold?: number
  disagreeThreshold?: number
  angularSpreadThreshold: number
  angular: 'auto' | 'yes' | 'no'
  includeSources?: string[]
  excludeSources?: string[]
  minSources: number
  stalenessTimeoutMs: number
  emitMinIntervalMs: number
  jumpRejection?: JumpConfig
  slewLimit?: number
}

export interface PluginOptions {
  defaultStalenessTimeoutMs: number
  defaultEmitMinIntervalMs: number
  defaultMinSources: number
  maxSourcesPerPath: number
  paths: RawPathConfig[]
}

export interface ResolvedConfig {
  maxSourcesPerPath: number
  paths: PathConfig[]
}

export interface ConfigError {
  path: string
  message: string
}

export interface ValidationResult {
  config: ResolvedConfig
  errors: ConfigError[]
  advisories: ConfigError[]
}

export const DEFAULT_MAX_SOURCES_PER_PATH = 16

const METHODS: CombineMethod[] = ['median', 'trimmedMean', 'mean']
const ANGULAR_MODES = ['auto', 'yes', 'no']

function positive(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n) && n > 0
}

function nonNegative(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n) && n >= 0
}

export function validateConfig(options: PluginOptions): ValidationResult {
  const errors: ConfigError[] = []
  const advisories: ConfigError[] = []
  const paths: PathConfig[] = []
  const seen = new Set<string>()

  for (const raw of options.paths ?? []) {
    const id = raw.path
    if (!id || typeof id !== 'string') {
      errors.push({ path: String(id), message: 'missing path' })
      continue
    }
    if (seen.has(id)) {
      errors.push({ path: id, message: 'duplicate path entry ignored' })
      continue
    }
    seen.add(id)
    let hadError = false
    if (raw.includeSources?.length && raw.excludeSources?.length) {
      errors.push({ path: id, message: 'set either includeSources or excludeSources, not both' })
      continue
    }
    const method = raw.method ?? 'median'
    if (!METHODS.includes(method)) {
      errors.push({ path: id, message: `unknown method ${method}` })
      continue
    }
    const angular = raw.angular ?? 'auto'
    if (!ANGULAR_MODES.includes(angular)) {
      errors.push({ path: id, message: `unknown angular mode ${angular}` })
      continue
    }
    const trimFraction = raw.trimFraction ?? 0.25
    if (!(trimFraction >= 0 && trimFraction < 0.5)) {
      errors.push({ path: id, message: 'trimFraction must be in [0, 0.5)' })
      continue
    }
    const staleness = raw.stalenessTimeoutMs ?? options.defaultStalenessTimeoutMs
    const emitInterval = raw.emitMinIntervalMs ?? options.defaultEmitMinIntervalMs
    const minSources = raw.minSources ?? options.defaultMinSources
    if (!positive(staleness) || !nonNegative(emitInterval) || !positive(minSources)) {
      errors.push({ path: id, message: 'staleness and minSources must be positive; emit interval must be non-negative' })
      continue
    }
    for (const [k, v] of [
      ['rejectThreshold', raw.rejectThreshold],
      ['disagreeThreshold', raw.disagreeThreshold],
      ['angularSpreadThreshold', raw.angularSpreadThreshold],
    ] as const) {
      if (v != null && !positive(v)) {
        errors.push({ path: id, message: `${k} must be positive when set` })
        hadError = true
      }
    }
    if (raw.jumpRejection && !positive(raw.jumpRejection.maxRate)) {
      errors.push({ path: id, message: 'jumpRejection.maxRate must be positive' })
      hadError = true
    }
    if (hadError) continue

    const outlierRejection = raw.outlierRejection ?? true
    if (!outlierRejection && raw.madThreshold != null) {
      advisories.push({ path: id, message: 'madThreshold ignored while outlierRejection is off' })
    }
    paths.push({
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
    })
  }

  const maxSourcesPerPath = positive(options.maxSourcesPerPath) ? options.maxSourcesPerPath : DEFAULT_MAX_SOURCES_PER_PATH
  return { config: { maxSourcesPerPath, paths }, errors, advisories }
}
