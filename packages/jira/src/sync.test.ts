import assert from "node:assert/strict";
import { test } from "node:test";
import {
  type IndexRecord,
  type Instant,
  instant,
  type Log,
  type Source,
  type SyncPage,
  syncSource,
  ulid,
} from "@oriel/core";
import { ensureWorkspace, indexStore, loadMigrations, migrate, open } from "@oriel/db";
import { jiraAttrs, jiraKeyShape } from "./attrs.ts";
import { fixtureSnapshot, loadJiraFixture } from "./fixture.ts";
import { fixtureSource } from "./fixture-source.ts";

const fixture = loadJiraFixture();
const site = "https://oriel.atlassian.net";
const allEdits = fixture.edits.length;
const t0 = instant(new Date(Date.UTC(2026, 9, 29, 9)));
const t1 = instant(new Date(Date.UTC(2026, 9, 29, 10)));
const deleted = fixture.edits.find((e) => e.kind === "delete");
const deletedId = fixture.issues.find((issue) => issue.key === deleted?.key)?.id ?? "";

function fresh() {
  const db = open(":memory:");
  migrate(db, loadMigrations(), t0);
  const workspaceId = ulid(0, new Uint8Array(10));
  ensureWorkspace(db, { id: workspaceId, name: "test" }, t0);
  const index = indexStore(db);
  const lines: { message: string; fields?: Record<string, unknown> }[] = [];
  const log: Log = (message, fields) => lines.push({ message, ...(fields ? { fields } : {}) });
  const sync = (source: Source<"jira", unknown>, full = false, now: Instant = t1) =>
    syncSource({
      source,
      attrs: jiraAttrs,
      key: jiraKeyShape,
      index,
      workspaceId,
      full,
      clock: () => now,
      log,
    });
  const live = () => index.records(workspaceId, "jira", jiraAttrs);
  return { index, workspaceId, lines, sync, live };
}

const byId = <R extends { id: string }>(records: R[]) =>
  records.toSorted((a, b) => a.id.localeCompare(b.id));

// Passes the fixture source's pages through `change`, and keeps each cursor it was asked for.
function wrapped(
  edited: number,
  change: (page: SyncPage<"jira", unknown>, at: number) => SyncPage<"jira", unknown> | "throw",
) {
  const inner = fixtureSource(fixture, { site, edited, pageSize: 40 });
  const cursors: (string | null)[] = [];
  const source: Source<"jira", unknown> = {
    kind: "jira",
    read: inner.read,
    async *sync(cursor) {
      cursors.push(cursor);
      let at = 0;
      for await (const page of inner.sync(cursor)) {
        const next = change(page, at++);
        if (next === "throw") throw new Error("the source went away");
        yield next;
      }
    },
  };
  return { source, cursors };
}

test("a malformed record is skipped and logged, its page still lands, and a sweep keeps it", async () => {
  const { sync, live, lines } = fresh();
  await sync(fixtureSource(fixture, { site, edited: 0 }));
  const before = live();
  const victim = before[0]?.id;
  const { source } = wrapped(0, (page) => ({
    ...page,
    records: page.records.map((record) => {
      if (record.id !== victim) return record;
      return { ...record, attrs: { ...(record.attrs as object), labels: "payments" } };
    }),
  }));
  const report = await sync(source, true);
  assert.equal(report.skipped, 1);
  assert.equal(report.gone, 0);
  assert.deepEqual(byId(live()), byId(before));
  const line = lines.find((l) => l.fields?.stableId === before[0]?.stableId);
  assert.match(String(line?.fields?.problem), /\$\.attrs\.labels/);
});

test("records with a foreign ID, a bad time or no stable ID are skipped too", async () => {
  const { sync, live } = fresh();
  const { source } = wrapped(0, (page, at) => {
    if (at > 0) return page;
    const [a, b, c, ...rest] = page.records;
    assert.ok(a && b && c);
    return {
      ...page,
      records: [
        { ...a, id: "jira:not a key" },
        { ...b, updatedAt: "2026-10-01" as Instant },
        { ...c, stableId: "" },
        ...rest,
      ],
    };
  });
  const report = await sync(source);
  assert.equal(report.skipped, 3);
  assert.equal(live().length, fixtureSnapshot(fixture, site, 0).records.length - 3);
});

