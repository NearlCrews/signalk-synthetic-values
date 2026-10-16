import type * as React from 'react';
import { Badge, VisuallyHidden } from 'signalk-nearlcrews-ui';
import type { DetectedKind } from '../../metrics.js';
import { kindMeta } from '../kindMeta.js';

interface KindBadgeProps {
  kind: DetectedKind;
}

// The least prominent element in the row. The visible shorthand is hidden from
// assistive technology, and one visually hidden phrase gives the whole kind.
export function KindBadge({ kind }: KindBadgeProps): React.ReactElement {
  const meta = kindMeta(kind);

  return (
    <Badge tone={meta.tone}>
      <span aria-hidden="true">{kind}</span>
      <VisuallyHidden>{meta.srLabel}</VisuallyHidden>
    </Badge>
  );
}
