// The synthetic Jira project, SYN, as frozen fixtures: a base state, ordered
// `changes` applied after it, and frozen regions. CI, evals and the window
// render from it, and `pnpm seed:jira` recreates it on the throwaway site.
// Fixtures are the source of truth. `fixtureSnapshot` is the one mapping from
// fixtures to index records and content, shared by sources and tests.
import { isInstant, type ItemId, itemId, parseItemId } from "./ids.ts";
import type { JiraAttrs, JiraContent } from "./jira.ts";
import type { IndexRecord } from "./source.ts";
import {
  array,
  boolean,
  type Infer,
  type Issue,
  literal,
  nullable,
  number,
  object,
  refine,
  type Result,
  string,
  union,
} from "./validate.ts";

const utc = refine(string, isInstant, "expected a canonical UTC instant");
const issueKey = refine(
  string,
  (key) => parseItemId(`jira:${key}`) !== null,
  "expected an issue key like SYN-12",
);
const jiraItemId = refine(
  string,
  (id): id is ItemId<"jira"> => parseItemId(id)?.source === "jira",
  "expected a Jira item ID like jira:SYN-12",
);

export const fixtureProject = object({
  key: refine(string, (key) => /^[A-Z][A-Z0-9_]*$/.test(key), "expected a project key"),
  product: string,
});

// Stale assignees are inactive people.
export const fixturePerson = object({ id: string, displayName: string, active: boolean });

export const fixtureIssue = object({
  key: issueKey,
  // The stable ID: Jira's numeric issue ID.
  id: refine(string, (id) => /^[1-9][0-9]*$/.test(id), "expected a numeric issue ID"),
  issueType: union(literal("Epic"), literal("Story"), literal("Task"), literal("Bug")),
  summary: string,
  // Plain text; paragraphs are separated by a blank line.
  description: string,
  status: object({
    name: string,
    category: union(literal("todo"), literal("in-progress"), literal("done")),
  }),
  epic: nullable(issueKey),
  // A person ID.
  assignee: nullable(string),
  points: nullable(number),
  labels: array(string),
  comments: array(object({ author: string, body: string, at: utc })),
  links: array(object({ linkId: string, url: string, title: string })),
  updatedAt: utc,
});

export const fixtureChange = union(
  object({ kind: literal("setEpic"), key: issueKey, epic: issueKey, at: utc }),
  object({ kind: literal("setSummary"), key: issueKey, summary: string, at: utc }),
  object({ kind: literal("delete"), key: issueKey, at: utc }),
);

// Item IDs snapshotted against the base state, as a region would be.
export const fixtureRegion = object({ name: string, items: array(jiraItemId) });

export const jiraFixture = object({
  project: fixtureProject,
  people: array(fixturePerson),
  issues: array(fixtureIssue),
  changes: array(fixtureChange),
  regions: array(fixtureRegion),
});

export type FixturePerson = Infer<typeof fixturePerson>;
export type FixtureIssue = Infer<typeof fixtureIssue>;
export type FixtureChange = Infer<typeof fixtureChange>;
export type FixtureRegion = Infer<typeof fixtureRegion>;
export type JiraFixture = Infer<typeof jiraFixture>;

// Each part is stored as `<part>.json` in `fixtures/jira/`.
export const jiraFixtureParts = ["project", "people", "issues", "changes", "regions"] as const;

// Jira's limit on a summary, in characters.
const maxSummary = 255;

const keyNumber = (key: string) => Number(key.slice(key.lastIndexOf("-") + 1));

// Shape first, then what shapes can't say: references resolve, keys are
// unique and ascending, epics precede their children (the seed creates in key
// order), and each change applies to the state the earlier ones left.
export function parseJiraFixture(input: unknown): Result<JiraFixture> {
  const shaped = jiraFixture(input);
  if (!shaped.ok) return shaped;
  const problems = consistency(shaped.value);
  return problems.length ? { ok: false, issues: problems } : shaped;
}

