import type * as React from 'react';
import { kindMeta } from '../kindMeta.js';
import { S } from '../styles.js';

interface KindBadgeProps {
  kind: string;
}

// Two static variants, built once: the warn family for non-combinable 'other'
// and the muted family for every other kind. Neither depends on runtime state.
const PILL_WARN: React.CSSProperties = {
  ...S.pill,
  background: 'var(--skn-warn-bg)',
  color: 'var(--skn-warn-fg)',
  borderColor: 'var(--skn-warn-border)',
};
const PILL_MUTED: React.CSSProperties = {
  ...S.pill,
  background: 'var(--skn-surface-muted)',
  color: 'var(--skn-text-muted)',
  borderColor: 'var(--skn-border)',
};

// Quiet pill showing the kind of a detected path.
//
// The kind badge is the least prominent element in the row: it uses the muted
// surface/text family for combinable kinds (position, angular, scalar, unknown)
// and the warn family for 'other' (non-combinable). No saturated color is used,
// so the badge does not compete with the state-bearing elements beside it.
//
// Accessibility: a visually-hidden span appended after the display label
// carries the full srLabel so screen readers get the complete description.
// The display label is also read, giving context ("position", "kind: position")
// without hiding it from sighted users. aria-label is intentionally omitted on
// a plain <span> because ARIA prohibits it without a role.
export function KindBadge({ kind }: KindBadgeProps): React.ReactElement {
  const meta = kindMeta(kind);
  const pillStyle = meta.token === 'warn' ? PILL_WARN : PILL_MUTED;

  return (
    <span style={pillStyle}>
      {meta.label}
      <span style={S.visuallyHidden}>{meta.srLabel}</span>
    </span>
  );
}
