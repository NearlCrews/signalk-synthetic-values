// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RawPathConfig } from '../../src/config.js';
import { DetectedPathRow } from '../../src/configpanel/components/DetectedPathRow.js';
import type { DetectedRow } from '../../src/configpanel/hooks/useDetected.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const availableRow: DetectedRow = {
  path: 'navigation.speedOverGround',
  sources: ['gps.1', 'gps.2'],
  kind: 'scalar',
  optedIn: false,
};

const optedInRow: DetectedRow = {
  path: 'navigation.headingTrue',
  sources: ['compass.1', 'compass.2', 'compass.3'],
  kind: 'angular',
  optedIn: true,
};

const otherRow: DetectedRow = {
  path: 'vessel.name',
  sources: ['ais.0', 'ais.1'],
  kind: 'other',
  optedIn: false,
};

const optedInConfig: RawPathConfig = {
  path: 'navigation.headingTrue',
};

// ---------------------------------------------------------------------------
// Available (not opted-in) row
// ---------------------------------------------------------------------------

describe('DetectedPathRow: available row', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('renders an enabled "Combine" button', () => {
    render(
      createElement(DetectedPathRow, {
        row: availableRow,
        optedIn: false,
        config: undefined,
        onAdd: vi.fn(),
        onRemove: vi.fn(),
        onUpdate: vi.fn(),
      })
    );
    const btn = screen.getByRole('button', { name: `Combine ${availableRow.path}` });
    expect(btn).toBeInTheDocument();
    expect(btn).not.toBeDisabled();
  });

  it('calls onAdd(path) when Combine is clicked', () => {
    const onAdd = vi.fn();
    render(
      createElement(DetectedPathRow, {
        row: availableRow,
        optedIn: false,
        config: undefined,
        onAdd,
        onRemove: vi.fn(),
        onUpdate: vi.fn(),
      })
    );
    const btn = screen.getByRole('button', { name: `Combine ${availableRow.path}` });
    fireEvent.click(btn);
    expect(onAdd).toHaveBeenCalledOnce();
    expect(onAdd).toHaveBeenCalledWith(availableRow.path);
  });

  it('does not show the "added" pill', () => {
    render(
      createElement(DetectedPathRow, {
        row: availableRow,
        optedIn: false,
        config: undefined,
        onAdd: vi.fn(),
        onRemove: vi.fn(),
        onUpdate: vi.fn(),
      })
    );
    expect(screen.queryByText(/added/i)).toBeNull();
  });

  it('does not show the priority instruction', () => {
    render(
      createElement(DetectedPathRow, {
        row: availableRow,
        optedIn: false,
        config: undefined,
        onAdd: vi.fn(),
        onRemove: vi.fn(),
        onUpdate: vi.fn(),
      })
    );
    expect(screen.queryByText(/priority not set/i)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Opted-in row
// ---------------------------------------------------------------------------

describe('DetectedPathRow: opted-in row', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('renders a "Remove" button instead of "Combine"', () => {
    render(
      createElement(DetectedPathRow, {
        row: optedInRow,
        optedIn: true,
        config: optedInConfig,
        onAdd: vi.fn(),
        onRemove: vi.fn(),
        onUpdate: vi.fn(),
      })
    );
    expect(screen.getByRole('button', { name: `Remove ${optedInRow.path}` })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: `Combine ${optedInRow.path}` })).toBeNull();
  });

  it('calls onRemove(path) when Remove is clicked', () => {
    const onRemove = vi.fn();
    render(
      createElement(DetectedPathRow, {
        row: optedInRow,
        optedIn: true,
        config: optedInConfig,
        onAdd: vi.fn(),
        onRemove,
        onUpdate: vi.fn(),
      })
    );
    fireEvent.click(screen.getByRole('button', { name: `Remove ${optedInRow.path}` }));
    expect(onRemove).toHaveBeenCalledOnce();
    expect(onRemove).toHaveBeenCalledWith(optedInRow.path);
  });

  it('shows the "combined" pill', () => {
    const { container } = render(
      createElement(DetectedPathRow, {
        row: optedInRow,
        optedIn: true,
        config: optedInConfig,
        onAdd: vi.fn(),
        onRemove: vi.fn(),
        onUpdate: vi.fn(),
      })
    );
    const pills = screen.getAllByText('combined', { exact: true });
    expect(pills).toHaveLength(1);
    expect(container.querySelector('[data-combined="true"]')).toBeInTheDocument();
  });

  it('shows the priority instruction', () => {
    render(
      createElement(DetectedPathRow, {
        row: optedInRow,
        optedIn: true,
        config: optedInConfig,
        onAdd: vi.fn(),
        onRemove: vi.fn(),
        onUpdate: vi.fn(),
      })
    );
    expect(screen.getByText(/source priority required/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /path-level override/i })).toHaveAttribute(
      'href',
      `#/data/priorities?path=${encodeURIComponent(optedInRow.path)}`
    );
  });

  it('groups the row by path without duplicating its visible details', () => {
    render(
      createElement(DetectedPathRow, {
        row: optedInRow,
        optedIn: true,
        config: optedInConfig,
        onAdd: vi.fn(),
        onRemove: vi.fn(),
        onUpdate: vi.fn(),
      })
    );
    expect(screen.getByRole('group', { name: optedInRow.path })).toBeInTheDocument();
    expect(screen.getAllByText(/3 sources/i)).toHaveLength(1);
    expect(screen.getAllByText(/kind: angular/i)).toHaveLength(1);
  });

  it('the Tune section is collapsed by default', () => {
    render(
      createElement(DetectedPathRow, {
        row: optedInRow,
        optedIn: true,
        config: optedInConfig,
        onAdd: vi.fn(),
        onRemove: vi.fn(),
        onUpdate: vi.fn(),
      })
    );
    const toggle = screen.getByRole('button', {
      name: new RegExp(`^Tune\\s*settings for ${optedInRow.path}$`),
    });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
  });

  it('expanding the Tune section renders PerPathSettings', () => {
    render(
      createElement(DetectedPathRow, {
        row: optedInRow,
        optedIn: true,
        config: optedInConfig,
        onAdd: vi.fn(),
        onRemove: vi.fn(),
        onUpdate: vi.fn(),
      })
    );
    const toggle = screen.getByRole('button', {
      name: new RegExp(`^Tune\\s*settings for ${optedInRow.path}$`),
    });
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    // PerPathSettings renders a Method selector when open.
    expect(screen.getByLabelText(/method/i)).toBeInTheDocument();
  });

  it('calls onUpdate(path, patch) when PerPathSettings fires onChange', () => {
    const onUpdate = vi.fn();
    render(
      createElement(DetectedPathRow, {
        row: optedInRow,
        optedIn: true,
        config: optedInConfig,
        onAdd: vi.fn(),
        onRemove: vi.fn(),
        onUpdate,
      })
    );
    // Expand Tune section.
    fireEvent.click(
      screen.getByRole('button', {
        name: new RegExp(`^Tune\\s*settings for ${optedInRow.path}$`),
      })
    );
    // Change the method select.
    const methodSelect = screen.getByLabelText(/method/i) as HTMLSelectElement;
    fireEvent.change(methodSelect, { target: { value: 'mean' } });
    expect(onUpdate).toHaveBeenCalledWith(optedInRow.path, { method: 'mean' });
  });
});

