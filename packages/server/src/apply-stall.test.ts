// A change set stuck applying comes back to Needs you (OA-82): with no word
// from its source, the server looks once a send's lease could have run, and
// each minute after, and tells the window again whenever the engine says the
// apply has stalled, or moved again; the window reloads and shows it stuck.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  type Actor,
  type ApplyReport,
  type ChangeSet,
  type ChangeSets,
  instant,
  type Ulid,
  ulid,
} from "@oriel/core";
import { sendLeaseMs } from "@oriel/changeset";
import {
  ensureWorkspace,
  loadMigrations,
  migrate,
  open,
  threadStore,
  workstreamStore,
} from "@oriel/db";
import { type ActionDeps, type Changed, dispatcher } from "./actions.ts";
import { unreached } from "./testing.ts";

const t0 = instant(new Date(Date.UTC(2026, 10, 2, 9)));
const id = (n: number) => ulid(n, new Uint8Array(10));
const user: Actor = { kind: "user" };

// A thread with a change set whose apply ends only when the test says, an
// engine that says it stalled when the test does, and the timers the
// dispatcher set, which only the test runs.
function world() {
  const db = open(":memory:");
  migrate(db, loadMigrations(), t0);
  const workspaceId = id(0);
  ensureWorkspace(db, { id: workspaceId, name: "test" }, t0);
  const workstreams = workstreamStore(db);
  const threads = threadStore(db);
  const [workstreamId, threadId, changeSetId] = [id(1), id(2), id(50)];
  workstreams.create(
    { id: workstreamId, workspaceId, name: "Launch", origin: { kind: "picked" } },
    [],
    t0,
  );
  threads.open({ id: threadId, workspaceId, workstreamId }, t0);
  const set = { id: changeSetId, workspaceId, threadId } as ChangeSet;
  const ending = Promise.withResolvers<ApplyReport>();
  const engine = { stalled: false };
  const changeSets = unreached<ChangeSets>("changeSets", {
    get: async (asked) => (asked === changeSetId ? set : null),
    decide: async () => set,
    apply: () => ending.promise,
    stalled: () => engine.stalled,
  });
  const timers: { ms: number; fire: () => void; cancelled: boolean }[] = [];
  const published: Changed[] = [];
  const dispatch = dispatcher({
    workspaceId,
    workstreams,
    threads,
    records: () => [],
    clusters: () => [],
    created: async () => [],
    turns: unreached<ActionDeps["turns"]>("turns"),
    changeSets,
    applied: async () => {},
    edit: () => assert.fail("nothing is edited here"),
    sources: unreached("sources"),
    kinds: unreached("kinds"),
    markSeen: () => assert.fail("the overview isn't left here"),
    drafted: () => null,
    running: () => false,
    unsettled: async () => [],
    emit: () => {},
    later: (ms, fire) => {
      const timer = { ms, fire, cancelled: false };
      timers.push(timer);
      return () => {
        timer.cancelled = true;
      };
    },
    publish: (changed) => published.push(changed),
    now: () => t0,
    newId: () => id(100),
  });
  const told = () =>
    published.flatMap((changed) => ("applying" in changed ? [changed.applying] : []));
  // The timer set last, which is the one still to run.
  const next = () => timers.at(-1);
  return { dispatch, changeSetId, ending, engine, timers, told, next };
}

// Every promise the dispatcher has started has gone as far as it can.
const settled = () => new Promise((resolve) => setImmediate(resolve));

const report = (changeSetId: Ulid): ApplyReport => ({
  changeSetId,
  applied: [],
  skipped: [],
  failed: [],
});

test("an apply that stalls is told again, so the window shows it stuck, and again when it moves", async () => {
  const w = world();
  const approving = w.dispatch("changeset.approve", { changeSet: w.changeSetId, hash: "h" }, user);
  await settled();
  assert.deepEqual(w.told(), [true]);
  // Once the lease could have run, it looks: still sending, nothing to say.
  assert.equal(w.next()?.ms, sendLeaseMs);
  w.next()?.fire();
  assert.deepEqual(w.told(), [true]);
  // A minute on, it has stalled: the window hears it again, once.
  assert.equal(w.next()?.ms, 60_000);
  w.engine.stalled = true;
  w.next()?.fire();
  w.next()?.fire();
  assert.deepEqual(w.told(), [true, true]);
  // Its source answers and it moves on: told again.
  w.engine.stalled = false;
  w.next()?.fire();
  assert.deepEqual(w.told(), [true, true, true]);
  // It ends: told, and nothing looks again.
  w.ending.resolve(report(w.changeSetId));
  assert.deepEqual(await approving, { report: report(w.changeSetId), problem: null, undo: null });
  assert.deepEqual(w.told(), [true, true, true, false]);
  assert.equal(w.next()?.cancelled, true);
});
