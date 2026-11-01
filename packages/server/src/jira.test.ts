// Jira connected from the window: the user types its details, Oriel checks
// them against the site, and its items join the window with no restart. The
// site is SYN in memory; the token never comes back out.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type TestContext, test } from "node:test";
import type { JiraView, ThreadView, WindowView } from "@oriel/web/view";
import { fileStore, jiraSite, memoryStore } from "./connection.ts";
import { account, json, type Script, t0, testApp } from "./testing.ts";

const details = {
  site: "oriel.atlassian.net",
  email: account.email,
  token: account.token,
  project: "syn",
};

async function unconnected(t: TestContext, options: Parameters<typeof testApp>[1] = {}) {
  const store = memoryStore();
  const app = await testApp(t, { connect: { store }, ...options });
  return { ...app, store };
}

const epics = (view: WindowView) =>
  view.clusters.filter((c) => c.row.origin.kind === "source").map((c) => c.row.label);

test("before Jira is connected the window is empty and offers to connect it", async (t) => {
  const app = await unconnected(t);
  assert.deepEqual(json<{ jira: JiraView }>(await app.get("/api/jira")).jira, {
    connected: null,
    connectable: true,
  });
  const window = json<WindowView>(await app.get("/api/window?grouping=epic"));
  assert.equal(window.items, 0);
  assert.equal(window.fixture, false);
  assert.deepEqual(
    app.app.telemetry().filter((e) => e.name === "source.connected"),
    [],
  );
});

test("connecting Jira from the window syncs its epics in, with no restart", async (t) => {
  const app = await unconnected(t);
  const reply = await app.post("/api/jira", details);
  assert.equal(reply.status, 200);
  const { jira } = json<{ jira: JiraView }>(reply);
  assert.equal(jira.connectable, false);
  assert.equal(jira.connected?.site, "https://oriel.atlassian.net");
  assert.equal(jira.connected?.project, "SYN");
  assert.ok((jira.connected?.items ?? 0) > 100);
  // The same epics and items as the fixture the window shows without Jira.
  const window = json<WindowView>(await app.get("/api/window?grouping=epic"));
  const fixture = json<WindowView>(await (await testApp(t)).get("/api/window?grouping=epic"));
  assert.deepEqual(epics(window), epics(fixture));
  assert.equal(window.items, fixture.items);
  // The onboarding clock starts here.
  const connects = app.app.telemetry().filter((e) => e.name === "source.connected");
  assert.deepEqual(
    connects.map((e) => e.data.source),
    ["jira"],
  );
  assert.deepEqual(app.store.saved(), {
    site: "https://oriel.atlassian.net",
    email: account.email,
    token: account.token,
    project: "SYN",
  });
  // Once connected, it stays as it is.
  const again = await app.post("/api/jira", details);
  assert.equal(again.status, 400);
  assert.match(json<{ error: string }>(again).error, /already connected/);
});

test("a change set approved after connecting is written to that Jira", async (t) => {
  const app = await unconnected(t, {
    plan: () => [{ run: "estimate" }],
    scripts: { estimate: async () => ({ writes: [["jira.setEstimate", ["jira:SYN-99", 5]]] }) },
  });
  await app.post("/api/jira", details);
  const { id: workstreamId } = json<{ id: string }>(
    await app.post("/api/workstreams", {
      kind: "picked",
      name: "Estimates",
      items: ["jira:SYN-99"],
    }),
  );
  const { id } = json<{ id: string }>(
    await app.post(`/api/workstreams/${workstreamId}/threads`, { text: "Estimate SYN-99" }),
  );
  await app.app.settled();
  const thread = json<ThreadView>(await app.get(`/api/threads/${id}`));
  assert.equal(thread.writable, true);
  const setId = thread.changeSets[0]?.id;
  assert.ok(setId);
  const { hash } = json<{ hash: string }>(await app.post(`/api/change-sets/${setId}/diff`));
  const approved = await app.post(`/api/change-sets/${setId}/approve`, { hash });
  assert.equal(approved.status, 200);
  assert.equal(app.site?.issue("SYN-99")?.points, 5);
});

