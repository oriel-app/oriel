// Oriel's own actions in the agent's module (decision 0024): generated from
// the registry, typed as the agent's door has them, and only recorded, each
// checked by the host.
import assert from "node:assert/strict";
import { test } from "node:test";
import { type ActionDeclaration, actions, type Ulid, ulid } from "@oriel/core";
import { intentFns } from "./actions.ts";
import { bindingsFor } from "./bindings.ts";
import { fixtureReader, fixtureRegion, namespaces, runGuest, snapshotAfter } from "./testing.ts";
import { typecheck } from "./typecheck.ts";

const reader = fixtureReader(snapshotAfter(0));
const threadId: Ulid = ulid(1, new Uint8Array(10));
const region = fixtureRegion("boarding-epic");
const own = () => bindingsFor(region, { reader, namespaces, thread: threadId });

test("every direct action open to the agent is a function, with the registry's doc", () => {
  const open = Object.entries(actions).flatMap(([name, declared]: [string, ActionDeclaration]) =>
    declared.class.kind === "direct" && declared.closed?.agent === undefined ? [name] : [],
  );
  assert.deepEqual(
    intentFns.map((fn) => `${fn.space}.${fn.name}`),
    open,
  );
  assert.ok(!open.includes("held.send"), "a person's action is never the agent's");
  for (const fn of intentFns) assert.equal(fn.doc, actions[fn.action].doc);
  const { dts } = own();
  assert.match(
    dts,
    /\/\*\* Adds items to a workstream\. The items themselves don't change\. \*\/\n {2}add\(input: \{ workstream\?: WorkstreamId; items: ItemId\[\] \}\): void;/,
  );
  // What only the user gives in the window isn't in the agent's types.
  assert.match(
    dts,
    /create\(input: \{ kind: "picked"; name: string; items: ItemId\[\] \}\): void;/,
  );
  assert.match(dts, /rename\(input: \{ workstream\?: WorkstreamId; name: string \}\): void;/);
  assert.match(dts, /done\(input\?: \{ thread\?: ThreadId \}\): void;/);
});

test("a call is recorded with the agent's own workstream and thread where it left them out", () => {
  const bindings = own();
  assert.deepEqual(bindings.intend("workstream.remove", [{ items: ["jira:SYN-13"] }]), {
    action: "workstream.remove",
    input: { workstream: region.workstreamId, items: ["jira:SYN-13"] },
  });
  assert.deepEqual(bindings.intend("thread.done", []), {
    action: "thread.done",
    input: { thread: threadId },
  });
  const other = ulid(9, new Uint8Array(10));
  assert.deepEqual(bindings.intend("workstream.rename", [{ workstream: other, name: "Later" }]), {
    action: "workstream.rename",
    input: { workstream: other, name: "Later" },
  });
  // Removing names members of whichever workstream, in reach or not.
  assert.equal(
    bindings.intend("workstream.remove", [{ workstream: other, items: ["jira:SYN-80"] }]).action,
    "workstream.remove",
  );
});

test("the host refuses what only the user gives, bad input, and items out of reach", async () => {
  const bindings = own();
  assert.throws(
    () => bindings.intend("workstream.rename", [{ name: "X", oriel: true }]),
    /^Error: workstream\.rename: \$\.oriel is the user's: /,
  );
  assert.throws(
    () => bindings.intend("thread.done", [{ via: "swipe" }]),
    /thread\.done: \$\.via is the user's/,
  );
  assert.throws(
    () =>
      bindings.intend("workstream.create", [{ kind: "cluster", grouping: "epic", cluster: "1" }]),
    /workstream\.create: a "cluster" input is the user's/,
  );
  assert.throws(
    () => bindings.intend("workstream.add", [{ items: ["jira:SYN-13"], extra: 1 }]),
    /workstream\.add: \$\.extra: not part of workstream\.add's input/,
  );
  assert.throws(
    () => bindings.intend("workstream.add", [{ items: [] }]),
    /workstream\.add: \$\.items: expected 1 to 500 items/,
  );
  assert.throws(
    () => bindings.intend("workstream.add", [{ items: ["jira:SYN-13"] }, 2]),
    /expected at most 1 argument/,
  );
  assert.throws(
    () => bindings.intend("held.send", [{ seq: 1 }]),
    /"held\.send" isn't an action here/,
  );
  // Joining a workstream takes the region's items, and what this run's
  // search() found, in this run only.
  assert.throws(
    () => bindings.intend("workstream.add", [{ items: ["jira:SYN-80"] }]),
    /workstream\.add: "jira:SYN-80" isn't in this region, and no search\(\) in this run found it/,
  );
  assert.throws(
    () =>
      bindings.intend("workstream.create", [{ kind: "picked", name: "X", items: ["jira:SYN-80"] }]),
    /workstream\.create: "jira:SYN-80" isn't in this region/,
  );
  await bindings.read("search", ["SYN-80"]);
  assert.deepEqual(bindings.intend("workstream.add", [{ items: ["jira:SYN-80", "jira:SYN-13"] }]), {
    action: "workstream.add",
    input: { workstream: region.workstreamId, items: ["jira:SYN-80", "jira:SYN-13"] },
  });
  assert.throws(() => own().intend("workstream.add", [{ items: ["jira:SYN-80"] }]), /SYN-80/);
  // Without a thread, there is none of the agent's to default to.
  const threadless = bindingsFor(region, { reader, namespaces });
  assert.throws(() => threadless.intend("thread.done", []), /no thread of the agent's/);
});

test("a script calls the actions as the declarations type them, and the guest only records them", async () => {
  const bindings = own();
  const script = `workstream.remove({ items: ["jira:SYN-13", "jira:SYN-19"] });
thread.done();
return "asked";`;
  assert.equal(await typecheck(script, bindings.dts), null);
  const refused = await typecheck(`workstream.add({ items: "jira:SYN-13" });`, bindings.dts);
  assert.equal(refused?.phase, "typecheck");
  const run = await runGuest(bindings, script);
  assert.deepEqual(run.outcome, { kind: "done", value: "asked" });
  assert.deepEqual(run.intents, [
    {
      action: "workstream.remove",
      input: { workstream: region.workstreamId, items: ["jira:SYN-13", "jira:SYN-19"] },
    },
    { action: "thread.done", input: { thread: threadId } },
  ]);
  assert.deepEqual(run.mutations, []);
  assert.deepEqual(run.rejected, []);
});
