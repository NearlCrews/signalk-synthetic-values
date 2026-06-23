import { Kind, SampleValue, LatLon } from './metrics'

export type MetadataLookup = (contextPrefixedPath: string) => { units?: string } | undefined

export const ANGULAR_ALLOWLIST: ReadonlySet<string> = new Set([
  'navigation.headingTrue',
  'navigation.headingMagnetic',
  'navigation.courseOverGroundTrue',
  'navigation.courseOverGroundMagnetic',
  'environment.wind.angleApparent',
  'environment.wind.angleTrueWater',
  'environment.wind.angleTrueGround',
])

function isLatLon(v: unknown): v is LatLon {
  return (
    typeof v === 'object' && v !== null &&
    Number.isFinite((v as LatLon).latitude) &&
    Number.isFinite((v as LatLon).longitude)
  )
}

export function classify(
  path: string,
  value: SampleValue,
  angularMode: 'auto' | 'yes' | 'no',
  getUnits: MetadataLookup,
  context: string,
): Kind {
  if (isLatLon(value)) return 'position'
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'other'
  if (angularMode === 'yes') return 'angular'
  if (angularMode === 'no') return 'scalar'
  const units = getUnits(`${context}.${path}`)?.units
  return ANGULAR_ALLOWLIST.has(path) && units === 'rad' ? 'angular' : 'scalar'
}
