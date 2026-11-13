import assert from "node:assert/strict";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type TestContext, test } from "node:test";
import { type Call, instant, ulid } from "@oriel/core";
import { connectionStore, open } from "@oriel/db";
import type { ConnectionView, ThreadView } from "@oriel/web/view";
import { json, type Script, t0, testApp } from "./testing.ts";

const site = "https://oriel.atlassian.net";

async function connected(t: TestContext, options: Parameters<typeof testApp>[1] = {}) {
  const top = realpathSync(mkdtempSync(join(tmpdir(), "oriel-server-routes-")));
  t.after(() => rmSync(top, { recursive: true, force: true }));
  const db = join(top, "window.db");
  const made = await testApp(t, { db, jira: false });
  await made.app.close();
  const store = open(db);
  connectionStore(store).connect(
    made.app.workspaceId,
    { id: ulid(Date.parse(t0)), kind: "jira", identity: site, options: { project: "SYN" } },
    instant(new Date(t0)),
  );
  store.close();
  const app = await testApp(t, { ...options, db, atlassian: true });
  assert.equal((await app.turnOn("jira")).status, 200);
  const jira = await app.connection("jira");
  assert.ok(jira);
  return { ...app, jira };
}

function notes(t: TestContext): string {
  const path = realpathSync(mkdtempSync(join(tmpdir(), "oriel-server-routes-")));
  t.after(() => rmSync(path, { recursive: true, force: true }));
  writeFileSync(join(path, "plan.md"), "# Plan\n\nKiosk wallets first.\n");
  return path;
}

test("a connect never takes an ID from the page: one the page sends is ignored", async (t) => {
  const app = await testApp(t, { jira: false });
  const path = notes(t);
  const theirs = "01JBZ0000000000000000000K9";
  const reply = await app.post("/api/connections", {
    kind: "folder",
    id: theirs,
    given: { path, id: theirs },
  });
  assert.equal(reply.status, 200);
  const made = json<{ connection: ConnectionView }>(reply).connection;
  assert.notEqual(made.id, theirs);
});

test("read-only, a connection gets no writer and its namespace offers no write, until it may propose changes again", async (t) => {
  const inspect: Script = async (bindings) => ({ value: bindings.dts });
  const app = await connected(t, { plan: () => [{ run: "inspect" }], scripts: { inspect } });
  const { jira } = app;
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
  await app.post("/api/actions/source.configure", set.undo.input);
  assert.equal((await app.connection("jira"))?.readOnly, false);
  assert.match(await module(), /setSummary/);
});
