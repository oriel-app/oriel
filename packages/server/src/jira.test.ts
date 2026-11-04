// Jira connected from the window: the user types its details, Oriel checks
// them against the site, and its items join the window with no restart. The
// site is SYN in memory; the token never comes back out.
import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type TestContext, test } from "node:test";
import type { JiraView, SetupView, ThreadView, WindowView } from "@oriel/web/view";
import { connectionStore, open } from "@oriel/db";
import {
  fileSecrets,
  jiraSite,
  legacyFile,
  legacySecret,
  memorySecrets,
  secretName,
} from "./connection.ts";
import { memorySetup } from "./setup/state.ts";
import { account, json, type Script, t0, testApp } from "./testing.ts";

const details = {
  site: "oriel.atlassian.net",
  email: account.email,
  token: account.token,
  project: "syn",
};

async function unconnected(t: TestContext, options: Parameters<typeof testApp>[1] = {}) {
  const secrets = memorySecrets();
  const app = await testApp(t, { connect: { secrets }, ...options });
  return { ...app, secrets };
}

// The secrets kept, by name, each a connection's: `connection.` and its ID.
const kept = (secrets: { kept: Map<string, string> }) =>
  [...secrets.kept].map(([name, value]) => {
    assert.match(name, /^connection\.[0-7][0-9A-HJKMNP-TV-Z]{25}$/);
    return JSON.parse(value) as unknown;
  });

// SYN's site as a connection the window made keeps it.
const synSaved = { site: "https://oriel.atlassian.net", ...account, project: "SYN" };

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
  // Its account is its connection's secret, and nothing else is.
  assert.deepEqual(kept(app.secrets), [account]);
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
  // The help to make a new one stays on screen, so the refusal points to it.
  assert.match(
    await refused({ ...details, token: "not-the-one" }),
    /didn't accept these two together\. .* make a new one \(step 2\)/,
  );
  assert.match(await refused({ ...details, email: "other@example.com" }), /didn't accept/);
  assert.match(await refused({ ...details, project: "NOPE" }), /no project NOPE/);
  assert.match(await refused({ ...details, site: "acme.atlassian.net" }), /only to oriel/);
  assert.match(
    await refused({ ...details, site: "http://localhost:8080" }),
    /Type your Jira address/,
  );
  assert.equal((await app.post("/api/jira", { ...details, token: "" })).status, 400);
  // A detail the window's check refuses is named alone, not beside the folder's.
  assert.equal(
    await refused({ ...details, token: "x".repeat(1100) }),
    "$.token: expected an API token",
  );
  assert.equal((await app.post("/api/jira", { ...details, token: "x".repeat(5000) })).status, 413);
  assert.deepEqual(kept(app.secrets), []);
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
  const db = join(top, "window.db");
  const secrets = fileSecrets(join(top, "secrets", "window"));
  const first = await testApp(t, { db, connect: { secrets } });
  assert.equal((await first.post("/api/jira", details)).status, 200);
  await first.app.close();
  const [connection] = connectionStore(open(db)).list(first.app.workspaceId);
  assert.ok(connection);
  assert.deepEqual(
    { ...connection, id: "", connectedAt: "" },
    {
      id: "",
      kind: "jira",
      number: 1,
      prefix: "jira",
      identity: "https://oriel.atlassian.net",
      name: null,
      options: { project: "SYN" },
      connectedAt: "",
      disconnectedAt: null,
    },
  );
  // One file, readable by its owner only, named for the connection; the
  // database keeps no secret.
  const file = join(top, "secrets", "window", secretName(connection.id));
  assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), account);
  assert.equal(statSync(file).mode & 0o777, 0o600);
  assert.equal(statSync(join(top, "secrets", "window")).mode & 0o777, 0o700);
  assert.doesNotMatch(readFileSync(db).toString("latin1"), new RegExp(account.token));
  const again = await testApp(t, { db, connect: { secrets } });
  const { jira } = json<{ jira: JiraView }>(await again.get("/api/jira"));
  assert.deepEqual([jira.connected?.project, jira.connectable], ["SYN", false]);
  assert.ok((jira.connected?.items ?? 0) > 100);
  // Connected once, so starting again doesn't count as connecting.
  assert.equal(again.app.telemetry().filter((e) => e.name === "source.connected").length, 1);
});

