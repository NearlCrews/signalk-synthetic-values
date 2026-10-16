import { describe, expect, it } from 'vitest';
import {
  detectedAdvisory,
  isMeaningfulToCombine,
  NON_NUMERIC_ADVISORY,
} from '../src/combinability';
import { UNRECOGNIZED_ANGLE_ADVISORY } from '../src/pathClassifier';

const facts = (overrides: Partial<Parameters<typeof detectedAdvisory>[0]> = {}) => ({
  path: 'environment.depth.belowKeel',
  sources: ['a', 'b'],
  combinable: true,
  unrecognizedAngle: false,
  ...overrides,
});

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

  it('flags the magnetic variation timestamp as not meaningful to average', () => {
    expect(isMeaningfulToCombine('navigation.magneticVariationAgeOfService')).toBe(false);
    expect(isMeaningfulToCombine('navigation.magneticVariation')).toBe(true);
  });

  it('treats real measurements as meaningful, including GNSS altitude and geoidal separation', () => {
    expect(isMeaningfulToCombine('navigation.position')).toBe(true);
    expect(isMeaningfulToCombine('navigation.gnss.antennaAltitude')).toBe(true);
    expect(isMeaningfulToCombine('navigation.gnss.geoidalSeparation')).toBe(true);
    expect(isMeaningfulToCombine('navigation.headingMagnetic')).toBe(true);
    expect(isMeaningfulToCombine('environment.water.temperature')).toBe(true);
  });
});

describe('detectedAdvisory', () => {
  it('says nothing about an ordinary combinable path', () => {
    expect(detectedAdvisory(facts())).toBe('');
  });

  it('explains a value that cannot be averaged ahead of anything else', () => {
    expect(detectedAdvisory(facts({ combinable: false }))).toBe(NON_NUMERIC_ADVISORY);
  });

  it('names the reason a numeric path is not meaningful to average', () => {
    expect(detectedAdvisory(facts({ path: 'navigation.gnss.satellites' }))).toMatch(
      /GNSS fix metadata/
    );
    expect(detectedAdvisory(facts({ path: 'navigation.magneticVariationAgeOfService' }))).toMatch(
      /timestamp/
    );
  });

  it('joins every advisory that applies', () => {
    const text = detectedAdvisory(
      facts({ unrecognizedAngle: true, slowReporting: 'Raise the staleness timeout.' })
    );
    expect(text).toContain(UNRECOGNIZED_ANGLE_ADVISORY);
    expect(text).toContain('Raise the staleness timeout.');
  });

  it('warns when offset-corrected positions sit beside the raw ones', () => {
    const mixed = detectedAdvisory(
      facts({ path: 'navigation.position', sources: ['gps1', 'gps2', 'bow.ccrp'] })
    );
    expect(mixed).toMatch(/\.ccrp/);
    // Corrected copies on their own are consistent, so there is nothing to say.
    expect(
      detectedAdvisory(facts({ path: 'navigation.position', sources: ['bow.ccrp', 'stern.ccrp'] }))
    ).toBe('');
  });

  it('carries no em dash or ampersand in any advisory', () => {
    const all = detectedAdvisory(
      facts({
        path: 'navigation.gnss.satellites',
        sources: ['a', 'a.ccrp'],
        unrecognizedAngle: true,
      })
    );
    expect(all).not.toMatch(/[\u2014&]/);
    expect(NON_NUMERIC_ADVISORY).not.toMatch(/[\u2014&]/);
  });
});
