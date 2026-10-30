// A model-based test: seeded random histories of what a PM, a teammate, two
// Oriel instances and a flaky Jira do, with invariants checked after every
// step. A pure function of the seed: no clock, no sleeps.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  type CapturedMutation,
  type ChangeSets,
  type Instant,
  instant,
  parseItemId,
  type SourceWriter,
  type Ulid,
} from "@oriel/core";
import { ChangeSetError, changeSetsOver } from "./change-sets.ts";
import { sameValue } from "./hash.ts";
import { store } from "./store.ts";
import { fixtureJira, type MemoryIssue, memoryJira, nth, setup, specs, t0 } from "./testing.ts";

const seed = 20261029;
const sequences = 200;
const steps = 22;

// mulberry32: small, fast, and the same everywhere.
function prng(start: number): () => number {
  let a = start >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Two stories and two fields, so histories keep running into each other.
const pool = ["jira:SYN-21", "jira:SYN-117"] as const;
const points = [1, 2, 3, 5, 8, null];
const titles = ["Retry", "Refund", "Receipt"];
type Field = "points" | "summary";
const fieldOf = (issue: MemoryIssue, field: Field) =>
  field === "points" ? issue.points : issue.summary;
const idempotent = (op: string) => specs.jira?.ops[op]?.idempotent === true;

type Fault = "fail" | "lost" | "crash" | null;

async function run(sequence: number, shared: ReturnType<typeof setup>) {
  const random = prng(seed + sequence * 7919);
  const pick = <T>(list: readonly T[]): T => nth(list, Math.floor(random() * list.length));
  const chance = (p: number) => random() < p;
  const trail: string[] = [];
  // Problems are collected and asserted between steps: one thrown inside the
  // writer would be caught by apply as a failed send.
  const problems: string[] = [];
  const problem = (what: string) => problems.push(what);

  // One database for every sequence: each makes its own change sets, and
  // Jira in memory is fresh per sequence.
  const { db } = shared;
  const rows = store(db);
  const jira = memoryJira(fixtureJira(), t0);
  // Simulated time: it moves only between steps, sometimes past the send
  // lease, never while a send is in flight.
  let clock: Instant = t0;

  // Every row the model has seen: its change set and the row it undoes.
  const known = new Map<Ulid, { setId: Ulid; op: string; reverts: Ulid | null }>();
  const sets: { id: Ulid; revertOf: Ulid | null }[] = [];
  const remember = (set: {
    id: Ulid;
    revertOf: Ulid | null;
    mutations: { id: Ulid; op: string; reverts: Ulid | null }[];
  }) => {
    if (!sets.some((s) => s.id === set.id)) sets.push({ id: set.id, revertOf: set.revertOf });
    for (const m of set.mutations) known.set(m.id, { setId: set.id, op: m.op, reverts: m.reverts });
  };
  // Rows a person removed: their writes are theirs to check.
  const removed = new Set<Ulid>();

  // Checked as each write leaves.
  const writer: SourceWriter<"jira"> = {
    kind: "jira",
    current: jira.writer.current,
    apply(request) {
      const row = rows.mutation(request.mutationId);
      const set = row ? rows.load(row.changeSetId) : null;
      // Invariant 1: only a row of a change set approved as it stands, as is.
      if (!row || set?.decision?.kind !== "approved")
        problem(`sent ${request.op} ${request.mutationId} without a live approval`);
      else if (request.op !== row.op || !sameValue(request.args, row.args))
        problem(`sent ${request.op} ${JSON.stringify(request.args)} for a row that says otherwise`);
      // Invariant 6: rows land in seq order.
      if (row && set?.mutations.some((m) => m.seq < row.seq && m.status !== "applied"))
        problem(`sent row ${row.seq} of ${row.changeSetId} before an earlier row was applied`);
      return jira.writer.apply(request);
    },
  };
  const instance = (): ChangeSets =>
    changeSetsOver({
      db,
      sources: { jira: { writer, reader: jira.reader } },
      specs,
      reviewBase: new URL("http://localhost:4000/review/"),
      now: () => clock,
      emit: () => {},
    });
  const instances: ChangeSets[] = [instance(), instance()];

  // A fault for the next write; and, for two instances at once, the other
  // one starts while the first has its write in flight.
  let fault: Fault = null;
  // Writes to let through before the fault hits.
  let faultAfter = 0;
  let lost = false;
  let crash: PromiseWithResolvers<void> | null = null;
  let whileSending: (() => Promise<unknown>) | null = null;
  jira.hooks.before = async () => {
    const now = faultAfter > 0 ? null : fault;
    if (faultAfter > 0) faultAfter -= 1;
    else fault = null;
    const other = whileSending;
    whileSending = null;
    if (other) await other();
    if (now === "fail") throw new Error("503: Jira is busy");
    if (now === "crash") {
      crash?.resolve();
      return new Promise<void>(() => {});
    }
    lost = now === "lost";
  };
  jira.hooks.after = () => {
    if (!lost) return;
    lost = false;
    throw new Error("timed out");
  };

  // What landed, read from the fake's log after each step.
  let read = 0;
  const landings = new Map<Ulid, number>();
  // Per row, the value just before its first landing.
  const firstBefore = new Map<Ulid, { item: string; field: Field; value: unknown }>();
  const created = new Map<Ulid, string>();
  // Fields a teammate changed since Oriel last wrote them, and fields Oriel
  // has written at all.
  const dirty = new Set<string>();
  const oriel = new Set<string>();
  const absorb = () => {
    for (; read < jira.landings.length; read++) {
      const { request, before, after } = nth(jira.landings, read);
      const id = request.mutationId;
      const info = known.get(id);
      if (!info) problem(`a write landed for ${id}, which the model never saw`);
      const count = (landings.get(id) ?? 0) + 1;
      landings.set(id, count);
      // Invariant 2: a write that can't be repeated reaches Jira at most once.
      if (!idempotent(request.op) && count > 1)
        problem(`${request.op} ${id} reached Jira ${count} times`);
      const item = (before ?? after)?.key ?? "";
      const written = idempotent(request.op)
        ? Object.keys(request.args as object).filter(
            (f): f is Field => f === "points" || f === "summary",
          )
        : [];
      const touched =
        request.op === "deleteItem"
          ? [`${item}|points`, `${item}|summary`]
          : written.map((f) => `${item}|${f}`);
      // Invariant 4: a revert never writes over what a teammate set since
      // Oriel's write.
      if (info?.reverts) {
        const over = touched.find((f) => dirty.has(f));
        if (over) problem(`a revert of ${info.reverts} wrote over a teammate's ${over}`);
      }
      for (const f of touched) {
        dirty.delete(f);
        oriel.add(f);
      }
      if (request.op === "createStory" && after) created.set(id, after.key);
      const field = written[0];
      if (field && before && count === 1)
        firstBefore.set(id, { item, field, value: fieldOf(before, field) });
    }
  };

  // Invariant 3. Once all of a reverse applied, every write of the original
  // that landed is undone, unless a person removed it or its reverse row.
  // And as the reverse rows for a field apply, the field holds its value from
  // before the original: judged in the step they apply, since anyone may
  // change it again afterwards.
  const verified = new Set<Ulid>();
  // Rows seen applied at the end of an earlier step.
  const appliedBefore = new Set<Ulid>();
  let checked = 0;
  const checkReverts = () => {
    for (const { id, revertOf } of sets) {
      if (revertOf === null) continue;
      const reverse = rows.load(id);
      if (!reverse) continue;
      if (reverse.mutations.every((m) => m.status !== "applied" || appliedBefore.has(m.id)))
        continue;
      const full = reverse.mutations.every((m) => m.status === "applied");
      const undone = new Set(reverse.mutations.map((r) => r.reverts));
      const forgone = new Set(
        [...known]
          .filter(([r, info]) => info.setId === id && removed.has(r))
          .map(([, info]) => info.reverts),
      );
      const original = [...known].filter(([r, info]) => info.setId === revertOf && !removed.has(r));
      const byField = new Map<string, Ulid[]>();
      for (const [r] of original) {
        if ((landings.get(r) ?? 0) === 0) continue;
        const createdKey = created.get(r);
        if (createdKey) {
          if (full && !forgone.has(r) && jira.issue(createdKey) !== null)
            problem(`reverting ${revertOf} left the story ${createdKey} it created`);
          continue;
        }
        const was = firstBefore.get(r);
        if (!was) continue;
        // Writes to a story the original created go with the story.
        if ([...created.values()].includes(was.item)) continue;
        if (full && !undone.has(r) && !forgone.has(r))
          problem(`reverting ${revertOf} left ${was.item}'s ${was.field} as written by ${r}`);
        const key = `${was.item}|${was.field}`;
        byField.set(key, [...(byField.get(key) ?? []), r]);
      }
      if (full) verified.add(id);
      for (const writers of byField.values()) {
        if (!writers.every((w) => undone.has(w))) continue;
        const covering = reverse.mutations.filter((m) => m.reverts && writers.includes(m.reverts));
        if (!covering.every((m) => m.status === "applied")) continue;
        if (covering.every((m) => appliedBefore.has(m.id))) continue;
        const was = firstBefore.get(nth(writers, 0));
        const issue = was && jira.issue(was.item);
        if (!was || !issue) continue;
        checked += 1;
        const now = fieldOf(issue, was.field);
        if (!sameValue(now, was.value))
          problem(
            `after reverting ${revertOf}, ${was.item}'s ${was.field} is ${JSON.stringify(now)}, not ${JSON.stringify(was.value)}`,
          );
      }
    }
  };

  // Invariant 5: a row is applied only if its write landed, or its value was
  // already in place (then its `after` holds the value it would have set).
  const checkApplied = () => {
    for (const [id, info] of known) {
      const row = rows.mutation(id);
      if (row?.status !== "applied" || !row.applied) continue;
      if ((landings.get(id) ?? 0) > 0) continue;
      if (!idempotent(info.op)) problem(`${info.op} ${id} is applied but never reached Jira`);
      for (const [field, value] of Object.entries(row.args as Record<string, unknown>))
        if (!sameValue(row.applied.after[field], value))
          problem(`${id} is applied without a write, but its ${field} wasn't in place`);
    }
  };

  const expected = (error: unknown) => {
    if (error instanceof ChangeSetError) return;
    if (
      error instanceof Error &&
      /landed in the source, but its row changed meanwhile/.test(error.message)
    )
      return;
    problem(`unexpected error: ${error instanceof Error ? error.stack : String(error)}`);
  };
  const attempt = async (work: () => Promise<unknown>) => {
    try {
      await work();
    } catch (error) {
      expected(error);
    }
  };
  // Runs an apply, or stops waiting once its instance has crashed; a crashed
  // instance is replaced, as a restarted process would be.
  const applyOn = async (slot: number, id: Ulid) => {
    crash = Promise.withResolvers<void>();
    const crashed = crash.promise.then(() => "crashed" as const);
    const outcome = await Promise.race([
      nth(instances, slot)
        .apply(id)
        .then(
          () => "done" as const,
          (error: unknown) => {
            expected(error);
            return "done" as const;
          },
        ),
      crashed,
    ]);
    if (outcome === "crashed") instances[slot] = instance();
  };
  // Render, approve and apply in one go, perhaps with a fault on the first write.
  const ship = async (id: Ulid) => {
    const a = nth(instances, 0);
    fault = pick<Fault>([null, null, "fail", "lost", "lost", "crash"]);
    faultAfter = pick([0, 1, 1]);
    const slot = pick([0, 1]);
    trail.push(`ship(${slot},${fault ?? "ok"})`);
    await attempt(async () => {
      const shown = await a.diff(id);
      await a.decide(id, "approved", { via: "thread", by: "pm" }, shown.hash);
    });
    await applyOn(slot, id);
    fault = null;
  };

  let teammate = 0;
  // Mostly the newest change set, so a revert tends to get shipped too.
  const randomSet = () => {
    const newest = sets.at(-1);
    if (!newest) return null;
    return chance(0.5) ? newest.id : pick(sets.slice(-4)).id;
  };
  const setOp = (target: string): CapturedMutation =>
    chance(0.6)
      ? {
          op: "setEstimate",
          target: target as `jira:${string}`,
          ref: null,
          args: { points: pick(points) },
        }
      : {
          op: "setSummary",
          target: target as `jira:${string}`,
          ref: null,
          args: { summary: pick(titles) },
        };
  const randomMutations = (): CapturedMutation[] => {
    if (chance(0.8)) return [setOp(pick(pool))];
    return [
      {
        op: "createStory",
        target: null,
        ref: "new:1",
        args: { summary: "Wallets", epic: "jira:SYN-1" },
      },
      ...(chance(0.5) ? [setOp("new:1")] : []),
      ...(chance(0.5)
        ? [
            {
              op: "addLink",
              target: "new:1",
              ref: null,
              args: { url: "https://docs.example.com/w", title: "Spec" },
            } as const,
          ]
        : []),
    ];
  };

  // A random walk that leans toward the next interesting move: retry or
  // revert what was sent, revert or edit around what applied, ship a revert.
  type Action =
    | "capture"
    | "ship"
    | "render"
    | "decide"
    | "apply"
    | "both"
    | "edit"
    | "teammate"
    | "revert";
  const chooseAction = (): Action => {
    const newest = sets.at(-1);
    if (!newest) return "capture";
    const set = rows.load(newest.id);
    const mutations = set?.mutations ?? [];
    const sent = mutations.some((m) => m.status === "failed");
    const done = mutations.length > 0 && mutations.every((m) => m.status === "applied");
    const weights: [Action, number][] = [
      ["capture", done ? 1.5 : 0.6],
      ["ship", newest.revertOf !== null && !done ? 4 : 2],
      ["render", 0.4],
      ["decide", 0.5],
      ["apply", sent ? 3 : 1],
      ["both", sent ? 1.5 : 0.6],
      ["edit", sent || newest.revertOf !== null ? 1.5 : 0.8],
      ["teammate", done || sent ? 2.5 : 1.5],
      ["revert", done ? 3 : sent ? 3 : 0.5],
    ];
    let roll = random() * weights.reduce((sum, [, w]) => sum + w, 0);
    for (const [action, weight] of weights) {
      roll -= weight;
      if (roll < 0) return action;
    }
    return "capture";
  };

  for (let step = 0; step < steps; step++) {
    clock = instant(new Date(Date.parse(clock) + pick([0, 0, 60_000, 6 * 60_000])));
    const action = chooseAction();
    const a = nth(instances, 0);
    if (action === "capture") {
      trail.push("capture");
      const mutations = [...randomMutations(), ...(chance(0.5) ? [setOp(pick(pool))] : [])];
      await attempt(async () => remember(await a.capture(shared.run, mutations)));
    } else if (action === "ship") {
      const id = randomSet();
      if (id) await ship(id);
    } else if (action === "render") {
      const id = randomSet();
      if (!id) continue;
      trail.push("render");
      await attempt(() => a.diff(id));
    } else if (action === "decide") {
      const id = randomSet();
      if (!id) continue;
      const kind = chance(0.8) ? "approved" : "rejected";
      trail.push(kind === "approved" ? "approve" : "reject");
      const hash = rows.load(id)?.hash ?? "";
      await attempt(() => a.decide(id, kind, { via: "thread", by: "pm" }, hash));
    } else if (action === "apply") {
      const id = randomSet();
      if (!id) continue;
      fault = pick<Fault>([null, null, "fail", "lost", "crash"]);
      faultAfter = pick([0, 1, 1]);
      const slot = pick([0, 1]);
      trail.push(`apply(${slot},${fault ?? "ok"})`);
      await applyOn(slot, id);
      fault = null;
    } else if (action === "both") {
      // Two instances: the second starts while the first's write is in flight.
      const id = randomSet();
      if (!id) continue;
      trail.push("apply(both)");
      whileSending = () => applyOn(1, id);
      await applyOn(0, id);
      whileSending = null;
    } else if (action === "edit") {
      const id = randomSet();
      const open = id ? (rows.load(id)?.mutations.filter((m) => m.status !== "applied") ?? []) : [];
      if (!id || open.length === 0) continue;
      const m = pick(open);
      if (chance(0.5)) {
        trail.push("remove");
        await attempt(async () => {
          await a.edit(id, { remove: [m.id] });
          removed.add(m.id);
        });
      } else {
        trail.push("edit");
        const args =
          m.op === "setEstimate"
            ? { points: pick(points) }
            : m.op === "setSummary"
              ? { summary: pick(titles) }
              : m.args;
        await attempt(() => a.edit(id, { set: [{ mutationId: m.id, args }] }));
      }
    } else if (action === "teammate") {
      // A teammate changes a field, often one Oriel just wrote. Before Oriel
      // ever writes a field, the teammate may pick a value Oriel might also
      // set; after, always one nobody else uses, since a later change back to
      // Oriel's value can't be told apart from no change at all.
      const aimed = sets
        .slice(-2)
        .flatMap((s) => rows.load(s.id)?.mutations ?? [])
        .flatMap((m) => {
          const target = m.applied?.item.id ?? (m.target?.startsWith("jira:") ? m.target : null);
          const key = target ? (parseItemId(target)?.key ?? null) : null;
          const field =
            m.op === "setEstimate" ? "points" : m.op === "setSummary" ? "summary" : null;
          // What a row still to be applied would set: a teammate may make the
          // same change first.
          const args = m.args as Record<string, unknown>;
          const wants = m.status === "applied" || !field ? undefined : args[field];
          return key && field ? [{ key, field: field as Field, wants }] : [];
        });
      const keys = [...pool.map((id) => parseItemId(id)?.key ?? ""), ...jira.created].filter(
        (k) => jira.issue(k) !== null,
      );
      const target: { key: string; field: Field; wants?: unknown } =
        aimed.length && chance(0.7)
          ? pick(aimed)
          : { key: pick(keys), field: pick<Field>(["points", "summary"]) };
      const { key, field, wants } = target;
      teammate += 1;
      const fresh = !oriel.has(`${key}|${field}`);
      const value =
        fresh && wants !== undefined && chance(0.4)
          ? wants
          : field === "points"
            ? fresh && chance(0.5)
              ? pick(points)
              : 100 + teammate
            : fresh && chance(0.5)
              ? pick(titles)
              : `Teammate ${teammate}`;
      const issue = jira.issue(key);
      if (!issue || sameValue(fieldOf(issue, field), value)) continue;
      trail.push(`teammate(${key}.${field})`);
      jira.edit(
        key,
        field === "points" ? { points: value as number | null } : { summary: String(value) },
      );
      dirty.add(`${key}|${field}`);
    } else {
      const id = randomSet();
      if (!id) continue;
      trail.push("revert");
      let reverse: Ulid | null = null;
      await attempt(async () => {
        const result = await a.revert(id);
        if ("conflicts" in result) return;
        remember(result);
        reverse = result.id;
      });
      if (reverse && chance(0.6)) await ship(reverse);
    }
    for (const { id } of sets) {
      const set = rows.load(id);
      if (set) remember(set);
    }
    absorb();
    checkReverts();
    checkApplied();
    for (const id of known.keys())
      if (rows.mutation(id)?.status === "applied") appliedBefore.add(id);
    if (problems.length)
      assert.fail(`sequence ${sequence}: ${problems.join("; ")}\n  steps: ${trail.join(" → ")}`);
  }
  return { landed: jira.landings.length, reverts: checked };
}

test("model: random histories keep the change-set invariants", async () => {
  const shared = setup();
  let landed = 0;
  let reverts = 0;
  for (let sequence = 0; sequence < sequences; sequence++) {
    const outcome = await run(sequence, shared);
    landed += outcome.landed;
    reverts += outcome.reverts;
  }
  // The histories must reach the states the invariants are about.
  assert.ok(landed > 450, `only ${landed} writes landed`);
  assert.ok(reverts > 40, `only ${reverts} reverted fields were checked`);
});
