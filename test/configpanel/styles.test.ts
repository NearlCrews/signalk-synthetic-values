import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const panelDirectory = fileURLToPath(new URL('../../src/configpanel', import.meta.url));

/** Component names the file pulls from the shared UI package, including its subpaths. */
function sharedUiImports(source: string): Set<string> {
  const names = new Set<string>();
  for (const match of source.matchAll(
    /import\s+(?:type\s+)?{([^}]*)}\s+from\s+'signalk-nearlcrews-ui(?:\/[\w-]+)?'/g
  )) {
    for (const specifier of match[1].split(',')) {
      // Keeps the local name from "X as Y" and drops any inline "type" prefix.
      const name = specifier.trim().split(/\s+/).pop();
      if (name) names.add(name);
    }
  }
  return names;
}

/** Default CSS module imports, keyed by the identifier the file reads classes from. */
function cssModuleImports(source: string, file: string): Map<string, string> {
  const modules = new Map<string, string>();
  for (const match of source.matchAll(/import\s+(\w+)\s+from\s+'([^']+\.module\.css)'/g)) {
    modules.set(match[1], join(dirname(file), match[2]));
  }
  return modules;
}

/** The JSX element a className lands on, read from the nearest opening tag. */
function owningTag(source: string, index: number): string | undefined {
  const open = source.lastIndexOf('<', index);
  if (open === -1) return undefined;
  return /^<([A-Za-z][\w.]*)/.exec(source.slice(open, index))?.[1];
}

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

/**
 * Every plugin CSS module class that lands on a shared UI component, keyed by
 * `<css module path>#<class name>` and valued with the component it styles.
 */
function classesOnSharedUiComponents(): Map<string, string> {
  const owned = new Map<string, string>();
  for (const file of panelFiles.filter((path) => path.endsWith('.tsx'))) {
    const source = panelSource(file);
    const components = sharedUiImports(source);
    for (const [identifier, cssPath] of cssModuleImports(source, file)) {
      for (const match of source.matchAll(new RegExp(`\\b${identifier}\\.(\\w+)`, 'g'))) {
        const owner = owningTag(source, match.index);
        if (owner === undefined || !components.has(owner)) continue;
        owned.set(`${cssPath}#${match[1]}`, owner);
      }
    }
  }
  return owned;
}

describe('panel styling boundary', () => {
  it('uses modular plugin styles instead of the retired local theme registry', () => {
    expect(existsSync(join(panelDirectory, 'styles.ts'))).toBe(false);
    const cssModules = panelFiles.filter((file) => file.endsWith('.module.css'));
    expect(cssModules.length).toBeGreaterThanOrEqual(4);
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

  it('doubles every plugin class that overrides a shared UI component', () => {
    // Shared UI ships every rule inside a native CSS scope. The cascade
    // compares scope proximity after specificity and before source order, and
    // an unscoped rule counts as infinitely distant, so a single-class plugin
    // rule loses to the package rule it means to override however the
    // stylesheets are ordered. Repeating the class name wins on specificity,
    // which is settled first. The browser suite asserts the resulting computed
    // styles; this case keeps the convention from silently lapsing.
    for (const [key, owner] of classesOnSharedUiComponents()) {
      const [cssPath, name] = key.split('#');
      // Only a rule whose subject is the bare class needs the doubling, so
      // skip the doubled form and any compound or descendant selector.
      const undoubled = panelSource(cssPath).replaceAll(`.${name}.${name}`, '');
      expect(
        undoubled,
        `${cssPath}: .${name} styles the shared UI ${owner} and must be declared as .${name}.${name}`
      ).not.toMatch(new RegExp(`\\.${name}\\s*(?=[,{])`));
    }
  });

  it('imports the shared UI package from the panel composition root', () => {
    const source = panelSource(join(panelDirectory, 'PluginConfigurationPanel.tsx'));
    expect(source).toContain("from 'signalk-nearlcrews-ui'");
    expect(source).toContain('<PanelRoot>');
    expect(source).not.toContain('legacyThemeStorageKeys');
  });
});
