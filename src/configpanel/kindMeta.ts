// Pure map from kind string to display metadata for the kind badge.
//
// token values:
//   'muted'  - uses --skn-surface-muted / --skn-text-muted (combinable kinds)
//   'warn'   - uses --skn-warn-bg / --skn-warn-fg (non-combinable: other)

export interface KindMeta {
  /** Display label shown inside the pill. */
  label: string;
  /** Token family name for the badge: 'muted' or 'warn'. */
  token: 'muted' | 'warn';
  /** Screen-reader phrasing for the accessible label. */
  srLabel: string;
}

const META: Record<string, KindMeta> = {
  position: { label: 'position', token: 'muted', srLabel: 'kind: position' },
  angular: { label: 'angular', token: 'muted', srLabel: 'kind: angular' },
  scalar: { label: 'scalar', token: 'muted', srLabel: 'kind: scalar' },
  other: { label: 'other', token: 'warn', srLabel: 'kind: other (not combinable)' },
  unknown: { label: 'unknown', token: 'muted', srLabel: 'kind: unknown' },
};

const FALLBACK: KindMeta = { label: 'unknown', token: 'muted', srLabel: 'kind: unknown' };

export function kindMeta(kind: string): KindMeta {
  return META[kind] ?? FALLBACK;
}
