import type { CSSProperties } from 'react';

// Design tokens for the federated config panel.
//
// The panel renders inside the Signal K admin UI, which is Bootstrap 5.3 and
// flips between light and dark via `data-bs-theme` on a host element. Inline
// styles cannot read that theme, so every color here references a `--skn-*`
// CSS custom property instead of a hex literal. TOKENS_CSS (below) defines
// those properties once on `.skn-panel` with explicit light values, then
// overrides them for dark mode. Surfaces are deliberately NOT derived from
// the host's `--bs-body-bg`: the admin's body background is page-gray, so a
// card that inherits it loses its white fill and blends into the page.
// Components stay theme-agnostic: they read tokens, the theme layer redefines
// them. A new hex literal in a component is a defect.
//
// Theme pinning: a `data-skn-theme` attribute on the `.skn-panel` root
// (set by ThemeToggle, persisted under localStorage key `skn-theme`) pins
// light, dark, or the red-preserving night theme regardless of the host.
// The pinned blocks share specificity (0,2,0) with the host-driven dark
// block and are emitted later in the stylesheet, so a pinned choice wins.

// Scale tokens: theme-independent, defined once on the root. Radii and font
// sizes sit on Bootstrap 5.3 defaults (radius .375rem = 6px, small text
// .875rem = 14px) so the panel reads native inside the CoreUI admin shell.
// The display size gives the wizard title and view-level headings one step of
// real contrast over the 15px card titles. Spacing runs an 8/12/16 scale so
// gutters stay on a consistent rhythm.
const SCALE_TOKENS = `
	--skn-radius: 6px;
	--skn-radius-sm: 4px;
	--skn-radius-pill: 999px;
	--skn-font-body: 14px;
	--skn-font-small: 12px;
	--skn-font-title: 15px;
	--skn-font-display: 17px;
	--skn-space-1: 8px;
	--skn-space-2: 12px;
	--skn-space-3: 16px;
`;

// Light theme. Cards must read white so they stand out from the admin's gray
// page background. Faint text is #62687a: 5.05:1 on the raised surface and
// 4.99:1 on the warn background, so it clears WCAG AA (4.5:1) everywhere it
// is used at small sizes.
// color-scheme rides along with each token block so native widgets
// (checkboxes, select dropdown lists, number spinners, scrollbars) follow the
// panel theme even when it is pinned against the host.
const LIGHT_TOKENS = `
	color-scheme: light;
	--skn-bg: #e4e5e6;
	--skn-surface: #ffffff;
	--skn-surface-muted: #f8f9fa;
	--skn-surface-raised: #f3f4f6;
	--skn-border: #e0e0e0;
	--skn-text: #333333;
	--skn-text-muted: #555555;
	--skn-text-faint: #62687a;
	--skn-accent: #3b82f6;
	--skn-accent-text: #ffffff;
	--skn-ok: #22c55e;
	--skn-wait: #f59e0b;
	--skn-off: #9ca3af;
	--skn-danger-bg: #fef2f2;
	--skn-danger-fg: #991b1b;
	--skn-danger-border: #fca5a5;
	--skn-warn-bg: #fef3c7;
	--skn-warn-fg: #78350f;
	--skn-warn-border: #fbbf24;
	--skn-success-bg: #ecfdf5;
	--skn-success-fg: #065f46;
	--skn-success-border: #6ee7b7;
	--skn-info-bg: #eef2ff;
	--skn-info-fg: #3730a3;
	--skn-info-border: #c7d2fe;
`;

