import {
  findMissingPlaywrightEngines,
  findPushAuditJobs,
  findRelativeReadmeLinks,
  findStrictVersionShares,
  playwrightEngines,
  scriptsRunningPlaywright,
  weeklySchedules,
  workflowParts,
} from '../scripts/repo-guards.mjs';

describe('findRelativeReadmeLinks', () => {
  it('accepts absolute, mailto, and in-page link targets', () => {
    const markdown = [
      '[site](https://example.com/a) and [plain](http://example.com)',
      '[mail](mailto:someone@example.com) and [section](#configuration)',
      '[ref]: https://example.com/ref',
      '<a href="https://example.com">x</a> <a href=\'#top\'>top</a>',
      '[angle](<https://example.com/with space>)',
    ].join('\n');
    expect(findRelativeReadmeLinks(markdown)).toEqual([]);
  });

  it('allows relative image paths, including an image wrapped in an absolute link', () => {
    const markdown = [
      '![hero](assets/screenshots/00-admin-hero.png)',
      '[![badge](assets/badge.svg)](https://example.com)',
      '<img src="assets/icons/icon-192.png" alt="icon">',
    ].join('\n');
    expect(findRelativeReadmeLinks(markdown)).toEqual([]);
  });

  it('reports relative inline links, reference definitions, and HTML anchors with their lines', () => {
    const markdown = [
      'See [the docs](docs/guide.md).',
      '[changelog]: CHANGELOG.md',
      '<a href="LICENSE">license</a>',
      "<a class=x href='./.github/SECURITY.md'>policy</a> and <a href=docs/a.md>a</a>",
      '[empty]()',
      '[angle](<docs/with space.md>)',
    ].join('\n');
    expect(findRelativeReadmeLinks(markdown)).toEqual([
      { line: 1, target: 'docs/guide.md' },
      { line: 2, target: 'CHANGELOG.md' },
      { line: 3, target: 'LICENSE' },
      { line: 4, target: './.github/SECURITY.md' },
      { line: 4, target: 'docs/a.md' },
      { line: 5, target: '' },
      { line: 6, target: 'docs/with space.md' },
    ]);
  });

  it('reports a relative link whose text wraps across lines', () => {
    const markdown = ['Install from the [Signal K', 'App Store](docs/install.md) or npm.'].join(
      '\n'
    );
    expect(findRelativeReadmeLinks(markdown)).toEqual([{ line: 2, target: 'docs/install.md' }]);
  });

  it('ignores code, fenced blocks, and footnotes', () => {
    const markdown = [
      'Inline `[not a link](docs/a.md)` code.',
      '```md',
      '[inside a fence](docs/a.md)',
      '~~~',
      '[still inside](docs/b.md)',
      '```',
      '~~~~',
      '[inside a tilde fence](docs/c.md)',
      '~~~~',
      '[^1]: a footnote, not a link',
      'After the fences [real](docs/d.md).',
    ].join('\n');
    expect(findRelativeReadmeLinks(markdown)).toEqual([{ line: 11, target: 'docs/d.md' }]);
  });
});

describe('findStrictVersionShares', () => {
  it('accepts non-strict singletons and host-only shares', () => {
    expect(
      findStrictVersionShares({
        react: { singleton: true, requiredVersion: '^19.2.0', import: false },
        'react-dom': { singleton: true, import: false },
        lodash: { strictVersion: false },
        hostOnly: { import: false },
      })
    ).toEqual([]);
    expect(findStrictVersionShares(undefined)).toEqual([]);
    expect(findStrictVersionShares(null)).toEqual([]);
  });

  it('reports an explicit strictVersion on any share', () => {
    expect(
      findStrictVersionShares({
        react: { singleton: true, strictVersion: true, import: false },
        other: { singleton: true, strictVersion: true },
      })
    ).toEqual(['react', 'other']);
  });

  it('reports shares webpack makes strict by default', () => {
    expect(
      findStrictVersionShares({
        withFallback: { requiredVersion: '^1.0.0' },
        shorthand: '^19.0.0',
      })
    ).toEqual(['withFallback', 'shorthand']);
    expect(
      findStrictVersionShares(['react', { 'react-dom': { singleton: true, import: false } }])
    ).toEqual(['react']);
  });
});

describe('playwrightEngines', () => {
  it('resolves each project engine the way Playwright does', () => {
    expect([
      ...playwrightEngines([
        { use: { defaultBrowserType: 'firefox' } },
        { use: { browserName: 'webkit', defaultBrowserType: 'chromium' } },
        { use: {} },
        {},
      ]),
    ]).toEqual(['firefox', 'webkit', 'chromium']);
  });
});

describe('scriptsRunningPlaywright', () => {
  it('follows npm run chains to the scripts that start a suite', () => {
    const scripts = {
      'test:browser': 'playwright test --project=chromium',
      'test:browser:cross': 'node scripts/run-browser-matrix.mjs',
      'verify:browser': 'npm run verify && npm run test:browser:cross',
      'verify:release': 'npm run verify:browser && npm run audit:full',
      release: 'npx --yes npm@12.0.2 run verify:release',
      verify: 'npm run lint && npm test',
      lint: 'biome check .',
    };
    expect(
      [...scriptsRunningPlaywright(scripts, /\bplaywright test\b|run-browser-matrix\.mjs/)].sort()
    ).toEqual([
      'release',
      'test:browser',
      'test:browser:cross',
      'verify:browser',
      'verify:release',
    ]);
  });
});

