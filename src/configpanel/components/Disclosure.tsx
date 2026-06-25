import type * as React from 'react';
import { S } from '../styles.js';

interface DisclosureProps {
  /** Toggle button label (text or nodes). */
  label: React.ReactNode;
  /** Stable id linking the toggle (aria-controls) to its body. */
  bodyId: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
  /** Overrides merged over S.disclosureToggle (padding, font size, etc.). */
  toggleStyle?: React.CSSProperties | undefined;
  /** Style applied to the body wrapper when open. */
  bodyStyle?: React.CSSProperties | undefined;
  /** Forwarded to the toggle button, for callers that manage focus return. */
  toggleRef?: React.Ref<HTMLButtonElement> | undefined;
}

/**
 * Expand/collapse disclosure shared by the detected-path groups, the per-row
 * Tune section, and the Advanced settings tier. Renders the S.disclosureToggle
 * button with the caret glyph and the aria-controls body wrapper, so the same
 * markup is not re-implemented per call site.
 *
 * The body is always rendered (kept in the DOM with `hidden` when collapsed) so
 * its id stays linkable for aria-controls.
 */
export function Disclosure({
  label,
  bodyId,
  open,
  onToggle,
  children,
  toggleStyle,
  bodyStyle,
  toggleRef,
}: DisclosureProps): React.ReactElement {
  return (
    <>
      <button
        ref={toggleRef}
        type="button"
        style={toggleStyle ? { ...S.disclosureToggle, ...toggleStyle } : S.disclosureToggle}
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={onToggle}
      >
        <span aria-hidden="true" style={{ marginRight: 6 }}>
          {open ? '▾' : '▸'}
        </span>
        {label}
      </button>
      {open ? (
        <div id={bodyId} style={bodyStyle}>
          {children}
        </div>
      ) : (
        <div id={bodyId} hidden />
      )}
    </>
  );
}
