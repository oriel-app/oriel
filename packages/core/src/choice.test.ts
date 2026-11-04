// A choice's shape as the agent hands it, and what a run's record keeps of it.
import assert from "node:assert/strict";
import { test } from "node:test";
import { choiceAsk, choiceItems } from "./choice.ts";
import { recordedArgs } from "./sketch.ts";

const ask = {
  question: "Do fares hold on next-day sailings?",
  options: [
    {
      label: "Same day only",
      standing: "agreed",
      evidence: [{ id: "slack:C1-1.1", quote: "any later sailing that day", role: "proposes" }],
    },
  ],
  open: [],
};

test("a choice takes a question, 1 to 5 options each with quotes, and what's unanswered", () => {
  assert.ok(choiceAsk(ask).ok);
  assert.equal(choiceAsk({ ...ask, options: [] }).ok, false);
  const bad = structuredClone(ask);
  (bad.options[0] as { standing: string }).standing = "decided";
  assert.equal(choiceAsk(bad).ok, false);
  assert.equal(choiceAsk({ ...ask, question: "Two\nlines" }).ok, false);
  assert.equal(choiceAsk({ ...ask, open: ["a", "b", "c", "d", "e", "f"] }).ok, false);
});

test("a run's record keeps a choice's size, never its quotes", () => {
  const [kept] = recordedArgs("choices.add", [ask]);
  assert.deepEqual(Object.keys(kept as object), ["bytes"]);
  assert.doesNotMatch(JSON.stringify(recordedArgs("choices.add", [ask])), /later sailing/);
});

test("each cited item once, in the order first cited", () => {
  const checked = {
    options: [
      { evidence: [{ id: "jira:SYN-45" }, { id: "slack:C1-1.1" }] },
      { evidence: [{ id: "jira:SYN-45" }] },
    ],
  } as Parameters<typeof choiceItems>[0];
  assert.deepEqual(choiceItems(checked), ["jira:SYN-45", "slack:C1-1.1"]);
});
