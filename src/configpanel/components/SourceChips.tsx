import type { CSSProperties } from 'react';
import { S } from '../styles';

interface SourceChipsProps {
  sources: string[];
}

const VISIBLE_MAX = 3;

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

  const chipStyle: CSSProperties = {
    display: 'inline-block',
    fontSize: 'var(--skn-font-small)',
    padding: '1px 6px',
    borderRadius: 'var(--skn-radius-pill)',
    background: 'var(--skn-surface-raised)',
    color: 'var(--skn-text-muted)',
    border: '1px solid var(--skn-border)',
    whiteSpace: 'nowrap',
  };

  const moreStyle: CSSProperties = {
    ...chipStyle,
    color: 'var(--skn-text-faint)',
    border: '1px solid var(--skn-border)',
    background: 'var(--skn-surface-muted)',
  };

  const wrapStyle: CSSProperties = {
    display: 'inline-flex',
    gap: 4,
    flexWrap: 'wrap',
    alignItems: 'center',
  };

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
