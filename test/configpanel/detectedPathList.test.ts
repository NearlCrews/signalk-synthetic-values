// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom';
import { fireEvent, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import type { RawPathConfig } from '../../src/config.js';
import { DetectedPathList } from '../../src/configpanel/components/DetectedPathList.js';
import type { DetectedRow } from '../../src/configpanel/hooks/useDetected.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const scalRow: DetectedRow = {
  path: 'navigation.speedOverGround',
  sources: ['gps.1', 'gps.2'],
  kind: 'scalar',
  optedIn: false,
};

const angRow: DetectedRow = {
  path: 'navigation.headingTrue',
  sources: ['compass.1', 'compass.2', 'compass.3'],
  kind: 'angular',
  optedIn: true,
};

const posRow: DetectedRow = {
  path: 'navigation.position',
  sources: ['gps.1', 'gps.2', 'gps.3', 'gps.4'],
  kind: 'position',
  optedIn: false,
};

const otherRow: DetectedRow = {
  path: 'vessel.name',
  sources: ['ais.0', 'ais.1'],
  kind: 'other',
  optedIn: false,
};

// Combinable by type (scalar) but flagged not recommended by the server: GNSS
// fix metadata. It belongs in the not-recommended group, not "Combine all".
const gnssRow: DetectedRow = {
  path: 'navigation.gnss.satellites',
  sources: ['gps.1', 'gps.2'],
  kind: 'scalar',
  optedIn: false,
  combinable: true,
  recommended: false,
  advisory: 'GNSS fix metadata. Averaging it across receivers is not meaningful.',
};

function emptyMap(): Map<string, RawPathConfig> {
  return new Map();
}

