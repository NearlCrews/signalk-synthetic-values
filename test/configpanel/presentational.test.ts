// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { KindBadge } from '../../src/configpanel/components/KindBadge';
import { PriorityBanner } from '../../src/configpanel/components/PriorityBanner';
import { SourceChips, sourceChips } from '../../src/configpanel/components/SourceChips';
import { kindMeta } from '../../src/configpanel/kindMeta';

// ---- kindMeta unit tests ----

describe('kindMeta', () => {
  it('returns the position label and neutral tone', () => {
    const meta = kindMeta('position');
    expect(meta.label).toBe('position');
    expect(meta.tone).toBe('neutral');
    expect(meta.srLabel).toContain('position');
  });

  it('returns the angular label and neutral tone', () => {
    const meta = kindMeta('angular');
    expect(meta.label).toBe('angular');
    expect(meta.tone).toBe('neutral');
    expect(meta.srLabel).toContain('angular');
  });

  it('returns the scalar label and neutral tone', () => {
    const meta = kindMeta('scalar');
    expect(meta.label).toBe('scalar');
    expect(meta.tone).toBe('neutral');
  });

  it('returns the other label and warning tone', () => {
    const meta = kindMeta('other');
    expect(meta.label).toBe('other');
    expect(meta.tone).toBe('warning');
    expect(meta.srLabel).toContain('other');
  });

  it('returns the unknown label and neutral tone', () => {
    const meta = kindMeta('unknown');
    expect(meta.label).toBe('unknown');
    expect(meta.tone).toBe('neutral');
    expect(meta.srLabel).toContain('unknown');
  });

  it('falls back to neutral for an unrecognized kind and labels it unknown', () => {
    const meta = kindMeta('something-else');
    expect(meta.tone).toBe('neutral');
    expect(meta.label).toBe('unknown');
  });
});

// ---- KindBadge component tests ----

describe('KindBadge', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('renders the position label as visible text', () => {
    const { getByText } = render(createElement(KindBadge, { kind: 'position' }));
    expect(getByText('position')).toBeInTheDocument();
  });

  it('provides an accessible label for position via a visually-hidden span', () => {
    render(createElement(KindBadge, { kind: 'position' }));
    expect(screen.getByText(/kind: position/i)).toBeInTheDocument();
  });
});

// ---- SourceChips component tests ----

describe('sourceChips', () => {
  const sources = ['gps.1', 'gps.2', 'gps.3'];

  it('marks every source live when the path is not configured', () => {
    expect(sourceChips(sources, [], undefined, false).map((c) => c.state)).toEqual([
      'live',
      'live',
      'live',
    ]);
  });

  it('marks a source the combiner no longer sees as stale', () => {
    expect(sourceChips(sources, ['gps.1'], undefined, true)).toEqual([
      { sourceRef: 'gps.1', state: 'live' },
      { sourceRef: 'gps.2', state: 'stale' },
      { sourceRef: 'gps.3', state: 'stale' },
    ]);
  });

  it('excluded wins over stale, because the operator asked for it', () => {
    expect(sourceChips(sources, ['gps.1'], ['gps.2'], true)).toEqual([
      { sourceRef: 'gps.1', state: 'live' },
      { sourceRef: 'gps.2', state: 'excluded' },
      { sourceRef: 'gps.3', state: 'stale' },
    ]);
  });
});

describe('SourceChips', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  const chipsFor = (
    sources: string[],
    fresh: string[] | undefined = undefined,
    excluded: string[] | undefined = undefined
  ) => sourceChips(sources, fresh, excluded, fresh !== undefined);

  const five = ['gps.1', 'gps.2', 'gps.3', 'gps.4', 'gps.5'];

  it('shows the first 3 chips when there are 5 sources', () => {
    const { getByText } = render(createElement(SourceChips, { chips: chipsFor(five) }));
    expect(getByText('gps.1')).toBeInTheDocument();
    expect(getByText('gps.2')).toBeInTheDocument();
    expect(getByText('gps.3')).toBeInTheDocument();
  });

  it('offers the rest through a real control rather than a hover tooltip', () => {
    const { getByRole } = render(createElement(SourceChips, { chips: chipsFor(five) }));
    const toggle = getByRole('button', { name: '2 more sources' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(toggle);
    expect(getByRole('button', { name: 'Show fewer' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('gps.4')).toBeVisible();
  });

  it('keeps the overflow chips out of view until the control is pressed', () => {
    render(createElement(SourceChips, { chips: chipsFor(five) }));
    expect(screen.getByText('gps.4')).not.toBeVisible();
  });

  it('names a stale source in its own text, not by colour alone', () => {
    render(createElement(SourceChips, { chips: chipsFor(['gps.1', 'gps.2'], ['gps.1']) }));
    expect(screen.getByText('gps.2, no data')).toBeInTheDocument();
    expect(screen.getByText('gps.1')).toBeInTheDocument();
  });

  it('names an excluded source in its own text', () => {
    render(
      createElement(SourceChips, { chips: chipsFor(['gps.1', 'gps.2'], undefined, ['gps.2']) })
    );
    expect(screen.getByText('gps.2, excluded')).toBeInTheDocument();
  });

  it('shows all chips without overflow when there are 3 or fewer sources', () => {
    const three = ['gps.1', 'gps.2', 'gps.3'];
    const { getByText, queryByText } = render(
      createElement(SourceChips, { chips: chipsFor(three) })
    );
    expect(getByText('gps.1')).toBeInTheDocument();
    expect(getByText('gps.2')).toBeInTheDocument();
    expect(getByText('gps.3')).toBeInTheDocument();
    expect(queryByText(/more source/)).toBeNull();
  });

  it('renders nothing when no sources are live', () => {
    const { container } = render(createElement(SourceChips, { chips: [] }));
    expect(container).toBeEmptyDOMElement();
  });
});

// ---- PriorityBanner component tests ----

describe('PriorityBanner', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('renders when show is true', () => {
    render(
      createElement(PriorityBanner, {
        show: true,
        sourceLabel: 'signalk-synthetic-values',
        onDismiss: vi.fn(),
      })
    );
    expect(screen.getByRole('region')).toBeInTheDocument();
  });

  it('does not render when show is false', () => {
    const { container } = render(
      createElement(PriorityBanner, {
        show: false,
        sourceLabel: 'signalk-synthetic-values',
        onDismiss: vi.fn(),
      })
    );
    expect(container.firstChild).toBeNull();
  });

  it('links to Data, Priorities and explains group fallback behavior', () => {
    render(
      createElement(PriorityBanner, {
        show: true,
        sourceLabel: 'signalk-synthetic-values',
        onDismiss: vi.fn(),
      })
    );
    expect(screen.getByText(/signalk-synthetic-values/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /data, priorities/i })).toHaveAttribute(
      'href',
      '#/data/priorities'
    );
    expect(screen.getByText(/relevant group/i)).toBeInTheDocument();
    expect(screen.getByText(/fallback after/i)).toBeInTheDocument();
  });

  it('is dismissible via a button that calls onDismiss', () => {
    const onDismiss = vi.fn();
    render(
      createElement(PriorityBanner, {
        show: true,
        sourceLabel: 'signalk-synthetic-values',
        onDismiss,
      })
    );
    const dismissBtn = screen.getByRole('button', { name: /dismiss/i });
    fireEvent.click(dismissBtn);
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it('does not claim the source is "preferred"', () => {
    render(
      createElement(PriorityBanner, {
        show: true,
        sourceLabel: 'signalk-synthetic-values',
        onDismiss: vi.fn(),
      })
    );
    expect(screen.queryByText(/preferred/i)).toBeNull();
  });
});
