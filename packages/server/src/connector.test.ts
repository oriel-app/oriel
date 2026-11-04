// Core keeps no list of kinds (decision 0049): a connector declared only
// beside the others, as packages/sources lists them, is the index's, a
// region module's and a change set's like any other. No kind takes one of
// Oriel's own names in the module.
import assert from "node:assert/strict";
import { test } from "node:test";
import { bindingsFor, orielNames } from "@oriel/bindings";
import { changeSets } from "@oriel/changeset";
import {
  type FieldValues,
  type IndexRecord,
  instant,
  type ItemId,
  type NamespaceSpec,
  object,
  op,
  type OpSpecs,
  param,
  parseItemId,
  type ReadResult,
  type Run,
  type Source,
  type SourceDeclaration,
  string,
  syncSource,
  type TelemetryEvent,
  ulid,
  unknown,
  write,
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
import { itemDocs, namespacesFor, sourceKinds, specs } from "@oriel/sources";

const t0 = instant(new Date(Date.UTC(2026, 10, 3, 9)));
const id = (n: number) => ulid(n, new Uint8Array(10));

// A memo connector, which no package but this test knows: a title it can
// change, and nothing else.
const memoOps = { setTitle: { args: object({ title: string }), revertOnly: false } };
const memoNamespace: NamespaceSpec = {
  name: "Memo",
  ops: memoOps,
  types: () => [],
  fns: () => [
    write({
      name: "setTitle",
      doc: "Retitle a memo.",
      op: "setTitle",
      creates: false,
      params: [param("id", "RegionId", string), param("title", "string", string)],
      build: ([memo, title], host) => {
        if (!host.has(memo)) throw new RangeError(`${memo} isn't in this region`);
        return { target: memo, args: { title } };
      },
    }),
  ],
};
const memoSpecs: OpSpecs = {
  name: "Memo",
  titleField: "summary",
  fields: { summary: "value", updated: "value" },
  updatedField: "updated",
  ops: {
    setTitle: op(memoOps.setTitle, {
      idempotent: true,
      after: ({ title }) => ({ summary: title }),
      describe: ({ title }) => `Retitle it "${title}"`,
      undo: (_args, applied) => ({ op: "setTitle", args: { title: applied.before.summary } }),
    }),
  },
};
const memo = {
  kind: "memo",
  key: /^M[1-9][0-9]{0,5}$/,
  name: "Memo",
  details: () => null,
  itemDoc: "A memo: its title is its subject.",
  panel: () => null,
  facets: {},
  recognizer: () => () => [],
  overview: () => [],
  namespace: () => memoNamespace,
  specs: memoSpecs,
} satisfies SourceDeclaration;

const memoRecord = (key: string, title: string): IndexRecord<"memo"> => ({
  id: `memo:${key}`,
  stableId: `stable-${key}`,
  title,
  location: `https://memo.example/${key}`,
  updatedAt: t0,
  facets: {},
  attrs: {},
});

test("a connector declared only beside the others round-trips its IDs through the index, a region's module and a change set", async () => {
  const db = open(":memory:");
  migrate(db, loadMigrations(), t0);
  const workspaceId = id(0);
  ensureWorkspace(db, { id: workspaceId, name: "test" }, t0);

  // The index: its sync keeps what has its key shape, and skips the rest.
  const index = indexStore(db);
  const titles = new Map<string, FieldValues>([
    ["memo:M1", { summary: "Launch", updated: t0 }],
    ["memo:M2", { summary: "Pricing", updated: t0 }],
  ]);
  const source: Source<"memo"> = {
    kind: "memo",
    async *sync() {
      yield {
        records: [memoRecord("M1", "Launch"), memoRecord("M2", "Pricing"), memoRecord("x1", "Odd")],
        gone: [],
        cursor: null,
      };
    },
    read: async (ids) =>
      ids.map((memoId): ReadResult<"memo"> => ({
        id: memoId,
        status: "ok",
        content: { title: String(titles.get(memoId)?.summary), text: "" },
      })),
  };
  const report = await syncSource({
    source,
    attrs: unknown,
    key: memo.key,
    facets: memo.facets,
    index,
    workspaceId,
    full: true,
    clock: () => t0,
    log: () => {},
  });
  assert.deepEqual([report.records, report.skipped], [2, 1]);
  const indexed = index.records(workspaceId, "memo", unknown);
  assert.deepEqual(
    indexed.map((record) => record.id),
    ["memo:M1", "memo:M2"],
  );
  assert.deepEqual(
    index.search(workspaceId, "memo:M1", 5).map((record) => record.id),
    ["memo:M1"],
  );

  // A region's module: its items, its namespace and its item doc, beside
  // the declared sources'.
  const workstreams = workstreamStore(db);
  const workstreamId = id(1);
  workstreams.create(
    { id: workstreamId, workspaceId, name: "Memos", origin: { kind: "picked" } },
    indexed.map((record) => ({ id: record.id, stableId: record.stableId })),
    t0,
  );
  const region = workstreams.region(workstreamId, 1);
  assert.ok(region);
  const bindings = bindingsFor(region, {
    reader: {
      read: (ids) =>
        source.read(
          ids.filter((each): each is ItemId<"memo"> => parseItemId(each)?.kind === "memo"),
        ),
      search: async () => [],
    },
    namespaces: {
      ...namespacesFor(indexed, { jira: { none: new Set(), home: null } }),
      memo: memo.namespace(),
    },
    items: { ...itemDocs, memo: memo.itemDoc },
  });
  assert.match(bindings.dts, /type RegionId =\n {2}\| "memo:M1"\n {2}\| "memo:M2";/);
  assert.match(
    bindings.dts,
    /declare const memo: \{\n.*\n {2}setTitle\(id: RegionId, title: string\): void;/,
  );
  assert.ok(bindings.dts.includes(memo.itemDoc));
  assert.match(bindings.shim, /const memo = Object\.freeze\(\{\n {2}setTitle: /);
  const captured = bindings.capture("memo.setTitle", ["memo:M1", "Launch plan"], null);
  assert.equal(captured.target, "memo:M1");

  // A change set: captured, checked against the region by identity, and
  // diffed through the kind's own reader. Its writer would be the one line
  // packages/changeset/src/writers.ts adds; without it, it can't be approved.
  const threadId = id(2);
  threadStore(db).open({ id: threadId, workspaceId, workstreamId }, t0);
  const run: Run = {
    id: id(3),
    workspaceId,
    threadId,
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
  };
  runStore(db).record(run, []);
  const events: TelemetryEvent[] = [];
  const sets = changeSets({
    db,
    writerConfig: {},
    readers: {
      memo: {
        current: async (memoId: ItemId, fields: readonly string[]) => {
          const values = titles.get(memoId);
          return values
            ? Object.fromEntries(fields.map((field) => [field, values[field] ?? null]))
            : "gone";
        },
        name: async () => null,
      },
    },
    specs: { ...specs, memo: memo.specs },
    reviewBase: new URL("http://localhost:4000/review/"),
    now: () => t0,
    emit: (event) => events.push(event),
    log: () => {},
  });
  const set = await sets.capture(run, [captured]);
  assert.deepEqual(
    set.mutations.map((m) => [m.op, m.target]),
    [["setTitle", "memo:M1"]],
  );
  const diff = await sets.diff(set.id);
  assert.deepEqual(
    diff.lines.map((line) => [line.target, line.sentence]),
    [["memo:M1", 'Retitle it "Launch plan"']],
  );
  assert.equal(sets.writable(set.id), false);
});

test("no declared kind is one of Oriel's own names in the module, or a word a script can't name", () => {
  for (const kind of sourceKinds) {
    assert.ok(!orielNames.includes(kind), `${kind} is one of Oriel's own names`);
    assert.doesNotThrow(() => new Function(`const ${kind} = 1;`), `${kind} can't name a global`);
  }
});
