// Ending a workstream (decision 0028), from its page's header or a menu or
// swipe on it in a list: Mark done or Reopen go at once; Delete asks first
// with how many threads go, and sends that count; each says what it did,
// with Undo through the one path every Undo takes. A done workstream leaves
// the sidebar for the Done page, and a deleted one's page isn't reloaded.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  deleteWarning,
  type Ended,
  endedText,
  endingReplied,
  initEnding,
  updateEnding,
} from "../src/ending.ts";
import type { Effect, Replied } from "../src/http.ts";
import { nav } from "../src/nav.ts";
import { init, type Model, update } from "../src/root.ts";
import { workstreamSummary, workstreamView } from "../testing.ts";

const workstreamId = "01JBZ0000000000000000000G1";
const at = "2026-10-30T09:00:00.000Z";
const launch: Ended = {
  id: workstreamId,
  name: "Launch",
  threads: { working: 2, done: 1, "handed-off": 0, dropped: 0 },
};

const replied = (tag: Replied["tag"], body: unknown, ok = true): Replied => ({
  type: "replied",
  tag,
  ok,
  body,
});

const requests = (effects: readonly Effect[]) =>
  effects.flatMap((e) =>
    e.type === "http" ? [`${e.method} ${e.url} ${JSON.stringify(e.body ?? null)}`] : [],
  );

const reopen = { action: "workstream.reopen", input: { workstream: workstreamId, mark: at } };
const restore = { action: "workstream.restore", input: { workstream: workstreamId } };

test("Mark done says what it did, with how many threads came along, and its Undo goes the one way every Undo does", () => {
  const [marking, sent] = updateEnding(initEnding(), {
    type: "markDoneClicked",
    workstream: launch,
  });
  assert.deepEqual(requests(sent), [`POST /api/workstreams/${workstreamId}/done {}`]);
  // One at a time.
  assert.deepEqual(updateEnding(marking, { type: "deleteClicked", workstream: launch })[1], []);
  const tag = { kind: "ended", id: workstreamId, how: "done", name: "Launch" } as const;
  const marked = endingReplied(
    marking,
    replied(tag, { ...workstreamView(), carried: 2, undo: reopen }),
  );
  assert.deepEqual(marked.ended, {
    kind: "done",
    workstreamId,
    name: "Launch",
    threads: 2,
    undo: reopen,
  });
  assert.equal(
    endedText(marked.ended ?? assert.fail()),
    "Marked “Launch” done, with 2 of its threads.",
  );
  const [undoing, undo] = updateEnding(marked, { type: "undoClicked" });
  assert.deepEqual(requests(undo), [
    `POST /api/actions/workstream.reopen {"workstream":"${workstreamId}","mark":"${at}"}`,
  ]);
  const back = endingReplied(undoing, replied({ ...tag, how: "undone" }, { undo: null }));
  assert.equal(back.ended, null);
});

test("Reopen goes at once, and says how many threads came back", () => {
  const [, sent] = updateEnding(initEnding(), { type: "reopenClicked", workstream: launch });
  assert.deepEqual(requests(sent), [`POST /api/workstreams/${workstreamId}/reopen {}`]);
  assert.equal(
    endedText({ kind: "reopened", name: "Launch", threads: 1 }),
    "Reopened “Launch”, with its thread.",
  );
});

