import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const panelDirectory = fileURLToPath(new URL('../../src/configpanel', import.meta.url));

function panelSources(directory: string): string[] {
  const output: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const fullPath = join(directory, entry.name);
    if (entry.isDirectory()) output.push(...panelSources(fullPath));
    else if (/\.(css|ts|tsx)$/.test(entry.name)) output.push(fullPath);
  }
  return output;
}

const panelFiles = panelSources(panelDirectory);
const fileContents = new Map<string, string>();

/** Reads a panel file once and serves every later case from the cache. */
function panelSource(file: string): string {
  const cached = fileContents.get(file);
  if (cached !== undefined) return cached;
  const source = readFileSync(file, 'utf8');
  fileContents.set(file, source);
  return source;
}

describe('panel styling boundary', () => {
  it('uses modular plugin styles instead of the retired local theme registry', () => {
    expect(existsSync(join(panelDirectory, 'styles.ts'))).toBe(false);
    const cssModules = panelFiles.filter((file) => file.endsWith('.module.css'));
    expect(cssModules.length).toBeGreaterThanOrEqual(2);
  });

  it('uses only public shared UI tokens in plugin CSS', () => {
    for (const file of panelFiles.filter((path) => path.endsWith('.css'))) {
      const source = panelSource(file);
      expect(source, `${file} uses a retired local token`).not.toContain('--skn-');
      expect(source, `${file} targets a private shared UI class`).not.toMatch(/\.snui-/);
    }
  });

  it('keeps raw palette colors out of panel source and CSS', () => {
    for (const file of panelFiles) {
      const source = panelSource(file);
      expect(source, `${file} contains a raw hex color`).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    }
  });

  it('imports the shared UI package from the panel composition root', () => {
    const source = panelSource(join(panelDirectory, 'PluginConfigurationPanel.tsx'));
    expect(source).toContain("from 'signalk-nearlcrews-ui'");
    expect(source).toContain('<PanelShell');
    expect(source).not.toContain('legacyThemeStorageKeys');
  });
});
