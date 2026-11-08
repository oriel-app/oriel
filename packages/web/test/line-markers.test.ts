// OA-118, fixed in c27653bc (#91): an Undo under the agent's reply also left
// a version marker later in the chat, saying the change twice. It folds into
// the reply's list.
import assert from "node:assert/strict";
import { test } from "node:test";
import { entriesOf } from "../src/thread.ts";
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
  const out = entriesOf([...entries, marker(5, true)]);
  assert.deepEqual(
    out.map((b) => b.kind),
    ["user", "reply", "actions"],
  );
});
