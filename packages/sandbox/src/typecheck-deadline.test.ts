// The typecheck's deadline, apart from sandbox.test.ts: the test waits it
// out, so it waits in parallel with that file's.
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fakeBindings } from "./fake-bindings.ts";
import { createSandbox } from "./sandbox.ts";
import { errorOf, exists, limits, type Logged, slowTypes, tscPid } from "./testing.ts";

test("types that keep tsc busy end at the deadline, with no tsc or temp directory left", async (t) => {
  const tmp = mkdtempSync(join(tmpdir(), "oriel-tsc-"));
  t.after(() => rmSync(tmp, { recursive: true, force: true }));
  // A high memory cap, so the deadline is what stops tsc here.
  const box = createSandbox({ now: () => 0, tmpDir: tmp, maxRssMb: 4096 });
  const logged: Logged[] = [];
  const log = (message: string, fields?: Record<string, unknown>) =>
    logged.push({ message, fields });
  const signal = new AbortController().signal;
  const result = await box.run(slowTypes, fakeBindings(), {
    limits: { ...limits, wallMs: 2_000 },
    signal,
    log,
  });
  assert.equal(result.outcome, "timeout");
  const error = errorOf(result.transcript.at(-1));
  assert.equal(error.phase, "limit");
  assert.match(error.message, /typecheck took longer than|while its types were checked/);
  assert.equal(exists(tscPid(logged)), false);
  assert.deepEqual(readdirSync(tmp), []);
  const next = await box.run(`return 1;`, fakeBindings(), { limits, signal, log: () => {} });
  assert.deepEqual(next.transcript, [{ kind: "return", value: 1 }]);
});
