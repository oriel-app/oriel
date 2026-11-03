// Change sets take kinds as data (decision 0049): a kind no package here
// knows applies and reverts through the writer of its item's connection, as
// a connector's line in writers.ts would build it.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  type FieldValues,
  instant,
  type ItemId,
  object,
  op,
  type OpSpecs,
  type SourceWriter,
  string,
  type TelemetryEvent,
  ulid,
  unknown,
} from "@oriel/core";
import {
  ensureWorkspace,
  indexStore,
  loadMigrations,
  migrate,
  open,
  runStore,
  threadStore,
  workstreamStore,
} from "@oriel/db";
import { changeSetsOver } from "./change-sets.ts";
import { approve, nth } from "./testing.ts";

const t0 = instant(new Date(Date.UTC(2026, 10, 3, 9)));
const id = (n: number) => ulid(n, new Uint8Array(10));

const setTitle = { args: object({ title: string }), revertOnly: false };
const memoSpecs: OpSpecs = {
  name: "Memo",
  titleField: "summary",
  fields: { summary: "value", updated: "value" },
  updatedField: "updated",
  ops: {
    setTitle: op(setTitle, {
      idempotent: true,
      after: ({ title }) => ({ summary: title }),
      describe: ({ title }) => `Retitle it "${title}"`,
      undo: (_args, applied) => ({ op: "setTitle", args: { title: applied.before.summary } }),
    }),
  },
};

// Memos in memory, by item ID, each with its stable ID.
function memoWriter(): SourceWriter & { titles: Map<string, string> } {
  const titles = new Map([["memo:M1", "Launch"]]);
  const values = (memo: string): FieldValues | "gone" => {
    const title = titles.get(memo);
    return title === undefined ? "gone" : { summary: title, updated: t0 };
  };
  return {
    kind: "memo",
    titles,
    async apply(request) {
      const target = request.target as ItemId;
      const before = values(target);
      if (before === "gone") throw new Error(`${target} is gone`);
      titles.set(target, (request.args as { title: string }).title);
      return {
        item: { id: target, stableId: "stable-M1" },
        before,
        after: values(target) as FieldValues,
      };
    },
    current: async (memo, fields) => {
      const found = values(memo);
      return found === "gone" ? found : Object.fromEntries(fields.map((f) => [f, found[f]]));
    },
    read: async (memo, fields) => {
      const found = values(memo);
      if (found === "gone") return found;
      return {
        stableId: "stable-M1",
        values: Object.fromEntries(fields.map((f) => [f, found[f]])),
      };
    },
  };
}

test("a kind no package here knows applies and reverts through its connection's writer", async () => {
  const db = open(":memory:");
  migrate(db, loadMigrations(), t0);
  const workspaceId = id(0);
  ensureWorkspace(db, { id: workspaceId, name: "test" }, t0);
  const sync = indexStore(db).beginSync(workspaceId, "memo", unknown, t0);
  sync.apply({
    records: [
      {
        id: "memo:M1",
        stableId: "stable-M1",
        title: "Launch",
        location: "https://memo.example/M1",
        updatedAt: t0,
        facets: {},
        attrs: {},
      },
    ],
    gone: [],
    cursor: null,
  });
  sync.finish(null, t0);
  const workstreamId = id(1);
  workstreamStore(db).create(
    { id: workstreamId, workspaceId, name: "Memos", origin: { kind: "picked" } },
    [{ id: "memo:M1", stableId: "stable-M1" }],
    t0,
  );
  const threadId = id(2);
  threadStore(db).open({ id: threadId, workspaceId, workstreamId }, t0);
  const run = { id: id(3), workspaceId, threadId };
  runStore(db).record(
    {
      ...run,
      snapshot: 1,
      regionVersion: 1,
      systemPromptHash: "p",
      dtsHash: "d",
      model: "model",
      inputTokens: 0,
      outputTokens: 0,
      wallMs: 0,
      coldStartMs: null,
      outcome: "ok",
      startedAt: t0,
    },
    [],
  );
  const writer = memoWriter();
  const events: TelemetryEvent[] = [];
  const sets = changeSetsOver({
    db,
    sources: { memo: { writer, reader: { current: writer.current, name: async () => null } } },
    specs: { memo: memoSpecs },
    reviewBase: new URL("http://localhost:4000/review/"),
    now: () => t0,
    emit: (event) => events.push(event),
  });

  const set = await sets.capture(run, [
    { op: "setTitle", target: "memo:M1", ref: null, args: { title: "Launch plan" } },
  ]);
  const diff = await sets.diff(set.id);
  assert.deepEqual(nth(diff.lines, 0).fields, [
    { name: "summary", before: "Launch", after: "Launch plan" },
  ]);
  await approve(sets, set.id);
  const report = await sets.apply(set.id);
  assert.equal(report.failed.length, 0);
  assert.equal(writer.titles.get("memo:M1"), "Launch plan");
  const applied = await sets.get(set.id);
  assert.equal(applied?.mutations[0]?.applied?.item.id, "memo:M1");
  assert.deepEqual(
    events.flatMap((event) => (event.name === "changeset.applied" ? [event.sources] : [])),
    [["memo"]],
  );

  const revert = await sets.revert(set.id);
  assert.ok(!("conflicts" in revert));
  await approve(sets, revert.id);
  await sets.apply(revert.id);
  assert.equal(writer.titles.get("memo:M1"), "Launch");
});
