// The host's lines under the agent's reply say what changed, not what was
// asked: the thread's marker for a change folds into its line (decision 0024).
import assert from "node:assert/strict";
import { test } from "node:test";
import { type ActionLine, type ItemId, ulid } from "@oriel/core";
import { actionLineView } from "./action-lines.ts";

const own = { thread: ulid(1, new Uint8Array(10)), workstream: ulid(2, new Uint8Array(10)) };
const touched = { kind: "workstream" as const, id: own.workstream, name: "Boarding" };
const ids = (...keys: string[]) => keys.map((key) => `jira:${key}` as ItemId);

test("an add names only what it added, and says so when the workstream had it all", () => {
  const add = (items: ItemId[], added: ItemId[]): ActionLine => ({
    call: { action: "workstream.add", input: { workstream: own.workstream, items } },
    touched,
    applied: true,
    undo: added.length
      ? { action: "workstream.remove", input: { workstream: own.workstream, items: added } }
      : null,
  });
  assert.equal(
    actionLineView(add(ids("SYN-3", "SYN-7"), ids("SYN-7")), own).text,
    "Added SYN-7 to this workstream.",
  );
  assert.equal(
    actionLineView(add(ids("SYN-3"), []), own).text,
    "Added nothing to this workstream: it already had SYN-3.",
  );
});

test("what was done names every item; what wasn't, the first few", () => {
  const keys = Array.from({ length: 8 }, (_, i) => `SYN-${i + 1}`);
  const input = { workstream: own.workstream, items: ids(...keys) };
  const done = actionLineView(
    { call: { action: "workstream.remove", input }, touched, applied: true, undo: null },
    own,
  );
  assert.equal(
    done.text,
    "Removed SYN-1, SYN-2, SYN-3, SYN-4, SYN-5, SYN-6, SYN-7 and SYN-8 from this workstream.",
  );
  const refused = actionLineView(
    { call: { action: "workstream.remove", input }, touched, applied: false, why: "no" },
    own,
  );
  assert.equal(
    refused.text,
    "Didn't remove SYN-1, SYN-2, SYN-3, SYN-4, SYN-5, SYN-6 and 2 more from this workstream: no.",
  );
});

test("a rename says the name it had, from its undo; each item is named once", () => {
  const renamed = actionLineView(
    {
      call: { action: "workstream.rename", input: { workstream: own.workstream, name: "Gates" } },
      touched,
      applied: true,
      undo: {
        action: "workstream.rename",
        input: { workstream: own.workstream, name: "Boarding" },
      },
    },
    own,
  );
  assert.equal(renamed.text, "Renamed “Boarding” to “Gates”.");
  const twice = { workstream: own.workstream, items: ids("SYN-3", "SYN-3") };
  assert.equal(
    actionLineView(
      { call: { action: "workstream.remove", input: twice }, touched, applied: true, undo: null },
      own,
    ).text,
    "Removed SYN-3 from this workstream.",
  );
});
