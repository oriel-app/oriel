// Test support: Jira in memory over the SYN fixture, and a fresh database per
// test. The writer reports fields the way jira.ts names them.
import type { DatabaseSync } from "node:sqlite";
import {
  type Approved,
  type ChangeSets,
  type FieldValues,
  type IndexRecord,
  type Instant,
  instant,
  type ItemId,
  parseItemId,
  type RunRef,
  SourceRefused,
  type SourceWriter,
  type TelemetryEvent,
  type Ulid,
  ulid,
  unknown,
  type WriteRequest,
  type WriteResult,
} from "@oriel/core";
import { fixtureSnapshot, isJiraOp, type JiraFixture, jiraOps, jiraSpecs } from "@oriel/jira";
import { ensureWorkspace, groupStore, indexStore, loadMigrations, migrate, open } from "@oriel/db";
import { loadJiraFixture } from "../../../scripts/fixtures/load.ts";
import { changeSetsOver, type FieldReader, type Specs } from "./change-sets.ts";

export type MemoryIssue = {
  key: string;
  id: string;
  summary: string;
  description: string;
  points: number | null;
  accountId: string | null;
  epic: ItemId<"jira"> | null;
  links: { linkId: string; url: string; title: string }[];
  updated: Instant;
};

export type MemorySnapshot = {
  project: string;
  people: { accountId: string; name: string }[];
  issues: MemoryIssue[];
};

// New issues and links start here, above every key and link ID the fixture has.
const firstNewIssue = 900;
const firstNewLink = 90001;

let loaded: JiraFixture | null = null;
const fixture = (): JiraFixture => {
  loaded ??= loadJiraFixture();
  return loaded;
};

const site = "https://oriel.atlassian.net";

// Jira as the SYN fixture leaves it after all its source edits: SYN-16
// renamed, SYN-88 moved to SYN-3, SYN-27 deleted.
// Computed once: it is pure, and memoryJira copies what it takes from it.
let synJira: MemorySnapshot | null = null;
export function fixtureJira(): MemorySnapshot {
  synJira ??= buildFixtureJira();
  return synJira;
}

function buildFixtureJira(): MemorySnapshot {
  const syn = fixture();
  const { records, content } = fixtureSnapshot(syn, site, syn.edits.length);
  return {
    project: syn.project.key,
    people: syn.people.map((p) => ({ accountId: p.id, name: p.displayName })),
    issues: records.map((record) => {
      const c = content.get(record.id);
      if (!c) throw new Error(`no content for ${record.id}`);
      return {
        key: parseItemId(record.id)?.key ?? record.id,
        id: record.stableId,
        summary: c.summary,
        description: c.description,
        points: c.points,
        accountId: c.assignee?.accountId ?? null,
        epic: c.epic,
        links: c.links.map((link) => ({ ...link })),
        updated: record.updatedAt,
      };
    }),
  };
}

type Request = WriteRequest<"jira">;

export type MemoryJira = ReturnType<typeof memoryJira>;

