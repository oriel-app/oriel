import assert from "node:assert/strict";
import { test } from "node:test";
import { instant, ulid } from "@oriel/core";
import type { Outside } from "./door.ts";
import { commandTools, receiptLimit } from "./commands.ts";
import type { ConnectedTool } from "./tokens.ts";

const id = ulid(0, new Uint8Array(10));
const by: ConnectedTool = {
  id,
  name: "Build bot",
  mode: "act",
  connectedAt: instant(new Date(0)),
  usedAt: null,
  revokedAt: null,
};
const command = {
  workstream: id,
  operation: "add",
  items: ["jira:SYN-1"],
  expectedVersion: 1,
  requestId: "one",
  epoch: "test",
};

// No app or I/O is needed to exercise the ledger's saturation and ambiguous
// failure behavior: only the number of dispatch attempts matters here.
test("a full receipt ledger refuses new commands and retains the oldest answer", async () => {
  let attempts = 0;
  const dispatch = Object.assign(
    async () => {
      throw new Error("unused");
    },
    {
      untyped: async () => {
        attempts++;
        return { undo: null, version: 2 };
      },
    },
  ) as Outside["dispatch"];
  const outside = { dispatch } as Outside;
  const edit = commandTools("test").find((tool) => tool.name === "workstream_edit");
  assert.ok(edit);
  const first = await edit.call(command, by, outside);
  for (let i = 1; i < receiptLimit; i++)
    await edit.call({ ...command, requestId: String(i) }, by, outside);
  await assert.rejects(
    edit.call({ ...command, requestId: "overflow" }, by, outside),
    /ledger full/,
  );
  assert.deepEqual(await edit.call(command, by, outside), first);
  assert.equal(attempts, receiptLimit);
});

test("a failure whose commit is uncertain is kept and never retried", async () => {
  let attempts = 0;
  const dispatch = Object.assign(
    async () => {
      throw new Error("unused");
    },
    {
      untyped: async () => {
        attempts++;
        throw new Error("failure after a possible commit");
      },
    },
  ) as Outside["dispatch"];
  const outside = { dispatch } as Outside;
  const edit = commandTools("test").find((tool) => tool.name === "workstream_edit");
  assert.ok(edit);
  const first = await edit.call(command, by, outside);
  assert.equal((first as { status: string }).status, "uncertain");
  assert.deepEqual(await edit.call(command, by, outside), first);
  assert.equal(attempts, 1);
});
