// The window's connection routes (decision 0049) where trust or data is at
// stake: a secret never sent to the page, an ID the page can't choose, a
// disconnect that deletes its secret and isn't undone by a racing apply, and
// a read-only connection that offers no write.
import assert from "node:assert/strict";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type TestContext, test } from "node:test";
import { type Call } from "@oriel/core";
import { open } from "@oriel/db";
import type { ConnectionView, ThreadView } from "@oriel/web/view";
import { memorySecrets } from "./connection.ts";
import { account, json, type Script, testApp } from "./testing.ts";

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

test("the window's list of connections never carries a connection's secret", async (t) => {
  const app = await connected(t);
  const listed = await app.connections();
  assert.ok(listed.connections.some((each) => each.id === app.jira.id));
  assert.doesNotMatch(JSON.stringify(listed), new RegExp(account.token));
});

test("a connect never takes an ID from the page: one the page sends is ignored", async (t) => {
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
  // Only the stand-in tracker, on in Jira's place (decision 0059).
  assert.deepEqual(
    (await app.connections()).connections.map((each) => [each.kind, each.own]),
    [["tracker", true]],
  );
  // The index holds none of its items.
  const store = open(db);
  try {
    assert.equal(store.prepare("select count(*) as n from items").get()?.n, 0);
  } finally {
    store.close();
  }
});

test("a signed-out connection can be disconnected, and disconnecting deletes its secret", async (t) => {
  const top = realpathSync(mkdtempSync(join(tmpdir(), "oriel-server-routes-")));
  t.after(() => rmSync(top, { recursive: true, force: true }));
  const db = join(top, "window.db");
  const first = await connected(t, db);
  await first.app.close();
  for (const name of first.secrets.kept.keys())
    first.secrets.kept.set(name, JSON.stringify({ ...account, token: "revoked-since" }));
  const app = await testApp(t, { db, connect: { secrets: first.secrets } });
  assert.equal((await app.connection("jira"))?.state, "signed-out");
  assert.equal((await app.post(`/api/connections/${first.jira.id}/disconnect`)).status, 200);
  assert.equal(await app.connection("jira"), null);
  assert.deepEqual([...first.secrets.kept.keys()], []);
});

test("read-only, a connection gets no writer and its namespace offers no write, until it may propose changes again", async (t) => {
  const inspect: Script = async (bindings) => ({ value: bindings.dts });
  const secrets = memorySecrets();
  const app = await testApp(t, {
    connect: { secrets },
    plan: () => [{ run: "inspect" }],
    scripts: { inspect },
  });
  const jira = json<{ connection: ConnectionView }>(await app.connect("jira", details)).connection;
  const { id: workstream } = json<{ id: string }>(
    await app.post("/api/workstreams", {
      kind: "picked",
      name: "Checkout",
      items: ["jira:SYN-10"],
    }),
  );
  const module = async () => {
    const { id } = json<{ id: string }>(
      await app.post(`/api/workstreams/${workstream}/threads`, { text: "What's left?" }),
    );
    await app.app.settled();
    const thread = json<ThreadView>(await app.get(`/api/threads/${id}`));
    const finished = thread.entries.find((entry) => entry.kind === "run.finished");
    assert.ok(finished?.kind === "run.finished");
    return JSON.parse(finished.run.returned ?? "null") as string;
  };
  assert.match(await module(), /setSummary/);
  const path = `/api/connections/${jira.id}/options`;
  const set = json<{ connection: ConnectionView; undo: Call }>(
    await app.post(path, { options: { readOnly: true } }),
  );
  assert.equal(set.connection.readOnly, true);
  const readOnly = await module();
  assert.match(readOnly, /declare const jira: \{/);
  assert.doesNotMatch(readOnly, /setSummary|createStory/);
  // May propose changes again, by its Undo.
  await app.post("/api/actions/source.configure", set.undo.input);
  assert.equal((await app.connection("jira"))?.readOnly, false);
  assert.match(await module(), /setSummary/);
});
