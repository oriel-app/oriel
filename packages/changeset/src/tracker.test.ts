// The stand-in tracker through change sets (decision 0059): its creates share
// their ops with Jira's, so each goes to the kind its namespace captured it
// for; applied, they land in Oriel's own store through the writer writers.ts
// builds; reverted, they go.
import assert from "node:assert/strict";
import { test } from "node:test";
import { type Instant, instant, type OwnItems, ulid, unknown } from "@oriel/core";
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
import { specs } from "@oriel/sources";
import { trackerDeclaration } from "@oriel/tracker";
import { changeSets } from "./change-sets.ts";
import { approve } from "./testing.ts";

const t0 = instant(new Date(Date.UTC(2026, 10, 6, 9)));
const id = (n: number) => ulid(n, new Uint8Array(10));

function setup() {
  const db = open(":memory:");
  migrate(db, loadMigrations(), t0);
  const workspaceId = id(0);
  ensureWorkspace(db, { id: workspaceId, name: "test" }, t0);
  const index = indexStore(db);
  // Oriel's own store, over the index, as the composition root lends it.
  const store = index.own(workspaceId, "tracker", unknown, trackerDeclaration.facets);
  let tick = 0;
  const now = () => instant(new Date(Date.parse(t0) + ++tick * 1000)) as Instant;
  const own: OwnItems = {
    records: () => index.records(workspaceId, "tracker", unknown),
    content: store.content,
    keys: store.keys,
    write: async ({ records, texts, contents, gone }) => {
      store.write({ records: [...records], gone: [...gone], texts }, contents, now());
    },
  };
  const workstreamId = id(1);
  workstreamStore(db).create(
    { id: workstreamId, workspaceId, name: "Window chat", origin: { kind: "window" } },
    [],
    t0,
  );
  const threadId = id(2);
  threadStore(db).open({ id: threadId, workspaceId, workstreamId }, t0);
  const run = { id: id(3), workspaceId, threadId };
  runStore(db).record(
    {
      ...run,
      snapshot: 0,
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
  const sets = changeSets({
    db,
    writerConfig: [{ prefix: "tracker", kind: "tracker", writes: { own, now } }],
    specs,
    reviewBase: new URL("http://localhost:4000/review/"),
    now: () => t0,
    emit: () => {},
    log: () => {},
  });
  return { db, sets, run, own };
}

const plan = [
  {
    op: "createEpic",
    target: null,
    ref: "new:1",
    args: { summary: "Spring launch" },
    into: "tracker",
  },
  {
    op: "createStory",
    target: null,
    ref: "new:2",
    args: { summary: "Pricing page", points: 3, epic: "new:1" },
    into: "tracker",
  },
] as const;

test("a plan the agent drafts into the tracker applies there, and its revert takes it back", async () => {
  const { sets, run, own } = setup();
  const set = await sets.capture(run, [...plan]);
  assert.deepEqual(
    set.mutations.map((m) => [m.op, m.into]),
    [
      ["createEpic", "tracker"],
      ["createStory", "tracker"],
    ],
  );
  await approve(sets, set.id);
  const report = await sets.apply(set.id);
  assert.deepEqual(report.failed, []);
  assert.deepEqual(
    own.records().map((record) => [record.id, record.title, record.facets.container?.id ?? null]),
    [
      ["tracker:T-1", "Spring launch", null],
      ["tracker:T-2", "Pricing page", "tracker:T-1"],
    ],
  );
  const revert = await sets.revert(set.id);
  assert.ok(!("conflicts" in revert), JSON.stringify(revert));
  await approve(sets, revert.id);
  assert.deepEqual((await sets.apply(revert.id)).failed, []);
  assert.deepEqual(own.records(), []);
});

test("a create captured before two kinds shared its op, with no kind, is Jira's, which had it then", async () => {
  const { sets, run } = setup();
  const [epic] = plan;
  const set = await sets.capture(run, [
    { op: epic.op, target: null, ref: epic.ref, args: epic.args },
  ]);
  // Jira's, which isn't connected here, so it can't be approved.
  await assert.rejects(approve(sets, set.id), { code: "read-only" });
});

test("a create's kind is in the hash a person approves", async () => {
  const { sets, run } = setup();
  const set = await sets.capture(run, [plan[0]]);
  const jira = await sets.capture(run, [{ ...plan[0], into: "jira" }]);
  assert.notEqual((await sets.diff(set.id)).hash, (await sets.diff(jira.id)).hash);
});
