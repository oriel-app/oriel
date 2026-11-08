// A Slack message's text reaches the agent through tool results, never the
// declarations its scripts are typed against.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { ThreadView } from "@oriel/web/view";
import { json, type Script, testApp } from "./testing.ts";

test("a thread on a Slack message reads it, and no message text reaches the declarations", async (t) => {
  const inspect: Script = async (bindings) => ({
    value: { dts: bindings.dts, items: (await bindings.read("items.list", [])).value },
  });
  const app = await testApp(t, {
    slack: { mode: "fixture" },
    plan: () => [{ run: "inspect" }],
    scripts: { inspect },
  });
  const message = "slack:C0FW1WEATHR-1788444000.000100";
  const { id: workstreamId } = json<{ id: string }>(
    await app.post("/api/workstreams", {
      kind: "picked",
      name: "Fares after cancellations",
      items: ["jira:SYN-45", message],
    }),
  );
  const { id } = json<{ id: string }>(
    await app.post(`/api/workstreams/${workstreamId}/threads`, {
      text: "What did the team decide?",
    }),
  );
  await app.app.settled();
  const thread = json<ThreadView>(await app.get(`/api/threads/${id}`));
  const finished = thread.entries.find((e) => e.kind === "run.finished");
  assert.ok(finished?.kind === "run.finished");
  const value = JSON.parse(finished.run.returned ?? "null") as {
    dts: string;
    items: { id: string; text?: string }[];
  };
  // The item's text reaches the run, through a tool result, and not the
  // declarations, which name it by ID alone.
  assert.match(value.items.find((item) => item.id === message)?.text ?? "", /fare they paid/);
  assert.ok(value.dts.includes(JSON.stringify(message)));
  assert.doesNotMatch(value.dts, /Dara|Decision|fare they paid/);
});
