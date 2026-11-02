// The `avoids` grader, and a case's thread before its prompt.
import assert from "node:assert/strict";
import { test } from "node:test";
import { parseEvalCase } from "./case.ts";
import { gradeAvoids } from "./graders.ts";

test("avoids: passes when the reply says none of the texts, and fails naming each it says", () => {
  assert.deepEqual(gradeAvoids(["by hand", "mistake"], "I proposed a revised change set."), {
    grader: "avoids",
    pass: true,
    detail: "none of 2 texts said",
  });
  assert.deepEqual(
    gradeAvoids(["by hand", "mistake"], "That line was a **Mistake**; make it by  hand."),
    { grader: "avoids", pass: false, detail: 'said: "by hand", "mistake"' },
  );
});

const changeSet = "01K8Y0000000000000000000C1";
const base = {
  id: "a-case",
  split: "train",
  kind: 2,
  region: "checkout-epic",
  prompt: "Only the first one.",
  expect: [{ grader: "avoids", text: ["mistake"] }],
  oriel: {
    threads: [
      {
        id: "01K8Y0000000000000000000T1",
        name: "Plan gift cards",
        state: "working",
        workstream: { id: "01K8Y0000000000000000000W1", name: "Checkout" },
        activityAt: "2026-10-31T09:05:00.000Z",
        said: ["Plan gift cards."],
      },
    ],
    changeSets: [
      {
        id: changeSet,
        thread: "01K8Y0000000000000000000T1",
        state: "rejected",
        createdAt: "2026-10-31T09:01:00.000Z",
        decided: { kind: "rejected", by: "you", at: "2026-10-31T09:05:00.000Z" },
        changes: [{ source: "Jira", sentence: "Create a story.", text: [] }],
      },
    ],
  },
};

test("a case's thread before its prompt holds the user's and agent's words and Oriel's notes, each about a change set it has", () => {
  const note = (id: string) => ({
    role: "note",
    note: { kind: "rejected", changeSet: id, via: "thread" },
  });
  const said = [
    { role: "user", text: "Plan gift cards." },
    { role: "assistant", text: "I proposed two stories." },
  ];
  assert.ok(parseEvalCase({ ...base, before: [...said, note(changeSet)] }).ok);
  const unknown = parseEvalCase({ ...base, before: [...said, note("01K8Y0000000000000000000C9")] });
  assert.ok(!unknown.ok);
  assert.deepEqual(
    unknown.issues.map((i) => i.path),
    ["$.before[2].note.changeSet"],
  );
  assert.ok(!parseEvalCase({ ...base, before: [{ role: "agent", text: "Hi." }] }).ok);
});