test("details Jira won't take are refused in plain words, and nothing is kept", async (t) => {
  const app = await unconnected(t);
  const refused = async (body: typeof details) => {
    const reply = await app.post("/api/jira", body);
    assert.equal(reply.status, 400);
    return json<{ error: string }>(reply).error;
  };
  assert.match(await refused({ ...details, token: "not-the-one" }), /didn't accept that email/);
  assert.match(await refused({ ...details, email: "other@example.com" }), /didn't accept/);
  assert.match(await refused({ ...details, project: "NOPE" }), /no project NOPE/);
  assert.match(await refused({ ...details, site: "acme.atlassian.net" }), /only to oriel/);
  assert.match(await refused({ ...details, site: "http://localhost:8080" }), /Type your Jira site/);
  assert.equal((await app.post("/api/jira", { ...details, token: "" })).status, 400);
  assert.equal((await app.post("/api/jira", { ...details, token: "x".repeat(5000) })).status, 413);
  assert.equal(app.store.saved(), null);
  assert.deepEqual(json<{ jira: JiraView }>(await app.get("/api/jira")).jira.connected, null);
  assert.equal(json<WindowView>(await app.get("/api/window?grouping=epic")).items, 0);
  // It still connects with the right ones.
  assert.equal((await app.post("/api/jira", details)).status, 200);
});

test("only this window can connect Jira, and the token never comes back out", async (t) => {
  const app = await unconnected(t);
  const elsewhere = await app.post("/api/jira", details, { origin: "https://attacker.example" });
  assert.equal(elsewhere.status, 403);
  const wrong = await app.post("/api/jira", { ...details, token: `${account.token}-x` });
  const right = await app.post("/api/jira", details);
  const replies = [elsewhere, wrong, right, await app.get("/api/jira")];
  for (const reply of replies) assert.doesNotMatch(String(reply.body), new RegExp(account.token));
  assert.doesNotMatch(JSON.stringify(app.logged), new RegExp(account.token));
  assert.doesNotMatch(JSON.stringify(app.app.telemetry()), new RegExp(account.token));
  assert.ok(app.logged.some((line) => line.message === "jira connected"));
});

test("a connection made in the window is there again when the server starts", async (t) => {
  const top = realpathSync(mkdtempSync(join(tmpdir(), "oriel-server-jira-")));
  t.after(() => rmSync(top, { recursive: true, force: true }));
  const db = join(top, "live.db");
  const store = fileStore(join(top, "secrets", "jira.json"));
  const first = await testApp(t, { db, connect: { store } });
  assert.equal((await first.post("/api/jira", details)).status, 200);
  await first.app.close();
  assert.equal(statSync(join(top, "secrets", "jira.json")).mode & 0o777, 0o600);
  assert.equal(statSync(join(top, "secrets")).mode & 0o777, 0o700);
  const again = await testApp(t, { db, connect: { store } });
  const { jira } = json<{ jira: JiraView }>(await again.get("/api/jira"));
  assert.deepEqual([jira.connected?.project, jira.connectable], ["SYN", false]);
  assert.ok((jira.connected?.items ?? 0) > 100);
  // Connected once, so starting again doesn't count as connecting.
  assert.equal(again.app.telemetry().filter((e) => e.name === "source.connected").length, 1);
});

test("a saved connection that can't be read stops the start without quoting it", (t) => {
  const top = realpathSync(mkdtempSync(join(tmpdir(), "oriel-server-jira-")));
  t.after(() => rmSync(top, { recursive: true, force: true }));
  const path = join(top, "jira.json");
  const store = fileStore(path);
  assert.equal(store.load(), null);
  store.save({ ...details, site: "https://oriel.atlassian.net", project: "SYN" });
  assert.equal(store.load()?.token, account.token);
  // Half a file: JSON.parse's own message would quote it.
  const broken = join(top, "broken.json");
  writeFileSync(broken, readFileSync(path, "utf8").slice(0, -10));
  assert.throws(
    () => fileStore(broken).load(),
    (error: Error) => !error.message.includes(account.token) && /can read/.test(error.message),
  );
});

test("Jira set up when the server starts can't be connected from the window", async (t) => {
  const app = await testApp(t);
  const { jira } = json<{ jira: JiraView }>(await app.get("/api/jira"));
  assert.equal(jira.connectable, false);
  assert.equal(jira.connected?.project, "SYN");
  const refused = await app.post("/api/jira", details);
  assert.equal(refused.status, 400);
});

test("a site is typed the ways people type it", () => {
  for (const typed of [
    "oriel",
    "oriel.atlassian.net",
    " Oriel.Atlassian.net/ ",
    "https://oriel.atlassian.net/jira/software/projects/SYN/boards/1",
  ])
    assert.equal(jiraSite(typed), "https://oriel.atlassian.net", typed);
  for (const typed of [
    "",
    "http://oriel.atlassian.net",
    "https://oriel.atlassian.net:8443",
    "https://user:pw@oriel.atlassian.net",
    "oriel.atlassian.net.evil.example",
    "169.254.169.254",
  ])
    assert.equal(jiraSite(typed), null, typed);
});

test("a saved connection Jira no longer takes is dropped, so the window asks again", async (t) => {
  const store = memoryStore({
    site: "https://oriel.atlassian.net",
    email: account.email,
    token: "revoked-since",
    project: "SYN",
  });
  const app = await testApp(t, { connect: { store } });
  const { jira } = json<{ jira: JiraView }>(await app.get("/api/jira"));
  assert.deepEqual(jira, { connected: null, connectable: true });
  assert.ok(app.logged.some((line) => line.message === "jira: the saved connection was refused"));
  assert.equal((await app.post("/api/jira", details)).status, 200);
  assert.equal(store.saved()?.token, account.token);
});

test("after a dropped connection, a change set from before says to connect Jira again", async (t) => {
  const top = realpathSync(mkdtempSync(join(tmpdir(), "oriel-server-jira-")));
  t.after(() => rmSync(top, { recursive: true, force: true }));
  const db = join(top, "window.db");
  const store = memoryStore();
  const estimate: Script = async () => ({ writes: [["jira.setEstimate", ["jira:SYN-99", 5]]] });
  const first = await testApp(t, {
    db,
    connect: { store },
    plan: () => [{ run: "estimate" }],
    scripts: { estimate },
  });
  await first.post("/api/jira", details);
  const { id: workstreamId } = json<{ id: string }>(
    await first.post("/api/workstreams", {
      kind: "picked",
      name: "Estimates",
      items: ["jira:SYN-99"],
    }),
  );
  const { id } = json<{ id: string }>(
    await first.post(`/api/workstreams/${workstreamId}/threads`, { text: "Estimate SYN-99" }),
  );
  await first.app.settled();
  const setId = json<ThreadView>(await first.get(`/api/threads/${id}`)).changeSets[0]?.id;
  assert.ok(setId);
  await first.app.close();
  const saved = store.saved();
  assert.ok(saved);
  const again = await testApp(t, {
    db,
    connect: { store: memoryStore({ ...saved, token: "revoked-since" }) },
  });
  const diff = await again.post(`/api/change-sets/${setId}/diff`);
  assert.equal(diff.status, 409);
  assert.match(json<{ error: string }>(diff).error, /Connect Jira in the window/);
  const thread = json<ThreadView>(await again.get(`/api/threads/${id}`));
  assert.equal(thread.writable, false);
});

test("a Jira project with no issues is connected, with none in the window", async (t) => {
  const app = await unconnected(t, { issues: () => [] });
  const reply = await app.post("/api/jira", details);
  assert.equal(reply.status, 200);
  const connected = {
    connected: { site: "https://oriel.atlassian.net", project: "SYN", items: 0, syncedAt: t0 },
    connectable: false,
  };
  assert.deepEqual(json<{ jira: JiraView }>(reply).jira, connected);
  assert.deepEqual(json<{ jira: JiraView }>(await app.get("/api/jira")).jira, connected);
  for (const grouping of ["epic", "assignee"])
    assert.equal(json<WindowView>(await app.get(`/api/window?grouping=${grouping}`)).items, 0);
  // Connecting an empty project starts the onboarding clock all the same.
  assert.deepEqual(
    app.app.telemetry().flatMap((e) => (e.name === "source.connected" ? [e.data.source] : [])),
    ["jira"],
  );
});

test("a Jira project whose issues are all done lists them, though nothing is stuck", async (t) => {
  const done = { name: "Done", category: "done" } as const;
  const app = await unconnected(t, {
    issues: (syn) => syn.map((issue) => ({ ...issue, status: done })),
  });
  const { jira } = json<{ jira: JiraView }>(await app.post("/api/jira", details));
  const items = jira.connected?.items ?? 0;
  assert.ok(items > 100);
  const epic = json<WindowView>(await app.get("/api/window?grouping=epic"));
  assert.ok(epic.items > 0);
  assert.ok(epic.clusters.flatMap((c) => c.list).every((row) => row.status?.category === "done"));
  const stuck = json<WindowView>(await app.get("/api/window?grouping=stuck"));
  assert.deepEqual(
    stuck.clusters.map((c) => [c.row.key, c.row.count]),
    [
      ["no-update-14-days", 0],
      ["unestimated", 0],
    ],
  );
});
