import type * as React from 'react';

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
    <section
      aria-label="Source priority reminder"
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        flexWrap: 'wrap',
        gap: 'var(--skn-space-2)',
        padding: 'var(--skn-space-2) var(--skn-space-3)',
        marginBottom: 'var(--skn-space-2)',
        background: 'var(--skn-info-bg)',
        border: '1px solid var(--skn-info-border)',
        borderRadius: 'var(--skn-radius)',
        color: 'var(--skn-info-fg)',
        fontSize: 'var(--skn-font-body)',
      }}
    >
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
        style={{
          flexShrink: 0,
          padding: '4px 10px',
          minHeight: 32,
          background: 'transparent',
          color: 'var(--skn-info-fg)',
          border: '1px solid var(--skn-info-border)',
          borderRadius: 'var(--skn-radius-sm)',
          cursor: 'pointer',
          fontSize: 'var(--skn-font-small)',
        }}
      >
        Dismiss
      </button>
    </section>
  );
}
