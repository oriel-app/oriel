import assert from "node:assert/strict";
import { test } from "node:test";
import type { Ulid } from "@oriel/core";
import type { ChatMessage } from "./contract.ts";
import { roundClosed, runTool, systemPrompt, threadMessages } from "./prompt.ts";
import type { ModelMessage } from "./provider.ts";
import { t0 } from "./testing.ts";

const runId = "01RUN" as Ulid;
const stand =
  "// Run 01RUN, earlier in this thread. Its script isn't kept; the result is its summary.";
const note = "// Oriel's note that the workstream changed. Not a run.";

// Each message as one line: who, its text, and its calls' scripts or its
// results' contents.
const shape = (messages: ModelMessage[]) =>
  messages.map((m) => {
    if (m.role === "tool") return ["tool", ...m.results.map((r) => `${r.callId}: ${r.content}`)];
    if (m.role === "user") return ["user", m.text];
    const scripts = m.calls.map(
      (c) => `${c.id}: ${String(Reflect.get(Object(c.input), "script"))}`,
    );
    return ["assistant", m.text, ...scripts];
  });

test("the system prompt names no source, item or region", () => {
  assert.doesNotMatch(systemPrompt, /jira:|folder:|SYN-|\$\{/);
  assert.equal(runTool("declare const x: 1;\n").description.includes("declare const x: 1;"), true);
});

test("history: markers before the first message are dropped, and runs in a row share one reply", () => {
  const messages = threadMessages(
    [
      { role: "marker", text: "added ABC-9", at: t0 },
      { role: "user", text: "Estimate them.", at: t0 },
      { role: "run", runId, summary: "Returned: 2", at: t0 },
      { role: "run", runId, summary: "Returned: 3", at: t0 },
      { role: "assistant", text: "Proposed.", at: t0 },
    ],
    "Thanks.",
  );
  assert.deepEqual(shape(messages), [
    ["user", "Estimate them."],
    ["assistant", "", `history_2: ${stand}`, `history_3: ${stand}`],
    ["tool", "history_2: Returned: 2", "history_3: Returned: 3"],
    ["assistant", "Proposed."],
    ["user", "Thanks."],
  ]);
});

test("history: a run that kept its script goes back with it", () => {
  const messages = threadMessages(
    [
      { role: "user", text: "How many?", at: t0 },
      { role: "run", runId, summary: "Returned: 2", script: "return 2;", at: t0 },
      { role: "assistant", text: "Two.", at: t0 },
    ],
    "Thanks.",
  );
  assert.deepEqual(shape(messages)[1], ["assistant", "", "history_1: return 2;"]);
});

// A replayed round left open before the user's text reads as an unfinished
// tool round with no thinking block, which the API refuses or answers with
// thinking off (see `roundClosed`). So every replayed round is closed with a
// reply before a user's message.
const asked: ChatMessage = { role: "user", text: "What changed?", at: t0 };
const answered: ChatMessage = { role: "assistant", text: "Nothing yet.", at: t0 };

test("history that ends in a marker: the round is closed before the user's message", () => {
  const messages = threadMessages(
    [asked, answered, { role: "marker", text: "added ABC-2", at: t0 }],
    "And now?",
  );
  assert.deepEqual(shape(messages), [
    ["user", "What changed?"],
    ["assistant", "Nothing yet.", `history_2: ${note}`],
    ["tool", "history_2: added ABC-2"],
    ["assistant", roundClosed],
    ["user", "And now?"],
  ]);
});

test("history that ends in a run: the round is closed before the user's message", () => {
  const messages = threadMessages(
    [asked, { role: "run", runId, summary: "Returned: []", at: t0 }],
    "And now?",
  );
  assert.deepEqual(shape(messages), [
    ["user", "What changed?"],
    ["assistant", "", `history_1: ${stand}`],
    ["tool", "history_1: Returned: []"],
    ["assistant", roundClosed],
    ["user", "And now?"],
  ]);
});

test("history that ends in a run and a marker: one round, closed once", () => {
  const messages = threadMessages(
    [
      asked,
      answered,
      { role: "run", runId, summary: "Returned: []", at: t0 },
      { role: "marker", text: "removed plan.md", at: t0 },
    ],
    "And now?",
  );
  assert.deepEqual(shape(messages), [
    ["user", "What changed?"],
    ["assistant", "Nothing yet.", `history_2: ${stand}`, `history_3: ${note}`],
    ["tool", "history_2: Returned: []", "history_3: removed plan.md"],
    ["assistant", roundClosed],
    ["user", "And now?"],
  ]);
});

test("history: a round the user's next message followed is closed too", () => {
  const messages = threadMessages(
    [
      asked,
      { role: "run", runId, summary: "Returned: []", at: t0 },
      { role: "user", text: "Hello?", at: t0 },
      { role: "assistant", text: "Here.", at: t0 },
    ],
    "And now?",
  );
  assert.deepEqual(
    shape(messages).map(([role]) => role),
    ["user", "assistant", "tool", "assistant", "user", "assistant", "user"],
  );
  assert.equal(shape(messages)[3]?.[1], roundClosed);
});

test("history: an assistant message with no text is absent, so it doesn't stand in for a reply", () => {
  const messages = threadMessages(
    [
      asked,
      { role: "run", runId, summary: "Returned: []", at: t0 },
      { role: "assistant", text: "", at: t0 },
      { role: "assistant", text: "  \n", at: t0 },
    ],
    "And now?",
  );
  assert.deepEqual(shape(messages), [
    ["user", "What changed?"],
    ["assistant", "", `history_1: ${stand}`],
    ["tool", "history_1: Returned: []"],
    ["assistant", roundClosed],
    ["user", "And now?"],
  ]);
});
