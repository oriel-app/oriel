// The change log of SYN as a site in memory: what a teammate changes in Jira
// shows as the facets that moved, Jira's estimate by the label it declares.
import assert from "node:assert/strict";
import { test } from "node:test";
import { instant, syncSource, ulid } from "@oriel/core";
import { ensureWorkspace, indexStore, loadMigrations, migrate, open } from "@oriel/db";
import { loadJiraFixture } from "./fixture.ts";
import { jiraAttrs, jiraKeyShape } from "./attrs.ts";
import { jiraDeclaration } from "./declaration.ts";
import { memorySite, memorySiteOrigin } from "./memory-site.ts";
import { jiraSource } from "./source.ts";
import { readTransport } from "./transport.ts";

const fixture = loadJiraFixture();
const t0 = instant(new Date(Date.UTC(2026, 9, 29, 9)));
const t1 = instant(new Date(Date.UTC(2026, 9, 29, 10)));
const t2 = instant(new Date(Date.UTC(2026, 9, 29, 11)));

function synced() {
  const memory = memorySite(fixture, t0);
  const db = open(":memory:");
  migrate(db, loadMigrations(), t0);
  const workspaceId = ulid(0, new Uint8Array(10));
  ensureWorkspace(db, { id: workspaceId, name: "test" }, t0);
  const index = indexStore(db);
  const source = jiraSource({
    transport: readTransport({
      site: memorySiteOrigin,
      credential: { headers: async () => ({}) },
      fetch: memory.fetch,
    }),
    site: memorySiteOrigin,
    projects: ["SYN"],
    log: () => {},
  });
  const sync = (full: boolean, at = t1, items: { id: `jira:${string}`; stableId: string }[] = []) =>
    syncSource({
      items,
      source,
      attrs: jiraAttrs,
      key: jiraKeyShape,
      facets: jiraDeclaration.facets,
      index,
      workspaceId,
      full,
      clock: () => at,
      log: () => {},
    });
  const stableId = (key: string) => fixture.issues.find((issue) => issue.key === key)?.id;
  return { memory, index, workspaceId, sync, stableId };
}

test("moving SYN-45 to Done and estimating it logs its state and Jira's estimate, before and after", async () => {
  const { memory, index, workspaceId, sync, stableId } = synced();
  await sync(true, t0);
  memory.edit("SYN-45", { status: "Done", points: 3 });
  const report = await sync(false);
  assert.ok(report.records > 0);
  const entries = index.changes(workspaceId);
  assert.deepEqual(entries, [
    {
      seq: 1,
      source: "jira",
      stableId: stableId("SYN-45"),
      version: report.version,
      at: t1,
      facets: {
        state: { before: "todo", after: "done" },
        declared: { estimate: { before: null, after: 3 } },
      },
      gone: false,
    },
  ]);
  assert.equal(jiraDeclaration.facets.estimate.label, "Estimate");
});

test("a sync that changes nothing logs nothing, and a deleted issue logs when it went", async () => {
  const { memory, index, workspaceId, sync, stableId } = synced();
  await sync(true, t0);
  await sync(true);
  assert.deepEqual(index.changes(workspaceId), []);
  memory.remove("SYN-46");
  await sync(true, t2);
  assert.deepEqual(
    index.changes(workspaceId).map(({ stableId, at, gone, facets }) => ({
      stableId,
      at,
      gone,
      facets,
    })),
    [{ stableId: stableId("SYN-46"), at: t2, gone: true, facets: {} }],
  );
});

test("a search that lags a write logs the write once, never back and forth", async () => {
  const { memory, index, workspaceId, sync, stableId } = synced();
  await sync(true, t0);
  // Moved to Done as a change set writes it, read by key while the search
  // still lists it as it was.
  memory.searchLags();
  memory.edit("SYN-45", { status: "Done" });
  const written = [{ id: "jira:SYN-45" as const, stableId: stableId("SYN-45") ?? "" }];
  await sync(false, t1, written);
  await sync(false, t2, written);
  assert.deepEqual(
    index.changes(workspaceId).map((entry) => [entry.stableId, entry.facets.state]),
    [[stableId("SYN-45"), { before: "todo", after: "done" }]],
  );
});
