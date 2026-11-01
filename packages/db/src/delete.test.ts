import assert from "node:assert/strict";
import { test } from "node:test";
import { type GroupOrigin, type Instant, instant, type Ulid, ulid } from "@oriel/core";
import { groupStore } from "./groups.ts";
import { loadMigrations, migrate } from "./migrate.ts";
import { open } from "./open.ts";
import { threadStore } from "./threads.ts";
import { ensureWorkspace } from "./workspaces.ts";

const t0 = instant(new Date(Date.UTC(2026, 9, 31, 9)));
const after = (ms: number): Instant => instant(new Date(Date.parse(t0) + ms));
const id = (n: number): Ulid => ulid(n, new Uint8Array(10));

// A thread on a group, with a message, a run with a read, and a change set
// with one mutation, a decision and a live review link. `status` and
// `error` are that mutation's.
function fresh(
  options: {
    origin?: GroupOrigin;
    members?: number;
    status?: "pending" | "applied" | "failed";
    error?: string;
  } = {},
) {
  const db = open(":memory:");
  migrate(db, loadMigrations(), t0);
  const workspaceId = id(0);
  ensureWorkspace(db, { id: workspaceId, name: "test" }, t0);
  const groups = groupStore(db);
  const groupId = id(1);
  groups.create(
    { id: groupId, workspaceId, name: "Kiosk", origin: options.origin ?? { kind: "picked" } },
    Array.from({ length: options.members ?? 1 }, (_, n) => ({
      id: `jira:SYN-${n + 1}` as const,
      stableId: `1000${n + 1}`,
    })),
    t0,
  );
  const threads = threadStore(db);
  const threadId = id(2);
  threads.open({ id: threadId, workspaceId, groupId }, t0);
  threads.append(threadId, { role: "user", text: "Plan kiosk wallets" }, id(3), t0);
  const status = options.status ?? "pending";
  db.exec(`
    insert into runs (id, workspace_id, thread_id, snapshot, region_version, system_prompt_hash,
      dts_hash, model, input_tokens, output_tokens, wall_ms, cold_start_ms, outcome, started_at)
    values ('${id(4)}', '${workspaceId}', '${threadId}', 1, 1, 'p', 'd', 'model', 0, 0, 0, null, 'ok', '${t0}');
    insert into run_reads (workspace_id, run_id, seq, fn, args, ms, outside_region, status, payload_hash)
    values ('${workspaceId}', '${id(4)}', 1, 'items.list', '[]', 1, 0, 'answered', 'h');
    insert into change_sets (id, workspace_id, thread_id, run_id, revert_of, created_at)
    values ('${id(5)}', '${workspaceId}', '${threadId}', '${id(4)}', null, '${t0}');
    insert into review_links (token_hash, workspace_id, change_set_id, created_at)
    values ('hash', '${workspaceId}', '${id(5)}', '${t0}');
    insert into decisions (id, workspace_id, change_set_id, seq, kind, via, review_link, by_name, hash, at)
    values ('${id(6)}', '${workspaceId}', '${id(5)}', 1, 'approved', 'review-link', 'hash', 'Amara', 'h', '${t0}');
  `);
  db.prepare(`
    insert into mutations (id, workspace_id, change_set_id, seq, op, target, args, status, applied, error)
    values (?, ?, ?, 1, 'setEstimate', 'jira:SYN-1', '{}', ?, ?, ?)`).run(
    id(7),
    workspaceId,
    id(5),
    status,
    status === "applied"
      ? JSON.stringify({
          item: { id: "jira:SYN-1", stableId: "10001" },
          before: { points: null },
          after: { points: 3 },
          at: t0,
        })
      : null,
    options.error ?? null,
  );
  const count = (table: string) =>
    Number(db.prepare(`select count(*) as n from ${table}`).get()?.n);
  return { db, groups, groupId, threads, threadId, workspaceId, count };
}

const tables = [
  "threads",
  "messages",
  "runs",
  "run_reads",
  "change_sets",
  "mutations",
  "decisions",
  "review_links",
];

test("a thread that wrote nothing goes with everything in it, and leaves its group", () => {
  const { groups, groupId, threads, threadId, workspaceId, count } = fresh();
  assert.deepEqual(threads.wrote(threadId), {
    applied: 0,
    reverted: 0,
    unconfirmed: 0,
    sources: [],
  });
  assert.deepEqual(
    threads.delete(threadId, after(1000), () => false),
    {
      groupId,
      kept: false,
      groupRemoved: false,
    },
  );
  assert.deepEqual(
    tables.map((table) => [table, count(table)]),
    tables.map((table) => [table, 0]),
  );
  assert.equal(count("deleted_threads"), 0);
  assert.equal(threads.get(threadId, after(1000)), null);
  assert.deepEqual(threads.list(workspaceId, after(1000)), []);
  // A group the user picked is theirs: it stays, empty of threads or not.
  assert.equal(groups.get(groupId)?.name, "Kiosk");
  assert.throws(() => threads.delete(threadId, after(2000), () => false), /no thread/);
});

test("a group made for a thread from nothing goes with it once it holds nothing", () => {
  const { groups, groupId, threads, threadId, workspaceId, count } = fresh({
    origin: { kind: "thread" },
    members: 0,
  });
  assert.deepEqual(
    threads.delete(threadId, after(1000), () => false),
    {
      groupId,
      kept: false,
      groupRemoved: true,
    },
  );
  assert.equal(groups.get(groupId), null);
  assert.deepEqual(groups.list(workspaceId), []);
  for (const table of ["groups", "group_changes", "group_members"]) assert.equal(count(table), 0);
});

