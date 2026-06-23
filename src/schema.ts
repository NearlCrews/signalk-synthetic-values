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
          'Each entry combines all sources of one path. Detected multi-source paths are listed at GET /plugins/signalk-synthetic-values/api/detected.',
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
            outlierRejection: {
              type: 'boolean',
              title: 'Outlier rejection',
              description: 'Drop readings that deviate too far from the median before combining.',
              default: true,
            },
            madThreshold: {
              type: 'number',
              title: 'MAD threshold',
              description:
                'Number of median absolute deviations a reading may differ before being treated as an outlier.',
              default: 3,
            },
            rejectThreshold: {
              type: 'number',
              title: 'Absolute reject distance',
              description:
                'Maximum distance from the median before a reading is rejected outright: meters for position, radians for angular paths, value units for scalars.',
            },
            disagreeThreshold: {
              type: 'number',
              title: 'Disagreement distance',
              description:
                'If the spread between sources exceeds this value the synthetic output is flagged as disagreeing: meters for position, radians for angular paths, value units for scalars.',
            },
            angular: {
              type: 'string',
              title: 'Angular wrapping',
              description:
                'Force circular averaging on or off, or let the plugin detect it automatically from metadata.',
              enum: ['auto', 'yes', 'no'],
              default: 'auto',
            },
            minSources: {
              type: 'number',
              title: 'Minimum sources',
              description: 'Override the global minimum number of fresh sources required to emit.',
            },
            stalenessTimeoutMs: {
              type: 'number',
              title: 'Staleness timeout (ms)',
              description: 'Override the global timeout after which a reading is considered stale.',
            },
            emitMinIntervalMs: {
              type: 'number',
              title: 'Minimum emit interval (ms)',
              description: 'Override the global minimum interval between synthetic outputs.',
            },
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
