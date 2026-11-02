// A workstream ends done or deleted (decision 0028), in the stores: its done
// mark records which threads it marked, and a deleted one hides with its
// threads, rows kept.
import assert from "node:assert/strict";
import { test } from "node:test";
import { type Instant, instant, type Ulid, ulid } from "@oriel/core";
import { loadMigrations, migrate } from "./migrate.ts";
import { open } from "./open.ts";
import { threadStore } from "./threads.ts";
import { ensureWorkspace } from "./workspaces.ts";
import { workstreamStore } from "./workstreams.ts";

const t0 = instant(new Date(Date.UTC(2026, 9, 31, 9)));
const day = 24 * 60 * 60 * 1000;
const after = (ms: number): Instant => instant(new Date(Date.parse(t0) + ms));
const id = (n: number): Ulid => ulid(n, new Uint8Array(10));

// A workstream with three threads: working, dropped (opened 8 days before
// `now`) and marked done.
function fresh() {
  const db = open(":memory:");
  migrate(db, loadMigrations(), t0);
  const workspaceId = id(0);
  ensureWorkspace(db, { id: workspaceId, name: "test" }, t0);
  const workstreams = workstreamStore(db);
  const threads = threadStore(db);
  const workstreamId = id(1);
  workstreams.create(
    { id: workstreamId, workspaceId, name: "Kiosk", origin: { kind: "picked" } },
    [],
    t0,
  );
  const [dropped, working, done] = [id(2), id(3), id(4)];
  threads.open({ id: dropped, workspaceId, workstreamId }, t0);
  threads.open({ id: working, workspaceId, workstreamId }, after(8 * day));
  threads.open({ id: done, workspaceId, workstreamId }, after(8 * day));
  threads.markDone(done, after(8 * day));
  const now = after(8 * day + 1000);
  return { db, workspaceId, workstreams, threads, workstreamId, dropped, working, done, now };
}

test("a workstream's done mark marks its working and dropped threads, and reopening takes off only that mark", () => {
  const w = fresh();
  assert.equal(w.threads.get(w.dropped, w.now)?.state, "dropped");
  const marked = w.threads.markWorkstreamDone(w.workstreamId, w.now, {
    kind: "agent",
    threadId: w.working,
  });
  assert.deepEqual(marked?.toSorted(), [w.dropped, w.working].toSorted());
  assert.deepEqual(w.threads.workstreamDone(w.workstreamId, w.now), { at: w.now, by: "agent" });
  // Done already, it changes nothing.
  assert.equal(
    w.threads.markWorkstreamDone(w.workstreamId, after(9 * day), { kind: "user" }),
    null,
  );
  // Another mark's time takes nothing off.
  assert.equal(w.threads.reopenWorkstream(w.workstreamId, after(1), w.now), null);
  const later = after(9 * day);
  assert.deepEqual(
    w.threads.reopenWorkstream(w.workstreamId, w.now, later)?.toSorted(),
    [w.dropped, w.working].toSorted(),
  );
  assert.equal(w.threads.get(w.working, later)?.state, "working");
  assert.equal(w.threads.get(w.done, later)?.state, "done");
  assert.equal(w.threads.workstreamDone(w.workstreamId, later), null);
});

test("a deleted workstream hides its threads from every lookup, and restoring brings back each row as it was", () => {
  const w = fresh();
  w.workstreams.hide(w.workstreamId, w.now);
  assert.equal(w.workstreams.get(w.workstreamId), null);
  assert.deepEqual(w.workstreams.list(w.workspaceId), []);
  assert.deepEqual(w.threads.list(w.workspaceId, w.now), []);
  assert.deepEqual(w.threads.ofWorkstream(w.workstreamId, w.now), []);
  assert.equal(w.threads.get(w.done, w.now), null);
  // Only its own workspace brings it back.
  assert.equal(w.workstreams.restore(w.workstreamId, id(9)), false);
  assert.equal(w.workstreams.restore(w.workstreamId, w.workspaceId), true);
  assert.equal(w.workstreams.restore(w.workstreamId, w.workspaceId), false);
  assert.equal(w.threads.list(w.workspaceId, w.now).length, 3);
  assert.equal(w.threads.get(w.done, w.now)?.state, "done");
  // A thread uses it, so it isn't deleted with its log.
  assert.equal(w.workstreams.delete(w.workstreamId), false);
});
