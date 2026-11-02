// An Undo or Redo under the agent's reply is said by its line there, "…,
// which you undid" (OA-118): the marker it left later in the chat folds into
// that list, as the agent's own markers do. Anyone else's stays.
import assert from "node:assert/strict";
import { test } from "node:test";
import { blocks } from "../src/thread.ts";
import type { ChatEntry } from "../src/view.ts";
import { actionLine, itemRef } from "../testing.ts";

const at = "2026-11-01T00:00:00.000Z";
const syn13 = itemRef({ id: "jira:SYN-13", key: "SYN-13", title: "SYN-13" });
const undone = actionLine({
  text: "Removed SYN-13 from this workstream, which you undid.",
  applied: true,
  undone: true,
});
const marker = (seq: number, fromLine: boolean): ChatEntry => ({
  seq,
  at,
  kind: "marker",
  from: seq,
  to: seq + 1,
  added: [syn13],
  removed: [],
  ...(fromLine ? { fromLine: true as const } : {}),
});
const entries: ChatEntry[] = [
  { seq: 1, at, kind: "user", text: "Tidy" },
  { seq: 2, at, kind: "text", text: "Done." },
  { seq: 3, at, kind: "actions", lines: [undone] },
  { seq: 4, at, kind: "done" },
];

test("the marker an Undo under the reply left folds into its list", () => {
  const out = blocks([...entries, marker(5, true)]);
  assert.deepEqual(
    out.map((b) => b.kind),
    ["user", "reply", "actions"],
  );
});

test("an Undo's marker folds even after more was said", () => {
  const later: ChatEntry[] = [
    { seq: 5, at, kind: "user", text: "Thanks" },
    { seq: 6, at, kind: "text", text: "Anytime." },
    { seq: 7, at, kind: "done" },
  ];
  const out = blocks([...entries, ...later, marker(8, true)]);
  assert.deepEqual(
    out.map((b) => b.kind),
    ["user", "reply", "actions", "user", "reply"],
  );
});

test("a marker anyone else's change left stays in the chat", () => {
  const out = blocks([...entries, marker(5, false)]);
  assert.deepEqual(
    out.map((b) => b.kind),
    ["user", "reply", "actions", "marker"],
  );
});
