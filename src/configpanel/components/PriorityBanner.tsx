import type * as React from 'react';
import { Banner, Button } from 'signalk-nearlcrews-ui';

export interface PriorityBannerProps {
  show: boolean;
  sourceLabel: string;
  dismissFocusRef?: React.RefObject<HTMLElement | null>;
  onDismiss: () => void;
}

/**
 * A persistent, dismissible banner shown once any path is combined. It
 * explains that the synthetic value is published under the `sourceLabel`
 * source name and that the user must rank it first in Signal K's Data,
 * Priorities screen for the combined value to take effect.
 *
 * Does not claim the source is "preferred" because the plugin cannot read
 * the current priority state.
 */
export function PriorityBanner({
  show,
  sourceLabel,
  dismissFocusRef,
  onDismiss,
}: PriorityBannerProps): React.ReactElement | null {
  if (!show) return null;

  const dismissAction = (
    <Button
      aria-label="Dismiss priority reminder"
      size="compact"
      onClick={() => {
        onDismiss();
        queueMicrotask(() => dismissFocusRef?.current?.focus());
      }}
    >
      <span aria-hidden="true">×</span>
    </Button>
  );

  return (
    <Banner
      aria-label="Source priority reminder"
      actions={dismissAction}
      role="region"
      title="Set source priority to use combined values"
      tone="info"
    >
      Combined values use <strong>{sourceLabel}</strong>. In{' '}
      <a href="#/data/priorities">Data, Priorities</a>, rank it first in each relevant group. Set
      Fallback after on lower-ranked raw sources so they can take over if the plugin stops.
    </Banner>
  );
}