describe('findMissingPlaywrightEngines', () => {
  const engines = ['chromium', 'firefox', 'webkit'];
  const suites = new Set(['test:browser:cross:built', 'verify:release']);

  it('passes a workflow that runs no browser suite', () => {
    expect(findMissingPlaywrightEngines('run: npm run verify', engines, suites)).toEqual([]);
  });

  it('ignores suites named only in comment lines', () => {
    const workflow = [
      '# npm run verify:release still runs this before a release.',
      '    # npx playwright test',
      'run: npm run audit:full',
    ].join('\n');
    expect(findMissingPlaywrightEngines(workflow, engines, suites)).toEqual([]);
  });

  it('passes when every engine is installed', () => {
    const workflow = [
      'run: npx --no-install playwright install --with-deps chromium firefox webkit',
      'run: npm run test:browser:cross:built',
    ].join('\n');
    expect(findMissingPlaywrightEngines(workflow, engines, suites)).toEqual([]);
  });

  it('treats a bare install as every engine', () => {
    const workflow = 'run: npx playwright install --with-deps\nrun: npx playwright test';
    expect(findMissingPlaywrightEngines(workflow, engines, suites)).toEqual([]);
  });

  it('reports engines a suite needs but the workflow never installs', () => {
    const workflow = [
      'run: npx playwright install-deps webkit',
      'run: npx playwright install --with-deps chromium',
      'run: npx --yes npm@12.0.2 run verify:release',
    ].join('\n');
    expect(findMissingPlaywrightEngines(workflow, engines, suites)).toEqual(['firefox', 'webkit']);
  });

  it('reports every engine when a suite runs with no install step', () => {
    expect(findMissingPlaywrightEngines('run: npx playwright test', engines, suites)).toEqual(
      engines
    );
  });
});

const scheduledWorkflow = [
  'name: Workflow Security',
  'on:',
  '  push:',
  '    branches: [main]',
  '  schedule:',
  "    - cron: '31 6 * * 1'",
  '  workflow_dispatch:',
  'jobs:',
  '  actionlint:',
  '    runs-on: ubuntu-latest',
  '  dependency-audit:',
  "    if: github.event_name == 'schedule' || github.event_name == 'workflow_dispatch'",
  '    steps:',
  '      - run: npx --yes npm@12.0.2 run audit:full',
].join('\n');

describe('workflowParts', () => {
  it('separates the triggers from each job', () => {
    const { triggers, jobs } = workflowParts(scheduledWorkflow);
    expect(triggers).toContain('  push:');
    expect([...jobs.keys()]).toEqual(['actionlint', 'dependency-audit']);
    expect(jobs.get('actionlint')).not.toContain('audit:full');
    expect(jobs.get('dependency-audit')).toContain('audit:full');
  });

  it('treats a workflow without jobs as triggers only', () => {
    expect(workflowParts('on:\n  push:\n')).toEqual({
      triggers: 'on:\n  push:\n',
      jobs: new Map(),
    });
  });
});

describe('findPushAuditJobs', () => {
  const runsAudit = /\baudit:full\b/;

  it('accepts an audit job limited to scheduled and dispatched runs', () => {
    expect(findPushAuditJobs(scheduledWorkflow, runsAudit)).toEqual([]);
  });

  it('accepts any audit in a workflow without push or pull request triggers', () => {
    const workflow =
      "on:\n  schedule:\n    - cron: '0 6 * * 1'\njobs:\n  audit:\n    run: npm run audit:full";
    expect(findPushAuditJobs(workflow, runsAudit)).toEqual([]);
  });

  it('reports an audit job without a gate or with a gate that admits a push', () => {
    const workflow = [
      'on:',
      '  pull_request:',
      'jobs:',
      '  ungated:',
      '    steps:',
      '      - run: npm run audit:full',
      '  push-gated:',
      "    if: github.event_name == 'schedule' || github.event_name == 'push'",
      '    steps:',
      '      - run: npm run audit:full',
      '  other-condition:',
      "    if: github.ref == 'refs/heads/main'",
      '    steps:',
      '      - run: npm run audit:full',
      '  runtime-only:',
      '    steps:',
      '      - run: npm run audit:runtime',
    ].join('\n');
    expect(findPushAuditJobs(workflow, runsAudit)).toEqual([
      'ungated',
      'push-gated',
      'other-condition',
    ]);
  });
});

describe('weeklySchedules', () => {
  it('reads weekly crons as minutes after midnight on their weekday', () => {
    const workflow = [
      "    - cron: '31 6 * * 1'",
      '    - cron: "0 8 * * 1"',
      "- cron: '0 7 * * 1'",
    ].join('\n');
    expect(weeklySchedules(workflow)).toEqual([
      { cron: '31 6 * * 1', readable: true, day: 1, minutes: 391 },
      { cron: '0 8 * * 1', readable: true, day: 1, minutes: 480 },
      { cron: '0 7 * * 1', readable: true, day: 1, minutes: 420 },
    ]);
  });

  it('marks a schedule that is not a plain weekly expression as unreadable', () => {
    expect(weeklySchedules("    - cron: '*/30 6 * * 1-5'")).toEqual([
      { cron: '*/30 6 * * 1-5', readable: false },
    ]);
    expect(weeklySchedules('on:\n  push:\n')).toEqual([]);
  });
});
