// Test support: Jira in memory over a snapshot the tests write, and a fresh
// database per test. The writer reports fields the way jira.ts names them.
import type { DatabaseSync } from "node:sqlite";
import {
  type Approved,
  type ChangeSets,
  type FieldValues,
  type Instant,
  instant,
  type ItemId,
  isItemId,
  isJiraOp,
  jiraOps,
  parseItemId,
  type RunRef,
  type SourceWriter,
  type TelemetryEvent,
  type Ulid,
  ulid,
  type WriteRequest,
  type WriteResult,
} from "@oriel/core";
import { ensureWorkspace, loadMigrations, migrate, open } from "@oriel/db";
import { changeSets, type Reader } from "./change-sets.ts";

export type MemoryIssue = {
  key: string;
  id: string;
  summary: string;
  description: string;
  points: number | null;
  accountId: string | null;
  epic: ItemId<"jira"> | null;
  links: { linkId: string; url: string; title: string }[];
};

export type MemorySnapshot = {
  project: string;
  people: { accountId: string; name: string }[];
  issues: MemoryIssue[];
};

export function snapshot(): MemorySnapshot {
  return {
    project: "SYN",
    people: [
      { accountId: "acc-ana", name: "Ana Lima" },
      { accountId: "acc-bo", name: "Bo Chen" },
    ],
    issues: [
      {
        key: "SYN-1",
        id: "10001",
        summary: "Checkout reliability",
        description: "",
        points: null,
        accountId: null,
        epic: null,
        links: [],
      },
      {
        key: "SYN-2",
        id: "10002",
        summary: "Retry failed card payments",
        description: "Retry once after a soft decline.",
        points: 3,
        accountId: "acc-ana",
        epic: "jira:SYN-1",
        links: [],
      },
      {
        key: "SYN-3",
        id: "10003",
        summary: "Show a receipt after checkout",
        description: "",
        points: null,
        accountId: null,
        epic: "jira:SYN-1",
        links: [
          { linkId: "20001", url: "https://docs.example.com/receipts", title: "Receipt spec" },
        ],
      },
    ],
  };
}

type Request = WriteRequest<"jira">;

export type MemoryJira = ReturnType<typeof memoryJira>;

