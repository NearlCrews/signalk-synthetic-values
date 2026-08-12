// @vitest-environment jsdom

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PluginOptions } from '../../src/config.js';
import PluginConfigurationPanel from '../../src/configpanel/PluginConfigurationPanel.js';

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
    window.localStorage.clear();
    Object.defineProperty(window, 'CSSScopeRule', {
      configurable: true,
      value: class CSSScopeRule {},
    });
    mockFetch();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('renders without crashing when the host passes no saved configuration', async () => {
    // A fresh install: the Signal K admin UI mounts the panel with an undefined
    // configuration (nothing saved yet). The panel must not read paths off undefined.
    const mockSave = vi.fn();
    render(createElement(PluginConfigurationPanel, { configuration: undefined, save: mockSave }));
    expect(screen.getByText('Synthetic Values')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByTitle(availablePath)).toBeInTheDocument();
    });
  });

  it('renders without crashing when configuration is an empty object', async () => {
    // Some server versions pass an empty object rather than undefined.
    const mockSave = vi.fn();
    render(createElement(PluginConfigurationPanel, { configuration: {}, save: mockSave }));
    expect(screen.getByText('Synthetic Values')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByTitle(availablePath)).toBeInTheDocument();
    });
  });

  it('shows an Enable button when unconfigured and requests a config on click', async () => {
    // Unconfigured (no saved config) is the only state where the user cannot
    // reach a save trigger via detected paths, so the panel must offer one.
    const mockSave = vi.fn();
    render(createElement(PluginConfigurationPanel, { configuration: undefined, save: mockSave }));
    const enableBtn = screen.getByRole('button', { name: /enable plugin/i });
    expect(enableBtn).toBeInTheDocument();
    fireEvent.click(enableBtn);
    await waitFor(() => {
      expect(mockSave).toHaveBeenCalled();
    });
    // Requesting a configuration write is what enables the plugin server-side.
    const requested = mockSave.mock.calls[0][0] as PluginOptions;
    expect(Array.isArray(requested.paths)).toBe(true);
  });

  it('does not show the Enable button when a configuration is already present', async () => {
    const mockSave = vi.fn();
    render(createElement(PluginConfigurationPanel, { configuration: baseConfig, save: mockSave }));
    expect(screen.queryByRole('button', { name: /enable plugin/i })).not.toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByTitle(availablePath)).toBeInTheDocument();
    });
  });

  it('surfaces a failed request and retries it from the banner', async () => {
    const mockSave = vi
      .fn()
      .mockImplementationOnce(() => {
        throw new Error('boom');
      })
      .mockImplementation(() => undefined);
    render(createElement(PluginConfigurationPanel, { configuration: undefined, save: mockSave }));
    fireEvent.click(screen.getByRole('button', { name: /enable plugin/i }));
    // A synchronous host rejection must surface without claiming persistence.
    await waitFor(() => {
      expect(screen.getByText(/could not request the configuration update/i)).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    await waitFor(() => {
      expect(mockSave).toHaveBeenCalledTimes(2);
      expect(
        screen.queryByText(/could not request the configuration update/i)
      ).not.toBeInTheDocument();
      expect(
        screen.getByText(/configuration update requested from Signal K Admin/i)
      ).toBeInTheDocument();
    });
  });

  it('starts a fresh profile in Auto without persisting an implicit preference', async () => {
    const mockSave = vi.fn();
    const { container } = render(
      createElement(PluginConfigurationPanel, { configuration: baseConfig, save: mockSave })
    );

    await waitFor(() => {
      expect(screen.getByRole('radiogroup', { name: /panel theme/i })).toBeInTheDocument();
      expect(screen.getByRole('radio', { name: /auto/i })).toHaveAttribute('aria-checked', 'true');
      expect(container.querySelector('[data-snui-root]')).not.toHaveAttribute('data-snui-theme');
      expect(window.localStorage.getItem('signalk-nearlcrews-ui.theme.v1')).toBeNull();
    });
  });

  it('ignores the retired plugin-specific theme preference', async () => {
    window.localStorage.setItem('skn-theme', 'night');
    const mockSave = vi.fn();
    const { container } = render(
      createElement(PluginConfigurationPanel, { configuration: baseConfig, save: mockSave })
    );

    await waitFor(() => {
      expect(screen.getByRole('radio', { name: /auto/i })).toHaveAttribute('aria-checked', 'true');
      expect(container.querySelector('[data-snui-root]')).not.toHaveAttribute('data-snui-theme');
      expect(window.localStorage.getItem('signalk-nearlcrews-ui.theme.v1')).toBeNull();
      expect(window.localStorage.getItem('skn-theme')).toBe('night');
    });
  });

  it('shows a browser update message when native CSS scope is unavailable', () => {
    Object.defineProperty(window, 'CSSScopeRule', {
      configurable: true,
      value: undefined,
    });
    const mockSave = vi.fn();
    const { container } = render(
      createElement(PluginConfigurationPanel, { configuration: baseConfig, save: mockSave })
    );

    expect(screen.getByRole('alert')).toHaveTextContent(/browser update required/i);
    expect(container.querySelector('[data-snui-root]')).not.toBeInTheDocument();
  });

  it('renders both detected rows after the fetch resolves', async () => {
    const mockSave = vi.fn();
    render(createElement(PluginConfigurationPanel, { configuration: baseConfig, save: mockSave }));

    await waitFor(() => {
      // Both path strings should appear in the DOM
      expect(screen.getByTitle(combinedPath)).toBeInTheDocument();
      expect(screen.getByTitle(availablePath)).toBeInTheDocument();
    });
  });

  it('renders the priority banner because a path is already combined', async () => {
    const mockSave = vi.fn();
    render(createElement(PluginConfigurationPanel, { configuration: baseConfig, save: mockSave }));

    // The banner shows when paths.length > 0
    await waitFor(() => {
      expect(screen.getByRole('region', { name: /source priority/i })).toBeInTheDocument();
    });
  });

  it('moves focus to the detected-paths heading when the priority banner is dismissed', async () => {
    const mockSave = vi.fn();
    render(createElement(PluginConfigurationPanel, { configuration: baseConfig, save: mockSave }));
    await waitFor(() => {
      expect(screen.getByRole('region', { name: /source priority/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /dismiss priority reminder/i }));
    await waitFor(() => {
      expect(
        screen.getByText('Detected multi-source paths').closest('[tabindex="-1"]')
      ).toHaveFocus();
    });
  });

  it('requests the new path when Combine is clicked on the available row', async () => {
    const mockSave = vi.fn();
    render(createElement(PluginConfigurationPanel, { configuration: baseConfig, save: mockSave }));

    // Wait for the detected rows to appear, then find the Combine button
    // on the available (not-yet-combined) row.
    // The available row is "navigation.headingTrue"; it is not in baseConfig.paths
    // so it renders with a primary "Combine" button (not disabled).
    await waitFor(() => {
      expect(screen.getByTitle(availablePath)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: `Combine ${availablePath}` }));

    await waitFor(() => {
      expect(mockSave).toHaveBeenCalled();
    });

    // The request should include the new path appended to the existing ones.
    const requestedConfig = mockSave.mock.calls[0][0] as PluginOptions;
    const requestedPaths = requestedConfig.paths.map((p) => p.path);
    expect(requestedPaths).toContain(combinedPath);
    expect(requestedPaths).toContain(availablePath);

    // Top-level defaults must be preserved in the requested payload.
    expect(requestedConfig).toMatchObject({
      defaultStalenessTimeoutMs: baseConfig.defaultStalenessTimeoutMs,
      defaultEmitMinIntervalMs: baseConfig.defaultEmitMinIntervalMs,
      defaultMinSources: baseConfig.defaultMinSources,
      maxSourcesPerPath: baseConfig.maxSourcesPerPath,
    });
  });

  it('coalesces nearby writes into the latest snapshot after exactly 300 ms', async () => {
    const mockSave = vi.fn();
    render(createElement(PluginConfigurationPanel, { configuration: baseConfig, save: mockSave }));
    await waitFor(() => expect(screen.getByTitle(availablePath)).toBeInTheDocument());

    vi.useFakeTimers();
    fireEvent.click(screen.getByRole('button', { name: `Combine ${availablePath}` }));
    fireEvent.click(screen.getByRole('button', { name: `Remove ${combinedPath}` }));
    expect(mockSave).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(299);
    });
    expect(mockSave).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(mockSave).toHaveBeenCalledTimes(1);
    const requested = mockSave.mock.calls[0]?.[0] as PluginOptions;
    expect(requested.paths.map((path) => path.path)).toEqual([availablePath]);
    vi.useRealTimers();
  });

  it('requests the latest queued snapshot before the panel unmounts', async () => {
    const mockSave = vi.fn();
    const { unmount } = render(
      createElement(PluginConfigurationPanel, { configuration: baseConfig, save: mockSave })
    );
    await waitFor(() => expect(screen.getByTitle(availablePath)).toBeInTheDocument());

    vi.useFakeTimers();
    fireEvent.click(screen.getByRole('button', { name: `Combine ${availablePath}` }));
    fireEvent.click(screen.getByRole('button', { name: `Remove ${combinedPath}` }));
    expect(mockSave).not.toHaveBeenCalled();

    unmount();

    expect(mockSave).toHaveBeenCalledTimes(1);
    const requested = mockSave.mock.calls[0]?.[0] as PluginOptions;
    expect(requested.paths.map((path) => path.path)).toEqual([availablePath]);
    vi.useRealTimers();
  });

  it('cancels a queued snapshot when a genuine external configuration arrives', async () => {
    const mockSave = vi.fn();
    const { rerender } = render(
      createElement(PluginConfigurationPanel, { configuration: baseConfig, save: mockSave })
    );
    await waitFor(() => expect(screen.getByTitle(availablePath)).toBeInTheDocument());

    vi.useFakeTimers();
    fireEvent.click(screen.getByRole('button', { name: `Combine ${availablePath}` }));
    const external = {
      ...baseConfig,
      defaultMinSources: 3,
      paths: [{ path: 'external.path' }],
    };
    rerender(createElement(PluginConfigurationPanel, { configuration: external, save: mockSave }));
    act(() => {
      vi.advanceTimersByTime(300);
    });

    expect(mockSave).not.toHaveBeenCalled();
    expect(
      screen.getByText(/queued changes were canceled because the configuration changed elsewhere/i)
    ).toBeInTheDocument();
    vi.useRealTimers();
  });

  it('keeps a newer queued edit when the host echoes its starting baseline', async () => {
    const mockSave = vi.fn();
    const { rerender } = render(
      createElement(PluginConfigurationPanel, { configuration: baseConfig, save: mockSave })
    );
    await waitFor(() => expect(screen.getByTitle(availablePath)).toBeInTheDocument());

    vi.useFakeTimers();
    fireEvent.click(screen.getByRole('button', { name: `Combine ${availablePath}` }));
    rerender(
      createElement(PluginConfigurationPanel, {
        configuration: structuredClone(baseConfig),
        save: mockSave,
      })
    );
    act(() => {
      vi.advanceTimersByTime(300);
    });

    expect(mockSave).toHaveBeenCalledTimes(1);
    const requested = mockSave.mock.calls[0]?.[0] as PluginOptions;
    expect(requested.paths.map((path) => path.path)).toEqual([combinedPath, availablePath]);
    expect(
      screen.queryByText(
        /queued changes were canceled because the configuration changed elsewhere/i
      )
    ).not.toBeInTheDocument();
    vi.useRealTimers();
  });

  it('a no-change tuning edit does not request an update after coalescing', async () => {
    const mockSave = vi.fn();
    render(createElement(PluginConfigurationPanel, { configuration: baseConfig, save: mockSave }));

    await waitFor(() => {
      expect(screen.getByTitle(combinedPath)).toBeInTheDocument();
    });

    // Open the Tune disclosure on the combined row.
    const tuneBtn = screen.getByRole('button', {
      name: new RegExp(`^Tune\\s*settings for ${combinedPath}$`),
    });
    fireEvent.click(tuneBtn);

    const minSourcesInput = screen.getByLabelText(/minimum sources/i);

    // Record save calls before the tuning edit.
    const callsBefore = mockSave.mock.calls.length;

    vi.useFakeTimers();

    // Set minSources to 3 so it becomes the requested baseline.
    fireEvent.change(minSourcesInput, { target: { value: '3' } });
    act(() => {
      vi.advanceTimersByTime(300);
    });
    await Promise.resolve();

    const callsAfterFirst = mockSave.mock.calls.length;
    expect(callsAfterFirst).toBe(callsBefore + 1);

    // Now set it back to the same value: this should be a no-op save.
    fireEvent.change(minSourcesInput, { target: { value: '3' } });
    act(() => {
      vi.advanceTimersByTime(300);
    });
    await Promise.resolve();

    vi.useRealTimers();

    // No additional save should have fired.
    expect(mockSave.mock.calls.length).toBe(callsAfterFirst);
  });

  it('coalesces tuning updates for 300 ms and preserves the complete configuration', async () => {
    const mockSave = vi.fn();
    render(createElement(PluginConfigurationPanel, { configuration: baseConfig, save: mockSave }));

    // Wait for the combined path row to appear (real timers; fetch is a microtask).
    await waitFor(() => {
      expect(screen.getByTitle(combinedPath)).toBeInTheDocument();
    });

    // Open the Tune disclosure on the combined row so the inputs render.
    const tuneBtn = screen.getByRole('button', {
      name: new RegExp(`^Tune\\s*settings for ${combinedPath}$`),
    });
    fireEvent.click(tuneBtn);

    // The "Minimum sources" number input is now in the DOM.
    const minSourcesInput = screen.getByLabelText(/minimum sources/i);
    expect(minSourcesInput).toBeInTheDocument();

    // Switch to fake timers AFTER the component has settled so the polling
    // interval and coalescing timer are both under our control from here on.
    vi.useFakeTimers();

    // Record save calls BEFORE the tuning change.
    const callsBefore = mockSave.mock.calls.length;

    // Fire a change on the minimum-sources input.
    fireEvent.change(minSourcesInput, { target: { value: '3' } });

    // save must NOT have been called synchronously (coalescing is still pending).
    expect(mockSave.mock.calls.length).toBe(callsBefore);

    act(() => {
      vi.advanceTimersByTime(299);
    });
    expect(mockSave.mock.calls.length).toBe(callsBefore);
    act(() => {
      vi.advanceTimersByTime(1);
    });
    await Promise.resolve();

    vi.useRealTimers();

    // save must now have been called exactly once more.
    expect(mockSave.mock.calls.length).toBe(callsBefore + 1);
    const lastRequested = mockSave.mock.calls[mockSave.mock.calls.length - 1][0] as PluginOptions;

    // The requested payload includes the patched entry.
    const requestedEntry = lastRequested.paths.find((p) => p.path === combinedPath);
    expect(requestedEntry).toBeDefined();
    expect(requestedEntry?.minSources).toBe(3);

    // The requested payload preserves the top-level defaults.
    expect(lastRequested).toMatchObject({
      defaultStalenessTimeoutMs: baseConfig.defaultStalenessTimeoutMs,
      defaultEmitMinIntervalMs: baseConfig.defaultEmitMinIntervalMs,
      defaultMinSources: baseConfig.defaultMinSources,
      maxSourcesPerPath: baseConfig.maxSourcesPerPath,
    });
  });
});
