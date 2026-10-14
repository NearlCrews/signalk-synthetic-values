import { readdir, readFile } from 'node:fs/promises';
import { tsImport } from 'tsx/esm/api';
import {
  findMissingPlaywrightEngines,
  findPushAuditJobs,
  playwrightEngines,
  scriptsRunningPlaywright,
  weeklySchedules,
  workflowParts,
} from './repo-guards.mjs';

const workflowDirectory = '.github/workflows';
const workflowPaths = (await readdir(workflowDirectory))
  .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
  .map((name) => `${workflowDirectory}/${name}`);
const failures = [];
const workflows = new Map();

for (const path of workflowPaths) {
  const workflow = await readFile(path, 'utf8');
  workflows.set(path, workflow);
  for (const [index, line] of workflow.split('\n').entries()) {
    const action = /\buses:\s+([^\s#]+)@([^\s#]+)/.exec(line);
    if (action !== null && !/^[0-9a-f]{40}$/.test(action[2] ?? '')) {
      failures.push(`${path}:${index + 1} must pin ${action[1]} to a full commit SHA.`);
    }
  }
}

// Every workflow cancels a superseded run on the same ref, except publishing,
// which must never stop halfway through a release.
const publishPath = `${workflowDirectory}/publish.yml`;
for (const [path, workflow] of workflows) {
  const expected = path === publishPath ? 'false' : 'true';
  if (!/^concurrency:/m.test(workflow) || !workflow.includes(`cancel-in-progress: ${expected}`)) {
    failures.push(`${path} must declare concurrency with cancel-in-progress: ${expected}.`);
  }
}

// The full dependency audit includes development tools, so it runs on a weekly
// schedule rather than gating pushes and pull requests. The runtime audit,
// which the plugin registry scores, stays a push and pull request gate.
for (const [path, workflow] of workflows) {
  for (const job of findPushAuditJobs(workflow, /\baudit:full\b/)) {
    failures.push(`${path} job ${job} runs audit:full on a push or pull request.`);
  }
}
const workflowSecurity = workflows.get(`${workflowDirectory}/workflow-security.yml`) ?? '';
const auditJob = workflowParts(workflowSecurity).jobs.get('dependency-audit') ?? '';
if (!auditJob.includes('npm@12.0.2 run audit:full')) {
  failures.push('workflow-security.yml must keep the scheduled dependency-audit job.');
}

// The plugin registry reads only the newest 20 runs on a release commit, so
// every scheduled workflow adds runs that can push the plugin CI run out of
// that window. Scheduling stays in this fixed set, and plugin CI runs last on
// its weekday so a fresh run always sits inside the window.
const scheduled = new Map(
  [...workflows]
    .map(([path, workflow]) => [path, weeklySchedules(workflow)])
    .filter(([, schedules]) => schedules.length > 0)
);
const expectedScheduled = ['codeql.yml', 'plugin-ci.yml', 'workflow-security.yml'].map(
  (name) => `${workflowDirectory}/${name}`
);
if ([...scheduled.keys()].sort().join() !== expectedScheduled.join()) {
  failures.push(
    `Only ${expectedScheduled.join(', ')} may run on a schedule, because each scheduled run on a release commit can evict its plugin CI run from the registry's newest 20.`
  );
}
const pluginCiPath = `${workflowDirectory}/plugin-ci.yml`;
for (const [path, schedules] of scheduled) {
  for (const schedule of schedules.filter((entry) => !entry.readable)) {
    failures.push(
      `${path} schedule ${schedule.cron} must be a plain weekly minute hour * * day cron.`
    );
  }
}
const pluginCiSchedules = (scheduled.get(pluginCiPath) ?? []).filter((entry) => entry.readable);
for (const [path, schedules] of scheduled) {
  if (path === pluginCiPath) continue;
  for (const other of schedules.filter((entry) => entry.readable)) {
    const later = pluginCiSchedules.some(
      (own) => own.day === other.day && own.minutes > other.minutes
    );
    if (!later) {
      failures.push(`plugin-ci.yml must run on a schedule later than ${path} (${other.cron}).`);
    }
  }
}

const ci = await readFile('.github/workflows/ci.yml', 'utf8');
if (
  !ci.includes('node-version: [22.22.2, 26]') ||
  !ci.includes('npx --yes npm@12.0.2') ||
  !ci.includes('npm run audit:runtime') ||
  !ci.includes('test:browser:cross:built') ||
  !ci.includes("node-version: '20.18'") ||
  !ci.includes('Smoke the runtime artifact on the floor Node')
) {
  failures.push(
    'ci.yml must retain npm 12.0.2, the supported Node matrix, the runtime audit, the cross-browser gate, and the blocking Node 20 lane ending in the runtime-artifact smoke.'
  );
}
if (ci.split('npm run test:coverage').length !== 2) {
  failures.push('ci.yml must run the coverage thresholds exactly once.');
}
// The Admin matrix starts at the oldest server the README promises the panel
// supports, so the documented floor and the tested floor cannot drift.
const readme = await readFile('README.md', 'utf8');
const panelFloor = /configuration panel needs Signal K (\d+\.\d+\.\d+) or newer/.exec(readme)?.[1];
const adminJob = workflowParts(ci).jobs.get('signalk-admin') ?? '';
if (panelFloor === undefined) {
  failures.push(
    'README.md must state the oldest Signal K server the configuration panel supports.'
  );
} else if (!adminJob.includes(`signalk_server: ['${panelFloor}', latest]`)) {
  failures.push(
    `ci.yml signalk-admin must test Signal K ${panelFloor}, the README panel floor, and latest.`
  );
}
for (const expected of [
  'pack --ignore-scripts',
  'scripts/link-signalk-admin.mjs',
  'npm run test:integration',
]) {
  if (!adminJob.includes(expected)) {
    failures.push(`ci.yml signalk-admin must retain ${expected}.`);
  }
}

const pluginCi = await readFile('.github/workflows/plugin-ci.yml', 'utf8');
if (!pluginCi.includes('SignalK/signalk-server/.github/workflows/plugin-ci.yml@')) {
  failures.push('plugin-ci.yml must retain the official Signal K reusable workflow.');
}
if (pluginCiSchedules.length === 0) {
  failures.push('plugin-ci.yml must run on a weekly schedule.');
}
// ci.yml already runs coverage and the Admin integration job, and the release
// commit's main push run is the one the registry credits.
for (const unexpected of [
  'tags:',
  'coverage-command:',
  'format-check-command:',
  'enable-signalk-integration:',
]) {
  if (pluginCi.includes(unexpected)) {
    failures.push(`plugin-ci.yml must not set ${unexpected}`);
  }
}

// Every workflow that runs a browser suite installs every engine the
// Playwright projects launch, read from the config itself so a new project
// cannot slip past the install steps.
const { default: playwrightConfig } = await tsImport('../playwright.config.ts', import.meta.url);
const engines = playwrightEngines(playwrightConfig.projects ?? []);
const packageJson = JSON.parse(await readFile('package.json', 'utf8'));
const browserScripts = scriptsRunningPlaywright(
  packageJson.scripts,
  /\bplaywright test\b|run-browser-matrix\.mjs/
);
for (const [path, workflow] of workflows) {
  const missing = findMissingPlaywrightEngines(workflow, engines, browserScripts);
  if (missing.length > 0) {
    failures.push(`${path} runs a browser suite without installing ${missing.join(', ')}.`);
  }
}

const codeql = await readFile('.github/workflows/codeql.yml', 'utf8');
for (const expected of ['github/codeql-action/init@', 'github/codeql-action/analyze@']) {
  if (!codeql.includes(expected)) failures.push(`codeql.yml must include ${expected}.`);
}

const publish = await readFile('.github/workflows/publish.yml', 'utf8');
for (const expected of [
  'npm@12.0.2',
  '--provenance --access public',
  'name: npm-package',
  'needs: build',
  'RELEASE_GIT_HEAD="$(git rev-parse HEAD)"',
  'p.gitHead=process.env.RELEASE_GIT_HEAD',
  'PACKED_GIT_HEAD',
]) {
  if (!publish.includes(expected)) failures.push(`publish.yml must retain ${expected}.`);
}

for (const expected of ['actionlint@v1.7.12', 'zizmor-action@']) {
  if (!workflowSecurity.includes(expected)) {
    failures.push(`workflow-security.yml must include ${expected}.`);
  }
}

if (failures.length > 0) {
  console.error(failures.join('\n'));
  process.exit(1);
}

process.stdout.write(
  'Workflow pins, concurrency, schedules, audit placement, browser installs, release invariants, and security checks passed.\n'
);
