import AxeBuilder from '@axe-core/playwright';
import type { Locator, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import packageJson from '../../package.json' with { type: 'json' };

const EXPECTED_UI_VERSION = packageJson.devDependencies['signalk-nearlcrews-ui'];

type BoundingBox = NonNullable<Awaited<ReturnType<Locator['boundingBox']>>>;

/**
 * Hides the fixture's Admin chrome so the configuration column, and with it
 * the panel container query, gets the full width of the viewport.
 */
async function hideHostChrome(page: Page): Promise<void> {
  await page.locator('.sidebar, .plugin-list').evaluateAll((elements) => {
    for (const element of elements) element.style.display = 'none';
  });
}

/** The save bar's status line, told apart from the detected-paths announcer by its wording. */
function saveStatus(page: Page): Locator {
  return page.getByRole('status').filter({
    hasText: /all changes saved|unsaved changes|save sent to the server|save to enable the plugin/i,
  });
}

/**
 * The banners that announce. The panel shell mounts one polite and one
 * assertive region for the whole panel, both empty until something is
 * announced, so a bare role query never means the banner on its own.
 */
function alerts(page: Page): Locator {
  return page.getByRole('alert').filter({ hasText: /\S/ });
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('body')).toHaveAttribute('data-fixture-ready', 'true');
  await expect(page.getByRole('heading', { name: 'Synthetic Values' })).toBeVisible();
  await expect(page.getByText('navigation.headingTrue', { exact: true })).toBeVisible();
});

test('uses the fresh Match Admin default without persisting an implicit preference', async ({
  page,
}) => {
  const root = page.locator('[data-snui-root]');
  await expect(root).not.toHaveAttribute('data-snui-theme');
  await expect(root).toHaveCSS('background-color', 'rgb(244, 246, 248)');
  await expect(page.getByRole('radio', { name: 'Match Admin' })).toHaveAttribute(
    'aria-checked',
    'true'
  );
  await expect(page.getByText(/^last checked /)).toHaveText(
    /^last checked (?:now|\d+ seconds? ago)$/
  );
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('signalk-nearlcrews-ui.theme.v1')))
    .toBeNull();
});

test('keeps Match Admin light without a host marker and lets Match device follow the OS', async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  const root = page.locator('[data-snui-root]');
  const themeGroup = page.getByRole('radiogroup', { name: 'Panel theme' });

  await themeGroup.getByRole('radio', { name: 'Match Admin' }).click();
  await expect(root).not.toHaveAttribute('data-snui-theme');
  await expect(root).toHaveCSS('background-color', 'rgb(244, 246, 248)');
  await expect(root).toHaveCSS('color', 'rgb(24, 32, 44)');

  await themeGroup.getByRole('radio', { name: 'Match device' }).click();
  await expect(root).toHaveAttribute('data-snui-theme', 'system');
  await expect(root).toHaveCSS('background-color', 'rgb(16, 19, 28)');
  await expect(root).toHaveCSS('color', 'rgb(245, 247, 250)');

  await page.emulateMedia({ colorScheme: 'light' });
  await expect(root).toHaveCSS('background-color', 'rgb(244, 246, 248)');
  await expect(root).toHaveCSS('color', 'rgb(24, 32, 44)');
});

