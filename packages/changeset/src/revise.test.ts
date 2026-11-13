import assert from "node:assert/strict";
import { test } from "node:test";
import { orielRunModel, type RunRef, type Ulid, ulid } from "@oriel/core";
import { approve, setup } from "./testing.ts";

const estimate = (key: string, points: number) => ({
  op: "setEstimate",
  target: `jira:${key}` as const,
  ref: null,
  args: { points },
});

function anotherRun(s: ReturnType<typeof setup>, newThread: boolean, model = "model"): RunRef {
  const at = Date.parse("2026-10-29T09:00:01.000Z");
  const threadId = newThread ? (ulid(at) as Ulid) : s.run.threadId;
  if (newThread)
    s.db
      .prepare(
        "insert into threads (id, workspace_id, workstream_id, region_version, created_at) values (?, ?, ?, 1, ?)",
      )
      .run(threadId, s.workspaceId, s.workstreamId, "2026-10-29T09:00:01.000Z");
  const id = ulid(at) as Ulid;
  s.db
    .prepare(`
      insert into runs (id, workspace_id, thread_id, snapshot, region_version, system_prompt_hash,
        dts_hash, model, input_tokens, output_tokens, wall_ms, outcome, started_at)
      values (?, ?, ?, 1, 1, 'p', 'd', ?, 0, 0, 0, 'ok', ?)`)
    .run(id, s.workspaceId, threadId, model, "2026-10-29T09:00:01.000Z");
  return { id, threadId, workspaceId: s.workspaceId };
}

test("a revision replaces the changes, keeps the ID and the live review link, and voids the old diff", async () => {
  const s = setup();
  const { changeSets } = s;
  const set = await changeSets.capture(s.run, [estimate("SYN-8", 3), estimate("SYN-13", 2)]);
  const shown = await changeSets.diff(set.id);
  const url = await changeSets.reviewLink(set.id);
  const token = url.pathname.split("/").at(-1) ?? "";
  s.advance(1000);
  const later = anotherRun(s, false);
  const revised = await changeSets.revise(set.id, later, [estimate("SYN-8", 5)]);
  assert.equal(revised.id, set.id);
  assert.equal(revised.runId, later.id);
  assert.notEqual(revised.revisedAt, null);
  assert.deepEqual(
    revised.mutations.map((m) => [m.seq, m.target, m.args]),
    [[1, "jira:SYN-8", { points: 5 }]],
  );
  assert.notEqual(revised.hash, set.hash);
  assert.equal((await changeSets.ofThread(s.run.threadId)).length, 1);
  await assert.rejects(
    changeSets.decide(set.id, "approved", { via: "thread", by: "pm" }, shown.hash),
    { code: "stale" },
  );
  await assert.rejects(
    changeSets.decide(set.id, "approved", { via: "review-link", token, by: "Ann" }, shown.hash),
    { code: "stale" },
  );
  const opened = await changeSets.openReview(token);
  assert.equal(opened?.changeSet.hash, revised.hash);
  assert.ok(s.events.some((e) => e.name === "changeset.revised" && e.changeSetId === set.id));
  await approve(changeSets, set.id);
});

test("only the agent's own undecided change set in its thread can be revised", async () => {
  const s = setup();
  const { changeSets } = s;
  const set = await changeSets.capture(s.run, [estimate("SYN-8", 3)]);
  const before = set.hash;
  await assert.rejects(changeSets.revise(set.id, anotherRun(s, true), [estimate("SYN-8", 5)]), {
    code: "refused",
  });
  assert.equal((await changeSets.get(set.id))?.hash, before);
  await assert.rejects(changeSets.revise(set.id, s.run, [estimate("SYN-45", 5)]), {
    code: "refused",
  });
  await approve(changeSets, set.id);
  await assert.rejects(changeSets.revise(set.id, s.run, [estimate("SYN-8", 5)]), {
    code: "refused",
  });
  await changeSets.apply(set.id);
  const revert = await changeSets.revert(set.id);
  assert.ok(!("conflicts" in revert));
  await assert.rejects(changeSets.revise(revert.id, s.run, [estimate("SYN-8", 5)]), {
    code: "refused",
  });
  assert.equal((await changeSets.get(set.id))?.hash, before);
});

test("a rejected change set can't be revised", async () => {
  const s = setup();
  const { changeSets } = s;
  const set = await changeSets.capture(s.run, [estimate("SYN-8", 3)]);
  const { hash } = await changeSets.diff(set.id);
  await changeSets.decide(set.id, "rejected", { via: "thread", by: "pm" }, hash);
  await assert.rejects(changeSets.revise(set.id, s.run, [estimate("SYN-8", 5)]), {
    code: "refused",
  });
});

test("a change set Oriel proposed itself, as a stand-in's move, can't be revised", async () => {
  const s = setup();
  const { changeSets } = s;
  const set = await changeSets.capture(anotherRun(s, false, orielRunModel), [estimate("SYN-8", 3)]);
  assert.notEqual(await changeSets.revisable(set.id, s.run.threadId), null);
  await assert.rejects(changeSets.revise(set.id, s.run, [estimate("SYN-8", 5)]), {
    code: "refused",
  });
});

test("a revision can't bring back an approval the user's edit voided", async () => {
  const s = setup();
  const { changeSets } = s;
  const set = await changeSets.capture(s.run, [estimate("SYN-8", 3)]);
  await approve(changeSets, set.id);
  const [row] = set.mutations;
  assert.ok(row);
  const edited = await changeSets.edit(set.id, {
    set: [{ mutationId: row.id, args: { points: 4 } }],
  });
  assert.equal(edited.decision, null);
  await assert.rejects(changeSets.revise(set.id, s.run, [estimate("SYN-8", 3)]), {
    code: "refused",
  });
  assert.equal((await changeSets.get(set.id))?.decision, null);
});