test("the connection saved before connections moves into one at the first start, and the old one goes", async (t) => {
  const top = realpathSync(mkdtempSync(join(tmpdir(), "oriel-server-jira-")));
  t.after(() => rmSync(top, { recursive: true, force: true }));
  const db = join(top, "window.db");
  // Under `pnpm dev`, a file; on the desktop app, the secret store's `jira`.
  const old = join(top, "secrets", "jira.json");
  mkdirSync(join(top, "secrets"));
  writeFileSync(old, `${JSON.stringify(synSaved)}\n`, { mode: 0o600 });
  const secrets = memorySecrets();
  const first = await testApp(t, { db, connect: { secrets, legacy: legacyFile(old) } });
  assert.equal(existsSync(old), false);
  assert.deepEqual(kept(secrets), [account]);
  const { jira } = json<{ jira: JiraView }>(await first.get("/api/jira"));
  assert.deepEqual([jira.connected?.site, jira.connected?.project], [synSaved.site, "SYN"]);
  assert.ok(first.logged.some((line) => line.message === "jira: the saved connection moved"));
  await first.app.close();

  const desktop = memorySecrets(new Map([["jira", JSON.stringify(synSaved)]]));
  const app = await testApp(t, { connect: { secrets: desktop, legacy: legacySecret(desktop) } });
  assert.deepEqual(
    [...desktop.kept.keys()].filter((name) => name === "jira"),
    [],
  );
  assert.deepEqual(kept(desktop), [account]);
  assert.ok(json<{ jira: JiraView }>(await app.get("/api/jira")).jira.connected);
  assert.doesNotMatch(JSON.stringify([first.logged, app.logged]), new RegExp(account.token));
});

