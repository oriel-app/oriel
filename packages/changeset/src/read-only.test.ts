import assert from "node:assert/strict";
import { test } from "node:test";
import { changeSets } from "./change-sets.ts";
import { approve, nth, setup, specs } from "./testing.ts";

// Change sets with no writer config: Jira is read through the reader the
// composition root passes, as when Oriel runs on the fixture.
function readOnly() {
  const fixture = setup();
  const sets = changeSets({
    db: fixture.db,
    writerConfig: {},
    readers: { jira: fixture.jira.reader },
    specs,
    reviewBase: new URL("http://localhost:4000/review/"),
    now: () => "2026-10-29T09:00:00.000Z" as never,
    emit: (event) => fixture.events.push(event),
    log: () => {},
  });
  return { ...fixture, sets };
}

const estimate = (key: string, points: number) => ({
  op: "setEstimate",
  target: `jira:${key}` as const,
  ref: null,
  args: { points },
});

test("without writer config a change set is captured and diffed, but approving is refused", async () => {
  const { sets, run, jira } = readOnly();
  const set = await sets.capture(run, [estimate("SYN-3", 5)]);
  const diff = await sets.diff(set.id);
  assert.equal(diff.lines.length, 1);
  assert.deepEqual(nth(diff.lines, 0).fields, [
    { name: "points", before: jira.issue("SYN-3")?.points ?? null, after: 5 },
  ]);
  await assert.rejects(approve(sets, set.id), {
    name: "ChangeSetError",
    code: "read-only",
    message: /Writing to Jira isn't configured here/,
  });
  assert.equal((await sets.get(set.id))?.decision, null);
  await assert.rejects(sets.apply(set.id), { code: "read-only" });
  assert.deepEqual(jira.calls, []);
});

test("without writer config a change set can still be edited and rejected", async () => {
  const { sets, run } = readOnly();
  const set = await sets.capture(run, [estimate("SYN-3", 5), estimate("SYN-8", 2)]);
  const edited = await sets.edit(set.id, { remove: [nth(set.mutations, 0).id] });
  assert.equal(edited.mutations.length, 1);
  const diff = await sets.diff(set.id);
  const rejected = await sets.decide(set.id, "rejected", { via: "thread", by: "pm" }, diff.hash);
  assert.equal(rejected.decision?.kind, "rejected");
});

test("a thread's change sets read back in order, without touching the source", async () => {
  const { sets, run, jira } = readOnly();
  const first = await sets.capture(run, [estimate("SYN-3", 5)]);
  const second = await sets.capture(run, [estimate("SYN-8", 2)]);
  const reads = jira.calls.length;
  assert.deepEqual(
    (await sets.ofThread(run.threadId)).map((s) => s.id),
    [first.id, second.id],
  );
  assert.equal((await sets.get(second.id))?.mutations.length, 1);
  assert.equal(await sets.get(run.id), null);
  assert.deepEqual(await sets.ofThread(run.id), []);
  assert.equal(jira.calls.length, reads);
});
