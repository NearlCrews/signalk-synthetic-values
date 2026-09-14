import type { Kind } from './metrics';

/**
 * One row of the `/api/detected` response: the contract between the plugin
 * route and the configuration panel. Declared once so a new field cannot reach
 * the server row and miss the panel's view of it.
 */
export interface DetectedApiRow {
  path: string;
  sources: string[];
  /**
   * Sources fresh in the combiner right now. Empty for a path that is not
   * configured, where no combination is running. Discovery keeps a source
   * listed for a minute; the combiner drops it after the staleness timeout, so
   * without this the panel shows a dead sensor as a contributing one.
   */
  freshSources: string[];
  /** Sources the include or exclude lists keep out of the combination. */
  excludedSources: string[];
  kind: Kind | 'unknown';
  optedIn: boolean;
  /** Whether the value can be averaged at all (false for text and objects). */
  combinable: boolean;
  /** Whether averaging is meaningful (false for GNSS fix metadata). */
  recommended: boolean;
  /** Groups of sources reporting identical changing values: likely one feed re-broadcast. */
  duplicateGroups: string[][];
  /** Reason shown in the panel when the path is not combinable or not recommended. */
  advisory?: string;
}

/**
 * Fields a payload may omit. The panel parses whatever the route sends rather
 * than trusting it, and a field added after a panel build must not make every
 * row fail validation, so the panel's view of the row holds these optionally.
 */
type TolerantField =
  | 'freshSources'
  | 'excludedSources'
  | 'combinable'
  | 'recommended'
  | 'duplicateGroups';

/**
 * The panel's view of a detected row: the same shape as the server builds, with
 * the fields a payload may omit made optional. Derived rather than restated, so
 * a new wire field reaches both sides by construction.
 */
export type DetectedRow = Omit<DetectedApiRow, TolerantField> &
  Partial<Pick<DetectedApiRow, TolerantField>>;
