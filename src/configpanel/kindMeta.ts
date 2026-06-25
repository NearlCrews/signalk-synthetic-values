// Pure map from kind string to display metadata for the kind badge.
//
// token values:
//   'muted'  - uses --skn-surface-muted / --skn-text-muted (combinable kinds)
//   'warn'   - uses --skn-warn-bg / --skn-warn-fg (non-combinable: other)

import type { Kind } from '../metrics.js';

export interface KindMeta {
  /** Display label shown inside the pill. */
  label: string;
  /** Token family name for the badge: 'muted' or 'warn'. */
  token: 'muted' | 'warn';
  /** Screen-reader phrasing for the accessible label. */
  srLabel: string;
}

// Typed over the full Kind union plus the 'unknown' fallback, so adding a new
// combine Kind (as 'attitude' was) is a compile error until its badge entry is
// added rather than silently routing to the 'unknown' fallback. `Kind` is
// type-only, so this import adds nothing to the browser bundle.
const META: Record<Kind | 'unknown', KindMeta> = {
  position: { label: 'position', token: 'muted', srLabel: 'kind: position' },
  angular: { label: 'angular', token: 'muted', srLabel: 'kind: angular' },
  attitude: { label: 'attitude', token: 'muted', srLabel: 'kind: attitude' },
  scalar: { label: 'scalar', token: 'muted', srLabel: 'kind: scalar' },
  other: { label: 'other', token: 'warn', srLabel: 'kind: other (not combinable)' },
  unknown: { label: 'unknown', token: 'muted', srLabel: 'kind: unknown' },
};

export function kindMeta(kind: string): KindMeta {
  // 'unknown' is a required key of META, so the fallback is always defined.
  return (META as Record<string, KindMeta>)[kind] ?? META.unknown;
}
