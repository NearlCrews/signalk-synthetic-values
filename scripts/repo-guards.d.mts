export interface RelativeLink {
  line: number;
  target: string;
}

export interface PlaywrightProject {
  use?: { browserName?: string; defaultBrowserType?: string };
}

export function findRelativeReadmeLinks(markdown: string): RelativeLink[];

export function findStrictVersionShares(shared: unknown): string[];

export function playwrightEngines(projects: readonly PlaywrightProject[]): Set<string>;

export function scriptsRunningPlaywright(
  scripts: Readonly<Record<string, string>>,
  runsSuite: RegExp
): Set<string>;

export function findMissingPlaywrightEngines(
  workflow: string,
  engines: Iterable<string>,
  suiteScripts: ReadonlySet<string>
): string[];

export interface WorkflowParts {
  triggers: string;
  jobs: Map<string, string>;
}

export function workflowParts(workflow: string): WorkflowParts;

export function findPushAuditJobs(workflow: string, runsAudit: RegExp): string[];

export type WeeklySchedule =
  | { cron: string; readable: true; day: number; minutes: number }
  | { cron: string; readable: false };

export function weeklySchedules(workflow: string): WeeklySchedule[];
