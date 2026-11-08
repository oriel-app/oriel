// Jira connected from the window: what's refused keeps nothing, the token
// never comes back out, and a connection's secret is kept, moved and signed
// in again without being lost. The site is SYN in memory.
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
import { connectionStore, open } from "@oriel/db";
import { fileSecrets, legacyFile, legacySecret, memorySecrets, secretName } from "./connection.ts";
import { account, jiraOf, json, testApp } from "./testing.ts";

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

test("details Jira won't take are refused, and nothing is kept", async (t) => {
  const app = await unconnected(t);
  const refused = async (body: typeof details, status = 400) =>
    assert.equal(
      (await app.connect("jira", body)).status,
      status,
      JSON.stringify(body).slice(0, 80),
    );
  await refused({ ...details, token: "not-the-one" });
  await refused({ ...details, email: "other@example.com" });
  await refused({ ...details, project: "NOPE" });
  // Credentials go to the one site only, never to a local address.
  await refused({ ...details, site: "acme.atlassian.net" });
  await refused({ ...details, site: "http://localhost:8080" });
  await refused({ ...details, token: "" });
  await refused({ ...details, token: "x".repeat(1100) });
  await refused({ ...details, token: "x".repeat(5000) }, 413);
  assert.deepEqual(kept(app.secrets), []);
  assert.deepEqual((await jiraOf(app)).connected, null);
  assert.equal(app.app.window("epic").items, 0);
  // It still connects with the right ones.
  assert.equal((await app.connect("jira", details)).status, 200);
});

test("only this window can connect Jira, and the token never comes back out", async (t) => {
  const app = await unconnected(t);
  const elsewhere = await app.post(
    "/api/connections",
    { kind: "jira", given: details },
    { origin: "https://attacker.example" },
  );
  assert.equal(elsewhere.status, 403);
  const wrong = await app.connect("jira", { ...details, token: `${account.token}-x` });
  const right = await app.connect("jira", details);
  const replies = [elsewhere, wrong, right, await app.get("/api/connections")];
  for (const reply of replies) assert.doesNotMatch(String(reply.body), new RegExp(account.token));
  assert.doesNotMatch(JSON.stringify(app.logged), new RegExp(account.token));
  assert.doesNotMatch(JSON.stringify(app.app.telemetry()), new RegExp(account.token));
  assert.ok(app.logged.length > 0);
});

test("a connection made in the window is there again when the server starts", async (t) => {
  const top = realpathSync(mkdtempSync(join(tmpdir(), "oriel-server-jira-")));
  t.after(() => rmSync(top, { recursive: true, force: true }));
  const db = join(top, "window.db");
  const secrets = fileSecrets(join(top, "secrets", "window"));
  const first = await testApp(t, { db, connect: { secrets } });
  assert.equal((await first.connect("jira", details)).status, 200);
  await first.app.close();
  const [connection] = connectionStore(open(db)).list(first.app.workspaceId);
  assert.ok(connection);
  assert.deepEqual(
    [connection.kind, connection.identity, connection.options],
    ["jira", "https://oriel.atlassian.net", { project: "SYN" }],
  );
  // One file, readable by its owner only, named for the connection; the
  // database keeps no secret.
  const file = join(top, "secrets", "window", secretName(connection.id));
  assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), account);
  assert.equal(statSync(file).mode & 0o777, 0o600);
  assert.equal(statSync(join(top, "secrets", "window")).mode & 0o777, 0o700);
  assert.doesNotMatch(readFileSync(db).toString("latin1"), new RegExp(account.token));
  const again = await testApp(t, { db, connect: { secrets } });
  const jira = await jiraOf(again);
  assert.deepEqual([jira.connected?.project, jira.connectable], ["SYN", false]);
  assert.ok((jira.connected?.items ?? 0) > 100);
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
  const jira = await jiraOf(first);
  assert.deepEqual([jira.connected?.site, jira.connected?.project], [synSaved.site, "SYN"]);
  await first.app.close();

  const desktop = memorySecrets(new Map([["jira", JSON.stringify(synSaved)]]));
  const app = await testApp(t, { connect: { secrets: desktop, legacy: legacySecret(desktop) } });
  assert.deepEqual(
    [...desktop.kept.keys()].filter((name) => name === "jira"),
    [],
  );
  assert.deepEqual(kept(desktop), [account]);
  assert.ok((await jiraOf(app)).connected);
  assert.doesNotMatch(JSON.stringify([first.logged, app.logged]), new RegExp(account.token));
});

test("a saved connection that can't be read is left where it is, unquoted, and the window asks for Jira", async (t) => {
  // Half of one: JSON.parse's own message would quote it.
  const half = JSON.stringify(synSaved).slice(0, -10);
  const secrets = memorySecrets(new Map([["jira", half]]));
  const app = await testApp(t, { connect: { secrets, legacy: legacySecret(secrets) } });
  assert.equal(secrets.kept.get("jira"), half);
  assert.deepEqual(await jiraOf(app), {
    connected: null,
    connectable: true,
  });
  assert.ok(app.logged.length > 0);
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
  assert.equal((await jiraOf(gone)).connectable, true);
});

test("a connection Jira no longer takes is signed out, and signing in again keeps it", async (t) => {
  const top = realpathSync(mkdtempSync(join(tmpdir(), "oriel-server-jira-")));
  t.after(() => rmSync(top, { recursive: true, force: true }));
  const db = join(top, "window.db");
  const secrets = memorySecrets();
  const first = await testApp(t, { db, connect: { secrets } });
  assert.equal((await first.connect("jira", details)).status, 200);
  await first.app.close();
  const [name] = [...secrets.kept.keys()];
  assert.ok(name);
  secrets.kept.set(name, JSON.stringify({ ...account, token: "revoked-since" }));
  const app = await testApp(t, { db, connect: { secrets }, anySite: true });
  const jira = await jiraOf(app);
  assert.deepEqual(jira, { connected: null, connectable: true });
  // What the index had of it still shows while it waits for its account.
  assert.match(JSON.stringify(app.app.window("epic")), /"jira:SYN-1"/);
  // Another site is refused while this one waits for its account.
  for (const path of ["/api/connections", "/api/connections/pick"]) {
    const elsewhere = await app.post(path, { kind: "jira", given: { ...details, site: "acme" } });
    assert.equal(elsewhere.status, 400);
  }
  assert.equal((await app.connect("jira", details)).status, 200);
  // The same connection, under the same name, with the account that works.
  assert.deepEqual([...secrets.kept.keys()], [name]);
  assert.deepEqual(kept(secrets), [account]);
});

test("on the desktop app, where any Jira Cloud site is tried, an address that isn't https is refused before credentials go anywhere", async (t) => {
  const { project: _, ...typed } = details;
  const desktop = await unconnected(t, { anySite: true });
  const http = await desktop.post("/api/connections/pick", {
    kind: "jira",
    given: { ...typed, site: "http://acme.atlassian.net" },
  });
  assert.equal(http.status, 400);
  assert.deepEqual(json<{ fields: string[] }>(http).fields, ["site"]);
});
