import type { AngularMode } from './config';
import type { Attitude, AttitudeComponent, Kind, LatLon, SampleValue } from './metrics';
import { ATTITUDE_COMPONENTS, mapAttitudeComponents } from './metrics';

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
    // Asymmetry is deliberate: an object carrying latitude or longitude keys
    // IS a position, so a partial one is a malformed (likely transient)
    // sample and is dropped as 'invalid'. An attitude legitimately carries
    // fewer than three components, so its test lives in isAttitudeLike.
    if ('latitude' in value || 'longitude' in value) {
      return isLatLon(value) ? 'latlon' : 'invalid';
    }
    return isAttitudeLike(value) ? 'attitude' : 'nonCombinable';
  }
  return 'nonCombinable';
}

/**
 * How a radian-valued path behaves at the 0 and 2pi seam.
 *
 * - `fullCircle`: the quantity wraps, so it must be combined circularly. Two
 *   sources at 359 and 1 degrees are 2 degrees apart, not 358.
 * - `bounded`: the quantity is confined well inside one turn (a rudder angle,
 *   a magnetic variation, a tacking angle), so a linear combination is right
 *   and a circular one would answer "undefined" for a legitimate spread such
 *   as hard to port against hard to starboard.
 * - `unknown`: the path reports radians but matches neither list. Scalar
 *   combining is a guess: correct for a bounded angle, and exactly backwards
 *   for a bearing.
 */
export type AngleFamily = 'fullCircle' | 'bounded' | 'unknown';

// Full-circle quantities named exactly by the Signal K specification. Every
// entry wraps at the 0 and 2pi seam, so all of them must combine circularly.
// The wind angles belong here even though they are published on a -pi..pi
// branch: they wrap at dead astern, which circular combining handles natively.
// The specification defines environment.current as one object, which is how
// the stock mappers publish it and which this plugin does not combine; the two
// set entries cover a publisher that splits it into its own paths.
const FULL_CIRCLE_PATHS: ReadonlySet<string> = new Set([
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
  'environment.current.setTrue',
  'environment.current.setMagnetic',
  'steering.autopilot.target.headingTrue',
  'steering.autopilot.target.headingMagnetic',
  'steering.autopilot.target.windAngleApparent',
  'steering.autopilot.target.windAngleTrue',
  'performance.tackTrue',
  'performance.tackMagnetic',
  'performance.targetAngle',
]);

// The course families are structurally parallel: `navigation.course.calcValues`
// (published by the server's own course provider), `navigation.courseGreatCircle`,
// and `navigation.courseRhumbline` all carry the same bearing leaves, and the
// v2 course API keeps adding to that shape. A prefix plus leaf rule covers
// every present and future bearing in those subtrees without enumerating the
// dozen names, and the anchored prefix stops it leaking anywhere else. The
// `bearingToDestination` and `bearingOriginToDestination` leaves are the ones
// the NMEA 0183 APB, BOD, and Seatalk mappers publish directly under
// `navigation.courseRhumbline`.
const COURSE_PREFIXES = [
  'navigation.course.calcValues.',
  'navigation.courseGreatCircle.',
  'navigation.courseRhumbline.',
] as const;

const COURSE_BEARING_LEAVES: ReadonlySet<string> = new Set([
  'bearingTrackTrue',
  'bearingTrackMagnetic',
  'bearingTrue',
  'bearingMagnetic',
  'bearingToDestinationTrue',
  'bearingToDestinationMagnetic',
  'bearingOriginToDestinationTrue',
  'bearingOriginToDestinationMagnetic',
]);

// Radian paths the specification confines well inside one turn. Listing them
// keeps the unrecognized-angle advisory quiet for paths where scalar combining
// is the right answer, so the advisory only fires on a genuinely unknown path.
const BOUNDED_ANGLE_PATHS: ReadonlySet<string> = new Set([
  'navigation.magneticVariation',
  'navigation.magneticDeviation',
  'navigation.leewayAngle',
  'performance.leeway',
  'performance.beatAngle',
  'performance.gybeAngle',
  'steering.rudderAngle',
  'steering.rudderAngleTarget',
  'steering.autopilot.deadZone',
  'steering.autopilot.backlash',
  'steering.autopilot.portLock',
  'steering.autopilot.starboardLock',
  'design.keel.angle',
  'environment.wind.directionChangeAlarm',
]);

// propulsion.<instance>.drive.thrustAngle carries an instance name in the
// middle, so it needs the same prefix plus leaf treatment as the bearings.
const THRUST_ANGLE_SUFFIX = '.drive.thrustAngle';

// Depth paths where a smaller number means less water under the vessel. They
// live beside the other Signal K path tables so a reviewer extending one sees
// all three, rather than in the runtime where the damping stage happens to
// consult them.
const SHOALING_DEPTH_PATHS: ReadonlySet<string> = new Set([
  'environment.depth.belowKeel',
  'environment.depth.belowTransducer',
  'environment.depth.belowSurface',
]);

function leafOf(path: string): string {
  const dot = path.lastIndexOf('.');
  return dot === -1 ? path : path.slice(dot + 1);
}

function isCourseBearing(path: string): boolean {
  if (!COURSE_BEARING_LEAVES.has(leafOf(path))) return false;
  return COURSE_PREFIXES.some((prefix) => path.startsWith(prefix));
}

