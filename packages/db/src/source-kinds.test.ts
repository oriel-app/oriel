import assert from "node:assert/strict";
import { test } from "node:test";
import { instant, ulid } from "@oriel/core";
import { loadMigrations, migrate } from "./migrate.ts";
import { open } from "./open.ts";
import { sourceKindStore } from "./source-kinds.ts";
import { ensureWorkspace } from "./workspaces.ts";

const t0 = instant(new Date(Date.UTC(2026, 10, 6, 9)));

function fresh() {
  const db = open(":memory:");
  migrate(db, loadMigrations(), t0);
  const workspaceId = ulid(0, new Uint8Array(10));
  ensureWorkspace(db, { id: workspaceId, name: "test" }, t0);
  return { db, workspaceId, store: sourceKindStore(db) };
}

test("migration 0032 keeps one choice a kind, on or off, with who made it", () => {
  const { db, workspaceId } = fresh();
  const insert = (kind: string, state: string, by = "person") =>
    db
      .prepare(
        "insert into source_kinds (workspace_id, kind, state, server, by, at) values (?, ?, ?, null, ?, ?)",
      )
      .run(workspaceId, kind, state, by, t0);
  insert("jira", "on");
  assert.throws(() => insert("jira", "off"), /UNIQUE|PRIMARY/);
  assert.throws(() => insert("slack", "maybe"), /CHECK/);
  assert.throws(() => insert("slack", "off", "tool"), /CHECK/);
  assert.throws(
    () =>
      db
        .prepare("insert into source_finds (workspace_id, agent, found, at) values (?, ?, ?, ?)")
        .run(workspaceId, "claude-code", "not json", t0),
    /CHECK/,
  );
});

test("a choice is kept, replaced, and forgotten, as an Undo back to none forgets it", () => {
  const { workspaceId, store } = fresh();
  assert.deepEqual([...store.choices(workspaceId)], []);
  store.choose(workspaceId, "jira", { state: "on", server: "work-tracker", by: "person" }, t0);
  store.choose(workspaceId, "slack", { state: "off", server: null, by: "agent" }, t0);
  store.choose(workspaceId, "jira", { state: "off", server: "work-tracker", by: "agent" }, t0);
  assert.deepEqual(Object.fromEntries(store.choices(workspaceId)), {
    jira: { state: "off", server: "work-tracker", by: "agent" },
    slack: { state: "off", server: null, by: "agent" },
  });
  store.choose(workspaceId, "slack", null, t0);
  assert.deepEqual([...store.choices(workspaceId).keys()], ["jira"]);
});

test("what a look found, and its card until dismissed", () => {
  const { workspaceId, store } = fresh();
  assert.equal(store.finds(workspaceId), null);
  const found = [{ kind: "jira", server: "work-tracker" }];
  store.keepFinds(
    workspaceId,
    { agent: "claude-code", found, card: { appeared: found, gone: [] } },
    t0,
  );
  assert.deepEqual(store.finds(workspaceId), {
    agent: "claude-code",
    found,
    card: { appeared: found, gone: [] },
  });
  store.dismiss(workspaceId);
  assert.deepEqual(store.finds(workspaceId), { agent: "claude-code", found, card: null });
});
