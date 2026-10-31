import assert from "node:assert/strict";
import { test } from "node:test";
import { groupReplied, initGroup } from "../src/group.ts";
import type { Replied } from "../src/http.ts";
import { initJira, jiraReplied, loadJira, updateJira } from "../src/jira.ts";
import { init as initRoot, update as updateRoot } from "../src/root.ts";

const syn = {
  connected: {
    site: "https://oriel.atlassian.net",
    project: "SYN",
    items: 120,
    syncedAt: "2026-10-30T09:00:00.000Z",
  },
};
const replied = (tag: Replied["tag"], ok: boolean, body: unknown): Replied => ({
  type: "replied",
  tag,
  ok,
  body,
});
const sync = {
  type: "http",
  method: "POST",
  url: "/api/jira/sync",
  body: {},
  tag: { kind: "jiraSynced" },
};

test("Jira syncs on demand, once at a time, and says why when it can't", () => {
  assert.deepEqual(updateJira(initJira(), { type: "syncClicked" })[1], []);
  const shown = jiraReplied(initJira(), replied({ kind: "jira" }, true, { jira: syn })).model;
  const [syncing, effects] = updateJira(shown, { type: "syncClicked" });
  assert.deepEqual(effects, [sync]);
  assert.equal(syncing.syncing, true);
  assert.deepEqual(updateJira(syncing, { type: "syncClicked" })[1], []);

  const problem = "Oriel couldn't reach Jira just now, so the window may be behind it.";
  const failed = jiraReplied(syncing, replied({ kind: "jiraSynced" }, false, { error: problem }));
  assert.deepEqual(
    [failed.model.syncing, failed.model.problem, failed.model.view, failed.synced],
    [false, problem, syn, false],
  );
  const again = updateJira(failed.model, { type: "syncClicked" });
  assert.deepEqual([again[0].problem, again[1]], [null, [sync]]);
  const more = { connected: { ...syn.connected, items: 122 } };
  const done = jiraReplied(again[0], replied({ kind: "jiraSynced" }, true, { jira: more }));
  assert.deepEqual(
    [done.model, done.synced],
    [{ view: more, syncing: false, problem: null }, true],
  );
});

test("once Jira synced, the window and the group or thread on screen load again", () => {
  const [window, effects] = initRoot({ page: "window", grouping: "epic", addTo: null });
  assert.ok(effects.includes(loadJira));
  const synced = replied({ kind: "jiraSynced" }, true, { jira: syn });
  const [after, loads] = updateRoot(window, synced);
  assert.equal(after.jira.view, syn);
  assert.deepEqual(
    loads.map((e) => e.type),
    ["loadWindow"],
  );
  const [group] = initRoot({ page: "group", id: "01JB0000000000000000000000" });
  assert.deepEqual(updateRoot(group, synced)[1], [
    {
      type: "http",
      method: "GET",
      url: "/api/groups/01JB0000000000000000000000",
      tag: { kind: "groupSynced", id: "01JB0000000000000000000000" },
    },
  ]);
  const [thread] = initRoot({ page: "thread", id: "01JB0000000000000000000001" });
  assert.deepEqual(updateRoot(thread, synced)[1], [
    {
      type: "http",
      method: "GET",
      url: "/api/threads/01JB0000000000000000000001",
      tag: { kind: "thread", id: "01JB0000000000000000000001" },
    },
  ]);
});

test("a group reloaded after a sync keeps an Ask that's still on its way", () => {
  const [loading] = initGroup("01JB0000000000000000000000");
  const asking = { ...loading, pending: true, draft: "What's left?" };
  const view = { group: { id: "01JB0000000000000000000000" }, members: [] };
  const [after] = groupReplied(
    asking,
    replied({ kind: "groupSynced", id: "01JB0000000000000000000000" }, true, view),
  );
  assert.deepEqual([after.pending, after.draft, after.view], [true, "What's left?", view]);
});
