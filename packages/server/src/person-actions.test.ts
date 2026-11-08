// Who may take which window action through the dispatcher (OA-70): a
// person's actions, a review link's holder's, and none of them the agent's.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  type Actor,
  type ChangeSet,
  type ChangeSets,
  instant,
  type TelemetryEvent,
  ulid,
} from "@oriel/core";
import {
  ensureWorkspace,
  loadMigrations,
  migrate,
  open,
  threadStore,
  workstreamStore,
} from "@oriel/db";
import { ActionError, type ActionDeps, dispatcher, refusal } from "./actions.ts";
import { unreached } from "./testing.ts";

const t0 = instant(new Date(Date.UTC(2026, 9, 29, 9)));
const id = (n: number) => ulid(n, new Uint8Array(10));
const user: Actor = { kind: "user" };
const holder: Actor = { kind: "review-link", by: "Ana" };

// A workstream with a thread on it, and a change set (id 50) of that thread,
// which the engine stand-in only finds.
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
  const decided: string[] = [];
  const changeSets = unreached<ChangeSets>("changeSets", {
    get: async (asked) => (asked === changeSetId ? set : null),
    decide: async (_id, kind, approver) => {
      decided.push(`${kind} via ${approver.via}`);
      return set;
    },
    // An edit that changes nothing, and a dismissal of one dismissed already,
    // which the engine doesn't count.
    edit: async () => set,
    dismiss: async () => ({ changeSet: set, warnings: [] }),
  });
  const events: TelemetryEvent[] = [];
  const dispatch = dispatcher({
    workspaceId,
    workstreams,
    threads,
    records: () => [],
    clusters: () => [],
    created: async () => [],
    turns: unreached<ActionDeps["turns"]>("turns", { rejected: () => {} }),
    changeSets,
    applied: () => assert.fail("nothing applies here"),
    edit: () => assert.fail("nothing is edited here"),
    sources: unreached("sources"),
    kinds: unreached("kinds"),
    markSeen: () => assert.fail("the overview isn't left here"),
    drafted: () => null,
    running: () => false,
    unsettled: async () => [],
    emit: (event) => events.push(event),
    later: () => () => {},
    publish: () => {},
    now: () => t0,
    newId: () => id(100),
  });
  return { db, dispatch, threadId, changeSetId, decided, events };
}

test("a review link's holder may decide or dismiss a change set and nothing else, and the agent none of a person's actions", () => {
  const agent: Actor = { kind: "agent", threadId: id(2) };
  for (const action of ["changeset.approve", "changeset.reject", "changeset.dismiss"] as const)
    assert.equal(refusal(action, holder), null);
  for (const action of [
    "changeset.apply",
    "changeset.revert",
    "review-link.create",
    "thread.done",
  ] as const)
    assert.notEqual(refusal(action, holder), null);
  for (const action of [
    "changeset.approve",
    "source.connect",
    "source.disconnect",
    "thread.delete",
    "review-link.revoke",
  ] as const)
    assert.notEqual(refusal(action, agent), null);
  // Connecting and disconnecting are a person's whatever door, and setting
  // a connection's options is closed to outside tools as well as the agent
  // (decision 0049).
  const tool: Actor = { kind: "tool", name: "a coding agent" };
  for (const action of ["source.connect", "source.disconnect"] as const)
    assert.notEqual(refusal(action, tool), null);
  assert.notEqual(refusal("source.configure", agent), null);
  assert.notEqual(refusal("source.configure", tool), null);
  assert.equal(refusal("source.configure", { kind: "user" }), null);
  // Direct, but closed to the agent.
  for (const action of [
    "thread.open",
    "thread.say",
    "thread.stop",
    "thread.sync",
    "source.sync",
  ] as const)
    assert.notEqual(refusal(action, agent), null);
  // A sync renames a workstream after its anchor, as a change set may.
  assert.equal(refusal("workstream.rename", { kind: "sync", source: "jira" }), null);
});

test("only a review link's holder gives its token, and they must", async () => {
  const w = world();
  const invalid = (error: unknown) => error instanceof ActionError && error.code === "invalid";
  const decision = { changeSet: w.changeSetId, hash: "h" };
  await assert.rejects(w.dispatch("changeset.reject", { ...decision, token: "t" }, user), invalid);
  await assert.rejects(w.dispatch("changeset.reject", decision, holder), invalid);
  // A holder's reason waits for the user, and is shorter than the user's.
  await assert.rejects(
    w.dispatch("changeset.reject", { ...decision, token: "t", reason: "x".repeat(2001) }, holder),
    invalid,
  );
  await w.dispatch("changeset.reject", decision, user);
  await w.dispatch("changeset.reject", { ...decision, token: "t", reason: "No." }, holder);
  assert.deepEqual(w.decided, ["rejected via thread", "rejected via review-link"]);
});
