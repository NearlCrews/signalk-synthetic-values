import { resolve } from 'node:path';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';

const server = await createServer({
  configFile: resolve('fixtures/browser/vite.config.ts'),
  logLevel: 'warn',
});
await server.listen();

let browser;
try {
  browser = await chromium.launch();
  const page = await browser.newPage({
    colorScheme: 'light',
    deviceScaleFactor: 1,
    viewport: { width: 1000, height: 1200 },
  });
  await page.goto('http://127.0.0.1:4175/');
  await page.locator('body[data-fixture-ready="true"]').waitFor();
  await page.getByText('navigation.headingTrue', { exact: true }).waitFor();

  const panel = page.locator('[data-snui-root]');
  await panel.screenshot({
    animations: 'disabled',
    path: 'assets/screenshots/01-config-panel.png',
  });

  await page.getByText(/Detected but not recommended/).click();
  await panel.screenshot({
    animations: 'disabled',
    path: 'assets/screenshots/02-not-recommended.png',
  });

  await page.getByText(/Detected but not recommended/).click();
  const combinedRow = page.locator('[data-detected-path-row]', {
    hasText: 'navigation.speedOverGround',
  });
  await combinedRow
    .getByRole('button', { name: 'Tune settings for navigation.speedOverGround' })
    .click();
  await combinedRow
    .getByRole('button', { name: 'Advanced settings for navigation.speedOverGround' })
    .click();
  await panel.screenshot({
    animations: 'disabled',
    path: 'assets/screenshots/03-tune.png',
  });
} finally {
  await browser?.close();
  await server.close();
}
