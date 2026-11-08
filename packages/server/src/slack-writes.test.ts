// Posting in Slack through a change set (OA-28), end to end through the
// routes: nothing is sent before the approval, one revert undoes a post and
// a move, and a revert stops before it could delete others' words. Jira is SYN in
// memory; Slack is the fixture's workspace in memory, which the test also
// acts in as others do.
import assert from "node:assert/strict";
import { type TestContext, test } from "node:test";
import { fixtureApi, type FixtureWorkspace, loadSlackFixture } from "@oriel/slack";
import type { ChangeSetView, DiffView, ThreadView } from "@oriel/web/view";
import { weather } from "../../../scripts/fixtures/slack.ts";
import { json, type Script, testApp } from "./testing.ts";

// Chen Yuting's message that the SMS copy for SYN-61 is ready for review,
// with its two replies.
const sms = `slack:${weather}-1788782400.000100`;
const ready = "SYN-61 is ready to pick up: the SMS copy is signed off.";

const handOff: Script = async () => ({
  value: null,
  writes: [
    ["jira.setStatus", ["jira:SYN-61", "In Progress"]],
    ["slack.postMessage", [sms, ready]],
  ],
});

type Acted = { changeSet: ChangeSetView; error?: string; revert?: string };

async function proposed(t: TestContext, script: Script) {
  const workspace: FixtureWorkspace = fixtureApi(loadSlackFixture());
  const app = await testApp(t, {
    writes: true,
    slack: { mode: "fixture", fetch: workspace.fetch },
    plan: () => [{ run: "script" }],
    scripts: { script },
  });
  const { id: workstreamId } = json<{ id: string }>(
    await app.post("/api/workstreams", {
      kind: "picked",
      name: "SMS updates",
      items: ["jira:SYN-61", sms],
    }),
  );
  const { id: threadId } = json<{ id: string }>(
    await app.post(`/api/workstreams/${workstreamId}/threads`, { text: "Hand SYN-61 to the team" }),
  );
  await app.app.settled();
  const view = async () => json<ThreadView>(await app.get(`/api/threads/${threadId}`));
  const entry = (await view()).entries.find((e) => e.kind === "change-set");
  assert.ok(entry?.kind === "change-set", "the run captured a change set");
  const diff = async (id = entry.changeSetId) =>
    json<DiffView>(await app.post(`/api/change-sets/${id}/diff`));
  const act = async (action: string, body: unknown = {}, id = entry.changeSetId) => {
    const reply = await app.post(`/api/change-sets/${id}/${action}`, body);
    return { status: reply.status, body: json<Acted>(reply) };
  };
  const approve = async (id = entry.changeSetId) => {
    app.advance(1000);
    return act("approve", { hash: (await diff(id)).hash }, id);
  };
  const posted = () => workspace.calls.filter((c) => c.method === "chat.postMessage");
  return { ...app, workspace, workstreamId, view, diff, act, approve, posted };
}

const history = async (workspace: FixtureWorkspace) =>
  (
    (await workspace.api("conversations.history", { channel: weather })) as {
      messages: { ts: string; text: string; user?: string }[];
    }
  ).messages;

test("one change set moves a Jira story and posts in Slack: nothing is sent before the approval, and one revert undoes both", async (t) => {
  const app = await proposed(t, handOff);
  assert.deepEqual(app.posted(), []);
  assert.equal(
    app.site?.calls.some((c) => c.method === "POST"),
    false,
  );

  const approved = await app.approve();
  assert.equal(approved.body.changeSet.status, "applied");
  assert.equal(
    app.site?.calls.some((c) => c.method === "POST" && c.path.endsWith("/SYN-61/transitions")),
    true,
  );
  const [message] = await history(app.workspace);
  assert.equal(message?.text, ready);

  const reverted = await app.act("revert");
  assert.equal(reverted.status, 200);
  const revertId = reverted.body.revert;
  assert.ok(revertId);
  const undone = await app.approve(revertId);
  assert.equal(undone.body.changeSet.status, "applied");
  assert.notEqual((await history(app.workspace))[0]?.ts, message?.ts);
});

test("a revert stops, deleting nothing, once someone has replied to what it posted", async (t) => {
  const app = await proposed(t, handOff);
  await app.approve();
  const [message] = await history(app.workspace);
  assert.ok(message);
  app.workspace.replyAs("U0FWDARA01", weather, message.ts, "I'll take it.");
  const stopped = await app.act("revert");
  assert.equal(stopped.status, 409);
  assert.equal((await history(app.workspace))[0]?.ts, message.ts);
});
