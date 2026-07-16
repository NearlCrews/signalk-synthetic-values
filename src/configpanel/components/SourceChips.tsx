import type * as React from 'react';
import { Badge, Cluster } from 'signalk-nearlcrews-ui';
import utilities from '../utilities.module.css';

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
export function SourceChips({ sources }: SourceChipsProps): React.ReactElement | null {
  if (sources.length === 0) return null;

  const visible = sources.slice(0, VISIBLE_MAX);
  const overflow = sources.length - VISIBLE_MAX;
  const fullList = sources.join(', ');

  return (
    <Cluster gap={1} title={fullList}>
      {visible.map((src) => (
        <Badge key={src} aria-hidden="true">
          {src}
        </Badge>
      ))}
      {overflow > 0 ? <Badge aria-hidden="true">{`+${overflow} more`}</Badge> : null}
      <span className={utilities.visuallyHidden}>Sources: {fullList}</span>
    </Cluster>
  );
}