/**
 * Classify a radian-valued path against the Signal K specification. Exported so
 * the runtime can tell an operator when it is combining an unrecognized angle
 * linearly, which is the case that publishes a reciprocal bearing.
 */
export function angleFamily(path: string): AngleFamily {
  if (FULL_CIRCLE_PATHS.has(path) || isCourseBearing(path)) return 'fullCircle';
  if (BOUNDED_ANGLE_PATHS.has(path)) return 'bounded';
  if (path.startsWith('propulsion.') && path.endsWith(THRUST_ANGLE_SUFFIX)) return 'bounded';
  return 'unknown';
}

function isLatLon(v: unknown): v is LatLon {
  if (typeof v !== 'object' || v === null) return false;
  const { latitude, longitude } = v as LatLon;
  return (
    Number.isFinite(latitude) &&
    latitude >= -90 &&
    latitude <= 90 &&
    Number.isFinite(longitude) &&
    longitude >= -180 &&
    longitude <= 180
  );
}

// A missing or non-finite component is absent rather than disqualifying:
// n2k-signalk publishes a component the sensor does not measure as NaN, so a
// heel sensor reads { roll, pitch, yaw: NaN }.
function finiteComponent(value: object, c: AttitudeComponent): number | undefined {
  const x: unknown = Reflect.get(value, c);
  return typeof x === 'number' && Number.isFinite(x) ? x : undefined;
}

// An attitude carries at least one finite angular component, and nothing but a
// number, null, or nothing at all under any component name.
function isAttitudeLike(value: object): boolean {
  let finite = 0;
  for (const c of ATTITUDE_COMPONENTS) {
    const x: unknown = Reflect.get(value, c);
    if (typeof x === 'number') {
      if (Number.isFinite(x)) finite++;
    } else if (x !== undefined && x !== null) {
      return false;
    }
  }
  return finite > 0;
}

/**
 * The attitude with only its finite components, which is what the combiner and
 * the emitter expect. The same object comes back when nothing needs dropping,
 * which is every reading from a full motion sensor.
 */
export function normalizeAttitude(value: object): Attitude {
  const complete = ATTITUDE_COMPONENTS.every(
    (c) => finiteComponent(value, c) !== undefined || Reflect.get(value, c) === undefined
  );
  return complete ? (value as Attitude) : mapAttitudeComponents((c) => finiteComponent(value, c));
}

// Shown in the panel, and written to the server log, for a path that reports
// radians but is neither a known full-circle quantity nor a known bounded
// angle, so scalar combining is a guess that publishes the reciprocal bearing
// if the path in fact wraps.
export const UNRECOGNIZED_ANGLE_ADVISORY =
  'This path reports radians but is not a Signal K angle this plugin recognizes, so it is being averaged linearly. If it wraps at 360 degrees, such as a heading or a bearing, set Angular wrapping to Yes. If it does not, such as a rudder angle, set it to No.';

export interface Classification {
  kind: Kind;
  /**
   * Set when `auto` mode saw radian units on a path that is neither a known
   * full-circle quantity nor a known bounded angle. The value is still combined
   * as a scalar, which is right for a bounded angle and exactly backwards for a
   * bearing, so the runtime announces it rather than guessing in silence.
   */
  unrecognizedAngle?: true;
  /**
   * The direction of change that must never be smoothed. `decreasing` marks a
   * depth: a rise toward shallower water is a grounding hazard, and there is no
   * safe reason to report more water under the vessel than the sounders see.
   */
  safeDirection?: 'decreasing';
}

// A scalar depth carries the shoaling rule; every other kind and path does not.
// Written as one helper so both the `no` override and the automatic path build
// the same classification.
function scalarClassification(path: string): Classification {
  return SHOALING_DEPTH_PATHS.has(path)
    ? { kind: 'scalar', safeDirection: 'decreasing' }
    : { kind: 'scalar' };
}

export function classify(
  path: string,
  value: SampleValue,
  angularMode: AngularMode,
  getUnits: MetadataLookup,
  context: string
): Classification {
  if (isLatLon(value)) return { kind: 'position' };
  if (typeof value === 'object') return { kind: isAttitudeLike(value) ? 'attitude' : 'other' };
  if (!Number.isFinite(value)) return { kind: 'other' };
  // Both overrides are absolute, in both directions: 'yes' turns on circular
  // combining for a path the specification does not name, and 'no' turns it off
  // for one it does. They are the escape hatch when this classifier is wrong,
  // so neither consults the family or the units.
  if (angularMode === 'yes') return { kind: 'angular' };
  if (angularMode === 'no') return scalarClassification(path);
  const family = angleFamily(path);
  // A known full-circle path is angular whatever the metadata says. The server
  // does not resolve units for every specification path (nextPoint bearings and
  // environment.current components among them), so requiring 'rad' here would
  // reinstate the reciprocal-bearing bug on exactly the paths that matter most.
  if (family === 'fullCircle') return { kind: 'angular' };
  if (family === 'bounded') return { kind: 'scalar' };
  const units = getUnits(`${context}.${path}`)?.units;
  return units === 'rad'
    ? { ...scalarClassification(path), unrecognizedAngle: true }
    : scalarClassification(path);
}
