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
    writerConfig: [],
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
  });
  assert.equal((await sets.get(set.id))?.decision, null);
  await assert.rejects(sets.apply(set.id), { code: "read-only" });
  assert.deepEqual(jira.calls, []);
});
