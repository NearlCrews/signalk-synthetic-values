import { systemClock } from './clock'
import { Kind, SampleValue } from './metrics'
import { Registry } from './registry'
import { Discovery } from './discovery'
import { Emitter } from './emitter'
import { combine, CombineOptions, Sample } from './combine'
import { applyJump, applySlew, JumpState, SlewState } from './damping'
import { classify, MetadataLookup } from './pathClassifier'
import { validateConfig, PluginOptions, PathConfig } from './config'
import { buildSchema } from './schema'
import { pathStatus, summaryStatus } from './status'

const PLUGIN_ID = 'signalk-synthetic-values'

export = function (app: any) {
  let unregister: (() => void) | null = null
  let selfContext = 'vessels.self'
  let byPath = new Map<string, PathConfig>()
  const registry = new Registry(systemClock, 16)
  const discovery = new Discovery()
  const emitter = new Emitter(app, PLUGIN_ID, systemClock)
  const jumpState = new Map<string, Map<string, JumpState>>()
  const slewState = new Map<string, SlewState>()
  const classification = new Map<string, Kind>()
  const skipped: { path: string; reason: string }[] = []
  const prioritySet = new Set<string>() // best-effort; populated only if we ever learn priority. Stays empty in v1.

  const getUnits: MetadataLookup = (p) => {
    try {
      return app.getMetadata ? app.getMetadata(p) : undefined
    } catch {
      return undefined
    }
  }

  function isSelf(context: string | undefined): boolean {
    return context === undefined || context === selfContext
  }

  function isOwnSource(src: string): boolean {
    return src === PLUGIN_ID || src.startsWith(PLUGIN_ID + '.')
  }

  function classifyPath(path: string, value: SampleValue, cfg: PathConfig): Kind {
    const cached = classification.get(path)
    if (cached) return cached
    const kind = classify(path, value, cfg.angular, getUnits, selfContext)
    classification.set(path, kind)
    if (kind === 'other') skipped.push({ path, reason: 'non-combinable value' })
    return kind
  }

  function damped(path: string, cfg: PathConfig, kind: Kind, samples: Sample[], now: number): Sample[] {
    if (!cfg.jumpRejection) return samples
    let perSource = jumpState.get(path)
    if (!perSource) {
      perSource = new Map()
      jumpState.set(path, perSource)
    }
    return samples.map((s) => {
      const r = applyJump(kind, perSource!.get(s.sourceRef), s.value, now, cfg.jumpRejection!)
      perSource!.set(s.sourceRef, r.state)
      return { sourceRef: s.sourceRef, value: r.accepted }
    })
  }

  function maybeEmit(path: string, cfg: PathConfig): void {
    let samples = registry.fresh(path, cfg.stalenessTimeoutMs)
    const value0 = samples[0]?.value
    if (value0 === undefined) return
    const kind = classifyPath(path, value0, cfg)
    if (kind === 'other') return

    const now = systemClock.now()
    if (cfg.includeSources?.length) samples = samples.filter((s) => cfg.includeSources!.includes(s.sourceRef))
    if (cfg.excludeSources?.length) samples = samples.filter((s) => !cfg.excludeSources!.includes(s.sourceRef))
    samples = damped(path, cfg, kind, samples, now)

    const opts: CombineOptions = {
      kind,
      method: cfg.method,
      minSources: cfg.minSources,
      outlierRejection: cfg.outlierRejection,
      madThreshold: cfg.madThreshold,
      rejectThreshold: cfg.rejectThreshold,
      disagreeThreshold: cfg.disagreeThreshold,
      angularSpreadThreshold: cfg.angularSpreadThreshold,
      trimFraction: cfg.trimFraction,
    }
    const result = combine(samples, opts)
    app.setPluginStatus(pathStatus(path, result, PLUGIN_ID, cfg.minSources, prioritySet.has(path)))
    if (result.value === undefined) return

    let value = result.value
    if (cfg.slewLimit != null) {
      const r = applySlew(kind, slewState.get(path), value, now, cfg.slewLimit)
      slewState.set(path, r.state)
      value = r.value
    }
    emitter.maybeEmit(path, value, PLUGIN_ID, cfg.emitMinIntervalMs)
  }

  function observe(delta: any): void {
    if (!delta || !isSelf(delta.context)) return
    for (const update of delta.updates ?? []) {
      const src: string | undefined = update.$source
      if (!src || isOwnSource(src) || !Array.isArray(update.values)) continue
      for (const pv of update.values) {
        const cfg = byPath.get(pv.path)
        if (!cfg) continue
        discovery.observe(pv.path, src)
        registry.update(pv.path, src, pv.value, systemClock.now())
        maybeEmit(pv.path, cfg)
      }
    }
  }

  return {
    id: PLUGIN_ID,
    name: 'Synthetic Values',
    schema: () => buildSchema(() => discovery.detected()),

    start(options: PluginOptions) {
      const { config, errors, advisories } = validateConfig(options)
      registry.setMaxSourcesPerPath(config.maxSourcesPerPath)
      byPath = new Map(config.paths.map((p) => [p.path, p]))
      selfContext = app.selfContext ?? 'vessels.self'
      registry.reset()
      emitter.reset()
      jumpState.clear()
      slewState.clear()
      classification.clear()
      skipped.length = 0
      for (const e of [...errors, ...advisories]) {
        skipped.push({ path: e.path, reason: e.message })
        app.debug(`config ${e.path}: ${e.message}`)
      }
      unregister = app.registerDeltaInputHandler((delta: any, next: (d: any) => void) => {
        try {
          observe(delta)
        } catch (err) {
          app.setPluginError(err instanceof Error ? err.message : String(err))
          app.error(err)
        }
        next(delta)
      })
      app.setPluginStatus(summaryStatus(byPath.size, discovery.detected().length, skipped))
    },

    stop() {
      if (unregister) {
        unregister()
        unregister = null
      }
      registry.reset()
      emitter.reset()
      discovery.reset()
      jumpState.clear()
      slewState.clear()
      classification.clear()
    },

    registerWithRouter(router: any) {
      router.get('/detected', (_req: any, res: any) => {
        const detected = discovery.detected()
        res.json({
          paths: detected.map((d) => ({
            path: d.path,
            sources: d.sources,
            kind: classification.get(d.path) ?? 'unknown',
            optedIn: byPath.has(d.path),
          })),
        })
      })
    },
  }
}
