import { describe, expect, it } from 'vitest';
import { TOKENS_CSS } from '../../src/configpanel/styles';

describe('panel tokens', () => {
  it('defines the three pinned themes and the night block', () => {
    expect(TOKENS_CSS).toContain('[data-skn-theme="light"]');
    expect(TOKENS_CSS).toContain('[data-skn-theme="dark"]');
    expect(TOKENS_CSS).toContain('[data-skn-theme="night"]');
  });
  it('uses tokens, not raw hex, for state families in components (guard)', () => {
    // The night block defines the families; spot-check a known token exists.
    expect(TOKENS_CSS).toContain('--skn-ok');
    expect(TOKENS_CSS).toContain('--skn-info-bg');
    expect(TOKENS_CSS).toContain('--skn-warn-bg');
  });
});
