import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { TOKENS_CSS } from '../../src/configpanel/styles';

const panelDir = fileURLToPath(new URL('../../src/configpanel', import.meta.url));

// Every panel source file except styles.ts (the palette itself).
function panelSources(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...panelSources(full));
    else if (/\.(ts|tsx)$/.test(entry.name) && entry.name !== 'styles.ts') out.push(full);
  }
  return out;
}

describe('panel tokens', () => {
  it('defines the three pinned themes and the night block', () => {
    expect(TOKENS_CSS).toContain('[data-skn-theme="light"]');
    expect(TOKENS_CSS).toContain('[data-skn-theme="dark"]');
    expect(TOKENS_CSS).toContain('[data-skn-theme="night"]');
  });
  it('defines the state families used by components', () => {
    expect(TOKENS_CSS).toContain('--skn-ok');
    expect(TOKENS_CSS).toContain('--skn-info-bg');
    expect(TOKENS_CSS).toContain('--skn-warn-bg');
  });
  it('components use tokens, never raw hex colors (styles.ts is the only palette)', () => {
    const files = panelSources(panelDir);
    expect(files.length).toBeGreaterThan(5);
    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      expect(source, `${file} contains a raw hex color`).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    }
  });
  it('every theme block overrides the interaction brightness tokens', () => {
    const matches = TOKENS_CSS.match(/--skn-hover-brightness:/g) ?? [];
    // Light, dark, and night token sets (light and dark each appear twice:
    // host-driven and pinned blocks share the token string).
    expect(matches.length).toBeGreaterThanOrEqual(3);
  });
});
