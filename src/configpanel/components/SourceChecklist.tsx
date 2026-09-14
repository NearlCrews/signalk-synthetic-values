import type * as React from 'react';
import { CheckboxGroup } from 'signalk-nearlcrews-ui/composites';
import type { RawPathConfigPatch } from '../../config.js';

interface Props {
  sources: string[];
  includeSources: string[] | undefined;
  excludeSources: string[] | undefined;
  onChange: (patch: RawPathConfigPatch) => void;
}

/**
 * The sources feeding one path, as a checkbox group. A source is "on"
 * (included) unless it appears in excludeSources, or unless includeSources is
 * set and non-empty and the source is absent from it.
 *
 * Include and exclude model: prefer the exclude model (all on, uncheck to
 * exclude). Preserve an existing non-empty include list until its final live
 * source is cleared, then switch to excluding every live source because the
 * runtime treats an empty include list as no filter. Every patch explicitly
 * clears the opposite model. The reconciliation stays here rather than in the
 * group, which reports a plain selection.
 */
export function SourceChecklist({
  sources,
  includeSources,
  excludeSources,
  onChange,
}: Props): React.ReactElement {
  const useIncludeModel = Array.isArray(includeSources) && includeSources.length > 0;
  // Membership is asked once per source, so each list is hashed once rather
  // than rescanned per source on every render and every toggle.
  const listed = new Set(useIncludeModel ? includeSources : (excludeSources ?? []));
  const selected = useIncludeModel
    ? sources.filter((src) => listed.has(src))
    : sources.filter((src) => !listed.has(src));

  function handleChange(next: readonly string[]): void {
    if (next.length === 0) {
      // An empty include list means "no filter" to the runtime, so excluding
      // every source is the only way to express "combine nothing".
      onChange({ includeSources: undefined, excludeSources: [...sources] });
      return;
    }
    if (useIncludeModel) {
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
      options={sources.map((value) => ({ label: value, value }))}
      selectAllLabel="All sources"
      value={selected}
    />
  );
}
