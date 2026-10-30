// What the server holds whatever agent is plugged in (SPEC §9), and what it
// records for the pilot (SPEC §7).
import assert from "node:assert/strict";
import { test } from "node:test";
import { type GroupMember, type IndexRecord, type Instant, ulid } from "@oriel/core";
import { ensureWorkspace, groupStore, loadMigrations, migrate, open, threadStore } from "@oriel/db";
import type { ThreadView } from "@oriel/web/view";
import type { Agent } from "./agent.ts";
import { host, json, type Script, t0, testApp } from "./testing.ts";
import { memberOf, views } from "./views.ts";

const checkout = { kind: "cluster", grouping: "epic", cluster: "10001" };

async function thread(t: Parameters<typeof testApp>[0], options: Parameters<typeof testApp>[1]) {
  const app = await testApp(t, options);
  const { id: groupId } = json<{ id: string }>(await app.post("/api/groups", checkout));
  const opened = await app.post(`/api/groups/${groupId}/threads`, { text: "One" });
  const { id } = json<{ id: string }>(opened);
  await app.app.settled();
  const view = async () => json<ThreadView>(await app.get(`/api/threads/${id}`));
  const say = async (text: string) => {
    const reply = await app.post(`/api/threads/${id}/messages`, { text });
    await app.app.settled();
    return reply;
  };
  return { ...app, groupId, id, view, say };
}

test("every line a run logs names its thread and its run, each proxied read included", async (t) => {
  const listed: Script = async (bindings) => ({
    value: (await bindings.read("items.list", [])).value,
  });
  const app = await thread(t, {
    plan: () => [{ run: "list" }, { run: "list" }],
    scripts: { list: listed },
  });
  const runIds = (await app.view()).entries.flatMap((e) =>
    e.kind === "run.started" ? [e.runId] : [],
  );
  assert.equal(runIds.length, 2);
  const reads = app.logged.filter((line) => line.message === "sandbox.read");
  assert.equal(reads.length, 2);
  for (const [i, line] of reads.entries()) {
    assert.equal(line.fields.thread_id, app.id);
    assert.equal(line.fields.run_id, runIds[i]);
  }
  const runs = app.logged.filter((line) => line.message === "sandbox.run");
  assert.ok(runs.every((line) => line.fields.thread_id === app.id && line.fields.run_id));
});

test("a thread that has asked its last question takes no more, and says why", async (t) => {
  const app = await thread(t, { limits: { maxTurnsPerThread: 2 } });
  assert.equal((await app.say("Two")).status, 202);
  const refused = await app.say("Three");
  assert.equal(refused.status, 409);
  assert.match(json<{ error: string }>(refused).error, /all 2 of its questions/);
  const after = await app.view();
  const last = after.entries.at(-1);
  assert.ok(last?.kind === "limit");
  assert.match(last.reason, /Start a new thread/);
  assert.equal(after.entries.filter((e) => e.kind === "user").length, 2);
  // Asking again doesn't repeat the notice.
  assert.equal((await app.say("Four")).status, 409);
  assert.equal((await app.view()).entries.length, after.entries.length);
});

test("a thread that has spent its tokens takes no more, whatever the agent does", async (t) => {
  const spending: Agent = {
    async *turn() {
      yield { kind: "done", usage: { inputTokens: 6, outputTokens: 5 } };
    },
  };
  // This agent never says it has reached a cap; the server holds it anyway.
  const app = await thread(t, { agent: () => spending, limits: { maxTokensPerThread: 10 } });
  const refused = await app.say("Two");
  assert.equal(refused.status, 409);
  assert.match(
    json<{ error: string }>(refused).error,
    /^This thread has used its 10 tokens\. Start a new thread on this group to keep going\.$/,
  );
  assert.equal((await app.view()).entries.at(-1)?.kind, "limit");
});

test("the first sync connects the source; marking a thread done is recorded", async (t) => {
  const app = await thread(t, {});
  assert.deepEqual(app.app.telemetry()[0], {
    name: "source.connected",
    at: t0,
    data: { source: "jira" },
  });
  app.advance(1000);
  await app.post(`/api/threads/${app.id}/done`);
  const done = app.app.telemetry().at(-1);
  assert.deepEqual([done?.name, done?.data.threadId], ["thread.marked-done", app.id]);
});

