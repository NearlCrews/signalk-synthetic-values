import { describe, expect, it } from 'vitest';
import {
  isMeaningfulToCombine,
  NON_MEANINGFUL_ADVISORY,
  NON_NUMERIC_ADVISORY,
} from '../src/combinability';

describe('isMeaningfulToCombine', () => {
  it('flags GNSS fix metadata as not meaningful to average', () => {
    expect(isMeaningfulToCombine('navigation.gnss.satellites')).toBe(false);
    expect(isMeaningfulToCombine('navigation.gnss.horizontalDilution')).toBe(false);
    expect(isMeaningfulToCombine('navigation.gnss.positionDilution')).toBe(false);
    expect(isMeaningfulToCombine('navigation.gnss.differentialReference')).toBe(false);
    expect(isMeaningfulToCombine('navigation.gnss.differentialAge')).toBe(false);
    expect(isMeaningfulToCombine('navigation.gnss.methodQuality')).toBe(false);
    expect(isMeaningfulToCombine('navigation.gnss.verticalDilution')).toBe(false);
    expect(isMeaningfulToCombine('navigation.gnss.satellitesInView')).toBe(false);
    expect(isMeaningfulToCombine('navigation.gnss.integrity')).toBe(false);
    expect(isMeaningfulToCombine('navigation.gnss.type')).toBe(false);
  });

  it('treats real measurements as meaningful, including GNSS altitude and geoidal separation', () => {
    expect(isMeaningfulToCombine('navigation.position')).toBe(true);
    expect(isMeaningfulToCombine('navigation.gnss.antennaAltitude')).toBe(true);
    expect(isMeaningfulToCombine('navigation.gnss.geoidalSeparation')).toBe(true);
    expect(isMeaningfulToCombine('navigation.headingMagnetic')).toBe(true);
    expect(isMeaningfulToCombine('environment.water.temperature')).toBe(true);
  });

  it('advisory copy carries no em dash or ampersand', () => {
    expect(NON_MEANINGFUL_ADVISORY).not.toMatch(/[—&]/);
    expect(NON_NUMERIC_ADVISORY).not.toMatch(/[—&]/);
  });
});
