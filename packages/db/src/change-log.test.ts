import assert from "node:assert/strict";
import { test } from "node:test";
import {
  type DeclaredFacets,
  type Facets,
  type IndexRecord,
  type Instant,
  instant,
  nullable,
  number,
  object,
  ulid,
} from "@oriel/core";
import { indexStore } from "./index-store.ts";
import { loadMigrations, migrate } from "./migrate.ts";
import { open } from "./open.ts";
import { ensureWorkspace, lastSeen, markSeen } from "./workspaces.ts";

const day = 86_400_000;
const t0 = instant(new Date(Date.UTC(2026, 9, 29, 9)));
const later = (days: number) => instant(new Date(Date.parse(t0) + days * day));
const attrs = object({ size: nullable(number) });
const declared: DeclaredFacets = {
  size: { label: "Size", of: (record) => (record.attrs as { size: number | null }).size },
};

function fresh() {
  const db = open(":memory:");
  migrate(db, loadMigrations(), t0);
  const workspaceId = ulid(0, new Uint8Array(10));
  ensureWorkspace(db, { id: workspaceId, name: "test" }, t0);
  const index = indexStore(db);
  const sync = (records: IndexRecord<"jira">[], now: Instant, gone: string[] = []) => {
    const run = index.beginSync(workspaceId, "jira", attrs, now, declared);
    run.apply({ records, gone, cursor: null });
    return run.finish(null, now);
  };
  return { db, index, workspaceId, sync };
}

function record(
  stableId: string,
  key: string,
  facets: Facets,
  size: number | null = null,
): IndexRecord<"jira"> {
  return {
    id: `jira:${key}`,
    stableId,
    title: `Title of ${key}`,
    location: `https://oriel.atlassian.net/browse/${key}`,
    updatedAt: t0,
    facets,
    attrs: { size },
  };
}

test("an entry is in the same transaction as the page that made it", () => {
  const { index, workspaceId, sync } = fresh();
  sync([record("1", "SYN-1", { state: "todo" }), record("2", "SYN-2", {})], t0);
  const failing: DeclaredFacets = {
    size: {
      label: "Size",
      of: (r) => {
        if (r.stableId === "2") throw new Error("the page fails here");
        return null;
      },
    },
  };
  const run = index.beginSync(workspaceId, "jira", attrs, later(1), failing);
  assert.throws(
    () =>
      run.apply({
        records: [record("1", "SYN-1", { state: "done" }), record("2", "SYN-2", {})],
        gone: [],
        cursor: null,
      }),
    /the page fails here/,
  );
  assert.deepEqual(index.changes(workspaceId), []);
  assert.deepEqual(
    index.records(workspaceId, "jira", attrs).map((r) => r.facets.state),
    ["todo", undefined],
  );
});

test("what the user hasn't seen is what committed after the entry the overview they left showed", () => {
  const { db, index, workspaceId, sync } = fresh();
  assert.equal(lastSeen(db, workspaceId), null);
  sync([record("1", "SYN-1", { state: "todo" })], t0);
  sync([record("1", "SYN-1", { state: "in-progress" })], later(1));
  const shown = index.changes(workspaceId).at(-1)?.seq ?? 0;
  const run = index.beginSync(workspaceId, "jira", attrs, later(2), declared);
  markSeen(db, workspaceId, later(3), shown);
  run.apply({ records: [record("1", "SYN-1", { state: "done" })], gone: [], cursor: null });
  run.finish(null, later(4));
  const seen = lastSeen(db, workspaceId);
  assert.equal(seen?.at, later(3));
  assert.deepEqual(
    index.changes(workspaceId, seen?.seq).map((entry) => entry.facets.state?.after),
    ["done"],
  );
  markSeen(db, workspaceId, later(1), 0);
  assert.equal(lastSeen(db, workspaceId)?.at, later(3));
  assert.equal(lastSeen(db, workspaceId)?.seq, seen?.seq);
  markSeen(db, workspaceId, later(5), Number.MAX_SAFE_INTEGER);
  assert.equal(lastSeen(db, workspaceId)?.at, later(5));
  assert.deepEqual(index.changes(workspaceId, lastSeen(db, workspaceId)?.seq), []);
});

test("once a prune empties the change log, what changes next is still unseen", () => {
  const { db, index, workspaceId, sync } = fresh();
  sync([record("1", "SYN-1", { state: "todo" })], t0);
  sync([record("1", "SYN-1", { state: "done" })], later(1));
  markSeen(db, workspaceId, later(2), index.changes(workspaceId).at(-1)?.seq ?? 0);
  sync([record("1", "SYN-1", { state: "done" })], later(100));
  assert.deepEqual(index.changes(workspaceId), []);
  sync([record("1", "SYN-1", { state: "todo" })], later(101));
  assert.deepEqual(
    index.changes(workspaceId, lastSeen(db, workspaceId)?.seq).map((e) => e.at),
    [later(101)],
  );
});