// ---------------------------------------------------------------------------
// Non-combinable (kind === 'other') row
// ---------------------------------------------------------------------------

describe('DetectedPathRow: non-combinable row', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('renders a disabled Combine button', () => {
    render(
      createElement(DetectedPathRow, {
        row: otherRow,
        optedIn: false,
        config: undefined,
        onAdd: vi.fn(),
        onRemove: vi.fn(),
        onUpdate: vi.fn(),
      })
    );
    // aria-disabled rather than the native attribute, so the button keeps its
    // place in the tab order and its description is reachable.
    const btn = screen.getByRole('button', { name: /combine/i });
    expect(btn).not.toBeDisabled();
    expect(btn).toHaveAttribute('aria-disabled', 'true');
  });

  it('the unavailable Combine button has aria-describedby pointing to the reason', () => {
    render(
      createElement(DetectedPathRow, {
        row: otherRow,
        optedIn: false,
        config: undefined,
        onAdd: vi.fn(),
        onRemove: vi.fn(),
        onUpdate: vi.fn(),
      })
    );
    const btn = screen.getByRole('button', { name: /combine/i });
    const describedById = btn.getAttribute('aria-describedby');
    expect(describedById).toBeTruthy();
    const reason = document.getElementById(describedById as string);
    expect(reason).toBeInTheDocument();
    expect(reason).toBeVisible();
    expect(reason?.textContent).toMatch(/text.*number|number.*text|cannot be averaged/i);
  });

  it('does not call onAdd when the disabled button is clicked', () => {
    const onAdd = vi.fn();
    render(
      createElement(DetectedPathRow, {
        row: otherRow,
        optedIn: false,
        config: undefined,
        onAdd,
        onRemove: vi.fn(),
        onUpdate: vi.fn(),
      })
    );
    const btn = screen.getByRole('button', { name: /combine/i });
    // disabled buttons do not fire click events in browsers, but we verify the guard
    fireEvent.click(btn);
    expect(onAdd).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Not-recommended (GNSS fix metadata) row: combinable but flagged
// ---------------------------------------------------------------------------

describe('DetectedPathRow: not-recommended row', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  const metadataRow: DetectedRow = {
    path: 'navigation.gnss.satellites',
    sources: ['gps.1', 'gps.2'],
    kind: 'scalar',
    optedIn: false,
    combinable: true,
    recommended: false,
    advisory: 'GNSS fix metadata. It describes one receiver, so averaging it is not meaningful.',
  };

  it('keeps the Combine button enabled but shows the advisory', () => {
    render(
      createElement(DetectedPathRow, {
        row: metadataRow,
        optedIn: false,
        config: undefined,
        onAdd: vi.fn(),
        onRemove: vi.fn(),
        onUpdate: vi.fn(),
      })
    );
    expect(screen.getByRole('button', { name: /combine/i })).not.toBeDisabled();
    expect(screen.getByText(/GNSS fix metadata/i)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Duplicate-sources hint
// ---------------------------------------------------------------------------

describe('DetectedPathRow: duplicate sources hint', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('shows a hint naming the duplicated sources', () => {
    const row: DetectedRow = {
      ...availableRow,
      duplicateGroups: [['gps.1', 'gps.2']],
    };
    render(
      createElement(DetectedPathRow, {
        row,
        optedIn: false,
        config: undefined,
        onAdd: vi.fn(),
        onRemove: vi.fn(),
        onUpdate: vi.fn(),
      })
    );
    expect(screen.getByText(/identical values and may be the same feed/i)).toBeInTheDocument();
    expect(screen.getByText(/gps\.1 and gps\.2/i)).toBeInTheDocument();
  });

  it('shows no hint when there are no duplicate groups', () => {
    render(
      createElement(DetectedPathRow, {
        row: availableRow,
        optedIn: false,
        config: undefined,
        onAdd: vi.fn(),
        onRemove: vi.fn(),
        onUpdate: vi.fn(),
      })
    );
    expect(screen.queryByText(/may be the same feed/i)).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Live sources against listed sources
// ---------------------------------------------------------------------------

describe('DetectedPathRow: a stale source is not a contributing one', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  const row = (freshSources: string[] | null, excludedSources: string[] = []): DetectedRow => ({
    path: 'environment.depth.belowKeel',
    sources: ['sounder.1', 'sounder.2', 'sounder.3'],
    freshSources,
    excludedSources,
    kind: 'scalar',
    optedIn: true,
  });

  function renderRow(r: DetectedRow) {
    return render(
      createElement(DetectedPathRow, {
        row: r,
        optedIn: true,
        config: { path: r.path },
        onAdd: vi.fn(),
        onRemove: vi.fn(),
        onUpdate: vi.fn(),
      })
    );
  }

  it('says how many of the listed sources are actually combining', () => {
    renderRow(row(['sounder.1', 'sounder.2']));
    expect(screen.getByText('2 of 3 sources combining')).toBeInTheDocument();
  });

  it('marks the source that stopped reporting in its own text', () => {
    renderRow(row(['sounder.1', 'sounder.2']));
    expect(screen.getByText('sounder.3, no data')).toBeInTheDocument();
  });

  it('marks an excluded source as excluded, not as missing', () => {
    renderRow(row(['sounder.1', 'sounder.2'], ['sounder.3']));
    expect(screen.getByText('sounder.3, excluded')).toBeInTheDocument();
  });

  it('drops the combined badge when nothing is live, with words not only colour', () => {
    const { container } = renderRow(row([]));
    expect(screen.getByText('no live sources')).toBeInTheDocument();
    expect(screen.queryByText('combined')).toBeNull();
    expect(container.querySelector('[data-detected-path-row]')?.className).not.toContain('success');
  });

  it('reads as a plain count when every source is live', () => {
    renderRow(row(['sounder.1', 'sounder.2', 'sounder.3']));
    expect(screen.getByText('3 sources')).toBeInTheDocument();
    expect(screen.getByText('combined')).toBeInTheDocument();
  });

  it('treats every source as live for a path the plugin is not combining', () => {
    render(
      createElement(DetectedPathRow, {
        row: { ...row(null), optedIn: false },
        optedIn: false,
        config: undefined,
        onAdd: vi.fn(),
        onRemove: vi.fn(),
        onUpdate: vi.fn(),
      })
    );
    expect(screen.getByText('3 sources')).toBeInTheDocument();
  });

  it('names the destination of every path-level override link', () => {
    renderRow(row(['sounder.1']));
    // The name is matched loosely because the jsdom accessible-name shim drops
    // the space before a VisuallyHidden suffix; a real browser keeps it, which
    // is what tests/browser/panel.spec.ts asserts exactly.
    expect(
      screen.getByRole('link', { name: /path-level override\s*for environment\.depth\.belowKeel/ })
    ).toBeInTheDocument();
  });
});
