import type * as React from 'react';
import { useMemo } from 'react';
import { CheckboxGroup } from 'signalk-nearlcrews-ui/composites';
import type { RawPathConfigPatch } from '../../config.js';
import { useSourceSplit } from '../hooks/useSourceSplit.js';

interface Props {
  sources: string[];
  includeSources: string[] | undefined;
  excludeSources: string[] | undefined;
  onChange: (patch: RawPathConfigPatch) => void;
}

/**
 * The sources feeding one path, as a checkbox group. A source is checked when
 * the runtime's own include and exclude rule lets it through.
 *
 * Edits prefer the exclude model: all on, uncheck to exclude. An existing
 * include list is kept until its last source is cleared, and because the
 * runtime reads an empty include list as no filter at all, "nothing selected"
 * is written as excluding every source. Every patch clears the other list.
 */
export function SourceChecklist({
  sources,
  includeSources,
  excludeSources,
  onChange,
}: Props): React.ReactElement {
  const { included: selected } = useSourceSplit(sources, { includeSources, excludeSources });
  const options = useMemo(() => sources.map((value) => ({ label: value, value })), [sources]);

  function handleChange(next: readonly string[]): void {
    if (next.length === 0) {
      onChange({ includeSources: undefined, excludeSources: [...sources] });
      return;
    }
    if (includeSources?.length) {
      onChange({ includeSources: [...next], excludeSources: undefined });
      return;
    }
    const chosen = new Set(next);
    const excluded = sources.filter((src) => !chosen.has(src));
    onChange({
      includeSources: undefined,
      excludeSources: excluded.length === 0 ? undefined : excluded,
    });
  }

  return (
    <CheckboxGroup
      emptyWarning="No sources are selected, so this path will not combine."
      legend="Sources"
      onValueChange={handleChange}
      options={options}
      selectAllLabel="All sources"
      value={selected}
    />
  );
}
