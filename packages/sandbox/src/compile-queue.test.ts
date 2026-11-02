// The compile queue, apart from sandbox.test.ts: the test waits out a slow
// compile's deadline, so it waits in parallel with that file's.
import assert from "node:assert/strict";
import { test } from "node:test";
import { fakeBindings } from "./fake-bindings.ts";
import { createSandbox } from "./sandbox.ts";
import { limits, slowTypes } from "./testing.ts";

test("an abort while queued behind a slow compile rejects at once and starts no tsc", async () => {
  const box = createSandbox({ now: () => 0, maxRssMb: 4096 });
  const slow = box.run(slowTypes, fakeBindings(), {
    limits: { ...limits, wallMs: 3_000 },
    signal: new AbortController().signal,
    log: () => {},
  });
  const controller = new AbortController();
  const queuedLog: string[] = [];
  const queued = box.run(`return 1;`, fakeBindings(), {
    limits,
    signal: controller.signal,
    log: (message) => queuedLog.push(message),
  });
  controller.abort(new Error("not needed"));
  const first = await Promise.race([
    queued.then(
      () => "queued resolved",
      () => "queued rejected",
    ),
    slow.then(() => "slow settled"),
  ]);
  assert.equal(first, "queued rejected");
  await assert.rejects(queued, /not needed/);
  assert.equal((await slow).outcome, "timeout");
  assert.deepEqual(queuedLog, []);
});
