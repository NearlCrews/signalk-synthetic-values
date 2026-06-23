// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import '@testing-library/jest-dom';
import { render, fireEvent } from '@testing-library/react';
import { createElement } from 'react';

import { SourceChecklist } from '../../src/configpanel/components/SourceChecklist.js';
import { PerPathSettings } from '../../src/configpanel/components/PerPathSettings.js';
import type { RawPathConfig } from '../../src/config.js';
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
      })
    );
    const checkboxes = getAllByRole('checkbox') as HTMLInputElement[];
    // Uncheck gps.1 (the first checkbox)
    fireEvent.click(checkboxes[0] as HTMLElement);
    expect(onChange).toHaveBeenCalledOnce();
    const payload: Partial<RawPathConfig> = onChange.mock.calls[0][0];

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
      })
    );
    const checkboxes = getAllByRole('checkbox') as HTMLInputElement[];
    for (const cb of checkboxes) {
      fireEvent.click(cb);
    }

    for (const call of onChange.mock.calls) {
      const payload: Partial<RawPathConfig> = call[0];
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
      })
    );
    const checkboxes = getAllByRole('checkbox') as HTMLInputElement[];
    // Uncheck gps.1
    fireEvent.click(checkboxes[0] as HTMLElement);
    const payload: Partial<RawPathConfig> = onChange.mock.calls[0][0];

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

  it('renders Tier 1 controls: method selector, minSources input, and source checklist', () => {
    const { getByLabelText, getAllByRole } = render(
      createElement(PerPathSettings, { row, config, onChange: vi.fn() })
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
      createElement(PerPathSettings, { row, config, onChange })
    );
    const minSourcesInput = getByLabelText(/minimum sources/i) as HTMLInputElement;
    // row has 3 sources; set minSources to 5 (above count)
    fireEvent.change(minSourcesInput, { target: { value: '5' } });

    // Warning text should appear
    expect(getByText(/3 source/i)).toBeInTheDocument();

    // onChange must still have fired with the new value
    expect(onChange).toHaveBeenCalled();
    const calls = onChange.mock.calls;
    const lastPayload: Partial<RawPathConfig> = calls[calls.length - 1][0];
    expect(lastPayload.minSources).toBe(5);
  });

  it('the Advanced section is collapsed by default', () => {
    const { queryByText } = render(
      createElement(PerPathSettings, { row, config, onChange: vi.fn() })
    );
    // Advanced threshold labels should not be visible (collapsed)
    expect(queryByText(/outlier threshold/i)).toBeNull();
  });

  it('the Advanced section expands on click', () => {
    const { getByText } = render(
      createElement(PerPathSettings, { row, config, onChange: vi.fn() })
    );
    const advancedToggle = getByText(/advanced/i);
    fireEvent.click(advancedToggle);

    // After expanding, advanced fields should be visible
    expect(getByText(/staleness/i)).toBeInTheDocument();
  });
});