export function memoryJira(start: MemorySnapshot) {
  const issues = new Map(start.issues.map((issue) => [issue.key, structuredClone(issue)]));
  const people = new Map(start.people.map((p) => [p.accountId, p.name]));
  let nextIssue = 100;
  let nextLink = 30001;
  // Every request a writer received, in order, including ones that then failed.
  const calls: Request[] = [];
  const hooks: {
    // Runs before a request lands; a promise that never settles is a crash.
    before?: (request: Request, call: number) => Promise<void> | void;
    // Runs after a request has landed, before the writer answers.
    after?: (request: Request, call: number) => Promise<void> | void;
    read?: (id: ItemId) => Promise<void> | void;
  } = {};

  const find = (id: string): MemoryIssue | null => {
    const parsed = parseItemId(id);
    return parsed?.source === "jira" ? (issues.get(parsed.key) ?? null) : null;
  };
  const values = (issue: MemoryIssue): Record<string, unknown> => ({
    summary: issue.summary,
    description: issue.description,
    points: issue.points,
    accountId: issue.accountId,
    epic: issue.epic,
    ...Object.fromEntries(
      issue.links.map((l) => [`link:${l.linkId}`, { url: l.url, title: l.title }]),
    ),
  });
  const pick = (issue: MemoryIssue, fields: readonly string[]): FieldValues => {
    const all = values(issue);
    return Object.fromEntries(fields.map((f) => [f, Object.hasOwn(all, f) ? all[f] : null]));
  };
  const handle = (issue: MemoryIssue) => ({ id: `jira:${issue.key}` as const, stableId: issue.id });

  const land = (request: Request): WriteResult<"jira"> => {
    if (!isJiraOp(request.op)) throw new Error(`unknown op ${request.op}`);
    if (request.op === "createStory") {
      const args = jiraOps.createStory(request.args);
      if (!args.ok) throw new Error("bad createStory arguments");
      const issue: MemoryIssue = {
        key: `${start.project}-${nextIssue}`,
        id: String(10000 + nextIssue),
        summary: args.value.summary,
        description: args.value.description ?? "",
        points: args.value.points ?? null,
        accountId: null,
        epic: args.value.epic !== null && isItemId(args.value.epic) ? args.value.epic : null,
        links: [],
      };
      nextIssue += 1;
      issues.set(issue.key, issue);
      return {
        item: handle(issue),
        before: {},
        after: pick(issue, ["summary", "description", "points", "epic"]),
      };
    }
    const issue = request.target === null ? null : find(request.target);
    if (!issue)
      throw new Error(
        `Issue does not exist or you do not have permission to see it: ${request.target}`,
      );
    const set = <F extends "summary" | "description" | "points" | "accountId">(
      field: F,
      value: MemoryIssue[F],
    ) => {
      const before = pick(issue, [field]);
      issue[field] = value;
      return { item: handle(issue), before, after: pick(issue, [field]) };
    };
    switch (request.op) {
      case "setSummary": {
        const a = jiraOps.setSummary(request.args);
        if (!a.ok) throw new Error("bad arguments");
        return set("summary", a.value.summary);
      }
      case "setDescription": {
        const a = jiraOps.setDescription(request.args);
        if (!a.ok) throw new Error("bad arguments");
        return set("description", a.value.description);
      }
      case "setEstimate": {
        const a = jiraOps.setEstimate(request.args);
        if (!a.ok) throw new Error("bad arguments");
        return set("points", a.value.points);
      }
      case "setAssignee": {
        const a = jiraOps.setAssignee(request.args);
        if (!a.ok) throw new Error("bad arguments");
        return set("accountId", a.value.accountId);
      }
      case "addLink": {
        const a = jiraOps.addLink(request.args);
        if (!a.ok) throw new Error("bad arguments");
        const field = `link:${nextLink}`;
        issue.links.push({ linkId: String(nextLink), url: a.value.url, title: a.value.title });
        nextLink += 1;
        return { item: handle(issue), before: { [field]: null }, after: pick(issue, [field]) };
      }
      case "removeLink": {
        const a = jiraOps.removeLink(request.args);
        if (!a.ok) throw new Error("bad arguments");
        const field = `link:${a.value.linkId}`;
        const before = pick(issue, [field]);
        if (before[field] === null) throw new Error(`no link ${a.value.linkId}`);
        issue.links = issue.links.filter((l) => l.linkId !== a.value.linkId);
        return { item: handle(issue), before, after: { [field]: null } };
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
      const result = land(plain);
      await hooks.after?.(plain, calls.length);
      return result;
    },
    current,
  };

  const reader: Reader<"jira"> = {
    current,
    person: async (accountId) => people.get(accountId) ?? null,
  };

  return {
    writer,
    reader,
    calls,
    hooks,
    issue: (key: string): MemoryIssue | null => structuredClone(issues.get(key) ?? null),
    // An edit someone makes directly in Jira, outside Oriel.
    edit(
      key: string,
      change: Partial<Pick<MemoryIssue, "summary" | "description" | "points" | "accountId">>,
    ) {
      const issue = issues.get(key);
      if (!issue) throw new Error(`no issue ${key}`);
      Object.assign(issue, change);
    },
  };
}

export const t0 = instant(new Date(Date.UTC(2026, 9, 29, 9, 0, 0)));

// A fresh in-memory database with a workspace, region, thread and run, Jira in
// memory, and a clock the test moves by hand.
export function setup() {
  const db = open(":memory:");
  migrate(db, loadMigrations(), t0);
  const ms = Date.parse(t0);
  const workspaceId = ulid(ms);
  const regionId = ulid(ms);
  const threadId = ulid(ms);
  const runId = ulid(ms);
  ensureWorkspace(db, { id: workspaceId, name: "test" }, t0);
  db.prepare(
    "insert into regions (id, workspace_id, origin, snapshot, created_at) values (?, ?, ?, 1, ?)",
  ).run(regionId, workspaceId, JSON.stringify({ kind: "picked" }), t0);
  db.prepare(
    "insert into threads (id, workspace_id, region_id, created_at) values (?, ?, ?, ?)",
  ).run(threadId, workspaceId, regionId, t0);
  db.prepare(`
    insert into runs (id, workspace_id, thread_id, snapshot, system_prompt_hash, dts_hash, model,
      input_tokens, output_tokens, wall_ms, outcome, started_at)
    values (?, ?, ?, 1, 'p', 'd', 'model', 0, 0, 0, 'ok', ?)`).run(
    runId,
    workspaceId,
    threadId,
    t0,
  );

  const jira = memoryJira(snapshot());
  let now: Instant = t0;
  const events: TelemetryEvent[] = [];
  // Another instance over the same database, as after a restart.
  const instance = (writer: SourceWriter<"jira"> = jira.writer): ChangeSets =>
    changeSets({
      db,
      sources: { jira: { writer, reader: jira.reader } },
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
    changeSets: instance(),
    instance,
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
