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
	--skn-font-mono: ui-monospace, "SFMono-Regular", "SF Mono", Menlo, Consolas, "Liberation Mono", monospace;
	--skn-space-1: 8px;
	--skn-space-2: 12px;
	--skn-space-3: 16px;
	--skn-rail-width: 3px;
`;

// Light theme. Cards must read white so they stand out from the admin's gray
// page background. Faint text is #62687a: 5.05:1 on the raised surface and
// 4.99:1 on the warn background, so it clears WCAG AA (4.5:1) everywhere it
// is used at small sizes. The accent pair also clears AA: white accent text
// on #2563eb is 5.17:1 (the earlier #3b82f6 was 3.68:1, a fail at body size).
// Hover and active feedback darkens on the light surfaces; the dark and night
// blocks override the brightness tokens to lighten instead, since darkening a
// near-black surface is imperceptible.
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
	--skn-accent: #2563eb;
	--skn-accent-text: #ffffff;
	--skn-hover-brightness: 0.96;
	--skn-active-brightness: 0.9;
	--skn-row-hover-brightness: 0.97;
	--skn-ok: #22c55e;
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
// the card surface, so AA holds on every dark background it appears on. The
// accent stays light (#4c93ff) for visibility, so its text flips dark:
// #10131c on #4c93ff is 6.12:1 (white on it was 3.03:1, an AA fail).
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
	--skn-accent-text: #10131c;
	--skn-hover-brightness: 1.15;
	--skn-active-brightness: 1.3;
	--skn-row-hover-brightness: 1.08;
	--skn-ok: #2dd4a0;
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
	--skn-hover-brightness: 1.15;
	--skn-active-brightness: 1.3;
	--skn-row-hover-brightness: 1.08;
	--skn-ok: #cf8a4a;
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
${SCALE_TOKENS}${LIGHT_TOKENS}
	background: var(--skn-bg);
	color: var(--skn-text);
}
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
   interactive elements get a shared brightness response here, with a short
   transition so the shift reads as a response rather than a flicker. The
   direction is themed: light darkens, dark and night brighten (darkening a
   near-black surface moves channels by 2-3/255, imperceptible). Disabled
   buttons opt out. Only buttons transition filter: inputs and selects never
   receive one. */
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
	filter: brightness(var(--skn-hover-brightness));
}
.skn-panel button:active:not(:disabled) {
	filter: brightness(var(--skn-active-brightness));
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
.skn-row:hover { filter: brightness(var(--skn-row-hover-brightness)); }
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

export const S: Record<string, CSSProperties> = {};

// Marine touch targets: toolbar/inline controls at 36px, row Combine/Remove
// buttons one step larger for finger clearance in table rows. Named so the
// sizing lives in one place instead of repeated minHeight literals. TOUCH_ROW
// is exported for row containers that must match the row-button height.
const TOUCH = 36;
export const TOUCH_ROW = 40;

// The hairline border every bordered element shares. Exported so components
// do not respell the literal.
export const BORDER_HAIRLINE = '1px solid var(--skn-border)';

// Button padding literals, shared across the button variants below.
const PAD_BTN = '8px 16px';
const PAD_BTN_ROW = '8px 14px';
const PAD_BTN_SM = '6px 12px';

// Shared box model for the bordered input and select fields: every property
// except the width treatment is identical between the two.
const fieldBase: CSSProperties = {
  padding: '6px 10px',
  borderRadius: 'var(--skn-radius)',
  border: BORDER_HAIRLINE,
  background: 'var(--skn-surface)',
  color: 'var(--skn-text)',
  fontSize: 'var(--skn-font-body)',
};

// Shared box model for the error and info banners; each adds its own token
// family, alignment, padding, and margin.
const bannerBase: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 'var(--skn-space-2)',
  borderRadius: 'var(--skn-radius)',
  fontSize: 'var(--skn-font-body)',
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
S.fieldRow = {
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--skn-space-2)',
  marginBottom: 'var(--skn-space-1)',
  flexWrap: 'wrap',
};
// flex-basis 280 with shrink allowed: labels align in a column on wide
// screens but give the space back on tablets instead of forcing a dead gutter.
// Private base: only the narrow/wide variants are consumed, never S.label itself.
const labelBase: CSSProperties = {
  fontSize: 'var(--skn-font-body)',
  color: 'var(--skn-text-muted)',
  flex: '0 1 280px',
};
// Narrower label variants for denser panels (PerPathSettings and row editors).
// Spread labelBase and override flex-basis only; all other properties are shared.
S.labelNarrow = { ...labelBase, flex: '0 1 180px' };
S.labelWide = { ...labelBase, flex: '0 1 220px' };
S.select = { ...fieldBase, minWidth: 220 };
S.input = { ...fieldBase, width: 220 };
// 22px hit area for marine use: a 16px checkbox is too small for wet fingers
// on a moving boat. accentColor keeps the checked fill on the token palette.
S.checkbox = {
  width: 22,
  height: 22,
  flexShrink: 0,
  cursor: 'pointer',
  accentColor: 'var(--skn-accent)',
};
S.btnPrimary = {
  padding: PAD_BTN,
  minHeight: TOUCH,
  background: 'var(--skn-accent)',
  color: 'var(--skn-accent-text)',
  border: 'none',
  borderRadius: 'var(--skn-radius)',
  fontWeight: 600,
  cursor: 'pointer',
};
S.btnSecondary = {
  padding: PAD_BTN,
  minHeight: TOUCH,
  background: 'var(--skn-surface-raised)',
  color: 'var(--skn-text)',
  border: BORDER_HAIRLINE,
  borderRadius: 'var(--skn-radius)',
  cursor: 'pointer',
};
// Row Combine/Remove buttons: base button plus a larger touch target for
// marine use (wider finger clearance in table rows than toolbar buttons).
S.btnPrimaryRow = {
  ...S.btnPrimary,
  minHeight: TOUCH_ROW,
  padding: PAD_BTN_ROW,
};
S.btnSecondaryRow = {
  ...S.btnSecondary,
  minHeight: TOUCH_ROW,
  padding: PAD_BTN_ROW,
};
// Compact secondary button.
S.btnSecondarySm = {
  ...S.btnSecondary,
  padding: PAD_BTN_SM,
  fontSize: 'var(--skn-font-small)',
};
S.cardTitle = {
  fontSize: 'var(--skn-font-title)',
  fontWeight: 600,
  flex: 1,
  minWidth: 180,
  margin: 0,
  color: 'var(--skn-text)',
};
// Panel header: title row that holds the view title and the theme toggle.
S.panelHeader = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  flexWrap: 'wrap',
  gap: 'var(--skn-space-2)',
  marginBottom: 'var(--skn-space-3)',
};
S.panelTitle = {
  margin: 0,
  fontSize: 'var(--skn-font-display)',
  fontWeight: 700,
  color: 'var(--skn-text)',
};
S.note = {
  background: 'var(--skn-warn-bg)',
  border: '1px solid var(--skn-warn-border)',
  borderRadius: 'var(--skn-radius-sm)',
  color: 'var(--skn-warn-fg)',
  fontSize: 'var(--skn-font-small)',
  lineHeight: 1.45,
  margin: 'var(--skn-space-1) 0',
  padding: '6px var(--skn-space-1)',
};
S.errorBanner = {
  ...bannerBase,
  alignItems: 'center',
  padding: 'var(--skn-space-1) var(--skn-space-2)',
  margin: 'var(--skn-space-1) 0',
  color: 'var(--skn-danger-fg)',
  background: 'var(--skn-danger-bg)',
  border: '1px solid var(--skn-danger-border)',
};
// Info banner: same box model as the error banner on the info token family.
// Used by the source-priority reminder.
S.infoBanner = {
  ...bannerBase,
  alignItems: 'flex-start',
  padding: 'var(--skn-space-2) var(--skn-space-3)',
  marginBottom: 'var(--skn-space-2)',
  background: 'var(--skn-info-bg)',
  border: '1px solid var(--skn-info-border)',
  color: 'var(--skn-info-fg)',
};
S.btnInfoDismiss = {
  flexShrink: 0,
  padding: PAD_BTN_SM,
  minHeight: TOUCH,
  background: 'transparent',
  color: 'var(--skn-info-fg)',
  border: '1px solid var(--skn-info-border)',
  borderRadius: 'var(--skn-radius)',
  cursor: 'pointer',
  fontSize: 'var(--skn-font-small)',
};
// Inset sub-row beneath a detected-path header: the advisory line and the
// duplicate-sources hint share this container and small-text shape. The left
// padding adds the rail width so text aligns with the header content beside
// the opted-in rail.
S.insetSubRow = {
  paddingLeft: 'calc(var(--skn-space-2) + var(--skn-rail-width))',
  paddingRight: 'var(--skn-space-2)',
  paddingBottom: 'var(--skn-space-1)',
};
S.insetSubRowText = {
  display: 'block',
  fontSize: 'var(--skn-font-small)',
  color: 'var(--skn-text-faint)',
  marginTop: 2,
};
// Same shape, one step less faint: used for the duplicate-sources hint, which
// is advisory rather than a hard reason.
S.insetSubRowTextMuted = {
  display: 'block',
  fontSize: 'var(--skn-font-small)',
  color: 'var(--skn-text-muted)',
  marginTop: 2,
};
// Source-checklist row: a tighter field row for the include/exclude list.
S.checklistRow = {
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--skn-space-1)',
  marginBottom: 'var(--skn-space-1)',
};
S.btnRetry = {
  padding: PAD_BTN_SM,
  minHeight: TOUCH,
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
  padding: PAD_BTN_SM,
  minHeight: TOUCH,
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
  gap: 'var(--skn-space-1)',
  width: '100%',
  minHeight: TOUCH,
  background: 'none',
  border: 'none',
  padding: 0,
  fontSize: 'var(--skn-font-body)',
  fontWeight: 600,
  color: 'var(--skn-text)',
  cursor: 'pointer',
  textAlign: 'left',
};
S.disclosureBody = { marginTop: 'var(--skn-space-1)' };

// Shared pill shape for kind badges, source-count badges, added pills, and
// source chips. Variant colors are applied per call; this entry is the box
// model only (layout, size, radius, border placeholder).
S.pill = {
  display: 'inline-flex',
  alignItems: 'center',
  fontSize: 'var(--skn-font-small)',
  padding: '1px 8px',
  borderRadius: 'var(--skn-radius-pill)',
  border: '1px solid transparent',
};
// Pill color variants over the shared box model. One source of truth for each
// token family so the badges, chips, and pills across the panel cannot drift.
S.pillWarn = {
  ...S.pill,
  background: 'var(--skn-warn-bg)',
  color: 'var(--skn-warn-fg)',
  borderColor: 'var(--skn-warn-border)',
};
S.pillMuted = {
  ...S.pill,
  background: 'var(--skn-surface-muted)',
  color: 'var(--skn-text-muted)',
  borderColor: 'var(--skn-border)',
};
S.pillInfo = {
  ...S.pill,
  background: 'var(--skn-info-bg)',
  color: 'var(--skn-info-fg)',
  borderColor: 'var(--skn-info-border)',
};
S.pillSuccess = {
  ...S.pill,
  background: 'var(--skn-success-bg)',
  color: 'var(--skn-success-fg)',
  borderColor: 'var(--skn-success-border)',
};
S.pillRaised = {
  ...S.pill,
  background: 'var(--skn-surface-raised)',
  color: 'var(--skn-text-muted)',
  borderColor: 'var(--skn-border)',
};
