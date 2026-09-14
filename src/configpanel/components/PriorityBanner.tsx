import type * as React from 'react';
import { Banner } from 'signalk-nearlcrews-ui';

const PRIORITY_BANNER_TITLE = 'Set source priority to use combined values';

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

  return (
    <Banner
      // No aria-label: a banner given a landmark role takes its name from its
      // own visible title, so the region and the heading cannot drift apart.
      dismissFocusRef={dismissFocusRef}
      onDismiss={onDismiss}
      role="region"
      title={PRIORITY_BANNER_TITLE}
      tone="info"
    >
      Combined values use <strong>{sourceLabel}</strong>. In{' '}
      <a href="#/data/priorities">Data, Priorities</a>, rank it first in each relevant group. Set
      Fallback after on lower-ranked raw sources so they can take over if the plugin stops.
    </Banner>
  );
}
