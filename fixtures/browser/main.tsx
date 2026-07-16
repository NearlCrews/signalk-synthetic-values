import * as React from 'react';
import { createRoot } from 'react-dom/client';
import {
  DEFAULT_EMIT_INTERVAL_MS,
  DEFAULT_MAX_SOURCES_PER_PATH,
  DEFAULT_MIN_SOURCES,
  DEFAULT_STALENESS_MS,
} from '../../src/config.js';

declare const __REMOTE_URL__: string;

interface PanelConfiguration {
  defaultStalenessTimeoutMs: number;
  defaultEmitMinIntervalMs: number;
  defaultMinSources: number;
  maxSourcesPerPath: number;
  paths: Array<Record<string, unknown> & { path: string }>;
}

interface PanelProps {
  configuration?: Partial<PanelConfiguration>;
  save: (configuration: PanelConfiguration) => unknown;
}

interface RemoteContainer {
  get(module: string): Promise<() => { default: React.ComponentType<PanelProps> }>;
  init(scope: ShareScope): Promise<void> | void;
}

interface ShareScope {
  readonly react: Record<
    string,
    {
      readonly eager: boolean;
      readonly from: string;
      readonly get: () => Promise<() => typeof React>;
      readonly loaded: boolean;
    }
  >;
}

const parameters = new URLSearchParams(window.location.search);
const unconfigured = parameters.has('unconfigured');
const failFirstSave = parameters.has('save-failure');
if (parameters.has('unsupported-css-scope')) {
  Object.defineProperty(window, 'CSSScopeRule', {
    configurable: true,
    value: undefined,
  });
}

const detectedPayload = {
  paths: [
    {
      path: 'navigation.speedOverGround',
      sources: ['gps.1', 'gps.2'],
      kind: 'scalar',
      optedIn: true,
    },
    {
      path: 'navigation.headingTrue',
      sources: ['compass.1', 'compass.2', 'compass.rebroadcast'],
      kind: 'angular',
      optedIn: false,
      duplicateGroups: [['compass.1', 'compass.rebroadcast']],
    },
    {
      path: 'navigation.position',
      sources: ['gps.1', 'gps.2', 'gps.3'],
      kind: 'position',
      optedIn: false,
    },
    {
      path: 'navigation.gnss.satellites',
      sources: ['gps.1', 'gps.2'],
      kind: 'scalar',
      optedIn: false,
      combinable: true,
      recommended: false,
      advisory: 'GNSS fix metadata. Averaging it across receivers is not meaningful.',
    },
    {
      path: 'vessel.name',
      sources: ['ais.1', 'ais.2'],
      kind: 'other',
      optedIn: false,
      combinable: false,
    },
  ],
};

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

window.fetch = async (input): Promise<Response> => {
  const rawUrl = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const url = new URL(rawUrl, window.location.origin);
  if (url.pathname.endsWith('/detected')) {
    const requestCount = Number(document.body.dataset.detectedRequestCount ?? 0) + 1;
    document.body.dataset.detectedRequestCount = String(requestCount);
    return jsonResponse(detectedPayload);
  }
  return jsonResponse({ error: `Unhandled fixture request: ${url.pathname}` }, 404);
};

const shareScope: ShareScope = {
  react: {
    [React.version]: {
      eager: true,
      from: 'synthetic-values-browser-fixture',
      get: () => Promise.resolve(() => React),
      loaded: true,
    },
  },
};

try {
  const container = (await import(/* @vite-ignore */ __REMOTE_URL__)) as RemoteContainer;
  await container.init(shareScope);
  const factory = await container.get('./PluginConfigurationPanel');
  const Panel = factory().default;
  const rootElement = document.querySelector('#root');
  if (!(rootElement instanceof HTMLElement)) throw new Error('Fixture root is missing.');

  const initialConfiguration: PanelConfiguration = {
    defaultStalenessTimeoutMs: DEFAULT_STALENESS_MS,
    defaultEmitMinIntervalMs: DEFAULT_EMIT_INTERVAL_MS,
    defaultMinSources: DEFAULT_MIN_SOURCES,
    maxSourcesPerPath: DEFAULT_MAX_SOURCES_PER_PATH,
    paths: [{ path: 'navigation.speedOverGround' }],
  };

  function HostFixture(): React.ReactElement {
    const [configuration, setConfiguration] = React.useState<PanelConfiguration | undefined>(
      unconfigured ? undefined : initialConfiguration
    );
    const saveAttempts = React.useRef(0);

    const save = async (nextConfiguration: PanelConfiguration): Promise<void> => {
      saveAttempts.current += 1;
      document.body.dataset.saveAttemptCount = String(saveAttempts.current);
      if (failFirstSave && saveAttempts.current === 1) {
        throw new Error('Fixture save failed');
      }
      document.body.dataset.saveCount = String(Number(document.body.dataset.saveCount ?? 0) + 1);
      document.body.dataset.savedConfiguration = JSON.stringify(nextConfiguration);
      setConfiguration(nextConfiguration);
    };

    return <Panel {...(configuration === undefined ? {} : { configuration })} save={save} />;
  }

  createRoot(rootElement).render(
    <React.StrictMode>
      <HostFixture />
    </React.StrictMode>
  );
  document.body.dataset.fixtureReady = 'true';
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  const errorElement = document.querySelector('#fixture-error');
  if (errorElement) errorElement.textContent = message;
  document.body.dataset.fixtureReady = 'false';
}