// Dark theme. Faint text is #9aa1ad: 4.88:1 on the raised surface, 5.63:1 on
// the card surface, so AA holds on every dark background it appears on.
const DARK_TOKENS = `
	color-scheme: dark;
	--skn-bg: #1b1c22;
	--skn-surface: #262833;
	--skn-surface-muted: #20212b;
	--skn-surface-raised: #30323f;
	--skn-border: #3a3c4a;
	--skn-text: #e6e7ea;
	--skn-text-muted: #a3a9b5;
	--skn-text-faint: #9aa1ad;
	--skn-accent: #4c93ff;
	--skn-accent-text: #ffffff;
	--skn-ok: #2dd4a0;
	--skn-wait: #fbbf24;
	--skn-off: #6b7785;
	--skn-danger-bg: #3a1a1a;
	--skn-danger-fg: #f5a3a3;
	--skn-danger-border: #7a3a3a;
	--skn-warn-bg: #3a2f12;
	--skn-warn-fg: #f5d28a;
	--skn-warn-border: #6b551f;
	--skn-success-bg: #12352a;
	--skn-success-fg: #7fe3c0;
	--skn-success-border: #2f6b54;
	--skn-info-bg: #1e2547;
	--skn-info-fg: #a9b6f0;
	--skn-info-border: #3a4577;
`;

// Night theme: red-preserving for night vision at the helm. Near-black
// surfaces, every text and accent token collapses into the desaturated red
// and amber families, nothing renders blue, green, or white. Contrast checked
// against the night surfaces: text 7.25:1, muted 5.13:1, faint 4.56:1 worst
// case, every status fg 5.65:1 or better on its paired bg.
const NIGHT_TOKENS = `
	color-scheme: dark;
	--skn-bg: #0d0606;
	--skn-surface: #160a0a;
	--skn-surface-muted: #110808;
	--skn-surface-raised: #1f0e0e;
	--skn-border: #3a1616;
	--skn-text: #e08a8a;
	--skn-text-muted: #b87474;
	--skn-text-faint: #ad6c6c;
	--skn-accent: #cf6a3c;
	--skn-accent-text: #1a0808;
	--skn-ok: #cf8a4a;
	--skn-wait: #a9742e;
	--skn-off: #7a4f4f;
	--skn-danger-bg: #2a0d0d;
	--skn-danger-fg: #e07a6a;
	--skn-danger-border: #6e2a2a;
	--skn-warn-bg: #241204;
	--skn-warn-fg: #d9a05a;
	--skn-warn-border: #6e4a1f;
	--skn-success-bg: #1d0f08;
	--skn-success-fg: #cf8a5a;
	--skn-success-border: #6e3f1f;
	--skn-info-bg: #200c0c;
	--skn-info-fg: #c98080;
	--skn-info-border: #5e2a2a;
`;

// Injected once by the config panel root. Covers the token contract, the
// host-driven dark overrides, the pinned theme blocks, and the :focus-visible
// ring (inline styles cannot express pseudo-classes). Order matters: the
// pinned `[data-skn-theme]` blocks come after the host-driven dark block so
// an explicit user choice outranks the host theme at equal specificity.
export const TOKENS_CSS = `
.skn-panel {
${SCALE_TOKENS}${LIGHT_TOKENS}}
[data-bs-theme="dark"] .skn-panel,
.dark-mode .skn-panel {
${DARK_TOKENS}}
.skn-panel[data-skn-theme="light"] {
${LIGHT_TOKENS}}
.skn-panel[data-skn-theme="dark"] {
${DARK_TOKENS}}
.skn-panel[data-skn-theme="night"] {
${NIGHT_TOKENS}}
.skn-panel input:focus-visible,
.skn-panel select:focus-visible,
.skn-panel button:focus-visible {
	outline: 2px solid var(--skn-accent);
	outline-offset: 1px;
}
/* Buttons set their background as an inline style, which outranks the
   browser's default disabled appearance, so a disabled button would still
   look enabled. !important is required to override the inline style for the
   disabled state. */
.skn-panel button:disabled {
	background: var(--skn-surface-raised) !important;
	color: var(--skn-text-faint) !important;
	border-color: var(--skn-border) !important;
	cursor: not-allowed !important;
}
/* Pointer feedback. Inline styles cannot express :hover or :active, so the
   interactive elements get a shared brightness response here: a touch darker
   on hover, darker still while pressed, with a short transition so the shift
   reads as a response rather than a flicker. Disabled buttons opt out. Only
   buttons transition filter: inputs and selects never receive one. */
.skn-panel input,
.skn-panel select {
	transition:
		background-color 120ms ease,
		border-color 120ms ease;
}
.skn-panel button {
	transition:
		background-color 120ms ease,
		border-color 120ms ease,
		filter 120ms ease;
}
.skn-panel button:hover:not(:disabled) {
	filter: brightness(0.96);
}
.skn-panel button:active:not(:disabled) {
	filter: brightness(0.9);
}
/* Inputs and selects inside mapping-table cells flex with the column instead
   of holding the fixed 220px of S.input / S.select, so the table fits a phone
   without forcing horizontal scroll. min-width keeps each field usable when
   columns compress. !important is required because the base S.input and
   S.select widths arrive as inline styles, which outrank this rule. */
.skn-panel td input:not([type="checkbox"]),
.skn-panel td select {
	width: 100% !important;
	min-width: 120px !important;
	box-sizing: border-box !important;
}
.skn-panel { --skn-toolbar-height: 52px; }
.skn-toolbar { position: sticky; top: 0; z-index: 2; }
.skn-row { scroll-margin-top: var(--skn-toolbar-height); }
.skn-row:hover { filter: brightness(0.97); }
`;

