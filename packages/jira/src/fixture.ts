// The synthetic Jira project, SYN, as frozen fixtures: a base state, ordered
// `edits` made directly in the source after it, and frozen regions. CI, evals
// and the window render from it, and `pnpm seed:jira` recreates it on the
// throwaway site. Fixtures are the source of truth. `fixtureSnapshot` is the
// one mapping from fixtures to index records and content, shared by sources
// and tests.
import {
  array,
  boolean,
  type WorkstreamOrigin,
  type Infer,
  type Issue,
  isInstant,
  type ItemId,
  itemId,
  literal,
  nullable,
  number,
  object,
  parseItemId,
  refine,
  type Result,
  string,
  union,
} from "@oriel/core";
import { type JiraContent, jiraFacets, jiraKind, type JiraRecord, jiraText } from "./attrs.ts";
import { isSummary, maxSummary } from "./ops.ts";

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

// An edit someone made directly in the source, not an Oriel change set.
export const fixtureEdit = union(
  object({ kind: literal("setEpic"), key: issueKey, epic: issueKey, at: utc }),
  object({ kind: literal("setSummary"), key: issueKey, summary: string, at: utc }),
  object({ kind: literal("delete"), key: issueKey, at: utc }),
);

// Item IDs snapshotted against the base state, as a region would be, with an
// origin as stored. For the epic grouping, `cluster` is the epic's stable ID
// and `anchor` its item ID.
export const fixtureRegion = object({
  name: string,
  origin: union(
    object({
      kind: literal("cluster"),
      grouping: string,
      cluster: string,
      anchor: nullable(jiraItemId),
    }),
    object({ kind: literal("picked") }),
  ),
  items: array(jiraItemId),
});

// The fixture as its files hold it.
export const jiraFixtureFile = object({
  project: fixtureProject,
  people: array(fixturePerson),
  issues: array(fixtureIssue),
  edits: array(fixtureEdit),
  regions: array(fixtureRegion),
});

export type FixturePerson = Infer<typeof fixturePerson>;
export type FixtureIssue = Infer<typeof fixtureIssue>;
export type FixtureEdit = Infer<typeof fixtureEdit>;
export type JiraFixtureFile = Infer<typeof jiraFixtureFile>;

// A frozen region as Oriel uses it, with its origin in core's terms.
export type FixtureRegion = { name: string; origin: WorkstreamOrigin; items: ItemId<"jira">[] };
export type JiraFixture = Omit<JiraFixtureFile, "regions"> & { regions: FixtureRegion[] };

// Each part is stored as `<part>.json` in `fixtures/jira/`.
export const jiraFixtureParts = ["project", "people", "issues", "edits", "regions"] as const;

const badSummary = (summary: string) => !isSummary(summary);

const keyNumber = (key: string) => Number(key.slice(key.lastIndexOf("-") + 1));

// Shape first, then what shapes can't say: references resolve, keys are
// unique and ascending, epics precede their children (the seed creates in key
// order), each edit applies to the state the earlier ones left, and an epic
// region holds its epic and that epic's children. The fixture as stored, for
// the generator that writes it.
export function parseJiraFixtureFile(input: unknown): Result<JiraFixtureFile> {
  const shaped = jiraFixtureFile(input);
  if (!shaped.ok) return shaped;
  const problems = consistency(shaped.value);
  return problems.length ? { ok: false, issues: problems } : shaped;
}

// The fixture as Oriel uses it: checked as stored, then each region's origin
// in core's terms.
export function parseJiraFixture(input: unknown): Result<JiraFixture> {
  const parsed = parseJiraFixtureFile(input);
  if (!parsed.ok) return parsed;
  // The anchor by its stable ID too, from the base; the checks above
  // guarantee an epic region's anchor is there.
  const stableIds = new Map(parsed.value.issues.map((issue) => [`jira:${issue.key}`, issue.id]));
  const regions = parsed.value.regions.map(({ name, origin, items }): FixtureRegion => ({
    name,
    origin:
      origin.kind === "cluster"
        ? {
            ...origin,
            anchor:
              origin.anchor === null
                ? null
                : { id: origin.anchor, stableId: stableIds.get(origin.anchor) ?? "" },
          }
        : origin,
    items,
  }));
  return { ok: true, value: { ...parsed.value, regions } };
}