test("a group made for a thread from nothing stays while it holds an item or another thread", () => {
  const items = fresh({ origin: { kind: "thread" }, members: 1 });
  assert.equal(items.threads.delete(items.threadId, after(1000), () => false)?.groupRemoved, false);
  assert.ok(items.groups.get(items.groupId));

  const other = fresh({ origin: { kind: "thread" }, members: 0 });
  other.threads.open(
    { id: id(20), workspaceId: other.workspaceId, groupId: other.groupId },
    after(500),
  );
  assert.equal(other.threads.delete(other.threadId, after(1000), () => false)?.groupRemoved, false);
  assert.ok(other.groups.get(other.groupId));
  assert.deepEqual(
    other.threads.ofGroup(other.groupId, after(1000)).map((s) => s.thread.id),
    [id(20)],
  );
});

test("a thread that wrote to a source is kept out of sight, with its records, and its links revoked", () => {
  const { db, groupId, threads, threadId, workspaceId, count } = fresh({ status: "applied" });
  assert.deepEqual(threads.wrote(threadId), {
    applied: 1,
    reverted: 0,
    unconfirmed: 0,
    sources: ["jira"],
  });
  assert.deepEqual(
    threads.delete(threadId, after(1000), () => false),
    {
      groupId,
      kept: true,
      groupRemoved: false,
    },
  );
  assert.deepEqual(
    tables.map((table) => [table, count(table)]),
    tables.map((table) => [table, 1]),
  );
  assert.deepEqual(
    db
      .prepare("select revoked_at from review_links")
      .all()
      .map((row) => row.revoked_at),
    [after(1000)],
  );
  assert.equal(threads.get(threadId, after(1000)), null);
  assert.deepEqual(threads.list(workspaceId, after(1000)), []);
  assert.deepEqual(threads.ofGroup(groupId, after(1000)), []);
  assert.throws(() => threads.markDone(threadId, after(2000)), /no thread/);
  assert.throws(() => threads.wrote(threadId), /no thread/);
  assert.throws(() => threads.delete(threadId, after(2000), () => false), /no thread/);
});

test("a change sent with no answer may have landed, so its thread is kept too", () => {
  // As the engine leaves it: failed, with what went wrong, and no mark.
  const { threads, threadId, count } = fresh({
    status: "failed",
    error: "fetch failed. This may already be in Jira; check before trying again.",
  });
  assert.deepEqual(threads.wrote(threadId), {
    applied: 0,
    reverted: 0,
    unconfirmed: 1,
    sources: [],
  });
  assert.equal(threads.delete(threadId, after(1000), () => false)?.kept, true);
  assert.equal(count("mutations"), 1);
  // A refusal before sending puts the row back to pending: nothing written.
  const refused = fresh({ status: "pending", error: "SYN-1 is no longer in the group." });
  assert.equal(refused.threads.delete(refused.threadId, after(1000), () => false)?.kept, false);
});

test("a change a revert undid counts as reverted, not as standing, and keeps its thread", () => {
  const { db, threads, threadId, workspaceId, count } = fresh({ status: "applied" });
  db.exec(`
    insert into change_sets (id, workspace_id, thread_id, run_id, revert_of, created_at)
    values ('${id(8)}', '${workspaceId}', '${threadId}', null, '${id(5)}', '${t0}');
  `);
  db.prepare(`
    insert into mutations (id, workspace_id, change_set_id, seq, op, target, args, status, applied, reverts)
    values (?, ?, ?, 1, 'setEstimate', 'jira:SYN-1', '{}', 'applied', ?, ?)`).run(
    id(9),
    workspaceId,
    id(8),
    JSON.stringify({
      item: { id: "jira:SYN-1", stableId: "10001" },
      before: { points: 3 },
      after: { points: null },
      at: after(500),
    }),
    id(7),
  );
  assert.deepEqual(threads.wrote(threadId), {
    applied: 0,
    reverted: 1,
    unconfirmed: 0,
    sources: ["jira"],
  });
  assert.equal(threads.delete(threadId, after(1000), () => false)?.kept, true);
  assert.equal(count("mutations"), 2);
});

test("nothing is deleted while one of its change sets is being applied", () => {
  const { threads, threadId, count } = fresh();
  assert.equal(
    threads.delete(threadId, after(1000), (changeSetId) => changeSetId === id(5)),
    null,
  );
  assert.equal(count("threads"), 1);
  assert.equal(count("deleted_threads"), 0);
  assert.ok(threads.get(threadId, after(1000)));
});

test("a deleted thread doesn't follow its group", () => {
  const { groups, groupId, threads, threadId, workspaceId } = fresh({ status: "applied" });
  threads.open({ id: id(20), workspaceId, groupId }, t0);
  threads.delete(threadId, after(1000), () => false);
  groups.add(groupId, [{ id: "jira:SYN-9", stableId: "10009" }], { kind: "user" }, after(2000));
  let n = 100;
  assert.deepEqual(
    threads.follow(groupId, after(2000), () => id(n++)).map((move) => move.threadId),
    [id(20)],
  );
});

test("a group made for a thread from nothing goes with it even after the user named it", () => {
  const { groups, groupId, threads, threadId, workspaceId, count } = fresh({
    origin: { kind: "thread" },
    members: 0,
  });
  assert.equal(groups.rename(groupId, "Kiosk wallets"), true);
  assert.equal(groups.get(groupId)?.namedBy, "user");
  assert.equal(threads.delete(threadId, after(1000), () => false)?.groupRemoved, true);
  assert.deepEqual(groups.list(workspaceId), []);
  assert.equal(count("user_named_groups"), 0);
});
