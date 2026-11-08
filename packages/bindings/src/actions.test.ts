// Oriel's own actions in the agent's module (decision 0024): generated from
// the registry, typed as the agent's door has them, and only recorded, each
// checked by the host.
import assert from "node:assert/strict";
import { test } from "node:test";
import { type ActionDeclaration, actions, type Ulid, ulid } from "@oriel/core";
import { intentFns, windowIntentFns } from "./actions.ts";
import { bindingsFor } from "./bindings.ts";
import { fixtureReader, fixtureRegion, namespaces, snapshotAfter } from "./testing.ts";

const reader = fixtureReader(snapshotAfter(0));
const threadId: Ulid = ulid(1, new Uint8Array(10));
const region = fixtureRegion("boarding-epic");
const own = () => bindingsFor(region, { reader, namespaces, thread: threadId });

test("no action closed to the agent, or a person's alone, is one of its functions", () => {
  for (const fn of [...intentFns, ...windowIntentFns]) {
    const declared: ActionDeclaration = actions[fn.action];
    assert.equal(declared.class.kind, "direct", fn.action);
    assert.equal(declared.closed?.agent, undefined, fn.action);
  }
  // Only a person sends a held message, approves or rejects, or takes a rejection back (OA-258).
  const given = new Set<string>([...intentFns, ...windowIntentFns].map((fn) => fn.action));
  for (const action of [
    "held.send",
    "changeset.unreject",
    "changeset.dismiss-look",
    "changeset.second-look",
  ])
    assert.ok(!given.has(action), action);
});

test("the host refuses what only the user gives, and items out of reach", async () => {
  const bindings = own();
  assert.throws(() => bindings.intend("workstream.rename", [{ name: "X", oriel: true }]));
  assert.throws(() => bindings.intend("thread.done", [{ via: "swipe" }]));
  assert.throws(() =>
    bindings.intend("workstream.create", [{ kind: "cluster", grouping: "epic", cluster: "1" }]),
  );
  assert.throws(() => bindings.intend("held.send", [{ seq: 1 }]));
  // Joining a workstream takes the region's items, and what this run's
  // search() found, in this run only.
  assert.throws(() => bindings.intend("workstream.add", [{ items: ["jira:SYN-80"] }]));
  assert.throws(() =>
    bindings.intend("workstream.create", [{ kind: "picked", name: "X", items: ["jira:SYN-80"] }]),
  );
  await bindings.read("search", ["SYN-80"]);
  assert.deepEqual(bindings.intend("workstream.add", [{ items: ["jira:SYN-80", "jira:SYN-13"] }]), {
    action: "workstream.add",
    input: { workstream: region.workstreamId, items: ["jira:SYN-80", "jira:SYN-13"] },
  });
  assert.throws(() => own().intend("workstream.add", [{ items: ["jira:SYN-80"] }]));
  // Without a thread, there is none of the agent's to default to.
  const threadless = bindingsFor(region, { reader, namespaces });
  assert.throws(() => threadless.intend("thread.done", []));
});

test("the items of a cluster the overview names may join a workstream, but not be read (0044)", async () => {
  const chat = () =>
    bindingsFor(region, {
      reader,
      namespaces,
      thread: threadId,
      overview: async () => ({ view: {}, items: [], reachable: ["jira:SYN-80", "jira:SYN-81"] }),
    });
  const bindings = chat();
  // Before the read, they're out of reach.
  assert.throws(() =>
    bindings.intend("workstream.create", [{ kind: "picked", name: "X", items: ["jira:SYN-80"] }]),
  );
  await bindings.read("window.overview", []);
  assert.deepEqual(
    bindings.intend("workstream.create", [
      { kind: "picked", name: "X", items: ["jira:SYN-80", "jira:SYN-81"] },
    ]),
    {
      action: "workstream.create",
      input: { kind: "picked", name: "X", items: ["jira:SYN-80", "jira:SYN-81"] },
    },
  );
  // Reading one still takes a search() that shows it.
  await assert.rejects(bindings.read("items.read", ["jira:SYN-80"]));
  // In this run only.
  assert.throws(() => chat().intend("workstream.add", [{ items: ["jira:SYN-80"] }]));
});

test("the agent turns a kind off in the window chat only, and never turns one on", () => {
  const overview = async () => ({ view: null, items: [] });
  const chat = bindingsFor(region, { reader, namespaces, thread: threadId, overview });
  assert.deepEqual(chat.intend("source.off", [{ kind: "slack" }]), {
    action: "source.off",
    input: { kind: "slack" },
  });
  assert.throws(() => chat.intend("source.on", [{ kind: "slack" }]));
  // A workstream's thread answers about its workstream, not the window.
  assert.throws(() => own().intend("source.off", [{ kind: "slack" }]));
});
