import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { open } from "./open.ts";

test("a database opened exclusively can't be opened again until it closes", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "oriel-open-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, "oriel.db");
  const first = open(path, { exclusive: true });
  first.exec("create table kept (x)");
  assert.throws(() => open(path, { exclusive: true }), /locked/);
  assert.equal(first.prepare("pragma journal_mode").get()?.journal_mode, "wal");
  first.close();
  const again = open(path, { exclusive: true });
  assert.equal(again.prepare("select count(*) as n from kept").get()?.n, 0);
  again.close();
});
