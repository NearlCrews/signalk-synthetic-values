// Pure map from a detected kind to the badge that shows it.
import type { DetectedKind } from '../metrics.js';

export interface KindMeta {
  /** Shared badge tone. */
  tone: 'neutral' | 'warning';
  /** Screen-reader phrasing for the accessible label. */
  srLabel: string;
}

// Keyed by the whole DetectedKind union, so a new combine kind does not compile
// until it is given a badge. `DetectedKind` is type-only, so this import adds
// nothing to the browser bundle.
const META: Record<DetectedKind, KindMeta> = {
  position: { tone: 'neutral', srLabel: 'kind: position' },
  angular: { tone: 'neutral', srLabel: 'kind: angular' },
  attitude: { tone: 'neutral', srLabel: 'kind: attitude' },
  scalar: { tone: 'neutral', srLabel: 'kind: scalar' },
  other: { tone: 'warning', srLabel: 'kind: other (not combinable)' },
  unknown: { tone: 'neutral', srLabel: 'kind: unknown' },
};

export function kindMeta(kind: DetectedKind): KindMeta {
  return META[kind];
}