test('loads the production remote and completes combine, tune, and remove flows', async ({
  page,
}) => {
  await expect(page.locator('[data-snui-root]')).toHaveAttribute(
    'data-snui-version',
    EXPECTED_UI_VERSION
  );

  const headingRow = page.locator('[data-detected-path-row]', {
    hasText: 'navigation.headingTrue',
  });
  await headingRow
    .getByRole('button', { name: 'Combine navigation.headingTrue', exact: true })
    .click();
  await expect(page.locator('body')).toHaveAttribute('data-save-count', '1');
  await expect(page.locator('body')).toHaveAttribute(
    'data-saved-configuration',
    /"futureFixtureSetting":\{"enabled":true\}/
  );
  await expect(
    headingRow.getByRole('button', {
      name: 'Remove navigation.headingTrue',
      exact: true,
    })
  ).toBeVisible();

  await headingRow
    .getByRole('button', {
      name: 'Tune settings for navigation.headingTrue',
      exact: true,
    })
    .click();
  const minimumSources = headingRow.getByRole('spinbutton', { name: 'Minimum sources' });
  await minimumSources.fill('3');
  await expect(page.locator('body')).toHaveAttribute('data-save-count', '2');

  await headingRow
    .getByRole('button', {
      name: 'Advanced settings for navigation.headingTrue',
      exact: true,
    })
    .click();
  await expect(headingRow.getByRole('spinbutton', { name: 'Staleness timeout' })).toHaveAttribute(
    'placeholder',
    'default: 1000'
  );
  await expect(headingRow.getByRole('spinbutton', { name: 'Emit min interval' })).toHaveAttribute(
    'placeholder',
    'default: 1000'
  );

  await headingRow.getByRole('checkbox', { name: 'compass.rebroadcast' }).uncheck();
  await expect(page.locator('body')).toHaveAttribute('data-save-count', '3');

  await headingRow
    .getByRole('button', { name: 'Remove navigation.headingTrue', exact: true })
    .click();
  await expect(page.locator('body')).toHaveAttribute('data-save-count', '4');
  await expect(
    headingRow.getByRole('button', {
      name: 'Combine navigation.headingTrue',
      exact: true,
    })
  ).toBeVisible();
});

test('keeps a tuned value across a collapse and reopen of its section', async ({ page }) => {
  // Tune is a lazy-retain CollapsibleSection, so collapsing it runs every
  // effect cleanup in the subtree and reopening re-runs them while the field
  // state survives. The shared number field keeps its draft beside the value
  // it was typed against, so this asserts the edit survives the round trip.
  const row = page.locator('[data-detected-path-row][data-combined="true"]');
  const tune = row.getByRole('button', {
    name: 'Tune settings for navigation.speedOverGround',
    exact: true,
  });

  await tune.click();
  const minimumSources = row.getByRole('spinbutton', { name: 'Minimum sources' });
  await minimumSources.fill('3');
  await expect(minimumSources).toHaveValue('3');

  await tune.click();
  await expect(minimumSources).toBeHidden();
  await tune.click();

  await expect(minimumSources).toBeVisible();
  await expect(minimumSources).toHaveValue('3');
});

test('insets the nested Advanced section inside the embedded Tune section', async ({ page }) => {
  // Tune is an embedded CollapsibleSection: it drops its own inline padding so
  // the row wrapper supplies the inset the flush card no longer pads. Advanced
  // nests inside it at the default variant, so it keeps its own inset. The
  // package scopes the embedded rules to direct children for exactly this case.
  const row = page.locator('[data-detected-path-row][data-combined="true"]');
  await row
    .getByRole('button', { name: 'Tune settings for navigation.speedOverGround', exact: true })
    .click();
  const tune = row.getByRole('region', {
    name: 'Tune settings for navigation.speedOverGround',
  });
  await tune
    .getByRole('button', { name: 'Advanced settings for navigation.speedOverGround', exact: true })
    .click();
  const advanced = tune.getByRole('region', {
    name: 'Advanced settings for navigation.speedOverGround',
  });
  await expect(advanced.getByRole('spinbutton', { name: /^Outlier threshold/ })).toBeVisible();

  const insets = await Promise.all(
    [tune, advanced].map((section) =>
      section.evaluate((element) => {
        const header = element.querySelector(':scope > header') as HTMLElement;
        const toggle = header.querySelector('button') as HTMLButtonElement;
        const contentId = toggle.getAttribute('aria-controls') as string;
        const content = element.ownerDocument.getElementById(contentId) as HTMLElement;
        return {
          content: Number.parseFloat(getComputedStyle(content).paddingInlineStart),
          header: Number.parseFloat(getComputedStyle(header).paddingInlineStart),
        };
      })
    )
  );
  const [embedded, nested] = insets;
  expect(embedded?.header).toBe(0);
  expect(embedded?.content).toBe(0);
  expect(nested?.header).toBeGreaterThan(0);
  expect(nested?.content).toBeGreaterThan(0);
});

interface CombinedRowLayout {
  actionBox: BoundingBox;
  headerInline: number;
  pathBox: BoundingBox;
  panelWidth: number;
  rowBox: BoundingBox;
}