function mapOf(...paths: string[]): Map<string, RawPathConfig> {
  return new Map(paths.map((p) => [p, { path: p }]));
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

describe('DetectedPathList: empty state', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('renders the first-run explanatory copy', () => {
    render(
      createElement(DetectedPathList, {
        detected: [],
        configByPath: emptyMap(),
        onAdd: vi.fn(),
        onAddAll: vi.fn(),
        onRemove: vi.fn(),
        onUpdate: vi.fn(),
        lastChecked: null,
        loading: false,
        error: null,
        onRefresh: vi.fn(),
      })
    );
    expect(screen.getByText(/no duplicate paths detected yet/i)).toBeInTheDocument();
    expect(screen.getByText(/leave your instruments running/i)).toBeInTheDocument();
  });

  it('renders the Refresh button in the empty state', () => {
    render(
      createElement(DetectedPathList, {
        detected: [],
        configByPath: emptyMap(),
        onAdd: vi.fn(),
        onAddAll: vi.fn(),
        onRemove: vi.fn(),
        onUpdate: vi.fn(),
        lastChecked: null,
        loading: false,
        error: null,
        onRefresh: vi.fn(),
      })
    );
    expect(screen.getByRole('button', { name: /refresh/i })).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Loading state
// ---------------------------------------------------------------------------

describe('DetectedPathList: loading state', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('renders a non-blocking "checking" indicator while loading', () => {
    render(
      createElement(DetectedPathList, {
        detected: [],
        configByPath: emptyMap(),
        onAdd: vi.fn(),
        onAddAll: vi.fn(),
        onRemove: vi.fn(),
        onUpdate: vi.fn(),
        lastChecked: null,
        loading: true,
        error: null,
        onRefresh: vi.fn(),
      })
    );
    expect(screen.getByText(/checking/i)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Error state
// ---------------------------------------------------------------------------

describe('DetectedPathList: error state', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('renders a danger banner with the error message', () => {
    render(
      createElement(DetectedPathList, {
        detected: [],
        configByPath: emptyMap(),
        onAdd: vi.fn(),
        onAddAll: vi.fn(),
        onRemove: vi.fn(),
        onUpdate: vi.fn(),
        lastChecked: null,
        loading: false,
        error: 'network error',
        onRefresh: vi.fn(),
      })
    );
    expect(screen.getByText(/network error/i)).toBeInTheDocument();
  });

  it('renders a Retry button that calls onRefresh', () => {
    const onRefresh = vi.fn();
    render(
      createElement(DetectedPathList, {
        detected: [],
        configByPath: emptyMap(),
        onAdd: vi.fn(),
        onAddAll: vi.fn(),
        onRemove: vi.fn(),
        onUpdate: vi.fn(),
        lastChecked: null,
        loading: false,
        error: 'network error',
        onRefresh,
      })
    );
    const retryBtn = screen.getByRole('button', { name: /retry/i });
    fireEvent.click(retryBtn);
    expect(onRefresh).toHaveBeenCalledOnce();
  });

  it('never renders a silent empty list on error', () => {
    const { container } = render(
      createElement(DetectedPathList, {
        detected: [],
        configByPath: emptyMap(),
        onAdd: vi.fn(),
        onAddAll: vi.fn(),
        onRemove: vi.fn(),
        onUpdate: vi.fn(),
        lastChecked: null,
        loading: false,
        error: 'timeout',
        onRefresh: vi.fn(),
      })
    );
    // The "no duplicate paths detected yet" empty-state copy must NOT appear when
    // there is an error. An error banner must be present instead.
    expect(container.textContent).not.toMatch(/no duplicate paths detected yet/i);
    expect(screen.getByText(/timeout/i)).toBeInTheDocument();
  });

  it('keeps the retained list mounted below the error banner', () => {
    // useDetected preserves the previous rows on a failed poll; a transient
    // blip must not unmount them (losing open disclosures and focus).
    render(
      createElement(DetectedPathList, {
        detected: [scalRow, angRow],
        configByPath: mapOf(angRow.path),
        onAdd: vi.fn(),
        onAddAll: vi.fn(),
        onRemove: vi.fn(),
        onUpdate: vi.fn(),
        lastChecked: 1000,
        loading: false,
        error: 'network error',
        onRefresh: vi.fn(),
      })
    );
    expect(screen.getByText(/network error/i)).toBeInTheDocument();
    expect(screen.getByText(scalRow.path)).toBeInTheDocument();
    expect(screen.getByText(angRow.path)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Sorting
// ---------------------------------------------------------------------------

describe('DetectedPathList: sort order', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('shows not-yet-combined combinable rows first, by source count descending', () => {
    // posRow has 4 sources, scalRow has 2 sources; both not combined.
    // angRow is combined (in configByPath).
    const rows = [angRow, scalRow, posRow, otherRow];
    // Each row renders the path in a monospace span with title=path.
    const { container: sortContainer } = render(
      createElement(DetectedPathList, {
        detected: rows,
        configByPath: mapOf(angRow.path),
        onAdd: vi.fn(),
        onAddAll: vi.fn(),
        onRemove: vi.fn(),
        onUpdate: vi.fn(),
        lastChecked: null,
        loading: false,
        error: null,
        onRefresh: vi.fn(),
      })
    );
    const pathLabels = Array.from(sortContainer.querySelectorAll('.skn-row'))
      .map((el) => (el as HTMLElement).querySelector('[title]')?.getAttribute('title'))
      .filter(Boolean) as string[];
    // Not-yet-combined combinable rows should come first in order: posRow (4 src), scalRow (2 src)
    expect(pathLabels.indexOf(posRow.path)).toBeLessThan(pathLabels.indexOf(scalRow.path));
    // posRow and scalRow should both be before angRow (combined)
    expect(pathLabels.indexOf(posRow.path)).toBeLessThan(pathLabels.indexOf(angRow.path));
    expect(pathLabels.indexOf(scalRow.path)).toBeLessThan(pathLabels.indexOf(angRow.path));
  });

  it('places not-recommended rows under a collapsed disclosure group', () => {
    const rows = [scalRow, otherRow];
    render(
      createElement(DetectedPathList, {
        detected: rows,
        configByPath: emptyMap(),
        onAdd: vi.fn(),
        onAddAll: vi.fn(),
        onRemove: vi.fn(),
        onUpdate: vi.fn(),
        lastChecked: null,
        loading: false,
        error: null,
        onRefresh: vi.fn(),
      })
    );
    // The group toggle should exist and be collapsed by default.
    const toggle = screen.getByRole('button', { name: /detected but not recommended/i });
    expect(toggle).toBeInTheDocument();
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
  });

  it('groups a recommended:false GNSS path under not-recommended and out of Combine all', () => {
    const onAddAll = vi.fn();
    render(
      createElement(DetectedPathList, {
        detected: [scalRow, gnssRow],
        configByPath: emptyMap(),
        onAdd: vi.fn(),
        onAddAll,
        onRemove: vi.fn(),
        onUpdate: vi.fn(),
        lastChecked: null,
        loading: false,
        error: null,
        onRefresh: vi.fn(),
      })
    );
    // Only the one recommended row counts toward "Combine all".
    expect(screen.getByRole('button', { name: /combine all \(1\)/i })).toBeInTheDocument();
    // The GNSS metadata row is under the not-recommended disclosure.
    expect(
      screen.getByRole('button', { name: /detected but not recommended \(1\)/i })
    ).toBeInTheDocument();
  });

  it('combined rows appear after not-yet-combined combinable rows', () => {
    const rows = [scalRow, angRow]; // angRow is in configByPath (combined)
    const { container: combinedContainer } = render(
      createElement(DetectedPathList, {
        detected: rows,
        configByPath: mapOf(angRow.path),
        onAdd: vi.fn(),
        onAddAll: vi.fn(),
        onRemove: vi.fn(),
        onUpdate: vi.fn(),
        lastChecked: null,
        loading: false,
        error: null,
        onRefresh: vi.fn(),
      })
    );
    const pathLabels = Array.from(combinedContainer.querySelectorAll('.skn-row'))
      .map((el) => (el as HTMLElement).querySelector('[title]')?.getAttribute('title'))
      .filter(Boolean) as string[];
    // scalRow (not combined) must come before angRow (combined)
    expect(pathLabels.indexOf(scalRow.path)).toBeLessThan(pathLabels.indexOf(angRow.path));
  });
});

// ---------------------------------------------------------------------------
// Combine all
// ---------------------------------------------------------------------------

describe('DetectedPathList: Combine all', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('shows "Combine all" when there are combinable, not-yet-configured rows', () => {
    render(
      createElement(DetectedPathList, {
        detected: [scalRow, posRow],
        configByPath: emptyMap(),
        onAdd: vi.fn(),
        onAddAll: vi.fn(),
        onRemove: vi.fn(),
        onUpdate: vi.fn(),
        lastChecked: null,
        loading: false,
        error: null,
        onRefresh: vi.fn(),
      })
    );
    expect(screen.getByRole('button', { name: /combine all/i })).toBeInTheDocument();
  });

  it('"Combine all" shows a count confirmation with the correct number', () => {
    render(
      createElement(DetectedPathList, {
        detected: [scalRow, posRow, angRow], // angRow already in configByPath
        configByPath: mapOf(angRow.path),
        onAdd: vi.fn(),
        onAddAll: vi.fn(),
        onRemove: vi.fn(),
        onUpdate: vi.fn(),
        lastChecked: null,
        loading: false,
        error: null,
        onRefresh: vi.fn(),
      })
    );
    const btn = screen.getByRole('button', { name: /combine all/i });
    fireEvent.click(btn);
    // After click, a confirmation showing "2" (scalRow and posRow) should appear.
    expect(screen.getByText(/combine 2 detected path/i)).toBeInTheDocument();
  });

  it('"Combine all" calls onAddAll with only combinable, not-yet-configured rows', () => {
    const onAddAll = vi.fn();
    render(
      createElement(DetectedPathList, {
        detected: [scalRow, posRow, angRow, otherRow],
        configByPath: mapOf(angRow.path),
        onAdd: vi.fn(),
        onAddAll,
        onRemove: vi.fn(),
        onUpdate: vi.fn(),
        lastChecked: null,
        loading: false,
        error: null,
        onRefresh: vi.fn(),
      })
    );
    // Click "Combine all" to get to the confirmation.
    fireEvent.click(screen.getByRole('button', { name: /combine all/i }));
    // Click the confirm button.
    fireEvent.click(screen.getByRole('button', { name: /confirm/i }));
    // onAddAll should be called with exactly scalRow and posRow (not angRow, not otherRow).
    expect(onAddAll).toHaveBeenCalledOnce();
    const calledWith: DetectedRow[] = onAddAll.mock.calls[0][0] as DetectedRow[];
    const calledPaths = calledWith.map((r) => r.path).sort();
    expect(calledPaths).toEqual([posRow.path, scalRow.path].sort());
  });

  it('Cancel dismisses the confirmation without calling onAddAll', () => {
    const onAddAll = vi.fn();
    render(
      createElement(DetectedPathList, {
        detected: [scalRow, posRow],
        configByPath: emptyMap(),
        onAdd: vi.fn(),
        onAddAll,
        onRemove: vi.fn(),
        onUpdate: vi.fn(),
        lastChecked: null,
        loading: false,
        error: null,
        onRefresh: vi.fn(),
      })
    );
    fireEvent.click(screen.getByRole('button', { name: /combine all/i }));
    fireEvent.click(screen.getByRole('button', { name: /^cancel$/i }));
    expect(onAddAll).not.toHaveBeenCalled();
    // The request button is back after cancelling.
    expect(screen.getByRole('button', { name: /combine all/i })).toBeInTheDocument();
  });

  it('"Combine all" is absent or disabled when all combinable rows are already configured', () => {
    render(
      createElement(DetectedPathList, {
        detected: [scalRow, angRow],
        configByPath: mapOf(scalRow.path, angRow.path),
        onAdd: vi.fn(),
        onAddAll: vi.fn(),
        onRemove: vi.fn(),
        onUpdate: vi.fn(),
        lastChecked: null,
        loading: false,
        error: null,
        onRefresh: vi.fn(),
      })
    );
    const btn = screen.queryByRole('button', { name: /combine all/i });
    // Either absent or disabled.
    if (btn !== null) {
      expect(btn).toBeDisabled();
    } else {
      expect(btn).toBeNull();
    }
  });
});

// ---------------------------------------------------------------------------
// optedIn consistency rule
// ---------------------------------------------------------------------------

describe('DetectedPathList: optedIn consistency', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('treats a row as opted-in when its path is in configByPath, regardless of row.optedIn', () => {
    // scalRow has optedIn: false, but we put it in configByPath.
    // The list should render it as combined (Remove button, no primary Combine button for that path).
    render(
      createElement(DetectedPathList, {
        detected: [scalRow],
        configByPath: mapOf(scalRow.path),
        onAdd: vi.fn(),
        onAddAll: vi.fn(),
        onRemove: vi.fn(),
        onUpdate: vi.fn(),
        lastChecked: null,
        loading: false,
        error: null,
        onRefresh: vi.fn(),
      })
    );
    // Should see Remove button (opted-in state) not a Combine button for this path.
    expect(screen.getByRole('button', { name: /remove/i })).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Live region
// ---------------------------------------------------------------------------

describe('DetectedPathList: live region', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('renders a role="status" live region and updates its text when detected count changes', () => {
    const props = {
      detected: [scalRow],
      configByPath: emptyMap(),
      onAdd: vi.fn(),
      onAddAll: vi.fn(),
      onRemove: vi.fn(),
      onUpdate: vi.fn(),
      lastChecked: Date.now(),
      loading: false,
      error: null,
      onRefresh: vi.fn(),
    };

    const { rerender } = render(createElement(DetectedPathList, props));

    // The role="status" live region must exist from the first render.
    expect(screen.getByRole('status')).toBeInTheDocument();

    // Re-render with two detected rows so the count changes from 1 to 2.
    rerender(
      createElement(DetectedPathList, {
        ...props,
        detected: [scalRow, angRow],
      })
    );

    const region = screen.getByRole('status');
    // The announcement text should reflect the new count of 2 paths.
    expect(region.textContent).toMatch(/2 paths? detected/i);
  });
});

// PriorityBanner tests live in presentational.test.ts with the other
// presentational components.
