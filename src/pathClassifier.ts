import type { Attitude, Kind, LatLon, SampleValue } from './metrics';

export type MetadataLookup = (contextPrefixedPath: string) => { units?: string } | undefined;

export type ValueCategory = 'number' | 'latlon' | 'attitude' | 'invalid' | 'nonCombinable';

// The categories that carry a value the combiner can average. Keeps the
// "is this combinable" test in one place instead of an inline list of
// category comparisons at each call site.
export function isCombinableCategory(cat: ValueCategory): boolean {
  return cat === 'number' || cat === 'latlon' || cat === 'attitude';
}

export function valueCategory(value: unknown): ValueCategory {
  if (value === null || value === undefined) return 'invalid';
  if (typeof value === 'number') {
    return Number.isFinite(value) ? 'number' : 'invalid';
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    // Asymmetry is deliberate: an object carrying latitude or longitude keys
    // IS a position, so a partial one is a malformed (likely transient)
    // sample and is dropped as 'invalid'. An object missing attitude
    // components is simply a different shape, so it falls through to
    // 'nonCombinable' like any other object.
    if ('latitude' in obj || 'longitude' in obj) {
      return isLatLon(value) ? 'latlon' : 'invalid';
    }
    if (isAttitude(value)) return 'attitude';
    return 'nonCombinable';
  }
  return 'nonCombinable';
}

const ANGULAR_ALLOWLIST: ReadonlySet<string> = new Set([
  'navigation.headingTrue',
  'navigation.headingMagnetic',
  'navigation.headingCompass',
  'navigation.courseOverGroundTrue',
  'navigation.courseOverGroundMagnetic',
  'environment.wind.angleApparent',
  'environment.wind.angleTrueWater',
  'environment.wind.angleTrueGround',
  'environment.wind.directionTrue',
  'environment.wind.directionMagnetic',
]);

function isLatLon(v: unknown): v is LatLon {
  return (
    typeof v === 'object' &&
    v !== null &&
    Number.isFinite((v as LatLon).latitude) &&
    Number.isFinite((v as LatLon).longitude)
  );
}

// A combinable attitude carries all three finite angular components. A partial
// attitude (some components missing) is left non-combinable.
function isAttitude(v: unknown): v is Attitude {
  return (
    typeof v === 'object' &&
    v !== null &&
    Number.isFinite((v as Attitude).roll) &&
    Number.isFinite((v as Attitude).pitch) &&
    Number.isFinite((v as Attitude).yaw)
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
  if (isAttitude(value)) return 'attitude';
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'other';
  if (angularMode === 'yes') return 'angular';
  if (angularMode === 'no') return 'scalar';
  const units = getUnits(`${context}.${path}`)?.units;
  // Both gates are required: path must be on the allowlist AND units must be 'rad'.
  // A recently-rescaled path (units changed away from 'rad') silently downgrades to scalar.
  return ANGULAR_ALLOWLIST.has(path) && units === 'rad' ? 'angular' : 'scalar';
}
