import type * as React from 'react';
import type { RawPathConfig } from '../../config.js';
import { S } from '../styles.js';

interface Props {
  sources: string[];
  includeSources: string[] | undefined;
  excludeSources: string[] | undefined;
  onChange: (patch: Partial<RawPathConfig>) => void;
}

/**
 * Renders one labeled checkbox per live source. A source is "on" (included)
 * unless it appears in excludeSources, or unless includeSources is set and
 * non-empty and the source is absent from it.
 *
 * Include/exclude model: prefer the exclude model (all on, uncheck to
 * exclude). Use includeSources only when it was already set by the caller.
 * A patch is never emitted with both includeSources and excludeSources
 * non-empty, because the config layer rejects that combination.
 */
export function SourceChecklist({
  sources,
  includeSources,
  excludeSources,
  onChange,
}: Props): React.ReactElement {
  const useIncludeModel = Array.isArray(includeSources) && includeSources.length > 0;

  function isChecked(src: string): boolean {
    if (useIncludeModel) return includeSources.includes(src);
    return !excludeSources?.includes(src);
  }

  function handleToggle(src: string, checked: boolean): void {
    if (useIncludeModel) {
      // Include model: add or remove from the include list. Never set excludeSources.
      const current = includeSources ?? [];
      const next = checked ? [...current, src] : current.filter((s) => s !== src);
      onChange({ includeSources: next });
    } else {
      // Exclude model: add or remove from the exclude list. Never set includeSources.
      const current = excludeSources ?? [];
      const next = checked ? current.filter((s) => s !== src) : [...current, src];
      onChange({ excludeSources: next });
    }
  }

  const rowStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--skn-space-1)',
    marginBottom: 4,
  };

  const labelStyle: React.CSSProperties = {
    fontSize: 'var(--skn-font-body)',
    color: 'var(--skn-text)',
    cursor: 'pointer',
  };

  return (
    <div>
      <div style={{ ...S.textSmallMuted, marginBottom: 4 }}>Sources</div>
      {sources.map((src) => {
        const id = `skn-src-${src.replace(/[^a-z0-9]/gi, '-')}`;
        return (
          <div key={src} style={rowStyle}>
            <input
              id={id}
              type="checkbox"
              style={S.checkbox}
              checked={isChecked(src)}
              onChange={(e) => handleToggle(src, e.target.checked)}
              aria-label={src}
            />
            <label htmlFor={id} style={labelStyle}>
              {src}
            </label>
          </div>
        );
      })}
    </div>
  );
}
