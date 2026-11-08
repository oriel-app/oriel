// Adding a second look's suggested change to a change set (the challenger
// spike): checked as a capture is, against the region its run used, only
// while nobody has decided on it and nothing of it has applied, never past
// the most changes a change set may hold, and voiding nothing a person saw:
// the hash changes, so approval needs the new diff.
import assert from "node:assert/strict";
import { test } from "node:test";
import { ChangeSetError } from "./change-sets.ts";
import { approve, setup } from "./testing.ts";

const estimate = (key: string, points: number) => ({
  op: "setEstimate",
  target: `jira:${key}` as const,
  ref: null,
  args: { points },
});

test("a suggestion joins an undecided change set after its rows, and changes its hash", async () => {
  const { changeSets, run } = setup();
  const set = await changeSets.capture(run, [estimate("SYN-8", 3)]);
  const extended = await changeSets.extend(set.id, [estimate("SYN-13", 5)], 50);
  assert.deepEqual(
    extended.mutations.map((m) => [m.seq, m.target]),
    [
      [1, "jira:SYN-8"],
      [2, "jira:SYN-13"],
    ],
  );
  assert.notEqual(extended.hash, set.hash);
  // A diff shown before is no longer what the person would approve.
  await assert.rejects(
    changeSets.decide(set.id, "approved", { via: "thread", by: "pm" }, set.hash),
    { code: "stale" },
  );
});

test("a suggestion is refused outside the region, past the cap, with a new item, or once decided", async () => {
  const { changeSets, run } = setup();
  const set = await changeSets.capture(run, [estimate("SYN-8", 3)]);
  await assert.rejects(changeSets.extend(set.id, [estimate("SYN-45", 2)], 50), { code: "refused" });
  await assert.rejects(
    changeSets.extend(set.id, [estimate("SYN-13", 5), estimate("SYN-21", 1)], 2),
    ChangeSetError,
  );
  await assert.rejects(
    changeSets.extend(
      set.id,
      [{ op: "createStory", target: null, ref: "new:1", args: { summary: "A new story" } }],
      50,
    ),
    { code: "refused" },
  );
  await approve(changeSets, set.id);
  await assert.rejects(changeSets.extend(set.id, [estimate("SYN-13", 5)], 50), { code: "refused" });
});

test("a look at the diff records nothing a person would approve from", async () => {
  const { changeSets, run } = setup();
  const set = await changeSets.capture(run, [estimate("SYN-8", 3)]);
  const looked = await changeSets.look(set.id);
  assert.equal(looked.lines.length, 1);
  // Approval still needs a diff the person was shown.
  await assert.rejects(
    changeSets.decide(set.id, "approved", { via: "thread", by: "pm" }, looked.hash),
  );
  await approve(changeSets, set.id);
});
