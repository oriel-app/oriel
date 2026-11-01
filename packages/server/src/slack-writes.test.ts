// Posting in Slack through a change set (OA-28), end to end through the
// routes: one change set moves a Jira story and posts in the team's channel,
// one approval applies both, and one revert undoes both. Jira is SYN in
// memory; Slack is the fixture's workspace in memory, which the test also
// acts in as others do.
import assert from "node:assert/strict";
import { type TestContext, test } from "node:test";
import { fixtureApi, type FixtureWorkspace } from "@oriel/slack";
import type { ChangeSetView, DiffView, GroupView, ThreadView } from "@oriel/web/view";
import { loadSlackFixture, weather } from "../../../scripts/fixtures/slack.ts";
import { devPlan, scriptedAgent } from "./scripted-agent.ts";
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
const answer: Script = async () => ({
  value: null,
  writes: [["slack.reply", [sms, "Thanks, picking it up."]]],
});

type Acted = { changeSet: ChangeSetView; error?: string; revert?: string };

async function proposed(t: TestContext, script: Script) {
  const workspace: FixtureWorkspace = fixtureApi(loadSlackFixture());
  const app = await testApp(t, {
    writes: true,
    slack: { kind: "fixture", workspace },
    plan: () => [{ run: "script" }],
    scripts: { script },
  });
  const { id: groupId } = json<{ id: string }>(
    await app.post("/api/groups", {
      kind: "picked",
      name: "SMS updates",
      items: ["jira:SYN-61", sms],
    }),
  );
  const { id: threadId } = json<{ id: string }>(
    await app.post(`/api/groups/${groupId}/threads`, { text: "Hand SYN-61 to the team" }),
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
  return { ...app, workspace, groupId, view, diff, act, approve, posted };
}

const history = async (workspace: FixtureWorkspace) =>
  (
    (await workspace.api("conversations.history", { channel: weather })) as {
      messages: { ts: string; text: string; user?: string }[];
    }
  ).messages;

test("one change set moves a Jira story and posts in Slack; one approval applies both, one revert undoes both", async (t) => {
  const app = await proposed(t, handOff);
  const shown = await app.diff();
  assert.deepEqual(
    shown.lines.map((line) => [line.kind, line.sentence]),
    [
      [
        "change",
        "Move “Send disruption updates by SMS to passengers without the app” (SYN-61) from To Do to In Progress.",
      ],
      ["create", "Post in #weather-disruptions as Amara Okafor."],
    ],
  );
  // The text exactly as it will read, as a field the diff shows.
  assert.deepEqual(shown.lines[1]?.makes, "message");
  assert.deepEqual(
    shown.lines[1]?.fields.map((f) => [f.name, f.before, f.after]),
    [["description", null, ready]],
  );
  // Nothing reached Slack before the approval.
  assert.deepEqual(app.posted(), []);

  const approved = await app.approve();
  assert.equal(approved.body.changeSet.status, "applied");
  assert.equal(
    app.site?.calls.some((c) => c.method === "POST" && c.path.endsWith("/SYN-61/transitions")),
    true,
  );
  const [message] = await history(app.workspace);
  assert.deepEqual([message?.text, message?.user], [ready, "U0FWAMARA1"]);
  const created = `slack:${weather}-${message?.ts}`;

  // The conversation it posted joins the group, with its title, as any
  // created item does; the thread follows.
  const group = json<GroupView>(await app.get(`/api/groups/${app.groupId}`));
  assert.deepEqual(
    group.members.map((m) => [m.ref.id, m.ref.title]),
    [
      ["jira:SYN-61", "Send disruption updates by SMS to passengers without the app"],
      [sms, group.members[1]?.ref.title ?? ""],
      [created, `Amara Okafor: ${ready}`],
    ],
  );
  const applied = app.app.telemetry().filter((e) => e.name === "changeset.applied");
  assert.deepEqual(
    applied.map((e) => e.data.sources),
    [["jira", "slack"]],
  );

  const reverted = await app.act("revert");
  assert.equal(reverted.status, 200);
  const revertId = reverted.body.revert;
  assert.ok(revertId);
  const undo = await app.diff(revertId);
  assert.deepEqual(
    undo.lines.map((line) => [line.kind, line.sentence]),
    [
      [
        "delete",
        `Delete the message “Amara Okafor: ${ready}” from #weather-disruptions. People there may already have seen it.`,
      ],
      [
        "change",
        "Move “Send disruption updates by SMS to passengers without the app” (SYN-61) from In Progress to To Do.",
      ],
    ],
  );
  const undone = await app.approve(revertId);
  assert.equal(undone.body.changeSet.status, "applied");
  assert.notEqual((await history(app.workspace))[0]?.ts, message?.ts);
  assert.deepEqual(
    app.app
      .telemetry()
      .filter((e) => e.name === "changeset.applied")
      .map((e) => e.data.sources),
    [
      ["jira", "slack"],
      ["jira", "slack"],
    ],
  );
});

test("a revert stops, deleting nothing, once someone has replied to what it posted", async (t) => {
  const app = await proposed(t, handOff);
  await app.approve();
  const [message] = await history(app.workspace);
  assert.ok(message);
  app.workspace.replyAs("U0FWDARA01", weather, message.ts, "I'll take it.");
  const stopped = await app.act("revert");
  assert.equal(stopped.status, 409);
  assert.equal(
    stopped.body.error,
    `Stopped, so nothing was overwritten: “Amara Okafor: ${ready}” was edited or replied to since Oriel posted it, so deleting it could take others' words with it.`,
  );
  assert.equal((await history(app.workspace))[0]?.ts, message.ts);
});

test("a reply goes in the conversation the group holds, and its revert stops on an edit", async (t) => {
  const app = await proposed(t, answer);
  const shown = await app.diff();
  assert.match(
    shown.lines[0]?.sentence ?? "",
    /^Reply in the conversation “Chen Yuting: @here the SMS copy for SYN-61 is ready for review.*” in #weather-disruptions as Amara Okafor\.$/,
  );
  assert.deepEqual(
    shown.lines[0]?.fields.map((f) => [f.name, f.before, f.after]),
    [["reply:new", null, "Thanks, picking it up."]],
  );
  assert.equal((await app.approve()).body.changeSet.status, "applied");
  const reply = app.posted()[0];
  assert.deepEqual(reply?.params.thread_ts, "1788782400.000100");

  // Its own diff now shows the reply Slack named, and how many there are.
  const after = await app.diff();
  const fields = after.lines[0]?.fields ?? [];
  assert.deepEqual(
    fields.map((f) => f.name.replace(/:\d+\.\d+$/, ":ts")),
    ["reply:ts", "replies"],
  );
  const ts = fields[0]?.name.slice("reply:".length) ?? "";
  app.workspace.edit(weather, ts, "Thanks, on it.", "U0FWAMARA1");
  const stopped = await app.act("revert");
  assert.equal(stopped.status, 409);
  assert.match(stopped.body.error ?? "", /the reply Oriel posted in “.+” was edited since\.$/);
});

// Its scripts run in the real sandbox, as `pnpm dev`'s do. This spawns Deno.
test("the dev server's scripted agent posts or replies when asked, beside the group's conversation", async (t) => {
  const { createSandbox } = await import("@oriel/sandbox");
  const sandbox = createSandbox();
  const app = await testApp(t, {
    slack: { kind: "fixture" },
    agent: (deps) => scriptedAgent({ ...deps, sandbox }, devPlan),
  });
  const { id: groupId } = json<{ id: string }>(
    await app.post("/api/groups", { kind: "picked", name: "SMS", items: ["jira:SYN-61", sms] }),
  );
  for (const [text, sentence] of [
    ["post: Ready to pick up.", /^Post in #weather-disruptions as Amara Okafor\./],
    ["reply: Thanks!", /^Reply in the conversation “Chen Yuting: /],
  ] as const) {
    const { id } = json<{ id: string }>(await app.post(`/api/groups/${groupId}/threads`, { text }));
    await app.app.settled();
    const thread = json<ThreadView>(await app.get(`/api/threads/${id}`));
    const entry = thread.entries.find((e) => e.kind === "change-set");
    assert.ok(entry?.kind === "change-set", text);
    const diff = json<DiffView>(await app.post(`/api/change-sets/${entry.changeSetId}/diff`));
    assert.match(diff.lines[0]?.sentence ?? "", sentence);
  }
});
