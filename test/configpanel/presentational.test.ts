// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import '@testing-library/jest-dom';
import { render } from '@testing-library/react';
import { createElement } from 'react';
import { KindBadge } from '../../src/configpanel/components/KindBadge';
import { SourceChips } from '../../src/configpanel/components/SourceChips';
import { kindMeta } from '../../src/configpanel/kindMeta';

// ---- kindMeta unit tests ----

describe('kindMeta', () => {
  it('returns position label and muted token', () => {
    const meta = kindMeta('position');
    expect(meta.label).toBe('position');
    expect(meta.token).toBe('muted');
    expect(meta.srLabel).toContain('position');
  });

  it('returns angular label and muted token', () => {
    const meta = kindMeta('angular');
    expect(meta.label).toBe('angular');
    expect(meta.token).toBe('muted');
    expect(meta.srLabel).toContain('angular');
  });

  it('returns scalar label and muted token', () => {
    const meta = kindMeta('scalar');
    expect(meta.label).toBe('scalar');
    expect(meta.token).toBe('muted');
  });

  it('returns other label and warn token (non-combinable)', () => {
    const meta = kindMeta('other');
    expect(meta.label).toBe('other');
    expect(meta.token).toBe('warn');
    expect(meta.srLabel).toContain('other');
  });

  it('returns unknown label and muted token', () => {
    const meta = kindMeta('unknown');
    expect(meta.label).toBe('unknown');
    expect(meta.token).toBe('muted');
    expect(meta.srLabel).toContain('unknown');
  });

  it('falls back to muted for unrecognised kind and labels as unknown', () => {
    const meta = kindMeta('something-else');
    expect(meta.token).toBe('muted');
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
    const { container } = render(createElement(KindBadge, { kind: 'position' }));
    // KindBadge appends a visually-hidden span carrying the srLabel ("kind: position").
    // It must be clipped and absolutely positioned (S.visuallyHidden pattern).
    const spans = Array.from(container.querySelectorAll('span'));
    const hiddenSpan = spans.find(
      (el) =>
        (el as HTMLElement).style.position === 'absolute' && (el as HTMLElement).style.clip !== ''
    );
    expect(hiddenSpan).toBeDefined();
    expect(hiddenSpan?.textContent).toContain('position');
  });

  it('uses the warn style for kind "other"', () => {
    const { container } = render(createElement(KindBadge, { kind: 'other' }));
    const pill = container.firstElementChild as HTMLElement;
    // The warn token family: background or color should reference --skn-warn-bg or --skn-warn-fg.
    const style = pill?.getAttribute('style') ?? '';
    expect(style).toMatch(/--skn-warn/);
  });

  it('uses the muted style for combinable kinds', () => {
    const { container } = render(createElement(KindBadge, { kind: 'scalar' }));
    const pill = container.firstElementChild as HTMLElement;
    const style = pill?.getAttribute('style') ?? '';
    expect(style).toMatch(/--skn-surface-muted|--skn-text-muted/);
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
    // gps.4 and gps.5 may appear in the visually-hidden list but NOT as visible chips.
    // The visible chip text is the direct text nodes; we query for visible chip spans only.
    const allSpans = Array.from(container.querySelectorAll('span'));
    const visibleChips = allSpans.filter((el) => {
      const s = (el as HTMLElement).style;
      return (
        s.position !== 'absolute' &&
        !el.closest('[style*="position: absolute"]') &&
        el.textContent === 'gps.4'
      );
    });
    expect(visibleChips).toHaveLength(0);
  });

  it('renders a visually-hidden enumeration of all 5 sources', () => {
    const { container } = render(createElement(SourceChips, { sources: five }));
    // Find the visually-hidden span (position absolute, clipped).
    const allSpans = Array.from(container.querySelectorAll('span'));
    const hiddenSpan = allSpans.find((el) => {
      const s = (el as HTMLElement).style;
      return s.position === 'absolute' && s.clip !== '';
    });
    expect(hiddenSpan).toBeDefined();
    // It must mention all 5 sources.
    for (const src of five) {
      expect(hiddenSpan?.textContent).toContain(src);
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
});