function consistency(fixture: JiraFixture): Issue[] {
  const found: Issue[] = [];
  const problem = (path: string, message: string) => found.push({ path, message });
  const people = new Set<string>();
  fixture.people.forEach((person, i) => {
    if (people.has(person.id)) problem(`$.people[${i}].id`, "duplicate person ID");
    people.add(person.id);
  });

  const byKey = new Map<string, FixtureIssue>();
  const ids = new Set<string>();
  const linkIds = new Set<string>();
  const categories = new Map<string, string>();
  let previous = 0;
  fixture.issues.forEach((issue, i) => {
    const at = `$.issues[${i}]`;
    if (!issue.key.startsWith(`${fixture.project.key}-`))
      problem(`${at}.key`, "not in the project");
    if (keyNumber(issue.key) <= previous) problem(`${at}.key`, "keys must be unique and ascending");
    previous = keyNumber(issue.key);
    if (ids.has(issue.id)) problem(`${at}.id`, "duplicate issue ID");
    ids.add(issue.id);
    byKey.set(issue.key, issue);
    const category = categories.get(issue.status.name) ?? issue.status.category;
    if (category !== issue.status.category)
      problem(`${at}.status.category`, "one status name, one category");
    categories.set(issue.status.name, category);

    if (!issue.summary.trim() || [...issue.summary].length > maxSummary)
      problem(`${at}.summary`, `expected 1 to ${maxSummary} characters`);
    if (issue.issueType === "Epic" && issue.epic !== null)
      problem(`${at}.epic`, "an epic has no epic");
    if (issue.epic !== null) {
      const epic = byKey.get(issue.epic);
      if (epic?.issueType !== "Epic") problem(`${at}.epic`, "expected an earlier epic's key");
    }
    if (issue.assignee !== null && !people.has(issue.assignee))
      problem(`${at}.assignee`, "unknown person");
    if (issue.points !== null && issue.points < 0) problem(`${at}.points`, "negative estimate");
    issue.labels.forEach((label, j) => {
      if (!/^\S+$/.test(label)) problem(`${at}.labels[${j}]`, "labels have no whitespace");
    });
    if (new Set(issue.labels).size !== issue.labels.length)
      problem(`${at}.labels`, "duplicate label");
    let commentAt = "";
    issue.comments.forEach((comment, j) => {
      if (!people.has(comment.author)) problem(`${at}.comments[${j}].author`, "unknown person");
      if (!comment.body.trim()) problem(`${at}.comments[${j}].body`, "empty comment");
      if (comment.at < commentAt || comment.at > issue.updatedAt)
        problem(`${at}.comments[${j}].at`, "comments are in order, none after updatedAt");
      commentAt = comment.at;
    });
    issue.links.forEach((link, j) => {
      if (linkIds.has(link.linkId)) problem(`${at}.links[${j}].linkId`, "duplicate link ID");
      linkIds.add(link.linkId);
      if (!link.url.startsWith("https://")) problem(`${at}.links[${j}].url`, "expected https");
    });
  });

  const live = new Map(byKey);
  let latest = fixture.issues.reduce(
    (max, issue) => (issue.updatedAt > max ? issue.updatedAt : max),
    "",
  );
  fixture.changes.forEach((change, i) => {
    const at = `$.changes[${i}]`;
    if (change.at < latest) problem(`${at}.at`, "changes come after the base and each other");
    latest = change.at;
    const issue = live.get(change.key);
    if (!issue) {
      problem(`${at}.key`, "no such issue at this point");
      return;
    }
    if (change.kind === "setEpic") {
      if (issue.issueType === "Epic") problem(`${at}.key`, "an epic has no epic");
      if (live.get(change.epic)?.issueType !== "Epic") problem(`${at}.epic`, "expected an epic");
      if (issue.epic === change.epic) problem(`${at}.epic`, "already in this epic");
    }
    if (change.kind === "setSummary" && change.summary === issue.summary)
      problem(`${at}.summary`, "unchanged");
    if (change.kind === "delete" && [...live.values()].some((child) => child.epic === change.key))
      problem(`${at}.key`, "deleting an epic that still has children");
    const next = applyChange(issue, change);
    if (!next) {
      live.delete(change.key);
      return;
    }
    live.set(change.key, next);
  });

  const regionNames = new Set<string>();
  fixture.regions.forEach((region, i) => {
    const at = `$.regions[${i}]`;
    if (regionNames.has(region.name)) problem(`${at}.name`, "duplicate region name");
    regionNames.add(region.name);
    if (region.items.length === 0) problem(`${at}.items`, "empty region");
    if (new Set(region.items).size !== region.items.length)
      problem(`${at}.items`, "duplicate item");
    region.items.forEach((id, j) => {
      if (!byKey.has(parseItemId(id)?.key ?? "")) problem(`${at}.items[${j}]`, "not in the base");
    });
  });
  return found;
}