/** Card, path, and action geometry for the row the fixture starts combined. */
async function combinedRowLayout(page: Page): Promise<CombinedRowLayout> {
  const row = page.locator('[data-detected-path-row][data-combined="true"]');
  const path = row.getByText('navigation.speedOverGround', { exact: true });
  const [panelWidth, headerInline, rowBox, pathBox, actionBox] = await Promise.all([
    page.locator('[data-snui-root]').evaluate((element) => element.clientWidth),
    // The header row owns the inset the action and the badges sit behind.
    path.evaluate((element) =>
      Number.parseFloat(getComputedStyle(element.parentElement as Element).paddingInlineStart)
    ),
    row.boundingBox(),
    path.boundingBox(),
    row
      .getByRole('button', { name: 'Remove navigation.speedOverGround', exact: true })
      .boundingBox(),
  ]);
  if (rowBox === null || pathBox === null || actionBox === null) {
    throw new Error('The combined row is not visible.');
  }
  return { actionBox, headerInline, panelWidth, pathBox, rowBox };
}

/** Distance between the trailing edge of the action and the trailing card border. */
function trailingGap(rowBox: BoundingBox, actionBox: BoundingBox): number {
  return rowBox.x + rowBox.width - (actionBox.x + actionBox.width);
}

test('marks a combined row with the shared card accent bar', async ({ page }) => {
  // The accent comes from the card's own `accent` prop, so this pins the tone
  // color and the fact that the leading edge is heavier than the plain card
  // border, without restating the width the package owns.
  const row = page.locator('[data-detected-path-row][data-combined="true"]');
  const accent = await row.evaluate((element) => {
    const probe = element.ownerDocument.createElement('span');
    probe.style.color = 'var(--snui-color-success)';
    element.append(probe);
    const token = getComputedStyle(probe).color;
    probe.remove();
    const style = getComputedStyle(element);
    return {
      color: style.borderLeftColor,
      leading: Number.parseFloat(style.borderLeftWidth),
      plain: Number.parseFloat(style.borderTopWidth),
      token,
    };
  });
  expect(accent.color).toBe(accent.token);
  expect(accent.leading).toBeGreaterThan(accent.plain);

  // An available row carries no accent, so every edge is the plain card border.
  const available = await page
    .locator('[data-detected-path-row]:not([data-combined])')
    .first()
    .evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        leading: Number.parseFloat(style.borderLeftWidth),
        plain: Number.parseFloat(style.borderTopWidth),
      };
    });
  expect(available.leading).toBe(available.plain);
});

test('keeps the plugin row overrides ahead of the scoped package styles', async ({ page }) => {
  // The card ships a grid gap between its slots; the row draws its own dividers
  // instead, so a zero gap here proves the doubled class still outranks the
  // package rule inside its native CSS scope.
  const row = page.locator('[data-detected-path-row][data-combined="true"]');
  await expect(row).toHaveCSS('row-gap', '0px');

  const { actionBox, headerInline, rowBox } = await combinedRowLayout(page);
  expect(headerInline).toBeGreaterThan(0);
  expect(actionBox.x - rowBox.x).toBeGreaterThanOrEqual(headerInline);
  expect(trailingGap(rowBox, actionBox)).toBeGreaterThanOrEqual(headerInline);
});

test('stacks the row action under the path in a narrow panel', async ({ page }) => {
  const { actionBox, pathBox, panelWidth, rowBox } = await combinedRowLayout(page);
  expect(panelWidth).toBeLessThan(600);
  expect(actionBox.y).toBeGreaterThan(pathBox.y);
  expect(actionBox.width).toBeCloseTo(pathBox.width, 0);
  expect(trailingGap(rowBox, actionBox)).toBeGreaterThan(0);
});

