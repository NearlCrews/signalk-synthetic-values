/**
 * Pure rules behind the repository guard scripts. They take text or parsed
 * configuration and return what is wrong, so test/repo-guards.test.ts can
 * exercise each rule without touching the file system.
 */

const SAFE_LINK_TARGET = /^(?:https?:|mailto:|#)/i;
const FENCE = /^ {0,3}(`{3,}|~{3,})/;

function unwrapTarget(raw) {
  const trimmed = raw.trim();
  return trimmed.startsWith('<') && trimmed.endsWith('>') ? trimmed.slice(1, -1) : trimmed;
}

/** Splits Markdown into its lines, blanking every line inside a fenced code block. */
function linesOutsideFences(markdown) {
  let openFence;
  return markdown.split('\n').map((line) => {
    const fence = FENCE.exec(line)?.[1];
    if (fence === undefined) return openFence === undefined ? line : '';
    if (openFence === undefined) openFence = fence;
    else if (fence[0] === openFence[0] && fence.length >= openFence.length) openFence = undefined;
    return '';
  });
}

/** Replaces every character of a match except newlines, so offsets keep their line numbers. */
function blank(match) {
  return match.replace(/[^\n]/g, ' ');
}

/**
 * The link targets in fence-blanked Markdown, each with the offset where it starts.
 * Matching runs over the whole text rather than line by line, because hard-wrapped
 * link text such as `[Signal K\nApp Store](docs/x.md)` spans lines.
 */
function linkTargets(text) {
  const prose = text.replace(/`[^`\n]*`/g, blank).replace(/!\[[^\]]*\]\([^)]*\)/g, blank);
  const found = [];
  const collect = (pattern, pick) => {
    for (const match of prose.matchAll(pattern)) {
      const target = pick(match);
      found.push({
        index: match.index + match[0].lastIndexOf(target),
        target: unwrapTarget(target),
      });
    }
  };
  collect(/\[[^\]]*\]\(\s*(<[^>]*>|[^\s)]*)/g, (match) => match[1]);
  collect(/^ {0,3}\[(?!\^)[^\]\n]+\]:\s*(<[^>]*>|\S+)/gm, (match) => match[1]);
  collect(
    /<a\b[^>]*?\shref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi,
    (match) => match[1] ?? match[2] ?? match[3]
  );
  return found.sort((a, b) => a.index - b.index);
}

/**
 * Lists the README link targets the Signal K App Store would leave dead. The
 * App Store renders link targets unmodified and rewrites only image paths
 * against the package, so a relative link that works on GitHub is dead there.
 * Inline links, reference definitions, and HTML anchors must point at http,
 * https, mailto, or an in-page anchor. Relative image paths stay allowed.
 * Fenced code blocks and inline code are skipped because they are not links.
 */
export function findRelativeReadmeLinks(markdown) {
  const text = linesOutsideFences(markdown).join('\n');
  return linkTargets(text)
    .filter(({ target }) => !SAFE_LINK_TARGET.test(target))
    .map(({ index, target }) => ({ line: text.slice(0, index).split('\n').length, target }));
}

/**
 * Lists the Module Federation shares webpack would treat as strict. Signal K
 * 2.24 Admin registers its React shares as 19.0.0 while shipping a newer React,
 * so a strict share rejects a compatible host and the panel never mounts.
 * Webpack makes a share strict when it sets `strictVersion: true`, and also by
 * default when the share keeps a local fallback and is not a singleton, which
 * includes the string shorthand. This mirrors ConsumeSharedPlugin's defaults.
 */
export function findStrictVersionShares(shared) {
  if (shared === undefined || shared === null) return [];
  const entries = Array.isArray(shared)
    ? shared.flatMap((item) => (typeof item === 'string' ? [[item, item]] : Object.entries(item)))
    : Object.entries(shared);
  return entries
    .filter(([, config]) => {
      if (typeof config === 'string') return true;
      if (typeof config.strictVersion === 'boolean') return config.strictVersion;
      return config.import !== false && !config.singleton;
    })
    .map(([name]) => name);
}

/** The browser engine each Playwright project launches, as Playwright resolves it. */
export function playwrightEngines(projects) {
  return new Set(
    projects.map(
      (project) => project.use?.browserName ?? project.use?.defaultBrowserType ?? 'chromium'
    )
  );
}

