// What a turn's intents apply as (decision 0024), read from the registry.
import assert from "node:assert/strict";
import { test } from "node:test";
import { ulid } from "./ids.ts";
import { alternatives, ownedFields, planned } from "./intents.ts";
import type { Intent } from "./sandbox.ts";

const id = (n: number) => ulid(n, new Uint8Array(10));
const [launch, risks, thread, other] = [id(1), id(2), id(3), id(4)];
const remove = (workstream: string, ...items: string[]): Intent => ({
  action: "workstream.remove",
  input: { workstream, items },
});

test("a workstream or thread field is the agent's own by the type it names", () => {
  assert.deepEqual(alternatives("workstream.add").map(ownedFields), [{ workstream: "workstream" }]);
  assert.deepEqual(alternatives("thread.done").map(ownedFields), [{ thread: "thread" }]);
  assert.deepEqual(alternatives("workstream.create").map(ownedFields), [{}, {}, {}]);
});

test("adjacent calls of one action on one workstream merge; others keep their order", () => {
  const rename = (name: string): Intent => ({
    action: "workstream.rename",
    input: { workstream: launch, name },
  });
  assert.deepEqual(
    planned(
      [
        remove(launch, "jira:SYN-1"),
        remove(launch, "jira:SYN-2", "jira:SYN-1"),
        remove(risks, "jira:SYN-3"),
        remove(launch, "jira:SYN-4"),
        rename("A"),
        rename("B"),
      ],
      { thread },
    ),
    [
      remove(launch, "jira:SYN-1", "jira:SYN-2"),
      remove(risks, "jira:SYN-3"),
      remove(launch, "jira:SYN-4"),
      rename("B"),
    ],
  );
  // Two creates make two workstreams.
  const create: Intent = {
    action: "workstream.create",
    input: { kind: "picked", name: "X", items: ["jira:SYN-1"] },
  };
  assert.equal(planned([create, create], { thread }).length, 2);
});

test("marking the agent's own thread done comes last, once; another's keeps its place", () => {
  const done = (which: string): Intent => ({ action: "thread.done", input: { thread: which } });
  assert.deepEqual(
    planned([done(thread), done(other), remove(launch, "jira:SYN-1"), done(thread)], { thread }),
    [done(other), remove(launch, "jira:SYN-1"), done(thread)],
  );
});
