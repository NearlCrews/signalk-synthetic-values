// Which detected paths are meaningful to combine across sources.
//
// The path classifier decides how to combine a value (scalar, angular, or
// position) from its TYPE, but it cannot see MEANING: a satellite count and a
// depth are both numbers. Some numeric Signal K paths describe a single
// receiver's GNSS solution rather than a measured quantity, so blending them
// across receivers is meaningless even though the value is numeric.
//
// These are exactly the GNSS fix-metadata fields the emitter cannon plugin
// forwards to NMEA 2000 for display (PGN 129029 GNSS Position Data, 129539
// GNSS DOPs, and 129540 Satellites in View): a plotter shows them so you can
// judge the fix it is using, not so you can average them. They are still
// detected and may be opted in by hand; they are just kept out of
// "Combine all" and flagged in the panel.
const NON_COMBINABLE_PATHS: ReadonlySet<string> = new Set([
  'navigation.gnss.satellites',
  'navigation.gnss.satellitesInView',
  'navigation.gnss.horizontalDilution',
  'navigation.gnss.verticalDilution',
  'navigation.gnss.positionDilution',
  'navigation.gnss.differentialAge',
  'navigation.gnss.differentialReference',
  'navigation.gnss.methodQuality',
  'navigation.gnss.integrity',
  'navigation.gnss.type',
]);

/** True unless the path is known GNSS fix metadata that is not meaningful to average. */
export function isMeaningfulToCombine(path: string): boolean {
  return !NON_COMBINABLE_PATHS.has(path);
}

// Shown in the panel when a value cannot be averaged at all (text or an object).
export const NON_NUMERIC_ADVISORY =
  'This value is text or an object, not a number or position, so it cannot be averaged.';

// Shown in the panel for numeric GNSS fix metadata that is detected but not
// meaningful to average across receivers.
export const NON_MEANINGFUL_ADVISORY =
  'GNSS fix metadata (a satellite count, dilution of precision, or correction reference). It describes one receiver, so averaging it across receivers is not meaningful. You can still combine it by hand.';
