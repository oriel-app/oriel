// The window's connection routes (decision 0049): every connection named by
// the ID the server made, connected through its connector's steps,
// configured with an Undo, synced and disconnected, each through the one
// dispatcher, with its events. A flag's connection is made again at every
// start, so the window neither configures nor disconnects it.
import assert from "node:assert/strict";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type TestContext, test } from "node:test";
import { type Call, instant, ulid } from "@oriel/core";
import { indexStore, open } from "@oriel/db";
import { fixtureGoogle, fixturePicks, loadSheetsFixture, standInToken } from "@oriel/sheets";
import type { ConnectionView, WorkstreamView } from "@oriel/web/view";
import { memorySecrets } from "./connection.ts";
import { connectionsOf } from "./connections.ts";
import { account, jiraOf, json, t0, testApp } from "./testing.ts";

const details = {
  site: "oriel.atlassian.net",
  email: account.email,
  token: account.token,
  project: "SYN",
};

async function connected(t: TestContext, db?: string) {
  const secrets = memorySecrets();
  const app = await testApp(t, { connect: { secrets }, ...(db ? { db } : {}) });
  const reply = await app.connect("jira", details);
  assert.equal(reply.status, 200);
  return { ...app, secrets, jira: json<{ connection: ConnectionView }>(reply).connection };
}

// The events a test cares about, without their times.
const events = (app: Awaited<ReturnType<typeof testApp>>, names: readonly string[]) =>
  app.app
    .telemetry()
    .filter((event) => names.includes(event.name))
    .map((event) => [event.name, event.data]);

test("the window lists each connection by the ID the server made, with what it identifies and never its secret", async (t) => {
  const app = await connected(t);
  assert.match(app.jira.id, /^[0-9A-HJKMNP-TV-Z]{26}$/);
  const listed = await app.connections();
  assert.deepEqual(
    listed.connections.map(({ id, kind, number, prefix, identity, options, state, flagged }) => ({
      id,
      kind,
      number,
      prefix,
      identity,
      options,
      state,
      flagged,
    })),
    [
      {
        id: app.jira.id,
        kind: "jira",
        number: 1,
        prefix: "jira",
        identity: "https://oriel.atlassian.net",
        options: { project: "SYN" },
        state: "open",
        flagged: false,
      },
    ],
  );
  // Jira is connected, and the folder can be, by its folder step.
  assert.deepEqual(listed.connectable, ["folder"]);
  assert.doesNotMatch(JSON.stringify(listed), new RegExp(account.token));
});