test("the window reports grouping and zoom changes, and nothing else", async (t) => {
  const app = await testApp(t);
  const send = (body: unknown, headers = {}) => app.post("/api/telemetry", body, headers);
  assert.equal((await send({ name: "grouping.switched", grouping: "stuck" })).status, 202);
  assert.equal((await send({ name: "zoom.changed", from: "cluster", to: "list" })).status, 202);
  assert.deepEqual(
    app.app
      .telemetry()
      .slice(-2)
      .map((e) => [e.name, e.data]),
    [
      ["grouping.switched", { grouping: "stuck" }],
      ["zoom.changed", { from: "cluster", to: "list" }],
    ],
  );
  for (const bad of [
    { name: "changeset.decided", changeSetId: "x" },
    { name: "grouping.switched", grouping: "toString" },
    { name: "zoom.changed", from: "cluster", to: "sideways" },
  ])
    assert.equal((await send(bad)).status, 400, JSON.stringify(bad));
  assert.equal(
    (await send({ name: "grouping.switched", grouping: "epic", pad: "x".repeat(300) })).status,
    413,
  );
  assert.equal(
    (
      await send(
        { name: "grouping.switched", grouping: "epic" },
        { origin: "https://attacker.example" },
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await app.handle({
        method: "POST",
        url: "/api/telemetry",
        headers: { host, "content-type": "application/json" },
        body: app.body('{"name":"grouping.switched","grouping":"epic"}'),
      })
    ).status,
    403,
  );
  assert.equal(app.app.telemetry().length, 3);
});

test("an item that moved keeps its title in a group's history and a thread's markers", () => {
  const db = open(":memory:");
  const at = t0 as Instant;
  migrate(db, loadMigrations(), at);
  const id = (n: number) => ulid(n, new Uint8Array(10));
  ensureWorkspace(db, { id: id(1), name: "test" }, at);
  const groups = groupStore(db);
  const threads = threadStore(db);
  groups.create({ id: id(2), workspaceId: id(1), name: "G", origin: { kind: "picked" } }, [], at);
  threads.open({ id: id(3), workspaceId: id(1), groupId: id(2) }, at);
  groups.add(id(2), [{ id: "jira:SYN-5", stableId: "10005" }], { kind: "user" }, at);
  threads.follow(id(2), at, () => id(4));
  // SYN-5 has since moved to another project: the index has it as OA-1.
  const moved = {
    id: "jira:OA-1",
    stableId: "10005",
    title: "Moved story",
    location: "https://oriel.atlassian.net/browse/OA-1",
    updatedAt: at,
    facets: {},
    attrs: {},
  } as IndexRecord;
  const shown = views({
    groups,
    threads,
    records: () => [moved],
    presentations: {},
    asOf: () => at,
    now: () => at,
    running: () => false,
    writable: false,
  });
  const added = shown.group(id(2))?.changes[0]?.added[0];
  assert.deepEqual([added?.key, added?.title], ["OA-1", "Moved story"]);
  const marker = shown
    .thread(id(3), [], new Map(), () => false)
    ?.entries.find((e) => e.kind === "marker");
  assert.ok(marker?.kind === "marker");
  assert.deepEqual(
    marker.added.map((r) => r.title),
    ["Moved story"],
  );
});

test("a member is found by identity, so a moved item is removed under its new handle", () => {
  const record = (id: string, stableId: string) => ({ id, stableId }) as IndexRecord;
  const held: GroupMember[] = [
    { id: "jira:SYN-5", stableId: "10005" },
    { id: "jira:SYN-6", stableId: "10006" },
  ];
  // SYN-5 moved to OA-1; SYN-6 was deleted, and its key reused by another item.
  const records = [record("jira:OA-1", "10005"), record("jira:SYN-6", "20006")];
  assert.equal(memberOf("jira:OA-1", held, records), held[0]);
  assert.equal(memberOf("jira:SYN-6", held, records), held[1]);
  assert.equal(memberOf("jira:SYN-5", held, records), undefined);
  assert.equal(memberOf("jira:SYN-7", held, records), undefined);
  // Still under its old handle while the index has it there.
  assert.equal(memberOf("jira:SYN-5", held, [record("jira:SYN-5", "10005")]), held[0]);
});