test('trails the row action behind the path at wide panel widths', async ({ page }) => {
  await hideHostChrome(page);
  await page.setViewportSize({ width: 1280, height: 900 });

  const wide = await combinedRowLayout(page);
  expect(wide.panelWidth).toBeGreaterThan(600);
  expect(wide.actionBox.x).toBeGreaterThan(wide.pathBox.x + wide.pathBox.width);
  expect(wide.actionBox.y).toBeLessThan(wide.pathBox.y + wide.pathBox.height);
  expect(trailingGap(wide.rowBox, wide.actionBox)).toBeLessThanOrEqual(wide.headerInline + 4);

  // Pinned just above the narrow breakpoint, the path basis and the badges
  // cannot share a line with the action in any engine, so the wrap is certain.
  await page.locator('.config-column').evaluate((element) => {
    element.style.flex = '0 0 660px';
  });
  const wrapped = await combinedRowLayout(page);
  expect(wrapped.panelWidth).toBeGreaterThan(600);
  expect(wrapped.panelWidth).toBeLessThan(700);
  expect(wrapped.actionBox.y).toBeGreaterThan(wrapped.pathBox.y);
  expect(trailingGap(wrapped.rowBox, wrapped.actionBox)).toBeLessThanOrEqual(
    wrapped.headerInline + 4
  );
});

test('enables an unconfigured plugin and retries a failed request', async ({ page }) => {
  await page.goto('/?unconfigured&save-failure');
  await expect(page.locator('body')).toHaveAttribute('data-fixture-ready', 'true');
  const save = page.getByRole('button', { name: 'Save', exact: true });
  await expect(saveStatus(page)).toHaveText(/Save to enable the plugin/);

  await save.click();
  await expect(alerts(page)).toContainText('Configuration request failed');
  await expect(page.locator('body')).toHaveAttribute('data-save-attempt-count', '1');
  await expect(save).toBeEnabled();

  await save.click();
  await expect(page.locator('body')).toHaveAttribute('data-save-attempt-count', '2');
  await expect(page.locator('body')).toHaveAttribute('data-save-count', '1');
  await expect(alerts(page)).toHaveCount(0);
  await expect(saveStatus(page)).toHaveText(/Save sent to the server/);
  await expect(save).toBeDisabled();
});

test('reports queued edits in the save bar and sends them on Save', async ({ page }) => {
  const status = saveStatus(page);
  await expect(status).toHaveText(/All changes saved/);
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();

  const headingRow = page.locator('[data-detected-path-row]', {
    hasText: 'navigation.headingTrue',
  });
  await headingRow
    .getByRole('button', { name: 'Combine navigation.headingTrue', exact: true })
    .click();
  await expect(page.locator('body')).toHaveAttribute('data-save-count', '1');
  await expect(status).toHaveText(/Save sent to the server/);
  await expect(page.getByRole('button', { name: 'Discard', exact: true })).toBeDisabled();
});

test('keeps the Combine all trigger mounted and restores focus after cancel', async ({ page }) => {
  const request = page.getByRole('button', { name: /Combine all/ });
  await request.focus();
  await request.click();
  await expect(request).toHaveAttribute('aria-disabled', 'true');
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(request).toBeFocused();
  await expect(request).not.toHaveAttribute('aria-disabled');
});

test('moves focus to the detected-paths heading after Combine all completes', async ({ page }) => {
  await page.getByRole('button', { name: /Combine all/ }).click();
  await page.getByRole('button', { name: /^Combine \d+ paths?$/ }).click();
  await expect(page.getByText('Detected multi-source paths').locator('..')).toBeFocused();
});

test('announces an unchanged manual refresh', async ({ page }) => {
  await page.getByRole('button', { name: 'Refresh detected paths' }).click();
  await expect(
    page.getByRole('region', { name: 'Detected multi-source paths' }).getByRole('status')
  ).toHaveText('Detected paths refreshed.');
});

test('ignores the retired legacy preference and supports every theme', async ({ page }) => {
  test.slow();
  await page.evaluate(() => {
    localStorage.removeItem('signalk-nearlcrews-ui.theme.v1');
    localStorage.setItem('skn-theme', 'night');
  });
  await page.reload();
  await expect(page.locator('body')).toHaveAttribute('data-fixture-ready', 'true');
  await expect(page.locator('[data-snui-root]')).not.toHaveAttribute('data-snui-theme');
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('signalk-nearlcrews-ui.theme.v1')))
    .toBeNull();
  await expect.poll(() => page.evaluate(() => localStorage.getItem('skn-theme'))).toBe('night');

  const themeGroup = page.getByRole('radiogroup', { name: 'Panel theme' });
  for (const [label, value] of [
    ['Match device', 'system'],
    ['Light', 'light'],
    ['Dark', 'dark'],
    ['Night', 'night'],
  ] as const) {
    await themeGroup.getByRole('radio', { name: label }).click();
    await expect(page.locator('[data-snui-root]')).toHaveAttribute('data-snui-theme', value);
  }
  await themeGroup.getByRole('radio', { name: 'Match Admin' }).click();
  await expect(page.locator('[data-snui-root]')).not.toHaveAttribute('data-snui-theme');
});