function consistency(fixture: JiraFixtureFile): Issue[] {
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

    if (badSummary(issue.summary))
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
  fixture.edits.forEach((edit, i) => {
    const at = `$.edits[${i}]`;
    if (edit.at < latest) problem(`${at}.at`, "edits come after the base and each other");
    latest = edit.at;
    const issue = live.get(edit.key);
    if (!issue) {
      problem(`${at}.key`, "no such issue at this point");
      return;
    }
    if (edit.kind === "setEpic") {
      if (issue.issueType === "Epic") problem(`${at}.key`, "an epic has no epic");
      if (live.get(edit.epic)?.issueType !== "Epic") problem(`${at}.epic`, "expected an epic");
      if (issue.epic === edit.epic) problem(`${at}.epic`, "already in this epic");
    }
    if (edit.kind === "setSummary" && badSummary(edit.summary))
      problem(`${at}.summary`, `expected 1 to ${maxSummary} characters`);
    if (edit.kind === "setSummary" && edit.summary === issue.summary)
      problem(`${at}.summary`, "unchanged");
    if (edit.kind === "delete" && [...live.values()].some((child) => child.epic === edit.key))
      problem(`${at}.key`, "deleting an epic that still has children");
    const next = applyEdit(issue, edit);
    if (!next) {
      live.delete(edit.key);
      return;
    }
    live.set(edit.key, next);
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
    const { origin } = region;
    if (origin.kind !== "cluster" || origin.grouping !== "epic") return;
    const epic = byKey.get(parseItemId(origin.anchor ?? "")?.key ?? "");
    if (epic?.issueType !== "Epic") {
      problem(`${at}.origin.anchor`, "expected an epic in the base");
      return;
    }
    if (origin.cluster !== epic.id)
      problem(`${at}.origin.cluster`, "expected the epic's stable ID");
    const members = [epic, ...fixture.issues.filter((issue) => issue.epic === epic.key)];
    const expected = new Set(members.map((issue) => `jira:${issue.key}`));
    if (expected.size !== region.items.length || region.items.some((id) => !expected.has(id)))
      problem(`${at}.items`, "expected the epic and its children in the base");
  });
  return found;
}

function applyEdit(issue: FixtureIssue, edit: FixtureEdit): FixtureIssue | null {
  if (edit.kind === "delete") return null;
  if (edit.kind === "setEpic") return { ...issue, epic: edit.epic, updatedAt: edit.at };
  return { ...issue, summary: edit.summary, updatedAt: edit.at };
}

// The issues after the first `edited` source edits (0 is the base state), in
// key order, with the stable IDs those edits deleted.
export function applySourceEdits(
  fixture: JiraFixture,
  edited: number,
): { issues: FixtureIssue[]; gone: string[] } {
  const live = new Map(fixture.issues.map((issue) => [issue.key, issue]));
  const gone: string[] = [];
  for (const edit of fixture.edits.slice(0, edited)) {
    const issue = live.get(edit.key);
    if (!issue) throw new RangeError(`edit to a missing issue: ${edit.key}`);
    const next = applyEdit(issue, edit);
    if (next) {
      live.set(edit.key, next);
      continue;
    }
    live.delete(edit.key);
    gone.push(issue.id);
  }
  return { issues: [...live.values()], gone };
}

export type FixtureSnapshot = {
  records: JiraRecord[];
  content: Map<ItemId<"jira">, JiraContent>;
  // Stable IDs the applied edits deleted.
  gone: string[];
};

// Pure. `site` is the origin item locations point at, such as
// "https://oriel.atlassian.net"; `edited` is how many source edits to apply.
// Records and content share no objects.
export function fixtureSnapshot(
  fixture: JiraFixture,
  site: string,
  edited: number,
): FixtureSnapshot {
  const people = new Map(fixture.people.map((person) => [person.id, person]));
  const name = (id: string) => people.get(id)?.displayName ?? id;
  // Stable IDs never change, and no edit deletes an epic that has children.
  const stableIds = new Map(fixture.issues.map((issue) => [issue.key, issue.id]));
  const { issues, gone } = applySourceEdits(fixture, edited);
  // The fixture has no workflows: any status SYN uses may follow any other,
  // as in a workflow that allows every transition. Listed from to-do to done.
  const order = { todo: 0, "in-progress": 1, done: 2 };
  const statuses = [
    ...new Map(fixture.issues.map((issue) => [issue.status.name, issue.status])).values(),
  ].toSorted((a, b) => order[a.category] - order[b.category] || a.name.localeCompare(b.name));
  const records: JiraRecord[] = [];
  const content = new Map<ItemId<"jira">, JiraContent>();
  for (const issue of issues) {
    const id = itemId("jira", issue.key);
    const epic =
      issue.epic === null
        ? null
        : { id: itemId("jira", issue.epic), stableId: stableIds.get(issue.epic) ?? "" };
    const assignee = () =>
      issue.assignee === null ? null : { accountId: issue.assignee, name: name(issue.assignee) };
    records.push({
      id,
      stableId: issue.id,
      title: issue.summary,
      location: `${site}/browse/${issue.key}`,
      updatedAt: issue.updatedAt,
      facets: jiraFacets({
        category: issue.status.category,
        epic,
        assignee: assignee(),
        // The fixture's types carry no hierarchy, so the name decides.
        kind: jiraKind({ name: issue.issueType }),
        points: issue.points,
      }),
      attrs: {
        issueType: issue.issueType,
        status: issue.status.name,
        labels: [...issue.labels],
      },
    });
    const comments = issue.comments.map((c) => ({
      author: name(c.author),
      body: c.body,
      at: c.at,
    }));
    content.set(id, {
      issueType: issue.issueType,
      status: { ...issue.status },
      moves: statuses
        .filter((status) => status.name !== issue.status.name)
        .map((status) => ({ ...status })),
      epic: epic?.id ?? null,
      assignee: assignee(),
      points: issue.points,
      labels: [...issue.labels],
      summary: issue.summary,
      description: issue.description,
      comments,
      links: issue.links.map((link) => ({ ...link })),
      title: issue.summary,
      text: jiraText({ summary: issue.summary, description: issue.description, comments }),
    });
  }
  return { records, content, gone };
}
