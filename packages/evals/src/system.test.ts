// The system under test with a scripted model: the real agent loop, provider,
// bindings and sandbox over a case's world, with each response played from a
// hand-written stream.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { AgentEvent } from "@oriel/agent";
import { instant, type Sandbox } from "@oriel/core";
import { createSandbox } from "@oriel/sandbox";
import { loadFolderFixture } from "../../../scripts/fixtures/folder.ts";
import { parseEvalCase } from "./case.ts";
import { loadJiraFixture } from "./repo.ts";
import type { SystemInput } from "./runner.ts";
import { agentSystem, replyOf } from "./system.ts";
import { scriptedModel, streamed } from "./testing.ts";
import { fileId } from "./world.ts";

const fixture = loadJiraFixture();
const folder = loadFolderFixture();
const now = instant(new Date("2026-10-29T09:00:00.000Z"));

// Time is passed in: every sandbox duration comes out as 0.
let shared: Sandbox | null = null;
const sandbox = () => (shared ??= createSandbox({ now: () => 0 }));
const system = agentSystem({ sandbox });

function input(fetch: SystemInput["fetch"], fields: Record<string, unknown> = {}): SystemInput {
  const parsed = parseEvalCase({
    id: "scripted",
    split: "train",
    kind: 2,
    region: "weather-epic",
    files: ["meeting-notes.md"],
    prompt: "Estimate SYN-29 at 3.",
    expect: [{ grader: "zero-mutations" }],
    ...fields,
  });
  assert.ok(parsed.ok, JSON.stringify(!parsed.ok && parsed.issues));
  const name = parsed.value.region;
  return {
    case: parsed.value,
    fixture,
    folder,
    region: fixture.regions.find((r) => r.name === name) ?? null,
    now,
    model: "claude-opus-5-5",
    fetch,
  };
}

const notes = fileId("meeting-notes.md");

test("the agent answers in the case's world, and its change set is the case's mutations", async () => {
  const script = [
    `const notes = await items.read("${notes}");`,
    `jira.setEstimate("jira:SYN-29", 3);`,
    `return notes.gone ? null : notes.text.split("\\n")[0];`,
  ].join("\n");
  const model = scriptedModel([
    streamed({ text: "Let me look.", script }),
    streamed({ text: "I proposed 3 points for SYN-29." }),
  ]);
  const output = await system(input(model.fetch));

  assert.deepEqual(output.mutations, [
    { op: "setEstimate", target: "jira:SYN-29", ref: null, args: { points: 3 } },
  ]);
  assert.equal(output.reply, "Let me look.\n\nI proposed 3 points for SYN-29.");
  assert.deepEqual(
    (output.transcript as AgentEvent[]).map((e) => e.kind),
    ["text", "run.started", "run.finished", "text", "change-set", "done"],
  );
  // The file was read through the folder source, and only its text came back.
  const [first, second] = model.bodies;
  const messages = second?.["messages"] as { content: { type: string; content?: string }[] }[];
  const result = messages.at(-1)?.content[0];
  assert.equal(result?.type, "tool_result");
  assert.match(
    result?.content ?? "",
    /^Returned: "# Disruption sync, 9 October"\nCaptured 1 change:/,
  );
  // The model under test is the case's, and the tool declares the file by ID only.
  assert.equal(first?.["model"], "claude-opus-5-5");
  const tool = JSON.stringify(first?.["tools"]);
  assert.ok(tool.includes(notes) && !tool.includes("meeting-notes"));
});

test("a question is answered with no mutations", async () => {
  const model = scriptedModel([streamed({ text: "Nothing to change." })]);
  const output = await system(input(model.fetch, { prompt: "What's in this group?" }));
  assert.deepEqual(output.mutations, []);
  assert.equal(output.reply, "Nothing to change.");
});

test("a turn the agent can't finish is the case's error, not a reply", async () => {
  const fetch: SystemInput["fetch"] = async () =>
    Response.json({ type: "error", error: { message: "overloaded" } }, { status: 529 });
  await assert.rejects(system(input(fetch)), /the agent's turn failed: .*HTTP 529.*overloaded/);
});

test("the reply is the agent's text, a paragraph break wherever a run came between", () => {
  const events: AgentEvent[] = [
    { kind: "text", text: "Let me " },
    { kind: "text", text: "look." },
    { kind: "limit", reason: "x" },
    { kind: "text", text: "Done." },
  ];
  assert.equal(replyOf(events), "Let me look.\n\nDone.");
  assert.equal(
    replyOf([
      { kind: "limit", reason: "x" },
      { kind: "text", text: "Hi" },
    ]),
    "Hi",
  );
});
