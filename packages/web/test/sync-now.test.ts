// Sync now, in a thread's right rail: one request at a time, none while a
// turn runs, and the reply is the thread at its new version.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { Effect, Replied } from "../src/http.ts";
import { initThread, type ThreadModel, threadReplied, updateThread } from "../src/thread.ts";
import { threadView } from "../testing.ts";

const id = "01JBZ0000000000000000000T1";
const behind = threadView({
  id,
  regionVersion: 1,
  workstream: { id: "G", name: "Launch", version: 2 },
});

const loaded = (view = behind): ThreadModel =>
  threadReplied(initThread(id)[0], {
    type: "replied",
    tag: { kind: "thread", id },
    ok: true,
    body: view,
  })[0];
const synced = (ok: boolean, body: unknown): Replied => ({
  type: "replied",
  tag: { kind: "synced", threadId: id, statuses: 0 },
  ok,
  body,
});
const posts = (effects: Effect[]) =>
  effects.flatMap((effect) =>
    effect.type === "http" && effect.method === "POST" ? [effect.url] : [],
  );

test("Sync now asks once, and the reply shows the thread at its new version", () => {
  const [syncing, effects] = updateThread(loaded(), { type: "syncClicked" });
  assert.equal(syncing.syncing, true);
  assert.deepEqual(posts(effects), [`/api/threads/${id}/sync`]);
  // A second click while the first is in flight asks nothing more.
  assert.deepEqual(updateThread(syncing, { type: "syncClicked" })[1], []);

  const caught = threadView({
    id,
    regionVersion: 2,
    workstream: { id: "G", name: "Launch", version: 2 },
    members: [
      { ref: { id: "jira:SYN-10", key: "SYN-10", title: "Wallets", url: null }, row: null },
    ],
  });
  const [shown] = threadReplied(syncing, synced(true, caught));
  assert.equal(shown.syncing, false);
  assert.equal(shown.view?.regionVersion, 2);
  assert.deepEqual(
    shown.view?.members.map((member) => member.ref.key),
    ["SYN-10"],
  );
});

test("Sync now waits while a turn runs, and says why a refused one didn't move", () => {
  assert.deepEqual(
    updateThread(loaded({ ...behind, running: true }), { type: "syncClicked" })[1],
    [],
  );
  const [syncing] = updateThread(loaded(), { type: "syncClicked" });
  const said = "The agent is still answering; stop it or wait for it to finish.";
  const [refused] = threadReplied(syncing, synced(false, { error: said }));
  assert.equal(refused.syncing, false);
  assert.equal(refused.notice, said);
  assert.equal(refused.view?.regionVersion, 1);
});
