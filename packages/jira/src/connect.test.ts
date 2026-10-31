// Connecting to SYN as a site in memory: the check, then a sync through the
// real source and transport, as the window's connect does.
import assert from "node:assert/strict";
import { test } from "node:test";
import { type Credential, instant, ulid } from "@oriel/core";
import { ensureWorkspace, indexStore, loadMigrations, migrate, open } from "@oriel/db";
import { loadJiraFixture } from "../../../scripts/fixtures/load.ts";
import { jiraAttrs } from "./attrs.ts";
import { checkConnection } from "./connect.ts";
import { fixtureSnapshot } from "./fixture.ts";
import { memorySite, memorySiteOrigin } from "./memory-site.ts";
import { jiraSource } from "./source.ts";
import { syncSource } from "./sync.ts";
import { basicAuth, readTransport } from "./transport.ts";

const fixture = loadJiraFixture();
const t0 = instant(new Date(Date.UTC(2026, 9, 29, 9)));
const account = { email: "pm@example.com", token: "right-one" };

function site() {
  const memory = memorySite(fixture, t0, { account });
  const over = (credential: Credential) =>
    readTransport({ site: memorySiteOrigin, credential, fetch: memory.fetch });
  return { memory, over };
}

test("the check says whether the account is taken and the project is there", async () => {
  const { over } = site();
  const right = over(basicAuth(account.email, account.token));
  assert.equal(await checkConnection(right, "SYN"), "ok");
  assert.equal(await checkConnection(right, "NOPE"), "no-project");
  assert.equal(await checkConnection(right, "not a key"), "no-project");
  assert.equal(
    await checkConnection(over(basicAuth(account.email, "wrong-one")), "SYN"),
    "refused",
  );
  assert.equal(await checkConnection(over({ headers: async () => ({}) }), "SYN"), "refused");
});

test("a sync of the site in memory indexes what the fixture snapshot does", async () => {
  const { memory, over } = site();
  const db = open(":memory:");
  migrate(db, loadMigrations(), t0);
  const workspaceId = ulid(0, new Uint8Array(10));
  ensureWorkspace(db, { id: workspaceId, name: "test" }, t0);
  const index = indexStore(db);
  const source = jiraSource({
    transport: over(basicAuth(account.email, account.token)),
    site: memorySiteOrigin,
    projects: ["SYN"],
    log: () => {},
    pageSize: 25,
  });
  const report = await syncSource({
    source,
    attrs: jiraAttrs,
    index,
    workspaceId,
    full: true,
    clock: () => t0,
    log: () => {},
  });
  const expected = fixtureSnapshot(fixture, memorySiteOrigin, fixture.edits.length).records;
  assert.equal(report.records, expected.length);
  const byId = <R extends { id: string }>(records: readonly R[]) =>
    records.toSorted((a, b) => a.id.localeCompare(b.id));
  const indexed = byId(index.records(workspaceId, "jira", jiraAttrs));
  assert.deepEqual(
    indexed.map((r) => [r.id, r.stableId, r.title, r.facets.container?.id ?? null]),
    byId(expected).map((r) => [r.id, r.stableId, r.title, r.facets.container?.id ?? null]),
  );
  // An item reads in full, comments included.
  const commented = fixture.issues.find((issue) => issue.comments.length > 0);
  assert.ok(commented);
  const [read] = await source.read([`jira:${commented.key}`]);
  assert.equal(read?.status, "ok");
  assert.ok(read?.status === "ok" && read.content.comments.length === commented.comments.length);
  // A later sync picks up an edit made in Jira.
  memory.edit("SYN-1", { summary: "Checkout, renamed in Jira" });
  const again = await syncSource({
    source,
    attrs: jiraAttrs,
    index,
    workspaceId,
    full: false,
    clock: () => t0,
    log: () => {},
  });
  assert.equal(again.full, false);
  assert.equal(
    index.records(workspaceId, "jira", jiraAttrs).find((r) => r.id === "jira:SYN-1")?.title,
    "Checkout, renamed in Jira",
  );
});
