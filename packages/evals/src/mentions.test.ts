// The `mentions` grader and its expectation.
import assert from "node:assert/strict";
import { test } from "node:test";
import { parseEvalCase } from "./case.ts";
import { gradeMentions } from "./graders.ts";

test("mentions: passes when the reply names every text, whatever its case or emphasis", () => {
  const reply = "Once you approve it, **revert** it from the thread to undo it.";
  assert.deepEqual(gradeMentions(["Revert", "the  thread"], reply), {
    grader: "mentions",
    pass: true,
    detail: "2 texts mentioned",
  });
});

test("mentions: fails and lists each text the reply never names", () => {
  const reply = "They will need to be deleted in the tracker afterwards.";
  assert.deepEqual(gradeMentions(["Revert", "tracker", "Undo"], reply), {
    grader: "mentions",
    pass: false,
    detail: 'never mentioned: "Revert", "Undo"',
  });
});

test("a case may expect mentions, with at least one text, in a deterministic kind", () => {
  const base = { id: "a-case", split: "train", kind: 2, region: "checkout-epic", prompt: "Go." };
  const parsed = parseEvalCase({ ...base, expect: [{ grader: "mentions", text: ["Revert"] }] });
  assert.ok(parsed.ok);
  const empty = parseEvalCase({ ...base, expect: [{ grader: "mentions", text: [] }] });
  assert.ok(!empty.ok);
  assert.deepEqual(
    empty.issues.map((i) => i.path),
    ["$.expect[0].text"],
  );
});
