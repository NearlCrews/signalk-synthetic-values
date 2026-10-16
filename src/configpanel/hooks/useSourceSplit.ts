import { useMemo } from 'react';
import { type SourceFilter, sourceFilterFor } from '../../config.js';

export interface SourceSplit {
  /** Sources the include and exclude lists let through to the combiner. */
  included: string[];
  /** Sources the lists keep out. */
  excluded: string[];
}

/**
 * Which of a path's sources the panel's copy of its include and exclude lists
 * lets through, by the rule the runtime applies to every delta. The checklist,
 * the source chips, and the minimum-sources warning all read this one answer,
 * so they cannot disagree about a path while an edit is waiting to be saved.
 */
export function useSourceSplit(sources: string[], filter: SourceFilter | undefined): SourceSplit {
  const includeSources = filter?.includeSources;
  const excludeSources = filter?.excludeSources;
  return useMemo(() => {
    const accepts = sourceFilterFor({ includeSources, excludeSources });
    const split: SourceSplit = { included: [], excluded: [] };
    for (const source of sources) (accepts(source) ? split.included : split.excluded).push(source);
    return split;
  }, [sources, includeSources, excludeSources]);
}
