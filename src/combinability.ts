// Which detected paths are meaningful to combine across sources.
//
// The path classifier decides how to combine a value (scalar, angular, or
// position) from its TYPE, but it cannot see MEANING: a satellite count and a
// depth are both numbers. Some numeric Signal K paths describe one source's own
// state rather than a measured quantity, so blending them across sources is
// meaningless even though the value is numeric.
//
// The GNSS entries are exactly the fix-metadata fields the emitter cannon
// plugin forwards to NMEA 2000 for display (PGN 129029 GNSS Position Data,
// 129539 GNSS DOPs, and 129540 Satellites in View): a plotter shows them so you
// can judge the fix it is using, not so you can average them. They are still
// detected and may be opted in by hand; they are just kept out of "Combine all"
// and flagged in the panel.

import { UNRECOGNIZED_ANGLE_ADVISORY } from './pathClassifier';

const GNSS_ADVISORY =
  'GNSS fix metadata (a satellite count, dilution of precision, or correction reference). It describes one receiver, so averaging it across receivers is not meaningful. You can still combine it by hand.';

const VARIATION_AGE_ADVISORY =
  'The time one source last calculated magnetic variation. It is a timestamp, not a measurement, so averaging it across sources is not meaningful. You can still combine it by hand.';

// Each path that is not meaningful to average, with the reason the panel shows.
const NOT_MEANINGFUL: ReadonlyMap<string, string> = new Map([
  ['navigation.gnss.satellites', GNSS_ADVISORY],
  ['navigation.gnss.satellitesInView', GNSS_ADVISORY],
  ['navigation.gnss.horizontalDilution', GNSS_ADVISORY],
  ['navigation.gnss.verticalDilution', GNSS_ADVISORY],
  ['navigation.gnss.positionDilution', GNSS_ADVISORY],
  ['navigation.gnss.differentialAge', GNSS_ADVISORY],
  ['navigation.gnss.differentialReference', GNSS_ADVISORY],
  ['navigation.gnss.methodQuality', GNSS_ADVISORY],
  ['navigation.gnss.integrity', GNSS_ADVISORY],
  ['navigation.gnss.type', GNSS_ADVISORY],
  ['navigation.magneticVariationAgeOfService', VARIATION_AGE_ADVISORY],
]);

/** True unless the path is known per-source metadata that is not meaningful to average. */
export function isMeaningfulToCombine(path: string): boolean {
  return !NOT_MEANINGFUL.has(path);
}

// Shown in the panel when a value cannot be averaged at all (text or an object).
export const NON_NUMERIC_ADVISORY =
  'This value is text or an object, not a number or position, so it cannot be averaged.';

// Signal K Server 2.31 and later, with GNSS offset correction set to "both",
// republishes each configured antenna's position corrected to the vessel's
// reference point under a `<sensor>.ccrp` source, beside the raw one. The copy
// is named after the sensor's label rather than its source, so the plugin
// cannot pair the two, and left alone each antenna votes twice.
const CCRP_SOURCE_SUFFIX = '.ccrp';

const CCRP_ADVISORY =
  'Some sources here are offset-corrected copies (.ccrp) that the server publishes beside the raw antenna positions, so each corrected antenna is counted twice. Exclude either the .ccrp sources or the raw ones, or set GNSS offset correction in the server settings to replace.';

function mixesCorrectedPositions(sources: readonly string[]): boolean {
  const corrected = sources.filter((source) => source.endsWith(CCRP_SOURCE_SUFFIX)).length;
  return corrected > 0 && corrected < sources.length;
}

export interface AdvisoryFacts {
  path: string;
  sources: readonly string[];
  /** Whether the value can be averaged at all. */
  combinable: boolean;
  /** Whether the path reports radians the classifier could not place. */
  unrecognizedAngle: boolean;
  /** Why the path never gathers enough fresh sources, when that is known. */
  slowReporting?: string | undefined;
}

/**
 * Everything the panel should say about a detected row, joined into the one
 * string the row renders. Several can apply at once: a slow-reporting path can
 * also be one whose angular wrapping is unconfirmed.
 */
export function detectedAdvisory(facts: AdvisoryFacts): string {
  const advisories: string[] = [];
  const notMeaningful = NOT_MEANINGFUL.get(facts.path);
  if (!facts.combinable) advisories.push(NON_NUMERIC_ADVISORY);
  else if (notMeaningful !== undefined) advisories.push(notMeaningful);
  if (facts.unrecognizedAngle) advisories.push(UNRECOGNIZED_ANGLE_ADVISORY);
  if (mixesCorrectedPositions(facts.sources)) advisories.push(CCRP_ADVISORY);
  if (facts.slowReporting) advisories.push(facts.slowReporting);
  return advisories.join(' ');
}
