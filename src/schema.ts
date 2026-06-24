import { COMBINE_METHODS } from './combine';
import {
  ANGULAR_MODES_LIST,
  DEFAULT_ANGULAR_SPREAD_THRESHOLD,
  DEFAULT_EMIT_INTERVAL_MS,
  DEFAULT_MAD_THRESHOLD,
  DEFAULT_MAX_SOURCES_PER_PATH,
  DEFAULT_MIN_SOURCES,
  DEFAULT_STALENESS_MS,
  DEFAULT_TRIM_FRACTION,
} from './config';
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
        minimum: 1,
        default: DEFAULT_STALENESS_MS,
      },
      defaultEmitMinIntervalMs: {
        type: 'number',
        title: 'Default minimum emit interval (ms)',
        minimum: 0,
        default: DEFAULT_EMIT_INTERVAL_MS,
      },
      defaultMinSources: {
        type: 'number',
        title: 'Default minimum sources',
        minimum: 1,
        default: DEFAULT_MIN_SOURCES,
      },
      maxSourcesPerPath: {
        type: 'number',
        title: 'Maximum sources tracked per path',
        minimum: 1,
        default: DEFAULT_MAX_SOURCES_PER_PATH,
      },
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
              enum: [...COMBINE_METHODS],
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
              minimum: 0,
              default: DEFAULT_MAD_THRESHOLD,
            },
            rejectThreshold: {
              type: 'number',
              title: 'Absolute reject distance',
              description:
                'Maximum distance from the median before a reading is rejected outright: meters for position, radians for angular paths, value units for scalars.',
              minimum: 0,
            },
            disagreeThreshold: {
              type: 'number',
              title: 'Disagreement distance',
              description:
                'If the spread between sources exceeds this value the synthetic output is flagged as disagreeing: meters for position, radians for angular paths, value units for scalars.',
              minimum: 0,
            },
            angular: {
              type: 'string',
              title: 'Angular wrapping',
              description:
                'Force circular averaging on or off, or let the plugin detect it automatically from metadata.',
              enum: [...ANGULAR_MODES_LIST],
              default: 'auto',
            },
            minSources: {
              type: 'number',
              title: 'Minimum sources',
              description: 'Override the global minimum number of fresh sources required to emit.',
              minimum: 1,
            },
            stalenessTimeoutMs: {
              type: 'number',
              title: 'Staleness timeout (ms)',
              description: 'Override the global timeout after which a reading is considered stale.',
              minimum: 1,
            },
            emitMinIntervalMs: {
              type: 'number',
              title: 'Minimum emit interval (ms)',
              description: 'Override the global minimum interval between synthetic outputs.',
              minimum: 0,
            },
            trimFraction: {
              type: 'number',
              title: 'Trim fraction (trimmedMean only, 0 to 0.5)',
              minimum: 0,
              default: DEFAULT_TRIM_FRACTION,
            },
            angularSpreadThreshold: {
              type: 'number',
              title: 'Angular spread threshold (radians, angular paths only)',
              minimum: 0,
              default: DEFAULT_ANGULAR_SPREAD_THRESHOLD,
            },
            slewLimit: {
              type: 'number',
              title: 'Slew limit (max change per second, kind units)',
              minimum: 0,
            },
            jumpRejection: {
              type: 'object',
              title: 'Jump rejection',
              description:
                'Hold back a sudden spike from a source and re-accept it only after a genuine step is confirmed.',
              properties: {
                maxRate: {
                  type: 'number',
                  title: 'Max rate (kind units per second)',
                  minimum: 0,
                },
                persistSamples: {
                  type: 'number',
                  title: 'Samples a new level must persist',
                  minimum: 1,
                },
                persistMs: {
                  type: 'number',
                  title: 'Milliseconds a new level must persist',
                  minimum: 0,
                },
              },
            },
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
