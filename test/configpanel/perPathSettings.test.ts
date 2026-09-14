// @vitest-environment jsdom

import { fireEvent, render } from '@testing-library/react';
import { createElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RawPathConfig, RawPathConfigPatch } from '../../src/config.js';
import { DEFAULT_MIN_SOURCES } from '../../src/config.js';
import { PerPathSettings } from '../../src/configpanel/components/PerPathSettings.js';
import { SourceChecklist } from '../../src/configpanel/components/SourceChecklist.js';
import type { PanelDefaults } from '../../src/configpanel/defaultsContext.js';
import { PanelDefaultsContext } from '../../src/configpanel/defaultsContext.js';
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
    // Three sources plus the group's own select-all box.
    expect(getAllByRole('checkbox')).toHaveLength(4);
  });

  it('unchecking an included source yields excludeSources and no non-empty includeSources', () => {
    const onChange = vi.fn();
    const { getByRole } = render(
      createElement(SourceChecklist, {
        sources,
        includeSources: undefined,
        excludeSources: undefined,
        onChange,
      })
    );
    fireEvent.click(getByRole('checkbox', { name: 'gps.1' }));
    expect(onChange).toHaveBeenCalledOnce();
    const payload: RawPathConfigPatch = onChange.mock.calls[0][0];

    // Must have excludeSources containing the unchecked source
    expect(payload.excludeSources).toContain('gps.1');
    expect(payload).toHaveProperty('includeSources', undefined);

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
    const checkboxes = (getAllByRole('checkbox') as HTMLInputElement[]).filter(
      (box) => box.getAttribute('aria-label') !== 'All sources'
    );
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
    const { getByRole } = render(
      createElement(SourceChecklist, {
        sources,
        includeSources: ['gps.1', 'gps.2', 'gps.3'],
        excludeSources: undefined,
        onChange,
      })
    );
    // Uncheck gps.1
    fireEvent.click(getByRole('checkbox', { name: 'gps.1' }));
    const payload: RawPathConfigPatch = onChange.mock.calls[0][0];

    // Must NOT produce excludeSources when includeSources was pre-set
    const hasExcludes = Array.isArray(payload.excludeSources) && payload.excludeSources.length > 0;
    expect(hasExcludes).toBe(false);
    // Must produce includeSources minus the unchecked source
    expect(payload.includeSources).not.toContain('gps.1');
    expect(payload.includeSources).toContain('gps.2');
    expect(payload.includeSources).toContain('gps.3');
    expect(payload).toHaveProperty('excludeSources', undefined);
  });

  it('switches to excluding all live sources when the final included source is cleared', () => {
    const onChange = vi.fn();
    const { getByRole } = render(
      createElement(SourceChecklist, {
        sources,
        includeSources: ['gps.1'],
        excludeSources: undefined,
        onChange,
      })
    );

    fireEvent.click(getByRole('checkbox', { name: 'gps.1' }));

    expect(onChange).toHaveBeenCalledWith({
      includeSources: undefined,
      excludeSources: sources,
    });
  });

  it('clears both filter keys when the final excluded source is re-enabled', () => {
    const onChange = vi.fn();
    const { getByRole } = render(
      createElement(SourceChecklist, {
        sources,
        includeSources: undefined,
        excludeSources: ['gps.1'],
        onChange,
      })
    );

    fireEvent.click(getByRole('checkbox', { name: 'gps.1' }));

    expect(onChange).toHaveBeenCalledWith({
      includeSources: undefined,
      excludeSources: undefined,
    });
  });

  it('generates distinct checkbox ids for names that collided under the legacy sanitizer', () => {
    const { getAllByRole } = render(
      createElement(SourceChecklist, {
        sources: ['gps.1', 'gps-1'],
        includeSources: undefined,
        excludeSources: undefined,
        onChange: vi.fn(),
      })
    );

    const ids = getAllByRole('checkbox').map((checkbox) => checkbox.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('stays quiet while at least one source is selected', () => {
    const { queryByText } = render(
      createElement(SourceChecklist, {
        sources,
        includeSources: undefined,
        excludeSources: undefined,
        onChange: vi.fn(),
      })
    );
    expect(queryByText(/will not combine/)).toBeNull();
  });

  it('warns when nothing is selected, because the path then combines nothing', () => {
    const { getByRole, getByText } = render(
      createElement(SourceChecklist, {
        sources,
        includeSources: undefined,
        excludeSources: sources,
        onChange: vi.fn(),
      })
    );
    expect(
      getByText('No sources are selected, so this path will not combine.')
    ).toBeInTheDocument();
    expect(getByRole('checkbox', { name: 'All sources' })).toBeInTheDocument();
  });

  it('offers a select-all box that clears a full selection in one press', () => {
    const onChange = vi.fn();
    const { getByRole } = render(
      createElement(SourceChecklist, {
        sources,
        includeSources: undefined,
        excludeSources: undefined,
        onChange,
      })
    );
    fireEvent.click(getByRole('checkbox', { name: 'All sources' }));
    expect(onChange).toHaveBeenCalledWith({
      includeSources: undefined,
      excludeSources: sources,
    });
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
    // Source checklist checkboxes: one per source plus the select-all box.
    expect(getAllByRole('checkbox')).toHaveLength(row.sources.length + 1);
  });

  it('raises minSources past source count, fires onChange, and warns once committed', () => {
    const onChange = vi.fn();
    const { getByLabelText, getByText, queryByText, rerender } = render(
      createElement(PerPathSettings, { row, config, onChange, idPrefix })
    );
    const minSourcesInput = getByLabelText(/minimum sources/i) as HTMLInputElement;
    // row has 3 sources; set minSources to 5 (above count)
    fireEvent.change(minSourcesInput, { target: { value: '5' } });

    // onChange must have fired with the new value
    expect(onChange).toHaveBeenCalled();
    const calls = onChange.mock.calls;
    const lastPayload: RawPathConfigPatch = calls[calls.length - 1][0];
    expect(lastPayload.minSources).toBe(5);
    expect(queryByText(/3 selected source/i)).toBeNull();

    // The panel commits every valid keystroke, so the warning follows the
    // committed configuration rather than a field-local draft.
    rerender(
      createElement(PerPathSettings, {
        row,
        config: { ...config, minSources: 5 },
        onChange,
        idPrefix,
      })
    );
    expect(getByText(/3 selected source/i)).toBeInTheDocument();
    expect(minSourcesInput).toHaveValue(5);
  });

  it('shows the validation message for a value the runtime would reject', () => {
    const { getByLabelText, getByText } = render(
      createElement(PerPathSettings, { row, config, onChange: vi.fn(), idPrefix })
    );
    fireEvent.click(getByText(/advanced/i));
    const madInput = getByLabelText(/outlier threshold/i) as HTMLInputElement;
    fireEvent.change(madInput, { target: { value: '-5' } });
    expect(madInput).toHaveAttribute('aria-invalid', 'true');
    expect(madInput).toHaveAccessibleDescription(/enter a number of 0 or more/i);
  });

  it('describes a unit-bearing field by its unit without changing its name', () => {
    const { getByLabelText, getByText } = render(
      createElement(PerPathSettings, { row, config, onChange: vi.fn(), idPrefix })
    );
    fireEvent.click(getByText(/advanced/i));
    const staleness = getByLabelText('Staleness timeout');
    expect(staleness).toHaveAccessibleDescription(/ms/);
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

  it('the Advanced section is collapsed by default and named for its path', () => {
    const { getByRole, queryByText } = render(
      createElement(PerPathSettings, { row, config, onChange: vi.fn(), idPrefix })
    );
    expect(
      getByRole('button', {
        name: new RegExp(`^Advanced\\s*settings for ${row.path}$`),
      })
    ).toHaveAttribute('aria-expanded', 'false');
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
    const madInput = getByLabelText(/outlier threshold/i) as HTMLInputElement;
    onChange.mockClear();
    // Negative: the validator rejects it, so the field emits no patch.
    fireEvent.change(madInput, { target: { value: '-5' } });
    expect(onChange).not.toHaveBeenCalled();
    // Non-negative: accepted and emitted.
    fireEvent.change(madInput, { target: { value: '2.5' } });
    expect(onChange).toHaveBeenCalledWith({ madThreshold: 2.5 });
  });

  it('rejects panel values that the runtime validator would reject', () => {
    const onChange = vi.fn();
    const { getByText, getByLabelText } = render(
      createElement(PerPathSettings, { row, config, onChange, idPrefix })
    );
    fireEvent.click(getByText(/advanced/i));
    for (const label of [
      /reject threshold/i,
      /disagree threshold/i,
      /angular spread threshold/i,
      /slew limit/i,
      /staleness timeout/i,
    ]) {
      onChange.mockClear();
      fireEvent.change(getByLabelText(label), { target: { value: '0' } });
      expect(onChange).not.toHaveBeenCalled();
    }
    onChange.mockClear();
    fireEvent.change(getByLabelText(/trim fraction/i), { target: { value: '0.5' } });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('rejects a fractional minimum source count instead of truncating it', () => {
    const onChange = vi.fn();
    const { getByLabelText } = render(
      createElement(PerPathSettings, { row, config, onChange, idPrefix })
    );
    fireEvent.change(getByLabelText(/minimum sources/i), { target: { value: '2.5' } });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('minSources placeholder shows the resolved default value', () => {
    const { getByLabelText } = render(
      createElement(PerPathSettings, { row, config, onChange: vi.fn(), idPrefix })
    );
    // No provider in this render, so the context falls back to the shipped
    // defaults; the placeholder must state the number, not a bare "default".
    const input = getByLabelText(/minimum sources/i) as HTMLInputElement;
    expect(input.placeholder).toBe(`default: ${DEFAULT_MIN_SOURCES}`);
  });

  it('setting the jump max rate writes the rate alone, leaving the plugin defaults', () => {
    const onChange = vi.fn();
    const { getByText, getByLabelText } = render(
      createElement(PerPathSettings, { row, config, onChange, idPrefix })
    );
    fireEvent.click(getByText(/advanced/i));
    const rateInput = getByLabelText(/jump rejection max rate/i) as HTMLInputElement;
    fireEvent.change(rateInput, { target: { value: '5' } });
    // validateConfig backfills persistSamples and persistMs, so the saved
    // config carries only what the operator actually chose.
    expect(onChange).toHaveBeenCalledWith({ jumpRejection: { maxRate: 5 } });
    // 0 is not a valid rate (exclusive minimum): no patch may fire.
    onChange.mockClear();
    fireEvent.change(rateInput, { target: { value: '0' } });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('clearing the jump max rate switches it off and keeps the persist settings', () => {
    const onChange = vi.fn();
    const cfgWithJump: RawPathConfig = {
      path: 'navigation.speedOverGround',
      jumpRejection: { maxRate: 5, persistSamples: 3, persistMs: 5000 },
    };
    const { getByText, getByLabelText } = render(
      createElement(PerPathSettings, { row, config: cfgWithJump, onChange, idPrefix: 'row2' })
    );
    fireEvent.click(getByText(/advanced/i));
    const rateInput = getByLabelText(/jump rejection max rate/i) as HTMLInputElement;
    expect(rateInput.value).toBe('5');
    fireEvent.change(rateInput, { target: { value: '' } });
    expect(onChange).toHaveBeenCalledWith({
      jumpRejection: { maxRate: undefined, persistSamples: 3, persistMs: 5000 },
    });
  });
});

describe('PerPathSettings: the minimum-sources field and its warning', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  const row: DetectedRow = {
    path: 'navigation.speedOverGround',
    sources: ['gps.1', 'gps.2', 'gps.3'],
    kind: 'scalar',
    optedIn: true,
  };
  const idPrefix = 'test-row';

  function renderWith(config: RawPathConfig, defaults?: Partial<PanelDefaults>) {
    const value: PanelDefaults = {
      minSources: DEFAULT_MIN_SOURCES,
      stalenessTimeoutMs: 1000,
      emitMinIntervalMs: 1000,
      maxSourcesPerPath: 16,
      ...defaults,
    };
    return render(
      createElement(
        PanelDefaultsContext.Provider,
        { value },
        createElement(PerPathSettings, { row, config, onChange: vi.fn(), idPrefix })
      )
    );
  }

  it('refuses a minimum above the tracked-source cap, which the runtime would drop', () => {
    const { getByLabelText } = renderWith({ path: row.path }, { maxSourcesPerPath: 4 });
    const input = getByLabelText(/minimum sources/i) as HTMLInputElement;
    expect(input).toHaveAttribute('max', '4');
    fireEvent.change(input, { target: { value: '5' } });
    expect(input).toHaveAttribute('aria-invalid', 'true');
  });

  it('warns when the resolved default already exceeds the source count', () => {
    const { getByText } = renderWith({ path: 'p' }, { minSources: 4 });
    expect(getByText(/3 selected sources/i)).toBeInTheDocument();
    expect(getByText(/Requiring 4/)).toBeInTheDocument();
  });

  it('counts only the sources that pass the include and exclude filter', () => {
    const { getByText } = renderWith({ path: row.path, excludeSources: ['gps.2', 'gps.3'] });
    expect(getByText(/1 selected source\./i)).toBeInTheDocument();
  });

  it('stays quiet when enough sources are selected', () => {
    const { queryByText } = renderWith({ path: row.path });
    expect(queryByText(/will not combine until/i)).toBeNull();
  });
});

describe('PerPathSettings: clearing the jump rate', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  const row: DetectedRow = {
    path: 'navigation.speedOverGround',
    sources: ['gps.1', 'gps.2'],
    kind: 'scalar',
    optedIn: true,
  };

  it('keeps hand-tuned persist settings in the saved config when the rate is cleared', () => {
    const onChange = vi.fn();
    const tuned: RawPathConfig = {
      path: row.path,
      jumpRejection: { maxRate: 2, persistSamples: 7, persistMs: 12000 },
    };
    const { getByLabelText, getByText, rerender } = render(
      createElement(PerPathSettings, { row, config: tuned, onChange, idPrefix: 'r' })
    );
    fireEvent.click(getByText(/advanced/i));
    const rate = getByLabelText(/jump rejection max rate/i) as HTMLInputElement;

    fireEvent.change(rate, { target: { value: '' } });
    expect(onChange).toHaveBeenLastCalledWith({
      jumpRejection: { maxRate: undefined, persistSamples: 7, persistMs: 12000 },
    });

    // The host echoes the cleared config back, then the rate is entered again.
    // The persist settings come from the config itself, so any editor of it
    // sees the same two values rather than only this panel.
    rerender(
      createElement(PerPathSettings, {
        row,
        config: { path: row.path, jumpRejection: { persistSamples: 7, persistMs: 12000 } },
        onChange,
        idPrefix: 'r',
      })
    );
    fireEvent.change(getByLabelText(/jump rejection max rate/i), { target: { value: '2' } });
    expect(onChange).toHaveBeenLastCalledWith({
      jumpRejection: { maxRate: 2, persistSamples: 7, persistMs: 12000 },
    });
  });

  it('writes the rate alone for a path that never had persist settings', () => {
    const onChange = vi.fn();
    const { getByLabelText, getByText } = render(
      createElement(PerPathSettings, { row, config: { path: row.path }, onChange, idPrefix: 'r' })
    );
    fireEvent.click(getByText(/advanced/i));
    fireEvent.change(getByLabelText(/jump rejection max rate/i), { target: { value: '3' } });
    expect(onChange).toHaveBeenLastCalledWith({ jumpRejection: { maxRate: 3 } });
  });
});
