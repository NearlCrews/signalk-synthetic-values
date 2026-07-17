import { describe, expect, it } from 'vitest';
import { buildSchema } from '../src/schema';

// Loose JSON Schema node shape, wide enough for every assertion below.
interface SchemaNode {
  type?: string;
  enum?: unknown[];
  default?: number | string;
  examples?: string[];
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: number;
  exclusiveMaximum?: number;
  minLength?: number;
  pattern?: string;
  required?: string[];
  uniqueItems?: boolean;
  properties: Record<string, SchemaNode>;
  items: SchemaNode;
}

const schemaOf = (detected: Parameters<typeof buildSchema>[0]): SchemaNode =>
  buildSchema(detected) as SchemaNode;

describe('buildSchema', () => {
  it('includes detected paths as enum hints', () => {
    const schema = schemaOf(() => [
      { path: 'navigation.position', sources: ['a', 'b'], duplicateGroups: [] },
    ]);
    const pathProp = schema.properties.paths.items.properties.path;
    expect(pathProp.examples).toContain('navigation.position');
  });
  it('never throws when detection throws, returns a usable schema', () => {
    const schema = schemaOf(() => {
      throw new Error('boom');
    });
    expect(schema.properties.paths).toBeDefined();
    expect(schema.properties.paths.items.properties.path.examples).toEqual([]);
  });
  it('description names the discovery route', () => {
    const schema = schemaOf(() => []);
    expect(JSON.stringify(schema)).toContain('/plugins/signalk-synthetic-values/api/detected');
  });
  it('exposes the combine-method and angular enums with defaults', () => {
    const schema = schemaOf(() => []);
    const props = schema.properties.paths.items.properties;
    expect(props.method.enum).toEqual(['median', 'trimmedMean', 'mean']);
    expect(props.method.default).toBe('median');
    expect(props.angular.enum).toEqual(['auto', 'yes', 'no']);
    expect(props.angular.default).toBe('auto');
  });
  it('exposes the jumpRejection object with its sub-fields', () => {
    const schema = schemaOf(() => []);
    const jr = schema.properties.paths.items.properties.jumpRejection;
    expect(jr.type).toBe('object');
    expect(jr.required).toEqual(['maxRate']);
    expect(Object.keys(jr.properties).sort()).toEqual(['maxRate', 'persistMs', 'persistSamples']);
  });
  it('strictly-positive validator fields use exclusiveMinimum so the form cannot accept 0', () => {
    // validateConfig rejects 0 for these; a plain minimum: 0 would let the
    // admin form submit a value the runtime then drops.
    const schema = schemaOf(() => []);
    const props = schema.properties.paths.items.properties;
    for (const key of [
      'rejectThreshold',
      'disagreeThreshold',
      'angularSpreadThreshold',
      'slewLimit',
    ]) {
      expect(props[key].exclusiveMinimum, key).toBe(0);
      expect(props[key].minimum, key).toBeUndefined();
    }
    expect(props.jumpRejection.properties.maxRate.exclusiveMinimum).toBe(0);
  });
  it('trimFraction declares the same upper bound the validator enforces', () => {
    const schema = schemaOf(() => []);
    expect(schema.properties.paths.items.properties.trimFraction.exclusiveMaximum).toBe(0.5);
  });
  it('count fields are integers and jump persist fields carry defaults', () => {
    const schema = schemaOf(() => []);
    const props = schema.properties.paths.items.properties;
    expect(schema.properties.defaultMinSources.type).toBe('integer');
    expect(schema.properties.maxSourcesPerPath.type).toBe('integer');
    expect(schema.properties.maxSourcesPerPath.maximum).toBe(64);
    expect(props.minSources.type).toBe('integer');
    expect(props.jumpRejection.properties.persistSamples.type).toBe('integer');
    expect(props.jumpRejection.properties.persistSamples.default).toBeGreaterThan(0);
    expect(props.jumpRejection.properties.persistMs.default).toBeGreaterThan(0);
  });
  it('matches runtime path and source-list validation', () => {
    const props = schemaOf(() => []).properties.paths.items.properties;
    expect(props.path.minLength).toBe(1);
    expect(props.path.pattern).toBeDefined();
    expect(props.includeSources.uniqueItems).toBe(true);
    expect(props.includeSources.items.minLength).toBe(1);
    expect(props.excludeSources.uniqueItems).toBe(true);
  });
});