function applyChange(issue: FixtureIssue, change: FixtureChange): FixtureIssue | null {
  if (change.kind === "delete") return null;
  if (change.kind === "setEpic") return { ...issue, epic: change.epic, updatedAt: change.at };
  return { ...issue, summary: change.summary, updatedAt: change.at };
}

// The issues after the first `applied` changes (0 is the base state), in key
// order, with the stable IDs the changes deleted.
export function applyChanges(
  fixture: JiraFixture,
  applied: number,
): { issues: FixtureIssue[]; gone: string[] } {
  const live = new Map(fixture.issues.map((issue) => [issue.key, issue]));
  const gone: string[] = [];
  for (const change of fixture.changes.slice(0, applied)) {
    const issue = live.get(change.key);
    if (!issue) throw new RangeError(`change to a missing issue: ${change.key}`);
    const next = applyChange(issue, change);
    if (next) {
      live.set(change.key, next);
      continue;
    }
    live.delete(change.key);
    gone.push(issue.id);
  }
  return { issues: [...live.values()], gone };
}

export type FixtureSnapshot = {
  records: IndexRecord<"jira", JiraAttrs>[];
  content: Map<ItemId<"jira">, JiraContent>;
  // Stable IDs the applied changes deleted.
  gone: string[];
};

// Pure. `site` is the origin item URLs point at, such as
// "https://oriel.atlassian.net"; `applied` is how many changes to apply.
export function fixtureSnapshot(
  fixture: JiraFixture,
  site: string,
  applied: number,
): FixtureSnapshot {
  const people = new Map(fixture.people.map((person) => [person.id, person]));
  const name = (id: string) => people.get(id)?.displayName ?? id;
  const { issues, gone } = applyChanges(fixture, applied);
  const records: IndexRecord<"jira", JiraAttrs>[] = [];
  const content = new Map<ItemId<"jira">, JiraContent>();
  for (const issue of issues) {
    const id = itemId("jira", issue.key);
    // A fresh copy each call, so records and content share no objects.
    const attrs = (): JiraAttrs => ({
      issueType: issue.issueType,
      status: { ...issue.status },
      epic: issue.epic === null ? null : itemId("jira", issue.epic),
      assignee:
        issue.assignee === null ? null : { accountId: issue.assignee, name: name(issue.assignee) },
      points: issue.points,
      labels: [...issue.labels],
    });
    records.push({
      id,
      stableId: issue.id,
      title: issue.summary,
      url: `${site}/browse/${issue.key}`,
      updatedAt: issue.updatedAt,
      attrs: attrs(),
    });
    content.set(id, {
      ...attrs(),
      summary: issue.summary,
      description: issue.description,
      comments: issue.comments.map((c) => ({ author: name(c.author), body: c.body, at: c.at })),
      links: issue.links.map((link) => ({ ...link })),
    });
  }
  return { records, content, gone };
}
