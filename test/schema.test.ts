import { describe, expect, it } from 'vitest';
import { buildSchema } from '../src/schema';

describe('buildSchema', () => {
  it('includes detected paths as enum hints', () => {
    const schema: any = buildSchema(() => [{ path: 'navigation.position', sources: ['a', 'b'] }]);
    const pathProp = schema.properties.paths.items.properties.path;
    expect(pathProp.examples).toContain('navigation.position');
  });
  it('never throws when detection throws, returns a usable schema', () => {
    const schema: any = buildSchema(() => {
      throw new Error('boom');
    });
    expect(schema.properties.paths).toBeDefined();
    expect(schema.properties.paths.items.properties.path.examples).toEqual([]);
  });
  it('description names the discovery route', () => {
    const schema: any = buildSchema(() => []);
    expect(JSON.stringify(schema)).toContain('/plugins/signalk-synthetic-values/api/detected');
  });
  it('exposes the combine-method and angular enums with defaults', () => {
    const schema: any = buildSchema(() => []);
    const props = schema.properties.paths.items.properties;
    expect(props.method.enum).toEqual(['median', 'trimmedMean', 'mean']);
    expect(props.method.default).toBe('median');
    expect(props.angular.enum).toEqual(['auto', 'yes', 'no']);
    expect(props.angular.default).toBe('auto');
  });
  it('exposes the jumpRejection object with its sub-fields', () => {
    const schema: any = buildSchema(() => []);
    const jr = schema.properties.paths.items.properties.jumpRejection;
    expect(jr.type).toBe('object');
    expect(Object.keys(jr.properties).sort()).toEqual(['maxRate', 'persistMs', 'persistSamples']);
  });
});
