import type { CSSProperties } from 'react';
import { kindMeta } from '../kindMeta';
import { S } from '../styles';

interface KindBadgeProps {
  kind: string;
}

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

  const pillStyle: CSSProperties =
    meta.token === 'warn'
      ? {
          display: 'inline-block',
          fontSize: 'var(--skn-font-small)',
          padding: '1px 6px',
          borderRadius: 'var(--skn-radius-sm)',
          background: 'var(--skn-warn-bg)',
          color: 'var(--skn-warn-fg)',
          border: '1px solid var(--skn-warn-border)',
        }
      : {
          display: 'inline-block',
          fontSize: 'var(--skn-font-small)',
          padding: '1px 6px',
          borderRadius: 'var(--skn-radius-sm)',
          background: 'var(--skn-surface-muted)',
          color: 'var(--skn-text-muted)',
          border: '1px solid var(--skn-border)',
        };

  return (
    <span style={pillStyle}>
      {meta.label}
      <span style={S.visuallyHidden}>{meta.srLabel}</span>
    </span>
  );
}
