// Linear's declaration (OA-278), on its fixture through the stand-in of its
// server.
import assert from "node:assert/strict";
import { test } from "node:test";
import { type ItemId, type NamespaceHost, type NamespaceWrite } from "@oriel/core";
import { linearDeclaration } from "./declaration.ts";

const loaded = linearDeclaration.fixture.load();

async function world() {
  return { connected: await loaded.connect(0) };
}

const host = (ids: readonly string[]): NamespaceHost =>
  ({ has: (id: string) => ids.includes(id), created: new Map() }) as unknown as NamespaceHost;
const build = (fn: NamespaceWrite | undefined, values: unknown[], ids: readonly string[]) => {
  assert.ok(fn);
  return fn.build(values as never, host(ids));
};

test("its declarations carry none of the source's text, and its writes take only the team's statuses and cycles to come", async () => {
  const { connected } = await world();
  const spec = linearDeclaration.namespace(connected.records, connected.context);
  const ids = ["linear:P-5e2a9c41b7d0", "linear:ENG-2", "linear:ENG-4"] as ItemId[];
  const scope = { ids, anchor: "linear:P-5e2a9c41b7d0" as ItemId };
  const fns = spec.fns(scope);
  // No status's or cycle's name, which are the source's text, reaches the
  // declarations: team() gives them.
  assert.doesNotMatch(spec.types(scope).join("\n"), /Timetable freeze|In Review|Triage/);
  const write = (name: string) => fns.find((fn) => fn.name === name) as NamespaceWrite;
  assert.throws(() => build(write("setCycle"), ["linear:ENG-2", 12], ids));
  assert.throws(() => build(write("setStatus"), ["linear:ENG-2", "Shipped"], ids));
  assert.deepEqual(build(write("setStatus"), ["linear:ENG-2", "In Review"], ids), {
    target: "linear:ENG-2",
    args: { status: "In Review" },
  });
});