// Injects TOKENS_CSS into the document once. Safe to call multiple times;
// a guard prevents double injection.
export function injectStyles(): void {
  const STYLE_ID = 'skn-panel-tokens';
  if (typeof document === 'undefined') return;
  if (document.getElementById(STYLE_ID)) return;
  const el = document.createElement('style');
  el.id = STYLE_ID;
  el.textContent = TOKENS_CSS;
  document.head.appendChild(el);
}

export const S: Record<string, CSSProperties> = {
  // The root paints --skn-bg itself: a pinned Dark or Night theme must read
  // as one continuous surface, not dark cards floating on the host's light
  // page (and the sticky footer reuses the same background).
  root: {
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    color: 'var(--skn-text)',
    background: 'var(--skn-bg)',
    padding: 'var(--skn-space-3)',
    borderRadius: 'var(--skn-radius)',
  },
  statusBar: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 'var(--skn-space-3)',
    padding: 'var(--skn-space-2) var(--skn-space-3)',
    background: 'var(--skn-surface-muted)',
    border: '1px solid var(--skn-border)',
    borderRadius: 'var(--skn-radius)',
    marginBottom: 'var(--skn-space-3)',
    alignItems: 'center',
    fontSize: 'var(--skn-font-body)',
  },
  dot: { width: 10, height: 10, borderRadius: '50%', display: 'inline-block' },
  dotOk: { background: 'var(--skn-ok)' },
  dotWait: { background: 'var(--skn-wait)' },
  dotOff: { background: 'var(--skn-off)' },
  statLabel: { color: 'var(--skn-text-muted)' },
  statValue: { fontWeight: 600, marginLeft: 4 },
  errorBadge: {
    background: 'var(--skn-danger-bg)',
    color: 'var(--skn-danger-fg)',
    border: '1px solid var(--skn-danger-border)',
    padding: '2px 8px',
    borderRadius: 'var(--skn-radius-sm)',
    fontSize: 'var(--skn-font-small)',
  },
};

// Error badge rendered as a real button (jump to first error). Inherits the
// badge palette and adds button resets plus a pointer cursor.
S.errorBadgeButton = {
  ...S.errorBadge,
  cursor: 'pointer',
  font: 'inherit',
};

