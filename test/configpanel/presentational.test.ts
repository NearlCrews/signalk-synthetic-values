// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom';
import { fireEvent, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { KindBadge } from '../../src/configpanel/components/KindBadge';
import { PriorityBanner } from '../../src/configpanel/components/PriorityBanner';
import { SourceChips } from '../../src/configpanel/components/SourceChips';
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

describe('SourceChips', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  const five = ['gps.1', 'gps.2', 'gps.3', 'gps.4', 'gps.5'];

  it('shows the first 3 chips when there are 5 sources', () => {
    const { getByText } = render(createElement(SourceChips, { sources: five }));
    expect(getByText('gps.1')).toBeInTheDocument();
    expect(getByText('gps.2')).toBeInTheDocument();
    expect(getByText('gps.3')).toBeInTheDocument();
  });

  it('shows "+2 more" when there are 5 sources', () => {
    const { getByText } = render(createElement(SourceChips, { sources: five }));
    expect(getByText('+2 more')).toBeInTheDocument();
  });

  it('does not show gps.4 or gps.5 as visible chips when there are 5 sources', () => {
    const { container } = render(createElement(SourceChips, { sources: five }));
    const allSpans = Array.from(container.querySelectorAll('span'));
    const visibleChips = allSpans.filter((element) => element.textContent === 'gps.4');
    expect(visibleChips).toHaveLength(0);
  });

  it('renders a visually-hidden enumeration of all 5 sources', () => {
    render(createElement(SourceChips, { sources: five }));
    const hiddenText = screen.getByText(/Sources: gps\.1/i).textContent ?? '';
    for (const src of five) {
      expect(hiddenText).toContain(src);
    }
  });

  it('puts the full list in the container title attribute', () => {
    const { container } = render(createElement(SourceChips, { sources: five }));
    const root = container.firstElementChild as HTMLElement;
    const title = root?.title ?? root?.getAttribute('title') ?? '';
    for (const src of five) {
      expect(title).toContain(src);
    }
  });

  it('shows all chips without overflow when there are 3 or fewer sources', () => {
    const three = ['gps.1', 'gps.2', 'gps.3'];
    const { getByText, queryByText } = render(createElement(SourceChips, { sources: three }));
    expect(getByText('gps.1')).toBeInTheDocument();
    expect(getByText('gps.2')).toBeInTheDocument();
    expect(getByText('gps.3')).toBeInTheDocument();
    expect(queryByText(/more/)).toBeNull();
  });

  it('renders nothing when no sources are live', () => {
    const { container } = render(createElement(SourceChips, { sources: [] }));
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
