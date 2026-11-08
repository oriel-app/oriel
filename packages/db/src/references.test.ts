import assert from "node:assert/strict";
import { test } from "node:test";
import {
  type IndexRecord,
  type Instant,
  instant,
  type ItemId,
  type Recognizer,
  type Source,
  type SourceKind,
  syncSource,
  ulid,
  unknown,
} from "@oriel/core";
import { indexStore } from "./index-store.ts";
import { loadMigrations, migrate } from "./migrate.ts";
import { open } from "./open.ts";
import { ensureWorkspace } from "./workspaces.ts";

const day = 86_400_000;
const t0 = instant(new Date(Date.UTC(2026, 9, 29, 9)));
const later = (days: number) => instant(new Date(Date.parse(t0) + days * day));
// Finds Jira keys and Slack message keys, as each source's own recognizer
// would: this test is about what the sync and the index do with them.
const recognize: Recognizer = (text) =>
  (text.match(/\b(?:SYN-\d+|C0FW1WEATHR-\d{10}\.\d{6})\b/g) ?? []).map((key): ItemId =>
    key.startsWith("SYN") ? `jira:${key}` : `slack:${key}`,
  );

type Given<K extends SourceKind> = { record: IndexRecord<K>; text?: string };

const issue = (key: string, stableId: string): Given<"jira"> => ({
  record: {
    id: `jira:${key}`,
    stableId,
    title: key,
    location: `https://oriel.atlassian.net/browse/${key}`,
    updatedAt: t0,
    facets: {},
    attrs: {},
  },
});
const message = (ts: string, text: string): Given<"slack"> => {
  const key = `C0FW1WEATHR-${ts}.000100`;
  return {
    record: {
      id: `slack:${key}`,
      stableId: key,
      title: "Dara",
      location: `https://ferrowick-example.slack.com/archives/C0FW1WEATHR/p${ts}000100`,
      updatedAt: t0,
      facets: { kind: "message" },
      attrs: {},
    },
    text,
  };
};

function fresh() {
  const db = open(":memory:");
  migrate(db, loadMigrations(), t0);
  const workspaceId = ulid(0, new Uint8Array(10));
  ensureWorkspace(db, { id: workspaceId, name: "test" }, t0);
  const index = indexStore(db);
  const sync = <K extends SourceKind>(kind: K, given: Given<K>[], at: Instant = t0) => {
    const texts = Object.fromEntries(
      given.flatMap((g) => (g.text === undefined ? [] : [[g.record.stableId, g.text]])),
    );
    const source: Source<K> = {
      kind,
      read: async () => [],
      async *sync() {
        yield { records: given.map((g) => g.record), gone: [], cursor: null, texts };
      },
    };
    return syncSource({
      source,
      attrs: unknown,
      key: /^[A-Za-z0-9.-]+$/,
      recognize,
      index,
      workspaceId,
      full: true,
      clock: () => at,
      log: () => {},
    });
  };
  const references = (id: ItemId) =>
    [
      ...index.records(workspaceId, "jira", unknown),
      ...index.records(workspaceId, "slack", unknown),
    ].find((record) => record.id === id)?.facets.references;
  return { db, sync, references, index, workspaceId };
}

const said =
  "Standup: yesterday I reproduced SYN-54, and SYN-54 again; see C0FW1WEATHR-1788344100.000100";

test("one text names at most 50 items", async () => {
  const { sync, references } = fresh();
  const issues = Array.from({ length: 60 }, (_, i) => issue(`SYN-${i + 1}`, `${10001 + i}`));
  await sync("jira", issues);
  const every = issues.map((g) => g.record.id.slice("jira:".length)).join(" ");
  await sync("slack", [message("1788444000", every)]);
  assert.equal(references("slack:C0FW1WEATHR-1788444000.000100")?.length, 50);
});

test("a connection forgotten takes its items, their references and its sync state, and what named them waits again", async () => {
  const { db, sync, references, index, workspaceId } = fresh();
  await sync("jira", [issue("SYN-54", "10054")]);
  await sync("slack", [message("1788444000", said)]);
  const before = index.snapshot(workspaceId);
  assert.equal(index.forget(workspaceId, "jira", later(1)), before + 1);
  assert.deepEqual(index.records(workspaceId, "jira", unknown), []);
  assert.equal(index.source(workspaceId, "jira"), null);
  assert.equal(references("slack:C0FW1WEATHR-1788444000.000100"), undefined);
  assert.deepEqual(
    db
      .prepare("select to_source, to_handle, at from item_references where to_source = 'jira'")
      .all()
      .map((row) => ({ ...row })),
    [{ to_source: "jira", to_handle: "SYN-54", at: later(1) }],
  );
  // Nothing more to forget takes no version.
  assert.equal(index.forget(workspaceId, "jira", later(2)), before + 1);
  // Connected again, the same item is named again.
  await sync("jira", [issue("SYN-54", "10054")], later(3));
  assert.deepEqual(references("slack:C0FW1WEATHR-1788444000.000100"), [
    { id: "jira:SYN-54", stableId: "10054" },
  ]);
  // Forgetting Slack takes the references its messages made.
  index.forget(workspaceId, "slack", later(4));
  assert.deepEqual(db.prepare("select * from item_references").all(), []);
});
