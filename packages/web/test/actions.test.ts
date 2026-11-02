// What the agent did in Oriel, under its reply (decision 0024): the markers
// its own changes left in the thread fold into the list that says them.
import assert from "node:assert/strict";
import { test } from "node:test";
import { blocks } from "../src/thread.ts";
import type { ChatEntry, ItemRef } from "../src/view.ts";
import { actionLine, itemRef } from "../testing.ts";

const at = "2026-11-01T00:00:00.000Z";
const ref = (key: string): ItemRef => itemRef({ id: `jira:${key}`, key, title: key });
const removed = actionLine({ text: "Removed SYN-13 from this workstream.", applied: true });
const marker = (seq: number, from: number, ownAgent: boolean): ChatEntry => ({
  seq,
  at,
  kind: "marker",
  from,
  to: from + 1,
  added: [],
  removed: [ref("SYN-13")],
  ...(ownAgent ? { ownAgent: true as const } : {}),
});
const actions = (seq: number): ChatEntry => ({ seq, at, kind: "actions", lines: [removed] });

test("the markers the agent's own changes left fold into its list", () => {
  const out = blocks([marker(1, 1, true), marker(2, 2, true), actions(3)]);
  assert.deepEqual(out, [{ kind: "actions", seq: 3, lines: [removed] }]);
});

test("a marker anyone else's change left stays, and so does the list's own", () => {
  const out = blocks([marker(1, 1, false), actions(2)]);
  assert.deepEqual(
    out.map((b) => b.kind),
    ["marker", "actions"],
  );
});
