import type * as React from 'react';
import { Badge } from 'signalk-nearlcrews-ui';
import { kindMeta } from '../kindMeta.js';
import utilities from '../utilities.module.css';

interface KindBadgeProps {
  kind: string;
}

// Quiet pill showing the kind of a detected path.
//
// The kind badge is the least prominent element in the row: it uses the
// neutral shared tone for combinable kinds and warning for 'other'.
//
// Accessibility: the visible shorthand is hidden from assistive technology,
// and one visually hidden phrase provides the complete kind description.
export function KindBadge({ kind }: KindBadgeProps): React.ReactElement {
  const meta = kindMeta(kind);

  return (
    <Badge tone={meta.tone}>
      <span aria-hidden="true">{meta.label}</span>
      <span className={utilities.visuallyHidden}>{meta.srLabel}</span>
    </Badge>
  );
}
