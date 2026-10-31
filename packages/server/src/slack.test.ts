// Slack's picked channels, read-only: their messages join the window beside
// Jira's, under groupings that say Slack has no epics or assignees, and a
// group can hold both, read by its thread's region.
import assert from "node:assert/strict";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fixtureApi, type ReadMethod, SlackError } from "@oriel/slack";
import type { GroupView, ThreadView, WindowView } from "@oriel/web/view";
import { loadSlackFixture } from "../../../scripts/fixtures/slack.ts";
import { json, type Script, testApp } from "./testing.ts";

const fixture = loadSlackFixture();
const slackRows = (view: WindowView) =>
  view.clusters.flatMap((c) => c.list).filter((row) => row.id.startsWith("slack:"));

test("the picked channel's messages are in the window, in clusters that say Slack has no epics or assignees", async (t) => {
  const app = await testApp(t, { slack: { kind: "fixture" } });
  const byEpic = json<WindowView>(await app.get("/api/window?grouping=epic"));
  const own = byEpic.clusters.find((c) => c.row.key === "no-epics-in-source");
  assert.equal(own?.row.origin.kind, "derived");
  assert.equal(own?.list.length, 18);
  assert.equal(slackRows(byEpic).length, 18);
  const row = own?.list.find((r) => r.title.startsWith("Dara Nikolaidis: Decision:"));
  assert.deepEqual(row && { ...row, title: undefined }, {
    id: "slack:C0FW1WEATHR-1788444000.000100",
    key: "C0FW1WEATHR-1788444000.000100",
    title: undefined,
    type: "message",
    status: null,
    assignee: null,
    points: null,
    // Its last reply, on 20 September, as of the SYN window's 2 October.
    idleDays: 12,
  });
  const byAssignee = json<WindowView>(await app.get("/api/window?grouping=assignee"));
  const none = byAssignee.clusters.find((c) => c.row.key === "no-assignees-in-source");
  assert.equal(none?.list.filter((r) => r.id.startsWith("slack:")).length, 18);
  assert.equal(slackRows(byAssignee).length, 18);
  // A message isn't work that can be stuck.
  assert.deepEqual(slackRows(json<WindowView>(await app.get("/api/window?grouping=stuck"))), []);
  const connects = app.app.telemetry().filter((e) => e.name === "source.connected");
  assert.deepEqual(
    connects.map((e) => e.data.source),
    ["jira", "slack"],
  );
});

test("a group holds Jira items and Slack messages; its thread reads both, and no message text reaches the declarations", async (t) => {
  const inspect: Script = async (bindings) => ({
    value: { dts: bindings.dts, items: (await bindings.read("items.list", [])).value },
  });
  const app = await testApp(t, {
    slack: { kind: "fixture" },
    plan: () => [{ run: "inspect" }],
    scripts: { inspect },
  });
  const message = "slack:C0FW1WEATHR-1788444000.000100";
  const { id: groupId } = json<{ id: string }>(
    await app.post("/api/groups", {
      kind: "picked",
      name: "Fares after cancellations",
      items: ["jira:SYN-45", message],
    }),
  );
  const group = json<GroupView>(await app.get(`/api/groups/${groupId}`));
  assert.deepEqual(
    group.members.map((m) => [m.ref.id, m.ref.url]),
    [
      ["jira:SYN-45", "https://oriel.atlassian.net/browse/SYN-45"],
      [message, "https://ferrowick-example.slack.com/archives/C0FW1WEATHR/p1788444000000100"],
    ],
  );
  assert.equal(group.members[1]?.row?.type, "message");
  const added = app.app.telemetry().filter((e) => e.name === "group.created");
  assert.equal(added.length, 1);
  const { id } = json<{ id: string }>(
    await app.post(`/api/groups/${groupId}/threads`, { text: "What did the team decide?" }),
  );
  await app.app.settled();
  const thread = json<ThreadView>(await app.get(`/api/threads/${id}`));
  const finished = thread.entries.find((e) => e.kind === "run.finished");
  assert.ok(finished?.kind === "run.finished");
  const value = JSON.parse(finished.run.returned ?? "null") as {
    dts: string;
    items: { id: string; gone: boolean; title?: string; text?: string }[];
  };
  assert.ok(value.dts.includes(JSON.stringify(message)));
  // Read-only: Slack gets no namespace, only items.*.
  assert.doesNotMatch(value.dts, /declare const slack/);
  assert.doesNotMatch(value.dts, /Dara|Decision|fare they paid/);
  const read = value.items.find((item) => item.id === message);
  assert.equal(read?.gone, false);
  assert.match(read?.title ?? "", /^Dara Nikolaidis: Decision:/);
  assert.match(read?.text ?? "", /Farid Haddad replied, 2026-09-20T09:30:00\.000Z:\nPicking this/);
});

test("Slack syncs each time the server starts, and connects once", async (t) => {
  const top = realpathSync(mkdtempSync(join(tmpdir(), "oriel-server-slack-")));
  t.after(() => rmSync(top, { recursive: true, force: true }));
  const db = join(top, "oriel.db");
  const first = await testApp(t, { db, slack: { kind: "fixture" } });
  await first.app.close();
  const again = await testApp(t, { db, slack: { kind: "fixture" } });
  assert.equal(
    slackRows(json<WindowView>(await again.get("/api/window?grouping=epic"))).length,
    18,
  );
  const connects = again.app.telemetry().filter((e) => e.name === "source.connected");
  assert.deepEqual(
    connects.map((e) => e.data.source),
    ["jira", "slack"],
  );
});

// Slack's Web API over fetch, answered from the fixture: the live path end to
// end, with no network.
function fixtureFetch() {
  const { api, calls } = fixtureApi(fixture);
  const send: typeof fetch = async (input, init) => {
    const method = String(input).replace("https://slack.com/api/", "") as ReadMethod;
    const params = Object.fromEntries(new URLSearchParams(String(init?.body)));
    const body = await api(method, params).catch((error: unknown) => {
      if (error instanceof SlackError) return { ok: false, error: error.code };
      throw error;
    });
    return new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });
  };
  return { send, calls };
}

test("live Slack reads only the channels picked by name, through the Web API", async (t) => {
  const { send, calls } = fixtureFetch();
  const credential = { headers: async () => ({ Authorization: "Bearer xoxp-test" }) };
  const app = await testApp(t, {
    slack: { kind: "live", credential, channels: ["#weather-disruptions"], fetch: send },
  });
  assert.equal(slackRows(json<WindowView>(await app.get("/api/window?grouping=epic"))).length, 18);
  assert.ok(
    calls.every((c) => c.params.channel === undefined || c.params.channel === "C0FW1WEATHR"),
  );
  await assert.rejects(
    testApp(t, { slack: { kind: "live", credential, channels: ["weather"], fetch: send } }),
    /Slack has no public channel Oriel can see named #weather/,
  );
});

test("a Slack message's link dropped on a group adds it", async (t) => {
  const app = await testApp(t, { slack: { kind: "fixture" } });
  const { id } = json<{ id: string }>(
    await app.post("/api/groups", { kind: "picked", name: "Fares", items: ["jira:SYN-45"] }),
  );
  const link = "https://ferrowick-example.slack.com/archives/C0FW1WEATHR/p1788444000000100";
  const dropped = json<{ added: string[]; refused: unknown[] }>(
    await app.post(`/api/groups/${id}/drop`, { links: [link], files: [] }),
  );
  assert.deepEqual(dropped.added, ["slack:C0FW1WEATHR-1788444000.000100"]);
  assert.deepEqual(dropped.refused, []);
});
