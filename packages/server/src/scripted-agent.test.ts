import assert from "node:assert/strict";
import { test } from "node:test";
import type { Message, NewMessage } from "@oriel/db";
import type { Instant } from "@oriel/core";
import type { AgentEvent, TurnInput } from "./agent.ts";
import { devPlan, scriptedAgent } from "./scripted-agent.ts";
import { testApp } from "./testing.ts";
import { history } from "./turns.ts";

const at = "2026-10-29T09:00:00.000Z" as Instant;

function input(text: string, items: string[]): TurnInput {
  return {
    thread: {
      id: "01JBZ0000000000000000000T1" as never,
      workspaceId: "01JBZ0000000000000000000W1" as never,
      groupId: "01JBZ0000000000000000000G1" as never,
      regionVersion: 1,
      state: "working",
      doneBy: null,
      createdAt: at,
    },
    region: {
      groupId: "01JBZ0000000000000000000G1" as never,
      version: 1,
      workspaceId: "01JBZ0000000000000000000W1" as never,
      items: items.map((id, i) => ({ id: id as never, stableId: String(i + 1) })),
      origin: { kind: "picked" },
    },
    history: [],
    spent: { inputTokens: 0, outputTokens: 0 },
    snapshot: 1,
    text,
  };
}

test("the dev plan searches when asked to find something", () => {
  assert.deepEqual(devPlan(input("Can you find the payment retries?", ["jira:SYN-1"]))[1], {
    search: "the payment retries",
  });
});

test("the dev plan proposes estimates only where there are Jira items", () => {
  const plan = devPlan(input("Which stories need estimates?", ["jira:SYN-1"]));
  assert.ok(plan.some((step) => "run" in step && step.run.includes("jira.setEstimate")));
  const none = devPlan(input("estimates?", ["folder:0123456789abcdef"]));
  assert.deepEqual(none, [
    { text: "Nothing in this group can be estimated: it has no Jira items." },
  ]);
});

test("anything else reads every item", () => {
  const plan = devPlan(input("What's here?", ["jira:SYN-1"]));
  assert.ok(plan.some((step) => "run" in step && step.run.includes("items.list()")));
});

test("history joins the agent's text, summarizes runs, and names marker items by ID", () => {
  const message = (seq: number, value: NewMessage): Message => ({ seq, at, ...value }) as Message;
  const event = (e: AgentEvent) => e;
  const runId = "01JBZ0000000000000000000R1" as never;
  const out = history(
    [
      message(1, { role: "user", text: "What's left?" }),
      message(2, { role: "agent", event: event({ kind: "text", text: "Let me " }) }),
      message(3, { role: "agent", event: event({ kind: "text", text: "look." }) }),
      message(4, { role: "agent", event: event({ kind: "run.started", runId, script: "x" }) }),
      message(5, {
        role: "agent",
        event: event({
          kind: "run.finished",
          runId,
          result: {
            reads: [],
            mutations: [],
            transcript: [{ kind: "return", value: { left: 2 } }],
            outcome: "ok",
            wallMs: 3,
            coldStartMs: null,
          },
        }),
      }),
      message(6, { role: "marker", from: 1, to: 2 }),
      message(7, { role: "agent", event: { kind: "unknown" } }),
    ],
    (from, to) => `v${from}→v${to}: added jira:SYN-3`,
  );
  assert.deepEqual(out, [
    { role: "user", text: "What's left?", at },
    { role: "assistant", text: "Let me look.", at },
    { role: "run", runId, summary: 'ok; returned {"left":2}', script: "x", at },
    { role: "marker", text: "v1→v2: added jira:SYN-3", at },
  ]);
});

// The dev plan's scripts run in the real sandbox, against real bindings over
// the fixture, so `pnpm dev` works. This spawns Deno, as the sandbox's own
// tests do.
test("the dev plan's scripts typecheck and run in the sandbox", async (t) => {
  const { createSandbox } = await import("@oriel/sandbox");
  const sandbox = createSandbox();
  const app = await testApp(t, { agent: (deps) => scriptedAgent({ ...deps, sandbox }, devPlan) });
  const created = await app.post("/api/groups", {
    kind: "cluster",
    grouping: "epic",
    cluster: "10001",
  });
  const { id: groupId } = JSON.parse(String(created.body)) as { id: string };
  const ask = async (text: string) => {
    const opened = await app.post(`/api/groups/${groupId}/threads`, { text });
    await app.app.settled();
    const { id } = JSON.parse(String(opened.body)) as { id: string };
    return JSON.parse(String((await app.get(`/api/threads/${id}`)).body)) as {
      entries: { kind: string; run?: { outcome: string; error: unknown } }[];
    };
  };
  for (const text of ["What's here?", "Which stories need estimates?", "find weather"]) {
    const view = await ask(text);
    const finished = view.entries.find((e) => e.kind === "run.finished");
    assert.deepEqual([text, finished?.run?.outcome, finished?.run?.error], [text, "ok", null]);
    if (text.includes("estimates")) assert.ok(view.entries.some((e) => e.kind === "change-set"));
    if (text.startsWith("find")) assert.ok(view.entries.some((e) => e.kind === "search"));
  }
});
