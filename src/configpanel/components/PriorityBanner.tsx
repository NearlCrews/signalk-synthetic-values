import type * as React from 'react';
import { S } from '../styles.js';

export interface PriorityBannerProps {
  show: boolean;
  sourceLabel: string;
  onDismiss: () => void;
}

/**
 * A persistent, dismissible banner shown once any path is combined. It
 * explains that the synthetic value is published under the `sourceLabel`
 * source name and that the user must set it as top priority in Signal K's
 * Data, Source priorities screen for the combined value to take effect.
 *
 * Does not claim the source is "preferred" because the plugin cannot read
 * the current priority state.
 */
export function PriorityBanner({
  show,
  sourceLabel,
  onDismiss,
}: PriorityBannerProps): React.ReactElement | null {
  if (!show) return null;

  return (
    <section aria-label="Source priority reminder" style={S.infoBanner}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <strong>Set source priority to use combined values.</strong> The plugin publishes combined
        values as the source <strong>{sourceLabel}</strong>. For each combined path, you must set{' '}
        <strong>{sourceLabel}</strong> as the top priority in Signal K under Data, Source
        priorities, otherwise Signal K continues using the original sources.
      </div>
      <button
        type="button"
        aria-label="Dismiss priority reminder"
        onClick={onDismiss}
        style={S.btnInfoDismiss}
      >
        Dismiss
      </button>
    </section>
  );
}
