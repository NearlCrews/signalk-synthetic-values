import type { DetectedPath } from './discovery';

export function buildSchema(detected: () => DetectedPath[]): object {
  let examples: string[] = [];
  try {
    examples = detected().map((d) => d.path);
  } catch {
    examples = [];
  }
  return {
    type: 'object',
    properties: {
      defaultStalenessTimeoutMs: {
        type: 'number',
        title: 'Default staleness timeout (ms)',
        default: 1000,
      },
      defaultEmitMinIntervalMs: {
        type: 'number',
        title: 'Default minimum emit interval (ms)',
        default: 1000,
      },
      defaultMinSources: { type: 'number', title: 'Default minimum sources', default: 2 },
      maxSourcesPerPath: { type: 'number', title: 'Maximum sources tracked per path', default: 16 },
      paths: {
        type: 'array',
        title: 'Paths to combine',
        description:
          'Each entry combines all sources of one path. Detected multi-source paths are listed at GET /plugins/signalk-synthetic-values/detected.',
        items: {
          type: 'object',
          required: ['path'],
          properties: {
            path: { type: 'string', title: 'Signal K path', examples },
            method: {
              type: 'string',
              title: 'Combine method',
              enum: ['median', 'trimmedMean', 'mean'],
              default: 'median',
            },
            outlierRejection: { type: 'boolean', default: true },
            madThreshold: { type: 'number', default: 3 },
            rejectThreshold: { type: 'number', title: 'Absolute reject distance (kind units)' },
            disagreeThreshold: { type: 'number', title: 'Disagreement distance (kind units)' },
            angular: { type: 'string', enum: ['auto', 'yes', 'no'], default: 'auto' },
            minSources: { type: 'number' },
            stalenessTimeoutMs: { type: 'number' },
            emitMinIntervalMs: { type: 'number' },
            trimFraction: {
              type: 'number',
              title: 'Trim fraction (trimmedMean only, 0 to 0.5)',
              default: 0.25,
            },
            angularSpreadThreshold: {
              type: 'number',
              title: 'Angular spread threshold (radians, angular paths only)',
            },
            slewLimit: { type: 'number', title: 'Slew limit (max change per second, kind units)' },
            includeSources: {
              type: 'array',
              title: 'Include only these sources (cannot combine with excludeSources)',
              items: { type: 'string' },
            },
            excludeSources: {
              type: 'array',
              title: 'Exclude these sources (cannot combine with includeSources)',
              items: { type: 'string' },
            },
          },
        },
      },
    },
  };
}
