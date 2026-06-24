// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom';
import { fireEvent, render } from '@testing-library/react';
import { createElement } from 'react';
import type { RawPathConfig, RawPathConfigPatch } from '../../src/config.js';
import { PerPathSettings } from '../../src/configpanel/components/PerPathSettings.js';
import SegmentedControl from '../../src/configpanel/components/SegmentedControl.js';
import { SourceChecklist } from '../../src/configpanel/components/SourceChecklist.js';
import type { DetectedRow } from '../../src/configpanel/hooks/useDetected.js';

// ---------------------------------------------------------------------------
// SourceChecklist tests
// ---------------------------------------------------------------------------

describe('SourceChecklist', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  const sources = ['gps.1', 'gps.2', 'gps.3'];

  it('renders one checkbox per live source', () => {
    const { getAllByRole } = render(
      createElement(SourceChecklist, {
        sources,
        includeSources: undefined,
        excludeSources: undefined,
        onChange: vi.fn(),
        idPrefix: 'test-row',
      })
    );
    expect(getAllByRole('checkbox')).toHaveLength(3);
  });

  it('unchecking an included source yields excludeSources and no non-empty includeSources', () => {
    const onChange = vi.fn();
    const { getAllByRole } = render(
      createElement(SourceChecklist, {
        sources,
        includeSources: undefined,
        excludeSources: undefined,
        onChange,
        idPrefix: 'test-row',
      })
    );
    const checkboxes = getAllByRole('checkbox') as HTMLInputElement[];
    // Uncheck gps.1 (the first checkbox)
    fireEvent.click(checkboxes[0] as HTMLElement);
    expect(onChange).toHaveBeenCalledOnce();
    const payload: RawPathConfigPatch = onChange.mock.calls[0][0];

    // Must have excludeSources containing the unchecked source
    expect(payload.excludeSources).toContain('gps.1');

    // Must NEVER have both includeSources and excludeSources non-empty at once
    const hasIncludes = Array.isArray(payload.includeSources) && payload.includeSources.length > 0;
    const hasExcludes = Array.isArray(payload.excludeSources) && payload.excludeSources.length > 0;
    expect(hasIncludes && hasExcludes).toBe(false);
  });

  it('never emits both includeSources and excludeSources non-empty in any operation', () => {
    const onChange = vi.fn();
    const { getAllByRole } = render(
      createElement(SourceChecklist, {
        sources,
        includeSources: undefined,
        excludeSources: undefined,
        onChange,
        idPrefix: 'test-row',
      })
    );
    const checkboxes = getAllByRole('checkbox') as HTMLInputElement[];
    for (const cb of checkboxes) {
      fireEvent.click(cb);
    }

    for (const call of onChange.mock.calls) {
      const payload: RawPathConfigPatch = call[0];
      const hasIncludes =
        Array.isArray(payload.includeSources) && payload.includeSources.length > 0;
      const hasExcludes =
        Array.isArray(payload.excludeSources) && payload.excludeSources.length > 0;
      expect(hasIncludes && hasExcludes).toBe(false);
    }
  });

  it('when includeSources is already set, trimming uses includeSources not excludeSources', () => {
    const onChange = vi.fn();
    const { getAllByRole } = render(
      createElement(SourceChecklist, {
        sources,
        includeSources: ['gps.1', 'gps.2', 'gps.3'],
        excludeSources: undefined,
        onChange,
        idPrefix: 'test-row',
      })
    );
    const checkboxes = getAllByRole('checkbox') as HTMLInputElement[];
    // Uncheck gps.1
    fireEvent.click(checkboxes[0] as HTMLElement);
    const payload: RawPathConfigPatch = onChange.mock.calls[0][0];

    // Must NOT produce excludeSources when includeSources was pre-set
    const hasExcludes = Array.isArray(payload.excludeSources) && payload.excludeSources.length > 0;
    expect(hasExcludes).toBe(false);
    // Must produce includeSources minus the unchecked source
    expect(payload.includeSources).not.toContain('gps.1');
    expect(payload.includeSources).toContain('gps.2');
    expect(payload.includeSources).toContain('gps.3');
  });
});

// ---------------------------------------------------------------------------
// PerPathSettings tests
// ---------------------------------------------------------------------------

