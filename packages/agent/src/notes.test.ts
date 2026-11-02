// Oriel's own lines in a thread reach the model as notes from Oriel, never as
// its own words (OA-91), and each names the change set it is about (OA-86).
import assert from "node:assert/strict";
import { test } from "node:test";
import type { OrielNote, Ulid } from "@oriel/core";
import type { ChatMessage } from "./contract.ts";
import { noteText, roundClosed, threadMessages } from "./prompt.ts";
import { t0 } from "./testing.ts";

const first = "01JBZ00000000000000000CS01" as Ulid;
const second = "01JBZ00000000000000000CS02" as Ulid;
const notes: OrielNote[] = [
  { kind: "rejected", changeSet: first, via: "thread" },
  { kind: "rejected", changeSet: second, via: "review-link" },
];

// Two turns each proposed a change set; both were rejected, back to back,
// then the user said what was wrong.
const history: ChatMessage[] = [
  { role: "user", text: "Rename SYN-23.", at: t0 },
  {
    role: "run",
    runId: "01RUN1" as Ulid,
    summary: `ok; returned null; captured 1 changes; they are change set ${first}`,
    script: "jira.setSummary('jira:SYN-23', 'A');",
    at: t0,
  },
  { role: "assistant", text: "I proposed a new title.", at: t0 },
  { role: "user", text: "And SYN-24.", at: t0 },
  {
    role: "run",
    runId: "01RUN2" as Ulid,
    summary: `ok; returned null; captured 1 changes; they are change set ${second}`,
    script: "jira.setSummary('jira:SYN-24', 'B');",
    at: t0,
  },
  { role: "assistant", text: "I proposed another.", at: t0 },
  ...notes.map((note) => ({ role: "note" as const, note, at: t0 })),
];

const messages = threadMessages(history, "Too long.");
const results = messages.flatMap((m) => (m.role === "tool" ? m.results.map((r) => r.content) : []));

test("Oriel's lines reach the model as tool results, never as what the agent said", () => {
  const said = messages.flatMap((m) => (m.role === "assistant" && m.text ? [m.text] : []));
  assert.deepEqual(said, ["I proposed a new title.", "I proposed another.", roundClosed]);
  // Each note is Oriel's, says so, and comes back from a call that says it isn't a run.
  assert.deepEqual(results.slice(-2), notes.map(noteText));
  for (const text of results.slice(-2)) assert.match(text, /Oriel, not you, /);
  const scripts = messages.flatMap((m) =>
    m.role === "assistant"
      ? m.calls.map((c) => String(Reflect.get(Object(c.input), "script")))
      : [],
  );
  assert.deepEqual(scripts.slice(-2), [
    "// Oriel's note of what happened in the thread. Not a run.",
    "// Oriel's note of what happened in the thread. Not a run.",
  ]);
  assert.deepEqual(messages.at(-1), { role: "user", text: "Too long." });
});

test("two rejections in a row name their change sets, so the answer is plainly about the second", () => {
  // Each run says which change set its changes became; each note which one
  // was rejected, the second last, just before the answer.
  assert.ok(results[0]?.endsWith(`they are change set ${first}`));
  assert.ok(results[1]?.endsWith(`they are change set ${second}`));
  assert.match(results.at(-2) ?? "", new RegExp(`^The user rejected change set ${first},`));
  assert.match(
    results.at(-1) ?? "",
    new RegExp(`^Change set ${second} was rejected on its review link,`),
  );
});