const NPM_RUN = /\bnpm(?:@[\w.-]+)?\s+run(?:-script)?\s+([\w:.-]+)/g;

/**
 * Names the package scripts that run a Playwright suite, directly through a
 * command matching `runsSuite` or through `npm run` of a script that does.
 */
export function scriptsRunningPlaywright(scripts, runsSuite) {
  const found = new Set(
    Object.entries(scripts)
      .filter(([, command]) => runsSuite.test(command))
      .map(([name]) => name)
  );
  let grew = true;
  while (grew) {
    grew = false;
    for (const [name, command] of Object.entries(scripts)) {
      if (found.has(name)) continue;
      if ([...command.matchAll(NPM_RUN)].some((match) => found.has(match[1]))) {
        found.add(name);
        grew = true;
      }
    }
  }
  return found;
}

/**
 * Lists the browser engines a workflow's Playwright suites need but the
 * workflow never installs. A workflow needs every engine once any of its steps
 * runs one of `suiteScripts` or calls `playwright test` directly; comment lines
 * do not count. A bare `playwright install` installs every engine.
 */
export function findMissingPlaywrightEngines(workflow, engines, suiteScripts) {
  const code = workflow.replace(/^\s*#.*$/gm, '');
  const runsSuite =
    /\bplaywright\s+test\b/.test(code) ||
    [...code.matchAll(NPM_RUN)].some((match) => suiteScripts.has(match[1]));
  if (!runsSuite) return [];

  const installed = new Set();
  for (const match of code.matchAll(/\bplaywright\s+install(?![\w-])([^\n]*)/g)) {
    const named = match[1].split(/\s+/).filter((token) => /^[a-z][\w-]*$/.test(token));
    if (named.length === 0) return [];
    for (const engine of named) installed.add(engine);
  }
  return [...engines].filter((engine) => !installed.has(engine)).sort();
}

/** Splits a workflow into its top-level trigger block and a map of job name to job text. */
export function workflowParts(workflow) {
  const jobsStart = workflow.search(/^jobs:\s*$/m);
  if (jobsStart === -1) return { triggers: workflow, jobs: new Map() };
  const jobsText = workflow.slice(jobsStart);
  const headers = [...jobsText.matchAll(/^ {2}([\w-]+):\s*$/gm)];
  const jobs = new Map(
    headers.map((header, index) => [
      header[1],
      jobsText.slice(header.index, headers[index + 1]?.index ?? jobsText.length),
    ])
  );
  return { triggers: workflow.slice(0, jobsStart), jobs };
}

const OFF_PUSH_EVENTS = new Set(['schedule', 'workflow_dispatch']);

/**
 * Lists the jobs that run the full dependency audit on a push or pull request.
 * A job in a workflow with those triggers passes only when its own `if:` limits
 * it to scheduled or manually dispatched runs.
 */
export function findPushAuditJobs(workflow, runsAudit) {
  const { triggers, jobs } = workflowParts(workflow);
  if (!/^ {2}(?:push|pull_request):/m.test(triggers)) return [];
  return [...jobs]
    .filter(([, body]) => runsAudit.test(body))
    .filter(([, body]) => {
      const condition = /^ {4}if:\s*(.+)$/m.exec(body)?.[1];
      if (condition === undefined) return true;
      const clauses = condition.split('||').map((clause) => clause.trim());
      return !clauses.every((clause) => {
        const event = /^github\.event_name\s*==\s*'([\w-]+)'$/.exec(clause)?.[1];
        return event !== undefined && OFF_PUSH_EVENTS.has(event);
      });
    })
    .map(([name]) => name);
}

/**
 * Reads a workflow's weekly cron schedules as minutes after midnight UTC on
 * their day of the week. A schedule that is not a plain weekly
 * `minute hour * * day` expression is reported as unreadable.
 */
export function weeklySchedules(workflow) {
  return [...workflow.matchAll(/^\s*-\s*cron:\s*['"]([^'"]+)['"]/gm)].map((match) => {
    const fields = /^(\d+) (\d+) \* \* (\d)$/.exec(match[1]);
    return fields === null
      ? { cron: match[1], readable: false }
      : {
          cron: match[1],
          readable: true,
          day: Number(fields[3]),
          minutes: Number(fields[2]) * 60 + Number(fields[1]),
        };
  });
}
