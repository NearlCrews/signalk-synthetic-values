import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('body')).toHaveAttribute('data-fixture-ready', 'true');
  await expect(page.getByRole('heading', { name: 'Synthetic Values' })).toBeVisible();
  await expect(page.getByText('navigation.headingTrue', { exact: true })).toBeVisible();
});

test('loads the production remote and completes combine, tune, and remove flows', async ({
  page,
}) => {
  await expect(page.locator('[data-snui-root]')).toHaveAttribute('data-snui-version', '0.2.0');

  const headingRow = page.locator('[data-detected-path-row]', {
    hasText: 'navigation.headingTrue',
  });
  await headingRow
    .getByRole('button', { name: 'Combine navigation.headingTrue', exact: true })
    .click();
  await expect(page.locator('body')).toHaveAttribute('data-save-count', '1');
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

test('enables an unconfigured plugin and retries a failed save', async ({ page }) => {
  await page.goto('/?unconfigured&save-failure');
  await expect(page.locator('body')).toHaveAttribute('data-fixture-ready', 'true');

  await page.getByRole('button', { name: 'Enable plugin' }).click();
  await expect(page.getByText('Configuration save failed')).toBeVisible();
  await expect(page.locator('body')).toHaveAttribute('data-save-attempt-count', '1');

  await page.getByRole('button', { name: 'Retry' }).click();
  await expect(page.locator('body')).toHaveAttribute('data-save-attempt-count', '2');
  await expect(page.locator('body')).toHaveAttribute('data-save-count', '1');
  await expect(page.getByText('Configuration save failed')).toBeHidden();
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

test('migrates the legacy preference and supports every theme', async ({ page }) => {
  await page.evaluate(() => {
    localStorage.removeItem('signalk-nearlcrews-ui.theme.v1');
    localStorage.setItem('skn-theme', 'night');
  });
  await page.reload();
  await expect(page.locator('body')).toHaveAttribute('data-fixture-ready', 'true');
  await expect(page.locator('[data-snui-root]')).toHaveAttribute('data-snui-theme', 'night');
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('signalk-nearlcrews-ui.theme.v1')))
    .toBe('night');

  const themeGroup = page.getByRole('radiogroup', { name: 'Panel theme' });
  for (const [label, value] of [
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
  test.skip(browserName !== 'chromium' || isMobile, 'One Chromium pass covers computed colors.');

  const themeGroup = page.getByRole('radiogroup', { name: 'Panel theme' });
  const root = page.locator('[data-snui-root]');
  await page.addStyleTag({ content: '* { transition: none !important; }' });

  for (const [label, value] of [
    ['Auto', null],
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
    const results = await new AxeBuilder({ page }).analyze();
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
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.locator('main').evaluate((element) => {
    element.style.width = '320px';
    element.style.padding = '0';
  });

  const root = page.locator('[data-snui-root]');
  await expect(root).toHaveCSS('width', '320px');
  const overflow = await root.evaluate((element) => element.scrollWidth - element.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
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
  await expect(page.locator('[data-snui-root]')).toHaveCount(0);
});