// Small (12px) semantic text utilities. Components spread these and add only
// layout tweaks (margins), so the small-text color treatments live in one
// place instead of being re-declared per component.
S.textSmallMuted = {
  fontSize: 'var(--skn-font-small)',
  color: 'var(--skn-text-muted)',
};
S.textSmallFaint = {
  fontSize: 'var(--skn-font-small)',
  color: 'var(--skn-text-faint)',
};
S.textSmallSuccess = {
  fontSize: 'var(--skn-font-small)',
  fontWeight: 600,
  color: 'var(--skn-success-fg)',
};
S.textSmallDanger = {
  fontSize: 'var(--skn-font-small)',
  fontWeight: 600,
  color: 'var(--skn-danger-fg)',
};
// Color-only utilities for cells that already carry their own font size.
S.textFaint = { color: 'var(--skn-text-faint)' };
S.textDanger = { color: 'var(--skn-danger-fg)' };
// Danger count badge in a section header.
S.sectionErrorCount = { ...S.textSmallDanger, marginLeft: 6 };
// Danger count pill on a category tab.
S.tabErrorDot = {
  display: 'inline-block',
  minWidth: 16,
  marginLeft: 6,
  padding: '0 5px',
  borderRadius: 'var(--skn-radius-pill)',
  background: 'var(--skn-danger-fg)',
  color: 'var(--skn-surface)',
  fontSize: 'var(--skn-font-small)',
  fontWeight: 700,
  lineHeight: '16px',
  textAlign: 'center',
};
S.fieldRow = {
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--skn-space-2)',
  marginBottom: 'var(--skn-space-1)',
  flexWrap: 'wrap',
};
// flex-basis 280 with shrink allowed: labels align in a column on wide
// screens but give the space back on tablets instead of forcing a dead gutter.
S.label = {
  fontSize: 'var(--skn-font-body)',
  color: 'var(--skn-text-muted)',
  flex: '0 1 280px',
};
S.select = {
  padding: '6px 10px',
  borderRadius: 'var(--skn-radius)',
  border: '1px solid var(--skn-border)',
  background: 'var(--skn-surface)',
  color: 'var(--skn-text)',
  fontSize: 'var(--skn-font-body)',
  minWidth: 220,
};
S.input = {
  padding: '6px 10px',
  borderRadius: 'var(--skn-radius)',
  border: '1px solid var(--skn-border)',
  background: 'var(--skn-surface)',
  color: 'var(--skn-text)',
  fontSize: 'var(--skn-font-body)',
  width: 220,
};
S.card = {
  background: 'var(--skn-surface)',
  border: '1px solid var(--skn-border)',
  borderRadius: 'var(--skn-radius)',
  padding: 'var(--skn-space-2) var(--skn-space-3)',
  marginBottom: 'var(--skn-space-2)',
};
S.cardHeader = {
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--skn-space-2)',
  marginBottom: 0,
  flexWrap: 'wrap',
};
// 22px hit area for marine use: a 16px checkbox is too small for wet fingers
// on a moving boat. accentColor keeps the checked fill on the token palette.
S.checkbox = {
  width: 22,
  height: 22,
  flexShrink: 0,
  cursor: 'pointer',
  accentColor: 'var(--skn-accent)',
};
S.cardMeta = {
  fontSize: 'var(--skn-font-small)',
  color: 'var(--skn-text-faint)',
};
S.tabs = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 4,
  borderBottom: '1px solid var(--skn-border)',
  marginBottom: 'var(--skn-space-2)',
};
S.tab = {
  padding: '8px 14px',
  minHeight: 36,
  background: 'transparent',
  border: 'none',
  borderBottom: '2px solid transparent',
  cursor: 'pointer',
  fontSize: 'var(--skn-font-body)',
  color: 'var(--skn-text-muted)',
};
S.tabActive = {
  borderBottom: '2px solid var(--skn-accent)',
  color: 'var(--skn-accent)',
  fontWeight: 600,
};
S.tabCount = { color: 'var(--skn-text-faint)' };
// Sticky action bar pinned to the bottom of the viewport.
S.footer = {
  position: 'sticky',
  bottom: 0,
  display: 'flex',
  alignItems: 'center',
  flexWrap: 'wrap',
  gap: 'var(--skn-space-1)',
  padding: 'var(--skn-space-2) 0',
  borderTop: '1px solid var(--skn-border)',
  marginTop: 'var(--skn-space-3)',
  background: 'var(--skn-bg)',
  zIndex: 5,
};
// Wrapper around the save-status indicator in the footer.
S.saveStatusFocus = {
  display: 'inline-flex',
  alignItems: 'center',
  outline: 'none',
};
S.btnPrimary = {
  padding: '8px 16px',
  minHeight: 36,
  background: 'var(--skn-accent)',
  color: 'var(--skn-accent-text)',
  border: 'none',
  borderRadius: 'var(--skn-radius)',
  fontWeight: 600,
  cursor: 'pointer',
};
S.btnSecondary = {
  padding: '8px 16px',
  minHeight: 36,
  background: 'var(--skn-surface-raised)',
  color: 'var(--skn-text)',
  border: '1px solid var(--skn-border)',
  borderRadius: 'var(--skn-radius)',
  cursor: 'pointer',
};
S.btnDestructive = {
  padding: '8px 16px',
  minHeight: 36,
  background: 'var(--skn-surface)',
  color: 'var(--skn-danger-fg)',
  border: '1px solid var(--skn-danger-border)',
  borderRadius: 'var(--skn-radius)',
  cursor: 'pointer',
};
// Compact destructive button sized for table rows.
S.btnDestructiveSm = {
  ...S.btnDestructive,
  padding: '6px 12px',
  fontSize: 'var(--skn-font-small)',
};
// Compact secondary button.
S.btnSecondarySm = {
  ...S.btnSecondary,
  padding: '6px 12px',
  fontSize: 'var(--skn-font-small)',
};
// Armed confirm state for the table-row Remove button.
S.btnDestructiveSmArmed = {
  ...S.btnDestructiveSm,
  background: 'var(--skn-danger-fg)',
  color: 'var(--skn-surface)',
  borderColor: 'var(--skn-danger-fg)',
  fontWeight: 600,
};
S.dirty = {
  color: 'var(--skn-warn-fg)',
  fontSize: 'var(--skn-font-small)',
  marginLeft: 8,
};
S.cardTitle = {
  fontSize: 'var(--skn-font-title)',
  fontWeight: 600,
  flex: 1,
  minWidth: 180,
  margin: 0,
  color: 'var(--skn-text)',
};
S.cardPurpose = {
  fontSize: 'var(--skn-font-small)',
  color: 'var(--skn-text-muted)',
  lineHeight: 1.45,
  margin: '2px 0 6px',
};
// Shared shape for small inline card badges.
const badgeBase: CSSProperties = {
  display: 'inline-block',
  fontSize: 'var(--skn-font-small)',
  padding: '1px 6px',
  borderRadius: 'var(--skn-radius-sm)',
};
S.cardCompatibility = {
  ...badgeBase,
  marginLeft: 8,
  fontWeight: 500,
};
// Neutral palette on purpose: "Legacy" is a fact, not a warning.
S.cardLegacy = {
  ...badgeBase,
  marginLeft: 8,
  fontWeight: 500,
  background: 'var(--skn-surface-raised)',
  color: 'var(--skn-text-muted)',
  border: '1px solid var(--skn-border)',
  cursor: 'help',
};
S.helpHint = {
  fontSize: 'var(--skn-font-small)',
  color: 'var(--skn-text-muted)',
  lineHeight: 1.45,
  margin: '2px 0 6px',
};
S.notePrefix = {
  fontWeight: 600,
  marginRight: 4,
};
S.note = {
  background: 'var(--skn-warn-bg)',
  border: '1px solid var(--skn-warn-border)',
  borderRadius: 'var(--skn-radius-sm)',
  color: 'var(--skn-warn-fg)',
  fontSize: 'var(--skn-font-small)',
  lineHeight: 1.45,
  margin: '8px 0 6px',
  padding: '6px 8px',
};
// Informational note. Info palette, not amber.
S.noteInfo = {
  ...S.note,
  background: 'var(--skn-info-bg)',
  border: '1px solid var(--skn-info-border)',
  color: 'var(--skn-info-fg)',
};
S.errorMark = { color: 'var(--skn-danger-fg)', fontSize: 14, fontWeight: 700 };
S.loadingText = {
  color: 'var(--skn-text-muted)',
  fontSize: 'var(--skn-font-body)',
};
S.savedPill = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: 'var(--skn-font-small)',
  lineHeight: 1,
  color: 'var(--skn-success-fg)',
  background: 'var(--skn-success-bg)',
  border: '1px solid var(--skn-success-border)',
  borderRadius: 'var(--skn-radius-pill)',
  padding: '5px 12px',
  marginLeft: 8,
};
S.errorBanner = {
  color: 'var(--skn-danger-fg)',
  background: 'var(--skn-danger-bg)',
  border: '1px solid var(--skn-danger-border)',
  borderRadius: 'var(--skn-radius)',
  padding: '8px 12px',
  fontSize: 'var(--skn-font-body)',
  margin: '8px 0',
  display: 'flex',
  alignItems: 'center',
  flexWrap: 'wrap',
  gap: 12,
};
S.btnRetry = {
  padding: '6px 12px',
  minHeight: 36,
  background: 'var(--skn-surface)',
  color: 'var(--skn-danger-fg)',
  border: '1px solid var(--skn-danger-border)',
  borderRadius: 'var(--skn-radius)',
  fontSize: 'var(--skn-font-small)',
  cursor: 'pointer',
};
S.visuallyHidden = {
  position: 'absolute',
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: 'hidden',
  clip: 'rect(0,0,0,0)',
  whiteSpace: 'nowrap',
  border: 0,
};
S.chipRow = {
  display: 'flex',
  gap: 'var(--skn-space-1)',
  flexWrap: 'wrap',
  marginBottom: 'var(--skn-space-3)',
};
S.chip = {
  padding: '6px 12px',
  minHeight: 36,
  background: 'var(--skn-info-bg)',
  color: 'var(--skn-info-fg)',
  border: '1px solid var(--skn-info-border)',
  borderRadius: 'var(--skn-radius-pill)',
  fontSize: 'var(--skn-font-small)',
  fontWeight: 500,
  cursor: 'pointer',
};

