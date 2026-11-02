// The run's wall-time cap, apart from sandbox.test.ts: each test here waits
// the cap out, so they wait in parallel with that file's.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { Bindings } from "@oriel/core";
import { fakeBindings } from "./fake-bindings.ts";
import { createSandbox } from "./sandbox.ts";
import { runner } from "./testing.ts";

// Time is passed in: every duration comes out as 0.
const go = runner(createSandbox({ now: () => 0 }));

test("the wall-time kill comes back as a clean limit error that names the cap", async () => {
  const { result } = await go(`for (;;) {}`, { wallMs: 1_000 });
  assert.equal(result.outcome, "timeout");
  assert.deepEqual(result.transcript, [
    {
      kind: "error",
      error: {
        phase: "limit",
        message: "the run passed its wall time of 1000 ms and was stopped",
        hint: "Look for a loop that never ends or a promise that never settles, and do less per run.",
        logs: [],
      },
    },
  ]);
});

test("reads still out when a run ends are logged as unanswered, and a late answer is ignored", async () => {
  const base = fakeBindings();
  let answer = () => {};
  const bindings: Bindings = {
    ...base,
    read: (fn, args) =>
      fn === "jira.hold"
        ? new Promise(
            (resolve) => (answer = () => resolve({ value: "late", outsideRegion: false })),
          )
        : base.read(fn, args),
  };
  const { result, logged } = await go(
    `await jira.listStories();\nawait jira.hold();`,
    { wallMs: 1_000 },
    bindings,
  );
  assert.equal(result.outcome, "timeout");
  const lines = () =>
    logged
      .filter((line) => line.message !== "sandbox.typecheck")
      .map((line) => [line.message, line.fields?.["status"] ?? line.fields?.["outcome"]]);
  const expected = [
    ["sandbox.read", "answered"],
    ["sandbox.read", "unanswered"],
    ["sandbox.run", "timeout"],
  ];
  assert.deepEqual(lines(), expected);
  answer();
  // Let the late answer land, then check nothing came of it.
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(lines(), expected);
  assert.deepEqual(
    result.reads.map((read) => [read.fn, read.status, read.payloadHash === null]),
    [
      ["jira.listStories", "answered", false],
      ["jira.hold", "unanswered", true],
    ],
  );
});