// Every write and every touch from outside moves the clock one second on from
// `clock`, and stamps the item's `updated` with it. A write that never
// reaches the issue (it is gone, names another item, or its arguments are
// bad) changes nothing and says so, as the Jira writer does.
export function memoryJira(start: MemorySnapshot, clock: Instant) {
  const issues = new Map(start.issues.map((issue) => [issue.key, structuredClone(issue)]));
  for (const issue of issues.values()) {
    const number = Number(issue.key.slice(issue.key.lastIndexOf("-") + 1));
    if (number >= firstNewIssue) throw new RangeError(`fixture key ${issue.key} is too high`);
    for (const link of issue.links)
      if (Number(link.linkId) >= firstNewLink)
        throw new RangeError(`link ${link.linkId} is too high`);
  }
  const people = new Map(start.people.map((p) => [p.accountId, p.name]));
  const hidden = new Set<string>();
  let nextIssue = firstNewIssue;
  let nextLink = firstNewLink;
  let ticks = 0;
  // Every request a writer received, in order, including ones that then failed.
  const calls: Request[] = [];
  // Keys of the issues writes created, in order.
  const created: string[] = [];
  // Every write that landed, in order, with the item just before and after it.
  const landings: { request: Request; before: MemoryIssue | null; after: MemoryIssue | null }[] =
    [];
  const hooks: {
    // Runs before a request lands; a promise that never settles is a crash.
    before?: (request: Request, call: number) => Promise<void> | void;
    // Runs after a request has landed, before the writer answers.
    after?: (request: Request, call: number) => Promise<void> | void;
    read?: (id: ItemId) => Promise<void> | void;
  } = {};

  const tick = (): Instant => {
    ticks += 1;
    return instant(new Date(Date.parse(clock) + ticks * 1000));
  };
  const find = (id: string): MemoryIssue | null => {
    const parsed = parseItemId(id);
    if (parsed?.source !== "jira" || hidden.has(parsed.key)) return null;
    return issues.get(parsed.key) ?? null;
  };
  const values = (issue: MemoryIssue): Record<string, unknown> => ({
    summary: issue.summary,
    description: issue.description,
    points: issue.points,
    assignee: issue.accountId,
    epic: issue.epic,
    updated: issue.updated,
    ...Object.fromEntries(
      issue.links.map((l) => [`link:${l.linkId}`, { url: l.url, title: l.title }]),
    ),
  });
  const pick = (issue: MemoryIssue, fields: readonly string[]): FieldValues => {
    const all = values(issue);
    return Object.fromEntries(fields.map((f) => [f, Object.hasOwn(all, f) ? all[f] : null]));
  };
  const handle = (issue: MemoryIssue) => ({ id: `jira:${issue.key}` as const, stableId: issue.id });
  const unsent = (message: string) => new SourceRefused(message, { sent: false });
  const parsed = <T>(result: { ok: true; value: T } | { ok: false }): T => {
    if (!result.ok) throw unsent("bad arguments");
    return result.value;
  };

  const land = (request: Request): WriteResult<"jira"> => {
    if (!isJiraOp(request.op)) throw new Error(`unknown op ${request.op}`);
    if (request.op === "createStory") {
      const args = parsed(jiraOps.createStory.args(request.args));
      const issue: MemoryIssue = {
        key: `${start.project}-${nextIssue}`,
        id: String(20000 + nextIssue),
        summary: args.summary,
        description: args.description ?? "",
        points: args.points ?? null,
        accountId: null,
        epic:
          args.epic !== null && parseItemId(args.epic)?.source === "jira"
            ? (args.epic as ItemId<"jira">)
            : null,
        links: [],
        updated: tick(),
      };
      nextIssue += 1;
      issues.set(issue.key, issue);
      created.push(issue.key);
      return {
        item: handle(issue),
        before: {},
        after: pick(issue, ["summary", "description", "points", "epic", "updated"]),
      };
    }
    const issue = request.target === null ? null : find(request.target);
    if (!issue) throw unsent(`${request.target} is gone from Jira`);
    // As the Jira writer does: a handle that names another item now is refused.
    if (issue.id !== request.expectedStableId)
      throw unsent(`${request.target} names another item now (stable ID ${issue.id})`);
    const set = <F extends "summary" | "description" | "points" | "accountId">(
      property: F,
      value: MemoryIssue[F],
    ) => {
      // Reported under core's field names, as the Jira writer does.
      const field = property === "accountId" ? "assignee" : property;
      const before = pick(issue, [field]);
      issue[property] = value;
      issue.updated = tick();
      return { item: handle(issue), before, after: pick(issue, [field, "updated"]) };
    };
    switch (request.op) {
      case "setSummary":
        return set("summary", parsed(jiraOps.setSummary.args(request.args)).summary);
      case "setDescription":
        return set("description", parsed(jiraOps.setDescription.args(request.args)).description);
      case "setEstimate":
        return set("points", parsed(jiraOps.setEstimate.args(request.args)).points);
      case "setAssignee":
        return set("accountId", parsed(jiraOps.setAssignee.args(request.args)).accountId);
      case "addLink": {
        const args = parsed(jiraOps.addLink.args(request.args));
        const field = `link:${nextLink}`;
        issue.links.push({ linkId: String(nextLink), url: args.url, title: args.title });
        nextLink += 1;
        issue.updated = tick();
        return {
          item: handle(issue),
          before: { [field]: null },
          after: pick(issue, [field, "updated"]),
        };
      }
      case "removeLink": {
        const { linkId } = parsed(jiraOps.removeLink.args(request.args));
        const field = `link:${linkId}`;
        const before = pick(issue, [field]);
        if (before[field] === null) throw unsent(`removeLink: no link ${linkId}`);
        issue.links = issue.links.filter((l) => l.linkId !== linkId);
        issue.updated = tick();
        return { item: handle(issue), before, after: pick(issue, [field, "updated"]) };
      }
      case "deleteItem": {
        const before = values(issue);
        issues.delete(issue.key);
        return { item: handle(issue), before, after: {} };
      }
    }
    throw new Error(`unhandled op ${request.op}`);
  };

  const current = async (
    id: ItemId<"jira">,
    fields: readonly string[],
  ): Promise<FieldValues | "gone"> => {
    await hooks.read?.(id);
    const issue = find(id);
    return issue ? pick(issue, fields) : "gone";
  };

  const writer: SourceWriter<"jira"> = {
    kind: "jira",
    async apply(request: Approved<Request>) {
      const plain: Request = structuredClone({ ...request });
      calls.push(plain);
      await hooks.before?.(plain, calls.length);
      const prior = plain.target === null ? null : structuredClone(find(plain.target));
      const result = land(plain);
      const key = parseItemId(result.item.id)?.key ?? "";
      landings.push({
        request: plain,
        before: prior,
        after: structuredClone(issues.get(key) ?? null),
      });
      await hooks.after?.(plain, calls.length);
      return result;
    },
    current,
  };

  const reader: FieldReader<"jira"> = {
    current,
    person: async (accountId) => people.get(accountId) ?? null,
  };

  const touch = (key: string): MemoryIssue => {
    const issue = issues.get(key);
    if (!issue) throw new Error(`no issue ${key}`);
    issue.updated = tick();
    return issue;
  };

  return {
    writer,
    reader,
    calls,
    created,
    landings,
    hooks,
    issue: (key: string): MemoryIssue | null => structuredClone(issues.get(key) ?? null),
    // An edit someone makes directly in Jira, outside Oriel.
    edit(
      key: string,
      change: Partial<Pick<MemoryIssue, "summary" | "description" | "points" | "accountId">>,
    ) {
      Object.assign(touch(key), change);
    },
    // A teammate's comment: it changes no field Oriel writes, only `updated`.
    comment(key: string) {
      touch(key);
    },
    // A teammate retitles a remote link.
    retitleLink(key: string, linkId: string, title: string) {
      const found = touch(key).links.find((l) => l.linkId === linkId);
      if (!found) throw new Error(`no link ${linkId} on ${key}`);
      found.title = title;
    },
    // The item can't be seen (deleted, moved or forbidden), then can again.
    hide(key: string) {
      hidden.add(key);
    },
    show(key: string) {
      hidden.delete(key);
    },
  };
}

