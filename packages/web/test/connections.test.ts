import assert from "node:assert/strict";
import { test } from "node:test";
import type { Replied } from "../src/http.ts";
import { initWorkstream, workstreamReplied } from "../src/workstream.ts";

const replied = (tag: Replied["tag"], ok: boolean, body: unknown): Replied => ({
  type: "replied",
  tag,
  ok,
  body,
});

test("a workstream reloaded after a sync keeps an Ask that's still on its way", () => {
  const [loading] = initWorkstream("01JB0000000000000000000000");
  const asking = { ...loading, pending: true, draft: "What's left?" };
  const view = { workstream: { id: "01JB0000000000000000000000" }, members: [] };
  const [after] = workstreamReplied(
    asking,
    replied({ kind: "workstreamSynced", id: "01JB0000000000000000000000" }, true, view),
  );
  assert.deepEqual([after.pending, after.draft, after.view], [true, "What's left?", view]);
});
