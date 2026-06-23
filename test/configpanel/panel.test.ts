// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import '@testing-library/jest-dom';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { createElement } from 'react';

import PluginConfigurationPanel from '../../src/configpanel/PluginConfigurationPanel.js';
import type { PluginOptions } from '../../src/config.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const combinedPath = 'navigation.speedOverGround';
const availablePath = 'navigation.headingTrue';

const baseConfig: PluginOptions = {
  defaultStalenessTimeoutMs: 10000,
  defaultEmitMinIntervalMs: 500,
  defaultMinSources: 2,
  maxSourcesPerPath: 10,
  paths: [{ path: combinedPath }],
};

// ---------------------------------------------------------------------------
// Mock fetch: /detected returns two rows: one already combined (optedIn true),
// one available (optedIn false).
// ---------------------------------------------------------------------------

const detectedPayload = {
  paths: [
    {
      path: combinedPath,
      sources: ['gps.1', 'gps.2'],
      kind: 'scalar',
      optedIn: true,
    },
    {
      path: availablePath,
      sources: ['compass.1', 'compass.2'],
      kind: 'scalar',
      optedIn: false,
    },
  ],
};

function mockFetch(): void {
  global.fetch = vi.fn().mockImplementation((url: string) => {
    if (typeof url === 'string' && url.includes('/detected')) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(detectedPayload),
      });
    }
    return Promise.reject(new Error(`unexpected fetch: ${String(url)}`));
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PluginConfigurationPanel', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    mockFetch();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders the theme toggle', async () => {
    const mockSave = vi.fn().mockResolvedValue(undefined);
    render(createElement(PluginConfigurationPanel, { configuration: baseConfig, save: mockSave }));

    // ThemeToggle renders as a fieldset with legend "Panel theme"
    await waitFor(() => {
      expect(screen.getByText(/panel theme/i)).toBeInTheDocument();
    });
  });

  it('renders both detected rows after the fetch resolves', async () => {
    const mockSave = vi.fn().mockResolvedValue(undefined);
    render(createElement(PluginConfigurationPanel, { configuration: baseConfig, save: mockSave }));

    await waitFor(() => {
      // Both path strings should appear in the DOM
      expect(screen.getByText(combinedPath)).toBeInTheDocument();
      expect(screen.getByText(availablePath)).toBeInTheDocument();
    });
  });

  it('renders the priority banner because a path is already combined', async () => {
    const mockSave = vi.fn().mockResolvedValue(undefined);
    render(createElement(PluginConfigurationPanel, { configuration: baseConfig, save: mockSave }));

    // The banner shows when paths.length > 0
    await waitFor(() => {
      expect(screen.getByRole('region', { name: /source priority/i })).toBeInTheDocument();
    });
  });

  it('calls save with the new path appended when Combine is clicked on the available row', async () => {
    const mockSave = vi.fn().mockResolvedValue(undefined);
    render(createElement(PluginConfigurationPanel, { configuration: baseConfig, save: mockSave }));

    // Wait for the detected rows to appear, then find the Combine button
    // on the available (not-yet-combined) row.
    // The available row is "navigation.headingTrue"; it is not in baseConfig.paths
    // so it renders with a primary "Combine" button (not disabled).
    await waitFor(() => {
      expect(screen.getByText(availablePath)).toBeInTheDocument();
    });

    // Find the enabled Combine button. The combined row has a Remove button;
    // the available row has the enabled Combine button.
    const combineBtns = screen.getAllByRole('button', { name: /combine/i });
    // Pick the enabled one (the combined row has no Combine button, only Remove).
    const enabledCombine = combineBtns.find(
      (btn) => !(btn as HTMLButtonElement).disabled && !btn.textContent?.toLowerCase().includes('all')
    );
    expect(enabledCombine).toBeDefined();
    fireEvent.click(enabledCombine as HTMLElement);

    await waitFor(() => {
      expect(mockSave).toHaveBeenCalled();
    });

    // The save argument should include the new path appended to the existing ones.
    const savedConfig = mockSave.mock.calls[0][0] as PluginOptions;
    const savedPaths = savedConfig.paths.map((p) => p.path);
    expect(savedPaths).toContain(combinedPath);
    expect(savedPaths).toContain(availablePath);

    // Top-level defaults must be preserved in the saved payload.
    expect(savedConfig).toMatchObject({
      defaultStalenessTimeoutMs: baseConfig.defaultStalenessTimeoutMs,
      defaultEmitMinIntervalMs: baseConfig.defaultEmitMinIntervalMs,
      defaultMinSources: baseConfig.defaultMinSources,
      maxSourcesPerPath: baseConfig.maxSourcesPerPath,
    });
  });

  it('debounces tuning updates: save is called after the debounce delay with the patched entry and preserved defaults', async () => {
    const mockSave = vi.fn().mockResolvedValue(undefined);
    render(createElement(PluginConfigurationPanel, { configuration: baseConfig, save: mockSave }));

    // Wait for the combined path row to appear (real timers; fetch is a microtask).
    await waitFor(() => {
      expect(screen.getByText(combinedPath)).toBeInTheDocument();
    });

    // Open the Tune disclosure on the combined row so the inputs render.
    const tuneBtn = screen.getByRole('button', { name: /tune/i });
    fireEvent.click(tuneBtn);

    // The "Minimum sources" number input is now in the DOM.
    const minSourcesInput = screen.getByLabelText(/minimum sources/i);
    expect(minSourcesInput).toBeInTheDocument();

    // Switch to fake timers AFTER the component has settled so the polling
    // interval and debounce timer are both under our control from here on.
    vi.useFakeTimers();

    // Record save calls BEFORE the tuning change.
    const callsBefore = mockSave.mock.calls.length;

    // Fire a change on the minimum-sources input.
    fireEvent.change(minSourcesInput, { target: { value: '3' } });

    // save must NOT have been called synchronously (debounce is still pending).
    expect(mockSave.mock.calls.length).toBe(callsBefore);

    // Advance fake timers past the 500 ms debounce and flush microtasks.
    vi.advanceTimersByTime(600);
    await Promise.resolve();

    vi.useRealTimers();

    // save must now have been called exactly once more.
    expect(mockSave.mock.calls.length).toBe(callsBefore + 1);
    const lastSaved = mockSave.mock.calls[mockSave.mock.calls.length - 1][0] as PluginOptions;

    // The saved payload includes the patched entry.
    const savedEntry = lastSaved.paths.find((p) => p.path === combinedPath);
    expect(savedEntry).toBeDefined();
    expect(savedEntry?.minSources).toBe(3);

    // The saved payload preserves the top-level defaults.
    expect(lastSaved).toMatchObject({
      defaultStalenessTimeoutMs: baseConfig.defaultStalenessTimeoutMs,
      defaultEmitMinIntervalMs: baseConfig.defaultEmitMinIntervalMs,
      defaultMinSources: baseConfig.defaultMinSources,
      maxSourcesPerPath: baseConfig.maxSourcesPerPath,
    });
  });
});