test('has no Axe findings in any theme', async ({ page, browserName, isMobile }) => {
  test.setTimeout(180_000);
  test.skip(browserName !== 'chromium' || isMobile, 'One Chromium pass covers computed colors.');

  const themeGroup = page.getByRole('radiogroup', { name: 'Panel theme' });
  const root = page.locator('[data-snui-root]');
  await page.addStyleTag({ content: '* { transition: none !important; }' });

  for (const [label, value] of [
    ['Match Admin', null],
    ['Match device', 'system'],
    ['Light', 'light'],
    ['Dark', 'dark'],
    ['Night', 'night'],
  ] as const) {
    await themeGroup.getByRole('radio', { name: label }).click();
    if (value === null) {
      await expect(root).not.toHaveAttribute('data-snui-theme');
    } else {
      await expect(root).toHaveAttribute('data-snui-theme', value);
    }
    const results = await new AxeBuilder({ page }).include('[data-snui-root]').analyze();
    expect(results.violations, `${label} theme`).toEqual([]);
  }
});

test('dismisses the priority reminder into the detected-paths heading', async ({ page }) => {
  await expect(page.getByRole('link', { name: 'Data, Priorities' })).toHaveAttribute(
    'href',
    '#/data/priorities'
  );
  await page
    .getByRole('region', { name: 'Set source priority to use combined values' })
    .getByRole('button', { name: 'Dismiss' })
    .click();
  await expect(page.getByText('Detected multi-source paths').locator('..')).toBeFocused();
});

test('has no Axe findings or horizontal overflow at 320 pixels', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 900 });
  await page
    .getByRole('button', {
      name: 'Tune settings for navigation.speedOverGround',
      exact: true,
    })
    .click();
  await page.getByText(/Detected but not recommended/).click();

  const longPath = page.getByText('navigation.gnss.satellites', { exact: true });
  await expect(longPath).toHaveCSS('white-space', 'normal');

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);

  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});

