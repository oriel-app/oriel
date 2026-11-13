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
  const next = () => timers.at(-1);
  return { dispatch, changeSetId, ending, engine, timers, told, next };
}

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
  assert.equal(w.next()?.ms, sendLeaseMs);
  w.next()?.fire();
  assert.deepEqual(w.told(), [true]);
  assert.equal(w.next()?.ms, 60_000);
  w.engine.stalled = true;
  w.next()?.fire();
  w.next()?.fire();
  assert.deepEqual(w.told(), [true, true]);
  w.engine.stalled = false;
  w.next()?.fire();
  assert.deepEqual(w.told(), [true, true, true]);
  w.ending.resolve(report(w.changeSetId));
  assert.deepEqual(await approving, { report: report(w.changeSetId), problem: null, undo: null });
  assert.deepEqual(w.told(), [true, true, true, false]);
  assert.equal(w.next()?.cancelled, true);
});
