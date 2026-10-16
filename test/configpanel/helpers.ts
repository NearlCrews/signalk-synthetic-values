// Shared fixtures for the panel tests.
import { type ComponentProps, createElement, type ReactElement } from 'react';
import { PanelShell } from 'signalk-nearlcrews-ui';
import { NON_NUMERIC_ADVISORY } from '../../src/combinability.js';
import type { DetectedRow } from '../../src/detected.js';

/**
 * A detected row as the route sends it, with every field present. Overrides set
 * what a case is about; the rest follows the server's own rules: a kind of
 * 'other' is not combinable, a row that cannot combine is not recommended and
 * says why, and an opted-in path is combining every source it reports.
 */
export function detectedRow(
  overrides: Partial<DetectedRow> & Pick<DetectedRow, 'path'>
): DetectedRow {
  const kind = overrides.kind ?? 'scalar';
  const combinable = overrides.combinable ?? kind !== 'other';
  const sources = overrides.sources ?? ['a', 'b'];
  return {
    sources,
    freshSources: overrides.optedIn ? sources : [],
    kind,
    optedIn: false,
    combinable,
    recommended: combinable,
    duplicateGroups: [],
    ...(combinable ? {} : { advisory: NON_NUMERIC_ADVISORY }),
    ...overrides,
  };
}

/**
 * Mount a panel piece inside the shared shell, which owns the live regions the
 * panel announcer speaks through.
 */
export function inShell(element: ReactElement): ReactElement {
  // Children go in as the third argument, as createElement intends; the cast only
  // satisfies a props type that lists them too.
  const props = { title: 'Test panel' } as ComponentProps<typeof PanelShell>;
  return createElement(PanelShell, props, element);
}

export function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200 });
}
