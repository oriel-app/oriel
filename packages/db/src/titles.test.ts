import assert from "node:assert/strict";
import { test } from "node:test";
import { instant, type Ulid, ulid } from "@oriel/core";
import { groupStore } from "./groups.ts";
import { loadMigrations, migrate } from "./migrate.ts";
import { open } from "./open.ts";
import { threadStore } from "./threads.ts";
import { ensureWorkspace } from "./workspaces.ts";

const t0 = instant(new Date(Date.UTC(2026, 9, 31, 9)));
const id = (n: number): Ulid => ulid(n, new Uint8Array(10));

test("a thread has no title until one is written, and a later one replaces it", () => {
  const db = open(":memory:");
  migrate(db, loadMigrations(), t0);
  const workspaceId = id(0);
  ensureWorkspace(db, { id: workspaceId, name: "test" }, t0);
  groupStore(db).create(
    { id: id(1), workspaceId, name: "Checkout", origin: { kind: "picked" } },
    [],
    t0,
  );
  const threads = threadStore(db);
  threads.open({ id: id(2), workspaceId, groupId: id(1) }, t0);
  assert.equal(threads.title(id(2)), null);
  threads.setTitle(id(2), "Unowned checkout stories", t0);
  assert.equal(threads.title(id(2)), "Unowned checkout stories");
  threads.setTitle(id(2), "Checkout owners", t0);
  assert.equal(threads.title(id(2)), "Checkout owners");
  assert.throws(() => threads.setTitle(id(9), "Nothing", t0), /no thread/);
  assert.equal(threads.title(id(9)), null);
});
