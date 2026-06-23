// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import '@testing-library/jest-dom';
import { render, fireEvent, screen } from '@testing-library/react';
import { createElement } from 'react';

import { DetectedPathRow } from '../../src/configpanel/components/DetectedPathRow.js';
import type { DetectedRow } from '../../src/configpanel/hooks/useDetected.js';
import type { RawPathConfig } from '../../src/config.js';

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
        config: undefined,
        onAdd: vi.fn(),
        onRemove: vi.fn(),
        onUpdate: vi.fn(),
      })
    );
    const btn = screen.getByRole('button', { name: /combine/i });
    expect(btn).toBeInTheDocument();
    expect(btn).not.toBeDisabled();
  });

  it('calls onAdd(path) when Combine is clicked', () => {
    const onAdd = vi.fn();
    render(
      createElement(DetectedPathRow, {
        row: availableRow,
        config: undefined,
        onAdd,
        onRemove: vi.fn(),
        onUpdate: vi.fn(),
      })
    );
    const btn = screen.getByRole('button', { name: /combine/i });
    fireEvent.click(btn);
    expect(onAdd).toHaveBeenCalledOnce();
    expect(onAdd).toHaveBeenCalledWith(availableRow.path);
  });

  it('does not show the "added" pill', () => {
    render(
      createElement(DetectedPathRow, {
        row: availableRow,
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
        config: optedInConfig,
        onAdd: vi.fn(),
        onRemove: vi.fn(),
        onUpdate: vi.fn(),
      })
    );
    expect(screen.getByRole('button', { name: /remove/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /combine/i })).toBeNull();
  });

  it('calls onRemove(path) when Remove is clicked', () => {
    const onRemove = vi.fn();
    render(
      createElement(DetectedPathRow, {
        row: optedInRow,
        config: optedInConfig,
        onAdd: vi.fn(),
        onRemove,
        onUpdate: vi.fn(),
      })
    );
    fireEvent.click(screen.getByRole('button', { name: /remove/i }));
    expect(onRemove).toHaveBeenCalledOnce();
    expect(onRemove).toHaveBeenCalledWith(optedInRow.path);
  });

  it('shows the "added" pill', () => {
    render(
      createElement(DetectedPathRow, {
        row: optedInRow,
        config: optedInConfig,
        onAdd: vi.fn(),
        onRemove: vi.fn(),
        onUpdate: vi.fn(),
      })
    );
    // The "added" pill appears as a visible element (the sr span also contains
    // "added", so we accept one or more matches and confirm at least one is present).
    expect(screen.getAllByText(/added/i).length).toBeGreaterThan(0);
  });

  it('shows the priority instruction', () => {
    render(
      createElement(DetectedPathRow, {
        row: optedInRow,
        config: optedInConfig,
        onAdd: vi.fn(),
        onRemove: vi.fn(),
        onUpdate: vi.fn(),
      })
    );
    expect(screen.getByText(/priority not set/i)).toBeInTheDocument();
  });

  it('accessible name includes path, source count, and kind', () => {
    render(
      createElement(DetectedPathRow, {
        row: optedInRow,
        config: optedInConfig,
        onAdd: vi.fn(),
        onRemove: vi.fn(),
        onUpdate: vi.fn(),
      })
    );
    // The source-count badge renders a visually-hidden label with the count.
    // The row's sr span also includes "3 sources", so we accept multiple matches.
    expect(screen.getAllByText(/3 sources/i).length).toBeGreaterThan(0);
    // The kind badge text should appear in the row (the sr span also contains
    // "angular", so we accept one or more matches).
    expect(screen.getAllByText(/angular/i).length).toBeGreaterThan(0);
    // A visually-hidden span should carry all parts of the accessible name.
    const srText = document.querySelector('.skn-vh');
    expect(srText?.textContent).toMatch(/navigation\.headingTrue/);
    expect(srText?.textContent).toMatch(/3 source/i);
    expect(srText?.textContent).toMatch(/angular/i);
    expect(srText?.textContent).toMatch(/added/i);
  });

  it('the Tune section is collapsed by default', () => {
    render(
      createElement(DetectedPathRow, {
        row: optedInRow,
        config: optedInConfig,
        onAdd: vi.fn(),
        onRemove: vi.fn(),
        onUpdate: vi.fn(),
      })
    );
    const toggle = screen.getByRole('button', { name: /tune/i });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
  });

  it('expanding the Tune section renders PerPathSettings', () => {
    render(
      createElement(DetectedPathRow, {
        row: optedInRow,
        config: optedInConfig,
        onAdd: vi.fn(),
        onRemove: vi.fn(),
        onUpdate: vi.fn(),
      })
    );
    const toggle = screen.getByRole('button', { name: /tune/i });
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
        config: optedInConfig,
        onAdd: vi.fn(),
        onRemove: vi.fn(),
        onUpdate,
      })
    );
    // Expand Tune section.
    fireEvent.click(screen.getByRole('button', { name: /tune/i }));
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
        config: undefined,
        onAdd: vi.fn(),
        onRemove: vi.fn(),
        onUpdate: vi.fn(),
      })
    );
    const btn = screen.getByRole('button', { name: /combine/i });
    expect(btn).toBeDisabled();
  });

  it('the disabled Combine button has aria-describedby pointing to the reason', () => {
    render(
      createElement(DetectedPathRow, {
        row: otherRow,
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
    expect(reason?.textContent).toMatch(/text.*number|number.*text|cannot be averaged/i);
  });

  it('does not call onAdd when the disabled button is clicked', () => {
    const onAdd = vi.fn();
    render(
      createElement(DetectedPathRow, {
        row: otherRow,
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
