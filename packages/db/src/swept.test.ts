// A source that reads only the parts of it that moved, such as a
// spreadsheet's tabs, says which parts a sync listed in full and which it
// couldn't read, and the sync worker marks gone only what it should.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  type IndexRecord,
  instant,
  type Source,
  type SyncPage,
  syncSource,
  ulid,
  unknown,
} from "@oriel/core";
import { indexStore } from "./index-store.ts";
import { loadMigrations, migrate } from "./migrate.ts";
import { open } from "./open.ts";
import { ensureWorkspace } from "./workspaces.ts";

const t0 = instant(new Date(Date.UTC(2026, 10, 3, 9)));

const row = (stableId: string): IndexRecord<"memo"> => ({
  id: `memo:${stableId.replaceAll("/", "-")}`,
  stableId,
  title: stableId,
  location: "https://example.com/",
  updatedAt: t0,
  facets: {},
  attrs: {},
});

function fresh() {
  const db = open(":memory:");
  migrate(db, loadMigrations(), t0);
  const workspaceId = ulid(0, new Uint8Array(10));
  ensureWorkspace(db, { id: workspaceId, name: "test" }, t0);
  const index = indexStore(db);
  const sync = (page: Omit<SyncPage<"memo">, "gone">, full: boolean) => {
    const source: Source<"memo"> = {
      kind: "memo",
      read: async () => [],
      async *sync() {
        yield { gone: [], ...page };
      },
    };
    return syncSource({
      source,
      attrs: unknown,
      key: /^[a-z0-9-]+$/,
      index,
      workspaceId,
      full,
      clock: () => t0,
      log: () => {},
    });
  };
  const live = () => index.liveStableIds(workspaceId, "memo").toSorted();
  return { sync, live };
}

test("a part listed in full loses what it no longer has; the rest stays", async () => {
  const { sync, live } = fresh();
  await sync({ records: ["a/1", "a/2", "b/1"].map(row), cursor: "v1" }, true);
  const report = await sync({ records: [row("a/1")], cursor: "v2", swept: ["a/"] }, false);
  assert.equal(report.gone, 1);
  assert.deepEqual(live(), ["a/1", "b/1"]);
});

test("a part listed in full with nothing in it loses everything under it", async () => {
  const { sync, live } = fresh();
  await sync({ records: ["a/1", "a/2", "b/1"].map(row), cursor: "v1" }, true);
  await sync({ records: [], cursor: "v2", swept: ["a/"] }, false);
  assert.deepEqual(live(), ["b/1"]);
});

test("without parts, a sync that isn't a full sweep marks nothing gone", async () => {
  const { sync, live } = fresh();
  await sync({ records: ["a/1", "a/2"].map(row), cursor: "v1" }, true);
  await sync({ records: [], cursor: "v2" }, false);
  assert.deepEqual(live(), ["a/1", "a/2"]);
});

test("a part the source couldn't read keeps its items, even in a full sweep", async () => {
  const { sync, live } = fresh();
  await sync({ records: ["a/1", "a/2", "b/1"].map(row), cursor: "v1" }, true);
  await sync({ records: [row("a/1")], cursor: null, held: ["b/"] }, true);
  assert.deepEqual(live(), ["a/1", "b/1"]);
  await sync({ records: [], cursor: "v3", swept: ["a/", "b/"], held: ["b/"] }, false);
  assert.deepEqual(live(), ["b/1"]);
});
