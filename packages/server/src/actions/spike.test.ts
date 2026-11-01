// SPIKE (OA-74): group remove, declared in-house and with Effect Schema,
// gives the same check, effect and refusals, and each declaration's four
// outputs are printed for the comparison (docs/internals/effect-spike.md).
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  type GroupMember,
  type IndexRecord,
  type Infer,
  instant,
  type TelemetryEvent,
  ulid,
  type Ulid,
} from "@oriel/core";
import { ensureWorkspace, groupStore, loadMigrations, migrate, open } from "@oriel/db";
import { Schema } from "effect";
import { type ActionDeps, ActionError, agentDeclaration, dispatch, mcpTool } from "./action.ts";
import { agentDeclarationE, GroupRemoveInput, mcpToolE, routeE } from "./effect.ts";
import { groupRemove } from "./group-remove.ts";

const t0 = instant(new Date(Date.UTC(2026, 9, 29, 9)));
const m = (key: string, stableId: string): GroupMember => ({ id: `jira:${key}`, stableId });

function world() {
  const db = open(":memory:");
  migrate(db, loadMigrations(), t0);
  const workspaceId = ulid(0, new Uint8Array(10));
  ensureWorkspace(db, { id: workspaceId, name: "test" }, t0);
  const groups = groupStore(db);
  const groupId = ulid(1, new Uint8Array(10));
  const members = [m("SYN-1", "10001"), m("SYN-2", "10002")];
  groups.create(
    { id: groupId, workspaceId, name: "Launch", origin: { kind: "picked" } },
    members,
    t0,
  );
  const records = members.map((member) => ({ ...member }) as unknown as IndexRecord);
  const events: TelemetryEvent[] = [];
  const changed: Ulid[] = [];
  const deps: ActionDeps = {
    workspaceId,
    groups,
    records: () => records,
    now: () => t0,
    emit: (event) => events.push(event),
    changed: (id) => changed.push(id),
  };
  return {
    deps,
    groupId,
    events,
    changed,
    held: () => groups.region(groupId, groups.get(groupId)?.version ?? 1)?.items.map((i) => i.id),
  };
}

test("both declarations accept and refuse the same inputs", () => {
  const group = ulid(1, new Uint8Array(10));
  const inputs: [unknown, boolean][] = [
    [{ group, items: ["jira:SYN-1"] }, true],
    [{ group, items: ["jira:SYN-1"], extra: 1 }, true],
    [{ group, items: [] }, false],
    [{ group, items: ["jira:syn-1"] }, false],
    [{ group, items: ["SYN-1"] }, false],
    [{ group: "nope", items: ["jira:SYN-1"] }, false],
    [{ group, items: Array.from({ length: 501 }, (_, i) => `jira:SYN-${i + 1}`) }, false],
    [null, false],
  ];
  const decodeE = Schema.decodeUnknownResult(GroupRemoveInput);
  for (const [input, ok] of inputs) {
    assert.equal(
      groupRemove.input(input).ok,
      ok,
      `in-house: ${JSON.stringify(input)?.slice(0, 60)}`,
    );
    assert.equal(
      decodeE(input)._tag === "Success",
      ok,
      `effect: ${JSON.stringify(input)?.slice(0, 60)}`,
    );
  }
});

test("the in-house type keeps our brands; Effect's needs a refine for each", () => {
  type InHouse = Infer<typeof groupRemove.input>;
  type Effect = typeof GroupRemoveInput.Type;
  const a: InHouse = { group: ulid(1, new Uint8Array(10)), items: ["jira:SYN-1"] };
  // Effect's arrays are readonly and its isULID() leaves group a string.
  const b: Effect = a;
  // @ts-expect-error string isn't Ulid
  const c: InHouse = { ...b, items: [...b.items] };
  assert.deepEqual(c, a);
});

test("the in-house dispatcher removes, records the actor and publishes once", () => {
  const w = world();
  dispatch(groupRemove, { group: w.groupId, items: ["jira:SYN-1"] }, { kind: "person" }, w.deps);
  assert.deepEqual(w.held(), ["jira:SYN-2"]);
  assert.deepEqual(w.changed, [w.groupId]);
  assert.deepEqual(
    w.events.map((e) => e.name === "action.called" && [e.action, e.actor]),
    [["group.remove", "person"]],
  );
  assert.throws(
    () =>
      dispatch(
        groupRemove,
        { group: w.groupId, items: ["jira:SYN-1"] },
        { kind: "person" },
        w.deps,
      ),
    (error) => error instanceof ActionError && error.code === "invalid",
  );
  assert.throws(
    () =>
      dispatch(
        groupRemove,
        { group: ulid(9, new Uint8Array(10)), items: ["jira:SYN-2"] },
        { kind: "person" },
        w.deps,
      ),
    (error) => error instanceof ActionError && error.code === "not-found",
  );
});

test("the Effect dispatcher does the same", async () => {
  const w = world();
  const services = {
    groups: {
      workspaceId: w.deps.workspaceId,
      store: w.deps.groups,
      records: w.deps.records,
      now: w.deps.now,
    },
    window: { emit: w.deps.emit, changed: w.deps.changed },
  };
  assert.deepEqual(await routeE({ group: w.groupId, items: ["jira:SYN-1"] }, services), {
    status: 200,
  });
  assert.deepEqual(w.held(), ["jira:SYN-2"]);
  assert.deepEqual(w.changed, [w.groupId]);
  assert.equal(w.events.length, 1);
  assert.deepEqual(await routeE({ group: w.groupId, items: ["jira:SYN-1"] }, services), {
    status: 400,
    error: "jira:SYN-1 isn't in this group",
  });
  assert.equal(
    (await routeE({ group: ulid(9, new Uint8Array(10)), items: ["jira:SYN-2"] }, services)).status,
    404,
  );
});

test("each declaration's .d.ts line and MCP inputSchema", (t) => {
  t.diagnostic(`in-house .d.ts:\n${agentDeclaration(groupRemove)}`);
  t.diagnostic(`effect .d.ts:\n${agentDeclarationE()}`);
  t.diagnostic(`in-house MCP: ${JSON.stringify(mcpTool(groupRemove))}`);
  t.diagnostic(`effect MCP: ${JSON.stringify(mcpToolE())}`);
  assert.match(agentDeclaration(groupRemove), /remove\(items: RegionId\[\]\): void;/);
  // Effect's code generator writes the refined ID as a string.
  assert.match(agentDeclarationE(), /remove\(items: ReadonlyArray<string>\): void;/);
  assert.deepEqual(mcpTool(groupRemove).inputSchema.required, ["group", "items"]);
  assert.deepEqual(mcpToolE().inputSchema.required, ["group", "items"]);
});