describe('PerPathSettings', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  const row: DetectedRow = {
    path: 'navigation.speedOverGround',
    sources: ['gps.1', 'gps.2', 'gps.3'],
    kind: 'scalar',
    optedIn: true,
  };

  const config: RawPathConfig = {
    path: 'navigation.speedOverGround',
  };

  const idPrefix = 'test-row';

  it('renders Tier 1 controls: method selector, minSources input, and source checklist', () => {
    const { getByLabelText, getAllByRole } = render(
      createElement(PerPathSettings, { row, config, onChange: vi.fn(), idPrefix })
    );
    // Method selector
    expect(getByLabelText(/method/i)).toBeInTheDocument();
    // minSources number input
    expect(getByLabelText(/minimum sources/i)).toBeInTheDocument();
    // Source checklist checkboxes (one per source)
    expect(getAllByRole('checkbox')).toHaveLength(row.sources.length);
  });

  it('raises minSources past source count and renders a warning but still fires onChange', () => {
    const onChange = vi.fn();
    const { getByLabelText, getByText } = render(
      createElement(PerPathSettings, { row, config, onChange, idPrefix })
    );
    const minSourcesInput = getByLabelText(/minimum sources/i) as HTMLInputElement;
    // row has 3 sources; set minSources to 5 (above count)
    fireEvent.change(minSourcesInput, { target: { value: '5' } });

    // Warning text should appear
    expect(getByText(/3 source/i)).toBeInTheDocument();

    // onChange must still have fired with the new value
    expect(onChange).toHaveBeenCalled();
    const calls = onChange.mock.calls;
    const lastPayload: RawPathConfigPatch = calls[calls.length - 1][0];
    expect(lastPayload.minSources).toBe(5);
  });

  it('clearing minSources emits { minSources: undefined } to signal key removal', () => {
    const onChange = vi.fn();
    const configWithMin: RawPathConfig = { path: 'navigation.speedOverGround', minSources: 3 };
    const { getByLabelText } = render(
      createElement(PerPathSettings, { row, config: configWithMin, onChange, idPrefix })
    );
    const minSourcesInput = getByLabelText(/minimum sources/i) as HTMLInputElement;
    // Clear the field
    fireEvent.change(minSourcesInput, { target: { value: '' } });
    expect(onChange).toHaveBeenCalled();
    const payload: RawPathConfigPatch = onChange.mock.calls[onChange.mock.calls.length - 1][0];
    expect(Object.hasOwn(payload, 'minSources')).toBe(true);
    expect(payload.minSources).toBeUndefined();
  });

  it('the Advanced section is collapsed by default', () => {
    const { queryByText } = render(
      createElement(PerPathSettings, { row, config, onChange: vi.fn(), idPrefix })
    );
    // Advanced threshold labels should not be visible (collapsed)
    expect(queryByText(/outlier threshold/i)).toBeNull();
  });

  it('the Advanced section expands on click', () => {
    const { getByText } = render(
      createElement(PerPathSettings, { row, config, onChange: vi.fn(), idPrefix })
    );
    const advancedToggle = getByText(/advanced/i);
    fireEvent.click(advancedToggle);

    // After expanding, advanced fields should be visible
    expect(getByText(/staleness/i)).toBeInTheDocument();
  });

  it('a NumberField rejects a negative value but accepts a non-negative one', () => {
    const onChange = vi.fn();
    const { getByText, getByLabelText } = render(
      createElement(PerPathSettings, { row, config, onChange, idPrefix })
    );
    fireEvent.click(getByText(/advanced/i));
    const madInput = getByLabelText(/mad threshold/i) as HTMLInputElement;
    onChange.mockClear();
    // Negative: the validator rejects it, so the field emits no patch.
    fireEvent.change(madInput, { target: { value: '-5' } });
    expect(onChange).not.toHaveBeenCalled();
    // Non-negative: accepted and emitted.
    fireEvent.change(madInput, { target: { value: '2.5' } });
    expect(onChange).toHaveBeenCalledWith({ madThreshold: 2.5 });
  });
});

describe('SegmentedControl', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('marks the active choice with aria-pressed and fires onChange on the other', () => {
    const onChange = vi.fn();
    const { getByRole } = render(
      createElement(SegmentedControl<'a' | 'b'>, {
        legend: 'Pick one',
        choices: [
          { value: 'a', label: 'Alpha' },
          { value: 'b', label: 'Beta' },
        ],
        value: 'a',
        onChange,
      })
    );
    expect(getByRole('button', { name: 'Alpha' })).toHaveAttribute('aria-pressed', 'true');
    expect(getByRole('button', { name: 'Beta' })).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(getByRole('button', { name: 'Beta' }));
    expect(onChange).toHaveBeenCalledWith('b');
  });
});
