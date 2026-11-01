import assert from "node:assert/strict";
import { test } from "node:test";
import { deletionWarning } from "../src/closing.ts";
import type { Effect, Replied } from "../src/http.ts";
import { init, type Model, type Msg, update } from "../src/root.ts";
import type { ThreadView } from "../src/view.ts";

const threadId = "01JBZ0000000000000000000T1";
const workstreamId = "01JBZ0000000000000000000G1";

const replied = (tag: Replied["tag"], body: unknown, ok = true): Msg => ({
  type: "replied",
  tag,
  ok,
  body,
});
const closing = (msg: Extract<Msg, { type: "closing" }>["msg"]): Msg => ({ type: "closing", msg });
const run = (model: Model, ...msgs: Msg[]): [Model, Effect[]] =>
  msgs.reduce<[Model, Effect[]]>(([m], msg) => update(m, msg), [model, []]);
const urls = (effects: Effect[]) =>
  effects.map((e) =>
    e.type === "http" ? `${e.method} ${e.url}` : e.type === "navigate" ? e.route : e.type,
  );

const nothing = { applied: 0, reverted: 0, unconfirmed: 0, sources: [] };

test("marking a thread done from its menu posts as the page's button does, and reloads what shows it", () => {
  const [done] = init({ page: "done" });
  const [asked, effects] = run(done, closing({ type: "markDoneClicked", threadId, via: "menu" }));
  assert.deepEqual(effects, [
    {
      type: "http",
      method: "POST",
      url: `/api/threads/${threadId}/done`,
      body: { via: "menu" },
      tag: { kind: "markedDone", threadId },
    },
  ]);
  // Once at a time.
  assert.deepEqual(run(asked, closing({ type: "markDoneClicked", threadId, via: "menu" }))[1], []);
  const [, reloads] = run(asked, replied({ kind: "markedDone", threadId }, {}));
  assert.deepEqual(urls(reloads), ["GET /api/threads", "GET /api/workstreams"]);
  // A workstream's page lists its threads too.
  const [onWorkstream] = init({ page: "workstream", id: workstreamId });
  const [, workstream] = run(
    onWorkstream,
    closing({ type: "markDoneClicked", threadId, via: "menu" }),
    replied({ kind: "markedDone", threadId }, {}),
  );
  assert.deepEqual(urls(workstream), [
    "GET /api/threads",
    "GET /api/workstreams",
    `GET /api/workstreams/${workstreamId}`,
  ]);
});

test("a failed close says why, until dismissed", () => {
  const [done] = init({ page: "done" });
  const [failed, effects] = run(
    done,
    closing({ type: "markDoneClicked", threadId, via: "menu" }),
    replied({ kind: "markedDone", threadId }, { error: "no such thread" }, false),
  );
  assert.deepEqual(effects, []);
  assert.equal(failed.closing.problem, "no such thread");
  assert.deepEqual(failed.closing.pending, []);
  assert.equal(run(failed, closing({ type: "problemDismissed" }))[0].closing.problem, null);
});

test("delete asks once, after saying what it would lose, then leaves a page that showed the thread", () => {
  const [onThread] = init({ page: "thread", id: threadId });
  const [asking, effects] = run(
    onThread,
    closing({ type: "deleteClicked", threadId, title: "Plan kiosk wallets", via: "menu" }),
  );
  assert.deepEqual(urls(effects), [`GET /api/threads/${threadId}/deletion`]);
  assert.equal(asking.closing.asking?.title, "Plan kiosk wallets");
  // Not before the person has been told.
  assert.deepEqual(run(asking, closing({ type: "deleteConfirmed" }))[1], []);
  const [told] = run(asking, replied({ kind: "deletion", threadId }, nothing));
  assert.deepEqual(told.closing.asking?.deletion, nothing);
  const [deleting, sent] = run(told, closing({ type: "deleteConfirmed" }));
  assert.deepEqual(sent, [
    {
      type: "http",
      method: "POST",
      url: `/api/threads/${threadId}/delete`,
      body: { via: "menu" },
      tag: { kind: "deleted", threadId },
    },
  ]);
  const [done, after] = run(
    deleting,
    replied({ kind: "deleted", threadId }, { workstreamId, workstreamRemoved: false }),
  );
  assert.equal(done.closing.asking, null);
  assert.deepEqual(after.at(-1), {
    type: "navigate",
    route: { page: "workstream", id: workstreamId },
    replace: true,
  });
  // A workstream made for it went too: the Done page, then.
  const [, removed] = run(
    deleting,
    replied({ kind: "deleted", threadId }, { workstreamId, workstreamRemoved: true }),
  );
  assert.deepEqual(removed.at(-1), { type: "navigate", route: { page: "done" }, replace: true });
});

test("cancelling a delete deletes nothing, and a refused one keeps asking with why", () => {
  const [done] = init({ page: "done" });
  const [told] = run(
    done,
    closing({ type: "deleteClicked", threadId, title: "New thread", via: "menu" }),
    replied({ kind: "deletion", threadId }, nothing),
  );
  const [cancelled, none] = run(told, closing({ type: "deleteCancelled" }));
  assert.deepEqual([cancelled.closing.asking, none], [null, []]);
  const [refused, effects] = run(
    told,
    closing({ type: "deleteConfirmed" }),
    replied({ kind: "deleted", threadId }, { error: "The agent is still answering." }, false),
  );
  assert.deepEqual(effects, []);
  assert.equal(refused.closing.asking?.threadId, threadId);
  assert.equal(refused.closing.problem, "The agent is still answering.");
  assert.deepEqual(refused.closing.pending, []);
});

test("a thread deleted in another tab says so on its page, which then watches the other threads", () => {
  const [onThread] = init({ page: "thread", id: threadId });
  const view = { id: threadId, entries: [], lastSeq: 0, changeSets: [] } as unknown as ThreadView;
  const [loaded] = run(onThread, replied({ kind: "thread", id: threadId }, view));
  const [gone, effects] = run(loaded, { type: "streamed", event: { type: "deleted" } });
  assert.equal(gone.thread?.deleted, true);
  assert.deepEqual(urls(effects), [
    "unsubscribe",
    "watchThreads",
    "GET /api/threads",
    "GET /api/workstreams",
  ]);
});

test("what deleting would lose, in plain words", () => {
  assert.equal(deletionWarning(nothing), "Its chat and any change sets not applied go for good.");
  assert.equal(
    deletionWarning({ applied: 2, reverted: 1, unconfirmed: 0, sources: ["jira"] }),
    "It made 2 changes in Jira. After deleting the thread you can no longer revert them from Oriel.",
  );
  assert.equal(
    deletionWarning({ applied: 0, reverted: 2, unconfirmed: 0, sources: ["jira"] }),
    "What it changed in Jira was reverted. Its chat goes for good.",
  );
  assert.match(
    deletionWarning({ applied: 0, reverted: 0, unconfirmed: 1, sources: [] }),
    /^It sent 1 change to its source with no answer, so it may have been made\. After deleting the thread you can no longer revert it/,
  );
});
