import { describe, expect, it } from 'vitest';
import { resolveBrowserFixturePort } from '../fixtures/browser/server-port.js';

describe('resolveBrowserFixturePort', () => {
  it('uses the project default when no override is provided', () => {
    expect(resolveBrowserFixturePort(undefined)).toBe(4175);
  });

  it.each([
    ['1024', 1024],
    ['49175', 49_175],
    ['65535', 65_535],
  ])('accepts the valid port %s', (rawPort, expected) => {
    expect(resolveBrowserFixturePort(rawPort)).toBe(expected);
  });

  it.each(['', '1023', '65536', '4175.5', 'not-a-port'])(
    'rejects the invalid port %s',
    (rawPort) => {
      expect(() => resolveBrowserFixturePort(rawPort)).toThrow(
        'SYNTHETIC_VALUES_BROWSER_PORT must be an integer from 1024 through 65535'
      );
    }
  );
});
