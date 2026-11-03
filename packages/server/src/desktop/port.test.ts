import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { keepPort, keptPort, portsFrom } from "./port.ts";

test("a folder keeps its port, and has none before the first launch", (t) => {
  const data = mkdtempSync(join(tmpdir(), "oriel-port-"));
  t.after(() => rmSync(data, { recursive: true, force: true }));
  assert.equal(keptPort(data), null);
  keepPort(data, 4321);
  assert.equal(keptPort(data), 4321);
  keepPort(data, 4325);
  assert.equal(keptPort(data), 4325);
});

test("a port file that doesn't hold a port counts as none", (t) => {
  const data = mkdtempSync(join(tmpdir(), "oriel-port-"));
  t.after(() => rmSync(data, { recursive: true, force: true }));
  for (const text of ["", "port", "0", "65536", "-1", "43.5", "4320 4321"]) {
    writeFileSync(join(data, "port"), text);
    assert.equal(keptPort(data), null, text);
  }
});

test("the ports tried go upward from the kept one, and stop at the last port", () => {
  const from = portsFrom(4320);
  assert.deepEqual(from.slice(0, 3), [4320, 4321, 4322]);
  assert.equal(from.length, 101);
  assert.equal(portsFrom(65_530).at(-1), 65_535);
  assert.deepEqual(portsFrom(0), [0]);
});