test("a connect names a kind and what was typed, never an ID: one the page sends is ignored", async (t) => {
  const app = await testApp(t, { connect: {} });
  const theirs = "01JBZ0000000000000000000K9";
  const reply = await app.post("/api/connections", {
    kind: "jira",
    id: theirs,
    given: { ...details, id: theirs },
  });
  assert.equal(reply.status, 200);
  const made = json<{ connection: ConnectionView }>(reply).connection;
  assert.notEqual(made.id, theirs);
  // A kind no connector declares, or one the window doesn't connect.
  assert.equal((await app.connect("memo", {})).status, 404);
  const slack = await app.connect("slack", {});
  assert.equal(slack.status, 400);
  assert.match(json<{ error: string }>(slack).error, /can't be connected from this window/);
  assert.equal((await app.connect("Jira!", details)).status, 400);
});

test("a connection's options are set with an Undo that puts back the ones they replaced, and the next sync reads with them", async (t) => {
  const app = await connected(t);
  const set = await app.post(`/api/connections/${app.jira.id}/options`, {
    options: { project: "OA" },
  });
  assert.equal(set.status, 200);
  const { connection, undo } = json<{ connection: ConnectionView; undo: Call }>(set);
  assert.deepEqual([connection.id, connection.options], [app.jira.id, { project: "OA" }]);
  assert.equal((await jiraOf(app)).connected?.project, "OA");
  // Its sync read the project it now names.
  const searched = app.site?.calls.filter((call) => call.path.includes("/search/jql")) ?? [];
  assert.ok(searched.length > 0);
  assert.deepEqual(undo, {
    action: "source.configure",
    input: { connection: app.jira.id, options: { project: "SYN" } },
  });
  // Counted by which option changed, never its value.
  assert.deepEqual(events(app, ["source.configured"]), [
    ["source.configured", { source: "jira", later: false, options: ["project"] }],
  ]);
  assert.doesNotMatch(JSON.stringify(app.app.telemetry()), /"OA"/);
  // Its Undo, through the one path every Undo takes.
  const undone = await app.post("/api/actions/source.configure", undo.input);
  assert.equal(undone.status, 200);
  assert.equal((await jiraOf(app)).connected?.project, "SYN");
  // The same options again change nothing, and have no Undo.
  const same = json<{ undo: Call | null }>(
    await app.post(`/api/connections/${app.jira.id}/options`, { options: { project: "SYN" } }),
  );
  assert.equal(same.undo, null);
});

test("options the connector's validator refuses change nothing; ones its source can't read now apply, and say why", async (t) => {
  const app = await connected(t);
  const path = `/api/connections/${app.jira.id}/options`;
  const invalid = await app.post(path, { options: { project: "not a key" } });
  assert.equal(invalid.status, 400);
  assert.equal(json<{ error: string }>(invalid).error, "$.project: expected a project key");
  assert.deepEqual(events(app, ["source.configured"]), []);
  // They apply at once, as Settings' do: the sync that reads with them
  // failing says why, as any sync does, and the next one reads with them.
  app.site?.outage("unexpected");
  const unread = await app.post(path, { options: { project: "OA" } });
  assert.equal(unread.status, 200);
  const { connection, problem, undo } = json<{
    connection: ConnectionView;
    problem?: string;
    undo: Call | null;
  }>(unread);
  assert.deepEqual(connection.options, { project: "OA" });
  assert.match(problem ?? "", /in a way Oriel didn't expect/);
  assert.ok(undo);
  assert.equal((await jiraOf(app)).connected?.project, "OA");
  // One the workspace doesn't have.
  const none = await app.post(`/api/connections/${"0".repeat(26)}/options`, { options: {} });
  assert.equal(none.status, 404);
});

test("a change set applied while its connection disconnects doesn't read it back in", async (t) => {
  const top = realpathSync(mkdtempSync(join(tmpdir(), "oriel-server-routes-")));
  t.after(() => rmSync(top, { recursive: true, force: true }));
  const db = join(top, "window.db");
  // The disconnect is held while it deletes the secret.
  const deleting = Promise.withResolvers<void>();
  const held = Promise.withResolvers<void>();
  const secrets = memorySecrets();
  const app = await testApp(t, {
    db,
    connect: {
      secrets: {
        ...secrets,
        delete: async (name) => {
          deleting.resolve();
          await held.promise;
          await secrets.delete(name);
        },
      },
    },
    plan: () => [{ run: "estimate" }],
    scripts: { estimate: async () => ({ writes: [["jira.setEstimate", ["jira:SYN-99", 5]]] }) },
  });
  const jira = json<{ connection: ConnectionView }>(await app.connect("jira", details)).connection;
  const { id: workstreamId } = json<{ id: string }>(
    await app.post("/api/workstreams", { kind: "picked", name: "Est", items: ["jira:SYN-99"] }),
  );
  const { id } = json<{ id: string }>(
    await app.post(`/api/workstreams/${workstreamId}/threads`, { text: "Estimate SYN-99" }),
  );
  await app.app.settled();
  const setId = json<{ changeSets: { id: string }[] }>(await app.get(`/api/threads/${id}`))
    .changeSets[0]?.id;
  assert.ok(setId);
  const { hash } = json<{ hash: string }>(await app.post(`/api/change-sets/${setId}/diff`));
  const gone = app.post(`/api/connections/${jira.id}/disconnect`);
  await deleting.promise;
  const approved = app.post(`/api/change-sets/${setId}/approve`, { hash });
  for (let i = 0; i < 20; i++) await new Promise((resolve) => setImmediate(resolve));
  held.resolve();
  assert.equal((await gone).status, 200);
  await approved;
  await app.app.settled();
  assert.deepEqual((await app.connections()).connections, []);
  // The index holds none of its items.
  const store = open(db);
  try {
    assert.equal(store.prepare("select count(*) as n from items").get()?.n, 0);
  } finally {
    store.close();
  }
});

test("what a change set wrote lately isn't read again by key once the options change", async (t) => {
  const app = await testApp(t, {
    connect: {},
    plan: () => [{ run: "estimate" }],
    scripts: { estimate: async () => ({ writes: [["jira.setEstimate", ["jira:SYN-99", 5]]] }) },
  });
  const jira = json<{ connection: ConnectionView }>(await app.connect("jira", details)).connection;
  const { id: workstreamId } = json<{ id: string }>(
    await app.post("/api/workstreams", { kind: "picked", name: "Est", items: ["jira:SYN-99"] }),
  );
  const { id } = json<{ id: string }>(
    await app.post(`/api/workstreams/${workstreamId}/threads`, { text: "Estimate SYN-99" }),
  );
  await app.app.settled();
  const setId = json<{ changeSets: { id: string }[] }>(await app.get(`/api/threads/${id}`))
    .changeSets[0]?.id;
  assert.ok(setId);
  const { hash } = json<{ hash: string }>(await app.post(`/api/change-sets/${setId}/diff`));
  assert.equal((await app.post(`/api/change-sets/${setId}/approve`, { hash })).status, 200);
  await app.app.settled();
  // Read by key while the search may lag the write...
  const byKey = () =>
    (app.site?.calls ?? []).filter((call) =>
      call.path.startsWith("/rest/api/3/issue/SYN-99?fields="),
    ).length;
  assert.equal((await app.sync("jira")).status, 200);
  const before = byKey();
  assert.ok(before > 0);
  // ...but not once the connection reads another project.
  const set = await app.post(`/api/connections/${jira.id}/options`, { options: { project: "OA" } });
  assert.equal(set.status, 200);
  assert.equal(byKey(), before);
});

test("a connection a flag makes can't be set or disconnected from the window", async (t) => {
  const app = await testApp(t);
  const jira = await app.connection("jira");
  assert.ok(jira);
  assert.equal(jira.flagged, true);
  const set = await app.post(`/api/connections/${jira.id}/options`, { options: { project: "OA" } });
  assert.equal(set.status, 409);
  assert.match(json<{ error: string }>(set).error, /A flag of pnpm dev makes this connection/);
  assert.equal((await app.post(`/api/connections/${jira.id}/disconnect`)).status, 409);
  assert.equal((await app.connection("jira"))?.state, "open");
});

test("disconnecting forgets the connection's secret, options and items, and connecting the same site again revives it", async (t) => {
  const top = realpathSync(mkdtempSync(join(tmpdir(), "oriel-server-routes-")));
  t.after(() => rmSync(top, { recursive: true, force: true }));
  const app = await connected(t, join(top, "window.db"));
  const { id: workstreamId } = json<{ id: string }>(
    await app.post("/api/workstreams", { kind: "picked", name: "Checkout", items: ["jira:SYN-1"] }),
  );
  const members = async () =>
    json<WorkstreamView>(await app.get(`/api/workstreams/${workstreamId}`)).members.map((m) => [
      m.ref.id,
      m.row !== null,
    ]);
  const gone = await app.post(`/api/connections/${app.jira.id}/disconnect`);
  assert.equal(gone.status, 200);
  assert.deepEqual(json(gone), { disconnected: app.jira.id, undo: null });
  assert.deepEqual([...app.secrets.kept.keys()], []);
  assert.deepEqual((await app.connections()).connections, []);
  assert.deepEqual(await jiraOf(app), { connected: null, connectable: true });
  // The workstream keeps its item, as one the index no longer has.
  assert.deepEqual(await members(), [["jira:SYN-1", false]]);
  // Gone, it can be neither synced nor disconnected again.
  assert.equal((await app.post(`/api/connections/${app.jira.id}/sync`)).status, 404);
  assert.equal((await app.post(`/api/connections/${app.jira.id}/disconnect`)).status, 404);
  // The same site again: the same ID, number and items' IDs.
  const back = json<{ connection: ConnectionView }>(await app.connect("jira", details));
  assert.deepEqual([back.connection.id, back.connection.prefix], [app.jira.id, "jira"]);
  assert.deepEqual(await members(), [["jira:SYN-1", true]]);
  assert.deepEqual(events(app, ["source.connected", "source.disconnected"]), [
    ["source.connected", { source: "jira", later: false }],
    ["source.disconnected", { source: "jira", later: false }],
    ["source.connected", { source: "jira", later: false }],
  ]);
});

test("a signed-out connection is listed as one, can be disconnected, and signing in again is counted as that", async (t) => {
  const top = realpathSync(mkdtempSync(join(tmpdir(), "oriel-server-routes-")));
  t.after(() => rmSync(top, { recursive: true, force: true }));
  const db = join(top, "window.db");
  const first = await connected(t, db);
  await first.app.close();
  for (const name of first.secrets.kept.keys())
    first.secrets.kept.set(name, JSON.stringify({ ...account, token: "revoked-since" }));
  const app = await testApp(t, { db, connect: { secrets: first.secrets } });
  const shut = await app.connection("jira");
  assert.deepEqual([shut?.id, shut?.state], [first.jira.id, "signed-out"]);
  // Signed out, it can't be synced or set.
  assert.equal((await app.post(`/api/connections/${first.jira.id}/sync`)).status, 409);
  const set = await app.post(`/api/connections/${first.jira.id}/options`, {
    options: { project: "OA" },
  });
  assert.equal(set.status, 409);
  assert.match(json<{ error: string }>(set).error, /signed out/);
  // Signing in again keeps it, and is counted as that.
  assert.equal((await app.connect("jira", details)).status, 200);
  assert.equal((await app.connection("jira"))?.state, "open");
  assert.deepEqual(events(app, ["source.signed-in-again"]), [
    ["source.signed-in-again", { source: "jira", later: false }],
  ]);
  // Signed out again, it can be disconnected all the same.
  await app.app.close();
  for (const name of first.secrets.kept.keys())
    first.secrets.kept.set(name, JSON.stringify({ ...account, token: "revoked-again" }));
  const again = await testApp(t, { db, connect: { secrets: first.secrets } });
  assert.equal((await again.connection("jira"))?.state, "signed-out");
  assert.equal((await again.post(`/api/connections/${first.jira.id}/disconnect`)).status, 200);
  assert.deepEqual((await again.connections()).connections, []);
  assert.deepEqual([...first.secrets.kept.keys()], []);
});

test("a connection kept from an earlier start opens again from its declaration, whatever its kind", async (t) => {
  const top = realpathSync(mkdtempSync(join(tmpdir(), "oriel-server-routes-")));
  t.after(() => rmSync(top, { recursive: true, force: true }));
  const db = join(top, "window.db");
  const secrets = memorySecrets();
  const made = await testApp(t, { db, connect: { secrets } });
  await made.app.close();
  // Kept as a connection made in the window is: Sheets, neither Jira nor
  // the folder, with its picks and its secret.
  const fixture = loadSheetsFixture();
  const store = open(db);
  const kept = await connectionsOf({
    db: store,
    index: indexStore(store),
    secrets,
    workspaceId: made.app.workspaceId,
    now: () => instant(new Date(t0)),
    newId: () => ulid(Date.parse(t0)),
    log: () => {},
  }).connect({
    kind: "sheets",
    identity: fixture.user.permissionId,
    options: fixturePicks(fixture),
    secret: JSON.stringify({ access: standInToken, expiresAt: Number.MAX_SAFE_INTEGER }),
  });
  store.close();
  assert.ok("connection" in kept);
  const again = await testApp(t, {
    db,
    connect: { secrets },
    sources: { sheets: { mode: "window", fetch: fixtureGoogle(fixture).fetch } },
  });
  const sheets = await again.connection("sheets");
  assert.deepEqual([sheets?.id, sheets?.state], [kept.connection.id, "open"]);
  assert.ok((sheets?.items ?? 0) > 0);
});
