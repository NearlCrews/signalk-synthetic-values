import type { DetectedKind } from './metrics';

/**
 * One row of the `/api/detected` response: the contract between the plugin
 * route and the configuration panel. Declared once so a new field cannot reach
 * the server row and miss the panel's view of it. The panel ships in the same
 * package as the route, so every field is always present.
 */
export interface DetectedRow {
  path: string;
  sources: string[];
  /**
   * Sources fresh in the combiner right now. Empty for a path that is not
   * configured, where no combination is running. Discovery keeps a source
   * listed for a minute; the combiner drops it after the staleness timeout, so
   * without this the panel shows a dead sensor as a contributing one.
   */
  freshSources: string[];
  kind: DetectedKind;
  optedIn: boolean;
  /** Whether the value can be averaged at all (false for text and objects). */
  combinable: boolean;
  /**
   * Whether "Combine all" should take the path: combinable, meaningful to
   * average, and of a kind the classifier is sure of.
   */
  recommended: boolean;
  /** Groups of sources that look like one sensor reported under several names. */
  duplicateGroups: string[][];
  /** Reason shown in the panel when the path is not combinable or not recommended. */
  advisory?: string;
}