test('responds to a 320-pixel embedded panel inside a wide host', async ({ page }) => {
  await hideHostChrome(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.locator('.config-column').evaluate((element) => {
    element.style.flex = '0 0 320px';
  });

  const root = page.locator('[data-snui-root]');
  const width = await root.evaluate((element) => element.clientWidth);
  expect(width).toBeGreaterThan(250);
  expect(width).toBeLessThanOrEqual(320);
  const overflow = await root.evaluate((element) => element.scrollWidth - element.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test('runs inside the current Admin scroll and card contract', async ({ page }) => {
  const overflow = await page.locator('.app-body').evaluate((element) => {
    const style = getComputedStyle(element);
    return { x: style.overflowX, y: style.overflowY };
  });
  expect(overflow).toEqual({ x: 'hidden', y: 'auto' });
  await expect(page.locator('.config-column.card [data-snui-root]')).toBeVisible();
});

test('provides coarse-pointer controls with 44-pixel targets @coarse', async ({ page }) => {
  for (const control of [
    page.getByRole('radio', { name: 'Match Admin' }),
    page.getByRole('button', { name: 'Refresh detected paths' }),
    page.getByRole('button', { name: /Combine all/ }),
  ]) {
    const box = await control.boundingBox();
    expect(box?.height).toBeGreaterThanOrEqual(44);
  }

  // A source checkbox draws a 20-pixel box, and the pointer target is the label
  // wrapping it, which takes its height from the shared control minimum. Assert
  // the wrapper rather than the box: a local height that cannot carry the
  // coarse-pointer media query is how this shrinks, and it shrinks silently,
  // since neither an axe scan nor a narrow viewport measures target size.
  const row = page.locator('[data-detected-path-row][data-combined="true"]');
  await row.getByRole('button', { name: /^Tune settings for/ }).click();
  const target = row.getByRole('checkbox').first().locator('xpath=ancestor::label[1]');
  const targetBox = await target.boundingBox();
  expect(targetBox?.height).toBeGreaterThanOrEqual(44);

  // The detection error control renders only while detection is failing, so it
  // is invisible to every check that measures the default fixture state.
  await page.goto('/?detected-failure');
  await expect(page.locator('body')).toHaveAttribute('data-fixture-ready', 'true');
  const retryBox = await page.getByRole('button', { name: /^Retry$/ }).boundingBox();
  expect(retryBox?.height).toBeGreaterThanOrEqual(44);
});

test('surfaces a failing detection with a working retry', async ({ page }) => {
  await page.goto('/?detected-failure');
  await expect(page.locator('body')).toHaveAttribute('data-fixture-ready', 'true');
  await expect(page.getByText('Could not load detected paths.')).toBeVisible();

  const retry = page.getByRole('button', { name: /^Retry$/ });
  await expect(retry).toBeVisible();
  const before = Number(await page.locator('body').getAttribute('data-detected-request-count'));
  await retry.click();
  await expect
    .poll(async () =>
      Number(await page.locator('body').getAttribute('data-detected-request-count'))
    )
    .toBeGreaterThan(before);
});

test('shows a compatibility message when native CSS scope is unavailable', async ({ page }) => {
  await page.goto('/?unsupported-css-scope');
  await expect(page.locator('body')).toHaveAttribute('data-fixture-ready', 'true');
  // The notice and its wording belong to the shared UI, so this asserts the
  // marker the package emits and that the notice renders a heading and a
  // message, rather than mirroring copy that moves with the library.
  const notice = page.locator('[data-snui-unsupported]');
  await expect(notice).toBeVisible();
  await expect(notice.getByRole('heading')).toBeVisible();
  await expect(notice).toContainText(/\S/);
  await expect(page.locator('[data-snui-root]')).toHaveCount(0);
  await expect(page.locator('style[data-snui-styles]')).toHaveCount(0);
});

test('tells a stale source apart from a contributing one', async ({ page }) => {
  await hideHostChrome(page);
  const row = page.locator('[data-detected-path-row]').filter({
    hasText: 'navigation.speedOverGround',
  });
  // The fixture lists gps.1 and gps.2 but only gps.1 is fresh to the combiner.
  await expect(row.getByText('gps.2, no data')).toBeVisible();
  await expect(row.getByText('gps.1', { exact: true })).toBeVisible();
  await expect(page.getByText('1 of 2 sources combining')).toBeAttached();
});

test('reveals the overflow sources through a control, not a hover tooltip', async ({ page }) => {
  await hideHostChrome(page);
  const row = page.locator('[data-detected-path-row]').filter({
    hasText: 'navigation.position',
  });
  // Three chips render inline; the fourth waits behind the control.
  const chip = row.getByText('gps.4', { exact: true });
  await expect(chip).toBeHidden();
  const toggle = row.getByRole('button', { name: '1 more source' });
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await toggle.click();
  await expect(chip).toBeVisible();
  // The trigger relabels when it opens, so the open state is read off the new label.
  await expect(row.getByRole('button', { name: 'Show fewer' })).toHaveAttribute(
    'aria-expanded',
    'true'
  );
});

test('keeps the unavailable Combine button focusable so its reason is reachable', async ({
  page,
}) => {
  // vessel.name lives in the collapsed not-recommended group, which mounts lazily.
  await page.getByText(/Detected but not recommended/).click();
  const combine = page.getByRole('button', { name: 'Combine vessel.name' });
  await expect(combine).toHaveAttribute('aria-disabled', 'true');
  await combine.focus();
  await expect(combine).toBeFocused();
});

test('warns when the source checklist is emptied', async ({ page }) => {
  await hideHostChrome(page);
  await page
    .getByRole('button', { name: 'Tune settings for navigation.speedOverGround', exact: true })
    .click();
  const group = page.getByRole('group', { name: 'Sources' });
  await group.getByRole('checkbox', { name: 'All sources' }).click();
  await expect(
    page.getByText('No sources are selected, so this path will not combine.')
  ).toBeVisible();
});
