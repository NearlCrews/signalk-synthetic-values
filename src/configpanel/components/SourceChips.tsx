import type * as React from 'react';
import { S } from '../styles.js';

interface SourceChipsProps {
  sources: string[];
}

const VISIBLE_MAX = 3;

// Module-level style constants: these have no reactive dependencies and are
// identical across every render, so they live outside the component function.
const chipStyle: React.CSSProperties = {
  ...S.pillRaised,
  whiteSpace: 'nowrap',
};

const moreStyle: React.CSSProperties = {
  ...chipStyle,
  color: 'var(--skn-text-faint)',
  background: 'var(--skn-surface-muted)',
};

const wrapStyle: React.CSSProperties = {
  display: 'inline-flex',
  // 4px: a deliberately tighter gap than the 8px base token so chips read as a
  // single cluster rather than separate controls.
  gap: 4,
  flexWrap: 'wrap',
  alignItems: 'center',
};

// Renders up to 3 source chips, collapsing extras to "+N more".
//
// Accessibility:
// - The container element carries a `title` attribute with the full
//   comma-separated source list, so hover reveals every source name.
// - A visually-hidden span enumerates all sources for screen readers,
//   covering the overflow case where some names are hidden visually.
//
// These two affordances together ensure both assistive technology and
// pointer-driven users can always access every source.
export function SourceChips({ sources }: SourceChipsProps): React.ReactElement {
  const visible = sources.slice(0, VISIBLE_MAX);
  const overflow = sources.length - VISIBLE_MAX;
  const fullList = sources.join(', ');

  return (
    <span style={wrapStyle} title={fullList}>
      {visible.map((src) => (
        <span key={src} style={chipStyle}>
          {src}
        </span>
      ))}
      {overflow > 0 && <span style={moreStyle}>{`+${overflow} more`}</span>}
      <span style={S.visuallyHidden}>Sources: {fullList}</span>
    </span>
  );
}
