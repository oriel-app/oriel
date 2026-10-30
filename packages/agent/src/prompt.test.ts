import assert from "node:assert/strict";
import { test } from "node:test";
import type { Ulid } from "@oriel/core";
import { runTool, systemPrompt, threadMessages } from "./prompt.ts";
import { t0 } from "./testing.ts";

test("the system prompt names no source, item or region", () => {
  assert.doesNotMatch(systemPrompt, /jira:|folder:|SYN-|\$\{/);
  assert.equal(runTool("declare const x: 1;\n").description.includes("declare const x: 1;"), true);
});

test("history: markers before the first message are dropped, and runs in a row share one reply", () => {
  const runId = "01RUN" as Ulid;
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
  assert.deepEqual(
    messages.map((m) =>
      m.role === "tool" ? m.results.map((r) => [r.callId, r.content]) : [m.role, m.text],
    ),
    [
      ["user", "Estimate them."],
      ["assistant", ""],
      [
        ["history_2", "Returned: 2"],
        ["history_3", "Returned: 3"],
      ],
      ["assistant", "Proposed."],
      ["user", "Thanks."],
    ],
  );
});
