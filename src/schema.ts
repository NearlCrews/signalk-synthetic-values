import { BOUNDS, schemaBounds } from './bounds';
import { COMBINE_METHODS } from './combine';
import {
  ANGULAR_MODES_LIST,
  DEFAULT_ANGULAR_MODE,
  DEFAULT_ANGULAR_SPREAD_THRESHOLD,
  DEFAULT_EMIT_INTERVAL_MS,
  DEFAULT_JUMP_PERSIST_MS,
  DEFAULT_JUMP_PERSIST_SAMPLES,
  DEFAULT_MAD_THRESHOLD,
  DEFAULT_MAX_SOURCES_PER_PATH,
  DEFAULT_METHOD,
  DEFAULT_MIN_SOURCES,
  DEFAULT_NOTIFICATIONS,
  DEFAULT_OUTLIER_REJECTION,
  DEFAULT_STALENESS_MS,
  DEFAULT_TRIM_FRACTION,
  PLUGIN_ID,
  SLEW_MAX_LAG_SECONDS,
} from './config';

// Detection is best effort here: a failure must not cost the admin its form.
function safeExamples(detectedPaths: () => string[]): string[] {
  try {
    return detectedPaths();
  } catch {
    return [];
  }
}

export function buildSchema(detectedPaths: () => string[]): object {
  const examples = safeExamples(detectedPaths);
  return {
    type: 'object',
    properties: {
      defaultStalenessTimeoutMs: {
        ...schemaBounds(BOUNDS.stalenessTimeoutMs),
        title: 'Default staleness timeout (ms)',
        default: DEFAULT_STALENESS_MS,
      },
      defaultEmitMinIntervalMs: {
        ...schemaBounds(BOUNDS.emitMinIntervalMs),
        title: 'Default minimum emit interval (ms)',
        default: DEFAULT_EMIT_INTERVAL_MS,
      },
      defaultMinSources: {
        ...schemaBounds(BOUNDS.minSources),
        title: 'Default minimum sources',
        default: DEFAULT_MIN_SOURCES,
      },
      maxSourcesPerPath: {
        ...schemaBounds(BOUNDS.maxSourcesPerPath),
        title: 'Maximum sources tracked per path',
        default: DEFAULT_MAX_SOURCES_PER_PATH,
      },
      notifications: {
        type: 'boolean',
        title: 'Publish confidence notifications',
        description:
          'Publish notifications.<path> when sources diverge, disagree, or are rejected, so a consumer reading only the value can still tell how much to trust it. Visual only, never audible.',
        default: DEFAULT_NOTIFICATIONS,
      },
      paths: {
        type: 'array',
        title: 'Paths to combine',
        description: `Each entry combines all sources of one path. Detected multi-source paths are listed at GET /plugins/${PLUGIN_ID}/api/detected.`,
        items: {
          type: 'object',
          required: ['path'],
          properties: {
            path: {
              type: 'string',
              title: 'Signal K path',
              minLength: 1,
              pattern: '^\\S(?:.*\\S)?$',
              examples,
            },
            method: {
              type: 'string',
              title: 'Combine method',
              enum: [...COMBINE_METHODS],
              default: DEFAULT_METHOD,
            },
            outlierRejection: {
              type: 'boolean',
              title: 'Outlier rejection',
              description:
                'Drop readings that deviate too far from the robust, kind-aware center before combining.',
              default: DEFAULT_OUTLIER_REJECTION,
            },
            madThreshold: {
              ...schemaBounds(BOUNDS.madThreshold),
              title: 'MAD threshold',
              description:
                'Scaled-MAD multiplier for distances from the robust, kind-aware center. Applies at four or more fresh sources; below that, use the absolute reject distance. Switch outlier rejection off rather than setting this to zero.',
              default: DEFAULT_MAD_THRESHOLD,
            },
            rejectThreshold: {
              ...schemaBounds(BOUNDS.rejectThreshold),
              title: 'Absolute reject distance',
              description:
                'Maximum distance from the robust, kind-aware center before a reading is rejected outright: meters for position, radians for angular paths, radians on the worst axis for attitude, value units for scalars. Applies whether or not outlier rejection is on, and it is the only rejection that works with two or three sources.',
            },
            disagreeThreshold: {
              ...schemaBounds(BOUNDS.disagreeThreshold),
              title: 'Disagreement distance',
              description:
                'If the spread between sources exceeds this value the synthetic output is flagged as disagreeing: meters for position, radians for angular paths, radians on the worst axis for attitude, value units for scalars.',
            },
            angular: {
              type: 'string',
              title: 'Angular wrapping',
              description:
                'Force circular averaging on or off, or let the plugin detect it automatically from the path. Set it to yes for a full-circle quantity the plugin does not recognize, such as a vendor bearing, and to no for a bounded angle.',
              enum: [...ANGULAR_MODES_LIST],
              default: DEFAULT_ANGULAR_MODE,
            },
            minSources: {
              ...schemaBounds(BOUNDS.minSources),
              title: 'Minimum sources',
              description: 'Override the global minimum number of fresh sources required to emit.',
            },
            stalenessTimeoutMs: {
              ...schemaBounds(BOUNDS.stalenessTimeoutMs),
              title: 'Staleness timeout (ms)',
              description: 'Override the global timeout after which a reading is considered stale.',
            },
            emitMinIntervalMs: {
              ...schemaBounds(BOUNDS.emitMinIntervalMs),
              title: 'Minimum emit interval (ms)',
              description: 'Override the global minimum interval between synthetic outputs.',
            },
            trimFraction: {
              ...schemaBounds(BOUNDS.trimFraction),
              title: 'Trim fraction (trimmedMean only, [0, 0.5))',
              default: DEFAULT_TRIM_FRACTION,
            },
            angularSpreadThreshold: {
              ...schemaBounds(BOUNDS.angularSpreadThreshold),
              title: 'Angular spread threshold (radians, angular and attitude paths)',
              default: DEFAULT_ANGULAR_SPREAD_THRESHOLD,
            },
            slewLimit: {
              ...schemaBounds(BOUNDS.slewLimit),
              title: 'Slew limit (max change per second, kind units)',
              description: `Rate limit on the published value. The limiter is bypassed once it would fall more than ${SLEW_MAX_LAG_SECONDS} seconds of catch-up behind the sources, and on a depth path whenever the water is shoaling, so it can damp noise without hiding a real change.`,
            },
            jumpRejection: {
              type: 'object',
              title: 'Jump rejection',
              description:
                'Hold back a sudden spike from a source and re-accept it only after a genuine step is confirmed. Clearing the rate switches it off and leaves the persist settings in place.',
              properties: {
                maxRate: {
                  ...schemaBounds(BOUNDS.maxRate),
                  title: 'Max rate (kind units per second)',
                },
                persistSamples: {
                  ...schemaBounds(BOUNDS.persistSamples),
                  title: 'Sensor samples a new level must persist',
                  default: DEFAULT_JUMP_PERSIST_SAMPLES,
                },
                persistMs: {
                  ...schemaBounds(BOUNDS.persistMs),
                  title: 'Milliseconds a new level must persist',
                  default: DEFAULT_JUMP_PERSIST_MS,
                },
              },
            },
            includeSources: {
              type: 'array',
              title: 'Include only these sources (cannot combine with excludeSources)',
              uniqueItems: true,
              items: { type: 'string', minLength: 1 },
            },
            excludeSources: {
              type: 'array',
              title: 'Exclude these sources (cannot combine with includeSources)',
              uniqueItems: true,
              items: { type: 'string', minLength: 1 },
            },
          },
        },
      },
    },
  };
}