test("a saved connection that can't be read is left where it is, unquoted, and the window asks for Jira", async (t) => {
  // Half of one: JSON.parse's own message would quote it.
  const half = JSON.stringify(synSaved).slice(0, -10);
  const secrets = memorySecrets(new Map([["jira", half]]));
  const app = await testApp(t, { connect: { secrets, legacy: legacySecret(secrets) } });
  assert.equal(secrets.kept.get("jira"), half);
  assert.deepEqual(json<{ jira: JiraView }>(await app.get("/api/jira")).jira, {
    connected: null,
    connectable: true,
  });
  assert.ok(app.logged.some((line) => /isn't one Oriel can read/.test(line.message)));
  assert.doesNotMatch(JSON.stringify(app.logged), new RegExp(account.token));
  // A store that doesn't answer is the same.
  const gone = await testApp(t, {
    connect: {
      legacy: {
        load: async () => {
          throw new Error("the shell is gone");
        },
        delete: async () => {},
      },
    },
  });
  assert.equal(json<{ jira: JiraView }>(await gone.get("/api/jira")).jira.connectable, true);
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

test("a connection Jira no longer takes is signed out, and signing in again keeps it", async (t) => {
  const top = realpathSync(mkdtempSync(join(tmpdir(), "oriel-server-jira-")));
  t.after(() => rmSync(top, { recursive: true, force: true }));
  const db = join(top, "window.db");
  const secrets = memorySecrets();
  const first = await testApp(t, { db, connect: { secrets } });
  assert.equal((await first.post("/api/jira", details)).status, 200);
  await first.app.close();
  const [name] = [...secrets.kept.keys()];
  assert.ok(name);
  secrets.kept.set(name, JSON.stringify({ ...account, token: "revoked-since" }));
  const app = await testApp(t, { db, connect: { secrets }, anySite: true });
  const { jira } = json<{ jira: JiraView }>(await app.get("/api/jira"));
  assert.deepEqual(jira, { connected: null, connectable: true });
  assert.ok(app.logged.some((line) => line.message === "jira: the saved connection was refused"));
  // Another site is refused while this one waits for its account.
  for (const path of ["/api/jira", "/api/jira/projects"]) {
    const elsewhere = await app.post(path, { ...details, site: "acme" });
    assert.equal(elsewhere.status, 400);
    assert.match(
      json<{ error: string }>(elsewhere).error,
      /one Jira site for now, oriel\.atlassian\.net\. Sign in to it again\./,
    );
  }
  assert.equal((await app.post("/api/jira", details)).status, 200);
  // The same connection, under the same name, with the account that works.
  assert.deepEqual([...secrets.kept.keys()], [name]);
  assert.deepEqual(kept(secrets), [account]);
});

test("after a dropped connection, a change set from before says to connect Jira again", async (t) => {
  const top = realpathSync(mkdtempSync(join(tmpdir(), "oriel-server-jira-")));
  t.after(() => rmSync(top, { recursive: true, force: true }));
  const db = join(top, "window.db");
  const secrets = memorySecrets();
  const estimate: Script = async () => ({ writes: [["jira.setEstimate", ["jira:SYN-99", 5]]] });
  const first = await testApp(t, {
    db,
    connect: { secrets },
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
  for (const name of secrets.kept.keys())
    secrets.kept.set(name, JSON.stringify({ ...account, token: "revoked-since" }));
  const again = await testApp(t, { db, connect: { secrets } });
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

test("the details typed list the projects they can see, and keep nothing (decision 0038)", async (t) => {
  const app = await unconnected(t);
  const { project: _, ...typed } = details;
  const reply = await app.post("/api/jira/projects", typed);
  assert.equal(reply.status, 200);
  const listed = json<{ projects: { key: string; issues: number | null }[]; more: boolean }>(reply);
  assert.deepEqual(
    listed.projects.map((p) => p.key),
    ["SYN"],
  );
  assert.ok((listed.projects[0]?.issues ?? 0) > 100);
  assert.equal(listed.more, false);
  assert.ok(!String(reply.body).includes(account.token));
  assert.deepEqual(kept(app.secrets), []);
  assert.equal(json<{ jira: JiraView }>(await app.get("/api/jira")).jira.connected, null);

  // A refusal names its fields, so the page marks them and keeps the help.
  const refused = await app.post("/api/jira/projects", { ...typed, token: "not-the-one" });
  assert.equal(refused.status, 400);
  assert.deepEqual(json<{ fields: string[] }>(refused).fields, ["email", "token"]);
  assert.match(json<{ error: string }>(refused).error, /didn't accept these two together/);
  const site = await app.post("/api/jira/projects", { ...typed, site: "localhost:8080" });
  assert.deepEqual(json<{ fields: string[] }>(site).fields, ["site"]);
});

test("on the desktop app any Jira Cloud site is tried; otherwise only the throwaway one", async (t) => {
  const { project: _, ...typed } = details;
  const elsewhere = { ...typed, site: "acme.atlassian.net" };
  const local = await unconnected(t);
  const refused = await local.post("/api/jira/projects", elsewhere);
  assert.match(json<{ error: string }>(refused).error, /only to oriel\.atlassian\.net/);
  const desktop = await unconnected(t, { anySite: true });
  // Tried: SYN in memory answers only for its own site, so this one is out of reach.
  const tried = await desktop.post("/api/jira/projects", elsewhere);
  assert.match(json<{ error: string }>(tried).error, /couldn't reach that address/);
  assert.deepEqual(json<{ fields: string[] }>(tried).fields, ["site"]);
  // Still only a Jira Cloud address, checked before credentials go anywhere.
  const http = await desktop.post("/api/jira/projects", {
    ...typed,
    site: "http://acme.atlassian.net",
  });
  assert.match(json<{ error: string }>(http).error, /Type your Jira address/);
});

test("Jira's first sync says what it has read, of the total Jira reports", async (t) => {
  const setup = {
    state: memorySetup(),
    fresh: true,
    home: tmpdir(),
    env: {},
    trust: async () => null,
  };
  const app = await unconnected(t, { anySite: true, setup });
  const reading = async () =>
    json<SetupView>(await app.get("/api/setup")).firstRun?.reading ?? null;
  assert.equal(await reading(), null);
  const searches = app.site?.hold("search");
  assert.ok(searches);
  const connecting = app.post("/api/jira", details);
  await searches.reached;
  const during = await reading();
  assert.equal(during?.project, "SYN");
  assert.equal(during?.read, 0);
  assert.ok((during?.total ?? 0) > 100);
  assert.equal(during?.stopped, false);
  searches.release();
  assert.equal((await connecting).status, 200);
  // Read whole: there's nothing more to show.
  assert.equal(await reading(), null);
});