// Segmented control (the theme toggle). Buttons share a bordered container;
// the active segment fills with the accent. 36px segments for marine touch use.
S.segmented = {
  display: 'inline-flex',
  // Rendered as a <fieldset>: zero out the user-agent margin and padding
  // so the segments sit flush inside the border.
  margin: 0,
  padding: 0,
  border: '1px solid var(--skn-border)',
  borderRadius: 'var(--skn-radius)',
  overflow: 'hidden',
  background: 'var(--skn-surface)',
};
S.segmentedBtn = {
  padding: '6px 12px',
  minHeight: 36,
  background: 'transparent',
  color: 'var(--skn-text-muted)',
  border: 'none',
  fontSize: 'var(--skn-font-small)',
  cursor: 'pointer',
};
S.segmentedBtnActive = {
  ...S.segmentedBtn,
  background: 'var(--skn-accent)',
  color: 'var(--skn-accent-text)',
  fontWeight: 600,
};

// Generic disclosure styles.
S.disclosureToggle = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  width: '100%',
  minHeight: 36,
  background: 'none',
  border: 'none',
  padding: 0,
  fontSize: 14,
  fontWeight: 600,
  color: 'var(--skn-text)',
  cursor: 'pointer',
  textAlign: 'left',
};
S.disclosureBody = { marginTop: 10 };
S.controlBar = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  flexWrap: 'wrap',
  gap: 'var(--skn-space-1)',
  marginBottom: 'var(--skn-space-2)',
};
S.controlBarGroup = {
  display: 'flex',
  alignItems: 'center',
  flexWrap: 'wrap',
  gap: 'var(--skn-space-1)',
};
S.searchRow = {
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--skn-space-1)',
  marginBottom: 'var(--skn-space-2)',
};
S.searchInput = {
  flex: 1,
  minWidth: 0,
  minHeight: 36,
  boxSizing: 'border-box',
  padding: '8px 12px',
  borderRadius: 'var(--skn-radius)',
  border: '1px solid var(--skn-border)',
  background: 'var(--skn-surface)',
  color: 'var(--skn-text)',
  fontSize: 'var(--skn-font-body)',
};
S.searchClear = {
  minHeight: 36,
  minWidth: 36,
  padding: '6px 12px',
  background: 'var(--skn-surface-raised)',
  color: 'var(--skn-text)',
  border: '1px solid var(--skn-border)',
  borderRadius: 'var(--skn-radius)',
  cursor: 'pointer',
  fontSize: 'var(--skn-font-small)',
};
S.countPill = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  minWidth: 20,
  padding: '1px 8px',
  borderRadius: 'var(--skn-radius-pill)',
  background: 'var(--skn-warn-bg)',
  color: 'var(--skn-warn-fg)',
  border: '1px solid var(--skn-warn-border)',
  fontSize: 'var(--skn-font-small)',
  fontWeight: 600,
};
