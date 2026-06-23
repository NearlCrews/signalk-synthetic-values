import type { Kind, LatLon, SampleValue } from './metrics';

export type MetadataLookup = (contextPrefixedPath: string) => { units?: string } | undefined;

export type ValueCategory = 'number' | 'latlon' | 'invalid' | 'nonCombinable';

export function valueCategory(value: unknown): ValueCategory {
  if (value === null || value === undefined) return 'invalid';
  if (typeof value === 'number') {
    return Number.isFinite(value) ? 'number' : 'invalid';
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    if ('latitude' in obj || 'longitude' in obj) {
      return isLatLon(value) ? 'latlon' : 'invalid';
    }
    return 'nonCombinable';
  }
  return 'nonCombinable';
}

export const ANGULAR_ALLOWLIST: ReadonlySet<string> = new Set([
  'navigation.headingTrue',
  'navigation.headingMagnetic',
  'navigation.courseOverGroundTrue',
  'navigation.courseOverGroundMagnetic',
  'environment.wind.angleApparent',
  'environment.wind.angleTrueWater',
  'environment.wind.angleTrueGround',
]);

function isLatLon(v: unknown): v is LatLon {
  return (
    typeof v === 'object' &&
    v !== null &&
    Number.isFinite((v as LatLon).latitude) &&
    Number.isFinite((v as LatLon).longitude)
  );
}

export function classify(
  path: string,
  value: SampleValue,
  angularMode: 'auto' | 'yes' | 'no',
  getUnits: MetadataLookup,
  context: string
): Kind {
  if (isLatLon(value)) return 'position';
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'other';
  if (angularMode === 'yes') return 'angular';
  if (angularMode === 'no') return 'scalar';
  const units = getUnits(`${context}.${path}`)?.units;
  // Both gates are required: path must be on the allowlist AND units must be 'rad'.
  // A recently-rescaled path (units changed away from 'rad') silently downgrades to scalar.
  return ANGULAR_ALLOWLIST.has(path) && units === 'rad' ? 'angular' : 'scalar';
}