test("a source that fails partway marks nothing gone, and the next sync reclaims its pages", async () => {
  const { sync, index, workspaceId } = fresh();
  await sync(fixtureSource(fixture, { site, edited: 0 }));
  const { source } = wrapped(allEdits, (page, at) => (at === 0 ? page : "throw"));
  await assert.rejects(sync(source, true), /went away/);
  assert.equal(index.snapshot(workspaceId), 1);
  assert.ok(index.liveStableIds(workspaceId, "jira").includes(deletedId));
  const report = await sync(fixtureSource(fixture, { site, edited: allEdits }), true);
  assert.equal(report.version, 2);
  assert.ok(!index.liveStableIds(workspaceId, "jira").includes(deletedId));
});

// A record the fixture doesn't have, as a change set might create it, updated
// after everything else.
const created = (() => {
  const base = fixtureSnapshot(fixture, site, 0).records.find((r) => r.facets.kind === "story");
  assert.ok(base);
  return {
    ...structuredClone(base),
    id: "jira:SYN-900" as const,
    stableId: "20900",
    title: "Tap to pay",
    location: `${site}/browse/SYN-900`,
    updatedAt: instant(new Date(Date.UTC(2026, 9, 30, 9))),
  };
})();

// The fixture's listing, as Jira's search answers before it catches up with
// a write; reading by key answers from `byKey`.
function lagging(edited: number, byKey: Map<string, IndexRecord<"jira", unknown>>) {
  const { source, cursors } = wrapped(edited, (page) => page);
  const asked: string[][] = [];
  const records: Source<"jira", unknown>["records"] = async (ids) => {
    asked.push([...ids]);
    return {
      records: ids.flatMap((id) => byKey.get(id) ?? []),
      gone: ids.filter((id) => !byKey.has(id)),
    };
  };
  return { source: { ...source, records }, cursors, asked };
}

test("items read one by one land over a listing that lags: a new one shows, a deleted one goes", async () => {
  const { sync, live, index, workspaceId } = fresh();
  await sync(fixtureSource(fixture, { site, edited: 0 }));
  const cursor = index.source(workspaceId, "jira")?.cursor;
  // The listing still has this one, which a change set has just deleted.
  const removed = live().find((r) => r.facets.kind === "story");
  assert.ok(removed);
  const { source, asked } = lagging(0, new Map([[created.id, created]]));
  const report = await syncSource({
    source,
    attrs: jiraAttrs,
    key: jiraKeyShape,
    index,
    workspaceId,
    full: false,
    items: [
      { id: created.id, stableId: created.stableId },
      { id: removed.id, stableId: removed.stableId },
    ],
    clock: () => t1,
    log: () => {},
  });
  assert.deepEqual(asked, [[created.id, removed.id]]);
  assert.deepEqual([report.version, report.gone], [2, 1]);
  assert.deepEqual(
    live().find((r) => r.id === created.id),
    created,
  );
  assert.ok(!live().some((r) => r.id === removed.id));
  // The cursor stays where the listing left it, not at the newer item read by key.
  assert.equal(index.source(workspaceId, "jira")?.cursor, cursor);
});

test("a full sweep keeps an item read by itself that the listing doesn't have yet", async () => {
  const { index, workspaceId, live } = fresh();
  const { source } = lagging(0, new Map([[created.id, created]]));
  const report = await syncSource({
    source,
    attrs: jiraAttrs,
    key: jiraKeyShape,
    index,
    workspaceId,
    full: true,
    items: [{ id: created.id, stableId: created.stableId }],
    clock: () => t1,
    log: () => {},
  });
  assert.equal(report.gone, 0);
  assert.equal(live().length, fixtureSnapshot(fixture, site, 0).records.length + 1);
});

test("what a sweep wrongly held as gone comes back once the source has it by key", async () => {
  const { live, workspaceId, index } = fresh();
  // A listing that lags a write doesn't have the new item yet, so the
  // sweep marks it gone; a later listing returns it, and its key reads.
  const behind = fixtureSnapshot(fixture, site, 0).records.at(-1);
  assert.ok(behind);
  const { source: missing } = wrapped(0, (page) => ({
    ...page,
    records: page.records.filter((r) => r.stableId !== behind.stableId),
  }));
  const options = {
    attrs: jiraAttrs,
    key: jiraKeyShape,
    index,
    workspaceId,
    clock: () => t1,
    log: () => {},
  };
  await syncSource({ ...options, source: fixtureSource(fixture, { site, edited: 0 }), full: true });
  await syncSource({ ...options, source: missing, full: true });
  assert.ok(!index.liveStableIds(workspaceId, "jira").includes(behind.stableId));
  const { source } = lagging(0, new Map([[behind.id, behind]]));
  await syncSource({ ...options, source, full: true });
  assert.deepEqual(
    live().find((r) => r.stableId === behind.stableId),
    behind,
  );
});