test("Delete asks first, naming how many threads go, and sends that count; a refusal says why", () => {
  const [asking, none] = updateEnding(initEnding(), { type: "deleteClicked", workstream: launch });
  assert.deepEqual([asking.asking, none], [{ workstreamId, name: "Launch", threads: 3 }, []]);
  assert.match(deleteWarning(3), /^Its 3 threads go with it, .*You can undo this right after\.$/);
  assert.equal(deleteWarning(0), "It has no threads. Its items stay in their sources.");
  assert.equal(updateEnding(asking, { type: "deleteCancelled" })[0].asking, null);
  const [deleting, sent] = updateEnding(asking, { type: "deleteConfirmed" });
  assert.deepEqual(requests(sent), [`POST /api/workstreams/${workstreamId}/delete {"threads":3}`]);
  const tag = { kind: "ended", id: workstreamId, how: "deleted", name: "Launch" } as const;
  const refused = endingReplied(
    deleting,
    replied(tag, { error: "It has 4 threads now. Look again before deleting it." }, false),
  );
  assert.deepEqual(
    [refused.problem, refused.asking, refused.pending],
    ["It has 4 threads now. Look again before deleting it.", null, null],
  );
  const deleted = endingReplied(deleting, replied(tag, { threads: 3, undo: restore }));
  assert.equal(endedText(deleted.ended ?? assert.fail()), "Deleted “Launch”, with its 3 threads.");
  const [, undo] = updateEnding(deleted, { type: "undoClicked" });
  assert.deepEqual(requests(undo), [
    `POST /api/actions/workstream.restore {"workstream":"${workstreamId}"}`,
  ]);
});

test("once one ends, both lists load again; its page loads again unless it was deleted", () => {
  const [onPage] = init({ page: "workstream", id: workstreamId });
  const tag = (how: "done" | "deleted") =>
    ({ kind: "ended", id: workstreamId, how, name: "Launch" }) as const;
  const loads = (model: Model, msg: Replied) => requests(update(model, msg)[1]);
  assert.deepEqual(
    loads(onPage, replied(tag("done"), { ...workstreamView(), carried: 0, undo: null })),
    [
      "GET /api/workstreams null",
      "GET /api/threads null",
      `GET /api/workstreams/${workstreamId} null`,
    ],
  );
  const [gone] = update(onPage, replied(tag("deleted"), { threads: 2, undo: restore }));
  assert.deepEqual(loads(onPage, replied(tag("deleted"), { threads: 2, undo: restore })), [
    "GET /api/workstreams null",
    "GET /api/threads null",
  ]);
  // Whatever else changes meanwhile, the deleted page isn't asked for again.
  assert.ok(
    !requests(update(gone, { type: "threadsMoved" })[1]).some((r) => r.includes(workstreamId)),
  );
});

test("while a delete is in flight its page isn't asked for again, and leaving a page leaves what was done behind", () => {
  const [onPage] = init({ page: "workstream", id: workstreamId });
  const [asked] = update(onPage, {
    type: "ending",
    msg: { type: "deleteClicked", workstream: launch },
  });
  const [deleting] = update(asked, { type: "ending", msg: { type: "deleteConfirmed" } });
  assert.ok(
    !requests(update(deleting, { type: "threadsMoved" })[1]).some((r) => r.includes(workstreamId)),
  );
  const tag = { kind: "ended", id: workstreamId, how: "done", name: "Launch" } as const;
  const [marked] = update(onPage, replied(tag, { ...workstreamView(), carried: 1, undo: reopen }));
  assert.ok(marked.ending.ended);
  const [left] = update(marked, { type: "routed", route: { page: "done" } });
  assert.equal(left.ending.ended, null);
});

test("a done workstream leaves the sidebar's workstreams and leads the Done page's", () => {
  const [model] = init({ page: "done" });
  const open = workstreamSummary({ id: "01JBZ0000000000000000000G2", name: "Open" });
  const older = workstreamSummary({ id: "01JBZ0000000000000000000G3", done: { at, by: "user" } });
  const newer = workstreamSummary({
    id: workstreamId,
    done: { at: "2026-10-31T09:00:00.000Z", by: "agent" },
  });
  const where = nav({ ...model, workstreams: [older, open, newer] });
  assert.deepEqual(
    where.workstreams?.map((entry) => entry.workstream.id),
    [open.id],
  );
  assert.deepEqual(
    where.done.map((each) => each.id),
    [newer.id, older.id],
  );
});