export const t0 = instant(new Date(Date.UTC(2026, 9, 29, 9, 0, 0)));

// Jira's op specs, as the composition root hands them to change sets.
export const specs: Specs = { jira: jiraSpecs };

// The thread's region: hand-picked stories that cover the fixture's mess, with
// SYN-27, which the fixture's edits delete. SYN-2 and SYN-14 are outside it.
export const regionKeys = [
  "SYN-1",
  "SYN-3",
  "SYN-8",
  "SYN-13",
  "SYN-21",
  "SYN-27",
  "SYN-31",
  "SYN-88",
  "SYN-103",
  "SYN-117",
];

// A fresh in-memory database with a workspace, a group of the region's items
// at version 1, a thread on it and a run in that version, Jira in memory, and
// a clock the test moves by hand.
export function setup() {
  const db = open(":memory:");
  migrate(db, loadMigrations(), t0);
  const ms = Date.parse(t0);
  const workspaceId = ulid(ms);
  const groupId = ulid(ms);
  const threadId = ulid(ms);
  const runId = ulid(ms);
  ensureWorkspace(db, { id: workspaceId, name: "test" }, t0);
  const base = new Map(fixture().issues.map((issue) => [issue.key, issue.id]));
  groupStore(db).create(
    { id: groupId, workspaceId, name: "Picked", origin: { kind: "picked" } },
    regionKeys.map((key) => ({ id: `jira:${key}`, stableId: base.get(key) ?? "" })),
    t0,
  );
  db.prepare(`
    insert into threads (id, workspace_id, group_id, region_version, created_at)
    values (?, ?, ?, 1, ?)`).run(threadId, workspaceId, groupId, t0);
  db.prepare(`
    insert into runs (id, workspace_id, thread_id, snapshot, region_version, system_prompt_hash,
      dts_hash, model, input_tokens, output_tokens, wall_ms, outcome, started_at)
    values (?, ?, ?, 1, 1, 'p', 'd', 'model', 0, 0, 0, 'ok', ?)`).run(
    runId,
    workspaceId,
    threadId,
    t0,
  );

  // The index, synced as the sync worker would: the base state, then the
  // fixture's source edits, which tombstone SYN-27.
  const syn = fixture();
  const index = indexStore(db);
  const indexPage = (records: IndexRecord[], gone: string[] = []) => {
    const sync = index.beginSync(workspaceId, "jira", unknown, t0);
    sync.apply({ records, gone, cursor: "c" });
    sync.finish("c", t0);
  };
  indexPage(fixtureSnapshot(syn, site, 0).records);
  const synced = fixtureSnapshot(syn, site, syn.edits.length);
  indexPage(synced.records, synced.gone);

  const jira = memoryJira(fixtureJira(), t0);
  let now: Instant = t0;
  const events: TelemetryEvent[] = [];
  // Another instance over the same database, as after a restart.
  const instance = (writer: SourceWriter<"jira"> = jira.writer): ChangeSets =>
    changeSetsOver({
      db,
      sources: { jira: { writer, reader: jira.reader } },
      specs,
      reviewBase: new URL("http://localhost:4000/review/"),
      now: () => now,
      emit: (event) => events.push(event),
    });
  const run: RunRef = { id: runId, threadId, workspaceId };
  return {
    db,
    jira,
    events,
    run,
    workspaceId: workspaceId as Ulid,
    // The thread's group, at version 1 holding `regionKeys`.
    groupId: groupId as Ulid,
    changeSets: instance(),
    instance,
    // A later sync page, such as a move or a reused key.
    indexPage,
    // An item's index record after the fixture's edits.
    indexed(key: string): IndexRecord {
      const record = synced.records.find((r) => r.id === `jira:${key}`);
      if (!record) throw new Error(`no record for ${key}`);
      return record;
    },
    advance(byMs: number) {
      now = instant(new Date(Date.parse(now) + byMs));
    },
  };
}

// Diffs the change set and approves exactly what the diff showed, in the thread.
export async function approve(changeSets: ChangeSets, id: Ulid) {
  const diff = await changeSets.diff(id);
  return changeSets.decide(id, "approved", { via: "thread", by: "pm" }, diff.hash);
}

export function nth<T>(list: readonly T[], index: number): T {
  const value = list[index];
  if (value === undefined) throw new RangeError(`no element ${index}`);
  return value;
}

export function count(db: DatabaseSync, table: "change_sets" | "decisions"): number {
  return Number(db.prepare(`select count(*) as n from ${table}`).get()?.n);
}

export function status(db: DatabaseSync, mutationId: Ulid): unknown {
  return db.prepare("select status from mutations where id = ?").get(mutationId)?.status;
}

// What a diff last recorded as shown for a mutation.
export function preview(db: DatabaseSync, mutationId: Ulid): unknown {
  const row = db.prepare("select preview from mutations where id = ?").get(mutationId);
  return typeof row?.preview === "string" ? JSON.parse(row.preview) : null;
}
