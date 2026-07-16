import type * as React from 'react';
import { Checkbox, FieldGroup, Stack } from 'signalk-nearlcrews-ui';
import type { RawPathConfigPatch } from '../../config.js';

interface Props {
  sources: string[];
  includeSources: string[] | undefined;
  excludeSources: string[] | undefined;
  onChange: (patch: RawPathConfigPatch) => void;
  /** Prefix for all DOM ids in this instance to avoid duplicates across rows. */
  idPrefix: string;
}

function toggleValue(values: string[], value: string, enabled: boolean): string[] {
  const next = new Set(values);
  if (enabled) next.add(value);
  else next.delete(value);
  return [...next];
}

function includePatch(
  sources: string[],
  includeSources: string[],
  source: string,
  checked: boolean
): RawPathConfigPatch {
  const next = toggleValue(includeSources, source, checked);
  if (next.length === 0) {
    return { includeSources: undefined, excludeSources: [...sources] };
  }
  return { includeSources: next, excludeSources: undefined };
}

function excludePatch(
  excludeSources: string[],
  source: string,
  checked: boolean
): RawPathConfigPatch {
  const next = toggleValue(excludeSources, source, !checked);
  return {
    includeSources: undefined,
    excludeSources: next.length === 0 ? undefined : next,
  };
}

/**
 * Renders one labeled checkbox per live source. A source is "on" (included)
 * unless it appears in excludeSources, or unless includeSources is set and
 * non-empty and the source is absent from it.
 *
 * Include/exclude model: prefer the exclude model (all on, uncheck to
 * exclude). Preserve an existing non-empty include list until its final live
 * source is cleared, then switch to excluding every live source because the
 * runtime treats an empty include list as no filter. Every patch explicitly
 * clears the opposite model.
 */
export function SourceChecklist({
  sources,
  includeSources,
  excludeSources,
  onChange,
  idPrefix,
}: Props): React.ReactElement {
  const useIncludeModel = Array.isArray(includeSources) && includeSources.length > 0;

  function isChecked(src: string): boolean {
    if (useIncludeModel) return includeSources.includes(src);
    return !excludeSources?.includes(src);
  }

  function handleToggle(src: string, checked: boolean): void {
    if (useIncludeModel) {
      onChange(includePatch(sources, includeSources, src, checked));
      return;
    }
    onChange(excludePatch(excludeSources ?? [], src, checked));
  }

  return (
    <FieldGroup legend="Sources">
      <Stack gap={2}>
        {sources.map((src) => {
          const id = `${idPrefix}-source-${encodeURIComponent(src)}`;
          return (
            <Checkbox
              key={src}
              id={id}
              label={src}
              checked={isChecked(src)}
              onChange={(event) => handleToggle(src, event.target.checked)}
            />
          );
        })}
      </Stack>
    </FieldGroup>
  );
}
