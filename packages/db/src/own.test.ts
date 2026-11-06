import assert from "node:assert/strict";
import { test } from "node:test";
import {
  type DeclaredFacets,
  type IndexRecord,
  instant,
  issueDeclaredFacets,
  ulid,
  unknown,
} from "@oriel/core";
import { indexStore } from "./index-store.ts";
import { loadMigrations, migrate } from "./migrate.ts";
import { open, transaction } from "./open.ts";
import { ensureWorkspace } from "./workspaces.ts";

const t0 = instant(new Date(Date.UTC(2026, 10, 6, 9)));
const t1 = instant(new Date(Date.UTC(2026, 10, 6, 10)));

function fresh(declared: DeclaredFacets = issueDeclaredFacets) {
  const db = open(":memory:");
  migrate(db, loadMigrations(), t0);
  const workspaceId = ulid(0, new Uint8Array(10));
  ensureWorkspace(db, { id: workspaceId, name: "test" }, t0);
  const index = indexStore(db);
  return { db, index, workspaceId, own: index.own(workspaceId, "tracker", unknown, declared) };
}

const issue = (n: number, estimate: number | null, at = t0): IndexRecord => ({
  id: `tracker:T-${n}`,
  stableId: String(n),
  title: `Story ${n}`,
  location: `/browse?item=tracker%3AT-${n}`,
  updatedAt: at,
  facets: { state: "todo", kind: "story", estimate },
  attrs: { issueType: "Story", status: "To do", labels: [] },
});

test("migration 0030 keeps a stand-in's content as JSON beside its index rows", () => {
  const { db, workspaceId } = fresh();
  assert.throws(
    () =>
      db
        .prepare(
          "insert into own_items (workspace_id, source, stable_id, content) values (?, ?, ?, ?)",
        )
        .run(workspaceId, "tracker", "1", "not json"),
    /CHECK constraint failed/,
  );
});

test("a stand-in's write lands its rows, their text, content and change log at once, as one snapshot", () => {
  const { index, workspaceId, own } = fresh();
  const first = own.write(
    { records: [issue(1, null)], gone: [], texts: { "1": "Story 1\n\nThe pricing page" } },
    { "1": { description: "The pricing page" } },
    t0,
  );
  assert.equal(first, 1);
  assert.deepEqual(
    index.records(workspaceId, "tracker", unknown).map((r) => r.id),
    ["tracker:T-1"],
  );
  assert.deepEqual(own.content("1"), { description: "The pricing page" });
  assert.equal(index.search(workspaceId, "pricing", 5)[0]?.id, "tracker:T-1");
  // An estimate set: the change log has it, in the version the write took.
  assert.equal(own.write({ records: [issue(1, 3, t1)], gone: [], texts: {} }, {}, t1), 2);
  assert.deepEqual(
    index
      .changes(workspaceId)
      .map(({ stableId, version, facets }) => ({ stableId, version, facets })),
    [{ stableId: "1", version: 2, facets: { declared: { estimate: { before: null, after: 3 } } } }],
  );
  // Deleted: its row is a tombstone, its content goes, and its key stays taken.
  own.write({ records: [], gone: ["1"], texts: {} }, {}, t1);
  assert.deepEqual(index.records(workspaceId, "tracker", unknown), []);
  assert.equal(own.content("1"), null);
  assert.deepEqual(own.keys(), ["T-1"]);
});

test("a stand-in's write that fails partway leaves nothing of it", () => {
  const failing: DeclaredFacets = {
    estimate: {
      label: "Estimate",
      of: (record) => {
        if (record.facets.estimate === 5) throw new Error("fails here");
        return record.facets.estimate ?? null;
      },
    },
  };
  const { index, workspaceId, own } = fresh(failing);
  own.write({ records: [issue(1, null)], gone: [], texts: {} }, { "1": { description: "" } }, t0);
  assert.throws(
    () =>
      own.write(
        { records: [issue(2, null), issue(1, 5, t1)], gone: [], texts: {} },
        { "2": { description: "new" } },
        t1,
      ),
    /fails here/,
  );
  assert.deepEqual(
    index.records(workspaceId, "tracker", unknown).map((r) => r.id),
    ["tracker:T-1"],
  );
  assert.equal(own.content("2"), null);
  assert.equal(index.snapshot(workspaceId), 1);
});

test("a transaction inside another is part of it, which rolls back all", () => {
  const { db, workspaceId } = fresh();
  const insert = db.prepare(
    "insert into own_items (workspace_id, source, stable_id, content) values (?, 'tracker', ?, '{}')",
  );
  assert.throws(() =>
    transaction(db, () => {
      transaction(db, () => insert.run(workspaceId, "1"));
      throw new Error("then this fails");
    }),
  );
  assert.equal(db.prepare("select count(*) as n from own_items").get()?.n, 0);
});
