// Pure map from kind string to display metadata for the kind badge.
import type { Kind } from '../metrics.js';

export interface KindMeta {
  /** Display label shown inside the pill. */
  label: string;
  /** Shared badge tone. */
  tone: 'neutral' | 'warning';
  /** Screen-reader phrasing for the accessible label. */
  srLabel: string;
}

// Typed over the full Kind union plus the 'unknown' fallback, so adding a new
// combine Kind (as 'attitude' was) is a compile error until its badge entry is
// added rather than silently routing to the 'unknown' fallback. `Kind` is
// type-only, so this import adds nothing to the browser bundle.
const META: Record<Kind | 'unknown', KindMeta> = {
  position: { label: 'position', tone: 'neutral', srLabel: 'kind: position' },
  angular: { label: 'angular', tone: 'neutral', srLabel: 'kind: angular' },
  attitude: { label: 'attitude', tone: 'neutral', srLabel: 'kind: attitude' },
  scalar: { label: 'scalar', tone: 'neutral', srLabel: 'kind: scalar' },
  other: { label: 'other', tone: 'warning', srLabel: 'kind: other (not combinable)' },
  unknown: { label: 'unknown', tone: 'neutral', srLabel: 'kind: unknown' },
};

export function kindMeta(kind: string): KindMeta {
  // 'unknown' is a required key of META, so the fallback is always defined.
  return (META as Record<string, KindMeta>)[kind] ?? META.unknown;
}
