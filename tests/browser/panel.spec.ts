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

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('body')).toHaveAttribute('data-fixture-ready', 'true');
  await expect(page.getByRole('heading', { name: 'Synthetic Values' })).toBeVisible();
  await expect(page.getByText('navigation.headingTrue', { exact: true })).toBeVisible();
});

test('uses the fresh Auto default without persisting an implicit preference', async ({ page }) => {
  const root = page.locator('[data-snui-root]');
  await expect(root).not.toHaveAttribute('data-snui-theme');
  await expect(root).toHaveCSS('background-color', 'rgb(244, 246, 248)');
  await expect(page.getByRole('radio', { name: 'Auto' })).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByText(/^last checked /)).toHaveText(/^last checked (?:now|\d+ sec\. ago)$/);
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('signalk-nearlcrews-ui.theme.v1')))
    .toBeNull();
});

test('keeps Auto light without a host marker and lets System follow the OS', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  const root = page.locator('[data-snui-root]');
  const themeGroup = page.getByRole('radiogroup', { name: 'Panel theme' });

  await themeGroup.getByRole('radio', { name: 'Auto' }).click();
  await expect(root).not.toHaveAttribute('data-snui-theme');
  await expect(root).toHaveCSS('background-color', 'rgb(244, 246, 248)');
  await expect(root).toHaveCSS('color', 'rgb(24, 32, 44)');

  await themeGroup.getByRole('radio', { name: 'System' }).click();
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
  await expect(
    headingRow.getByRole('spinbutton', { name: 'Staleness timeout (ms)' })
  ).toHaveAttribute('placeholder', 'default: 1000');
  await expect(
    headingRow.getByRole('spinbutton', { name: 'Emit min interval (ms)' })
  ).toHaveAttribute('placeholder', 'default: 1000');

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

test('keeps the plugin row overrides ahead of the scoped package styles', async ({ page }) => {
  const row = page.locator('[data-detected-path-row][data-combined="true"]');
  const accent = await row.evaluate((element) => {
    const probe = element.ownerDocument.createElement('span');
    probe.style.color = 'var(--snui-color-success)';
    element.append(probe);
    const token = getComputedStyle(probe).color;
    probe.remove();
    return { border: getComputedStyle(element).borderLeftColor, token };
  });
  expect(accent.border).toBe(accent.token);
  await expect(row).toHaveCSS('border-left-width', '3px');

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

  await page.getByRole('button', { name: 'Enable plugin' }).click();
  await expect(page.getByText('Configuration request failed')).toBeVisible();
  await expect(page.locator('body')).toHaveAttribute('data-save-attempt-count', '1');

  await page.getByRole('button', { name: 'Retry' }).click();
  await expect(page.locator('body')).toHaveAttribute('data-save-attempt-count', '2');
  await expect(page.locator('body')).toHaveAttribute('data-save-count', '1');
  await expect(page.getByText('Configuration request failed')).toBeHidden();
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
  await page.getByRole('button', { name: 'Confirm' }).click();
  await expect(page.getByText('Detected multi-source paths').locator('..')).toBeFocused();
});

test('announces an unchanged manual refresh', async ({ page }) => {
  await page.getByRole('button', { name: 'Refresh detected paths' }).click();
  await expect(page.getByRole('status')).toHaveText('Detected paths refreshed.');
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
    ['System', 'system'],
    ['Light', 'light'],
    ['Dark', 'dark'],
    ['Night', 'night'],
  ] as const) {
    await themeGroup.getByRole('radio', { name: label }).click();
    await expect(page.locator('[data-snui-root]')).toHaveAttribute('data-snui-theme', value);
  }
  await themeGroup.getByRole('radio', { name: 'Auto' }).click();
  await expect(page.locator('[data-snui-root]')).not.toHaveAttribute('data-snui-theme');
});

test('has no Axe findings in any theme', async ({ page, browserName, isMobile }) => {
  test.setTimeout(180_000);
  test.skip(browserName !== 'chromium' || isMobile, 'One Chromium pass covers computed colors.');

  const themeGroup = page.getByRole('radiogroup', { name: 'Panel theme' });
  const root = page.locator('[data-snui-root]');
  await page.addStyleTag({ content: '* { transition: none !important; }' });

  for (const [label, value] of [
    ['Auto', null],
    ['System', 'system'],
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
  await page.getByRole('button', { name: 'Dismiss priority reminder' }).click();
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
    page.getByRole('radio', { name: 'Auto' }),
    page.getByRole('button', { name: 'Refresh detected paths' }),
    page.getByRole('button', { name: /Combine all/ }),
  ]) {
    const box = await control.boundingBox();
    expect(box?.height).toBeGreaterThanOrEqual(44);
  }
});

test('shows a compatibility message when native CSS scope is unavailable', async ({ page }) => {
  await page.goto('/?unsupported-css-scope');
  await expect(page.locator('body')).toHaveAttribute('data-fixture-ready', 'true');
  await expect(page.locator('[data-browser-compatibility-message]')).toContainText(
    'Browser update required'
  );
  await expect(page.locator('[data-browser-compatibility-message]')).toContainText(
    'newer browser or embedded WebView'
  );
  await expect(page.locator('[data-snui-root]')).toHaveCount(0);
  await expect(page.locator('style[data-snui-styles]')).toHaveCount(0);
});
