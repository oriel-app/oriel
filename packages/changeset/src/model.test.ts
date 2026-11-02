// A model-based test: seeded random histories of what a PM, a teammate, two
// Oriel instances and a flaky Jira do, with invariants checked after every
// step. A pure function of the seed: no clock, no sleeps.
//
// Besides what lands, it checks what is offered. After every step, each of
// the newest change sets offers a step or is done with (invariant 8), and
// every step offered succeeds when taken from that state (invariant 7),
// tried on a copy of the database and of Jira so the walk goes on from the
// state as it was. While an apply is in flight, nothing is offered and every
// action is refused as busy (invariant 9).
//
// CI walks all 200 histories (GitHub Actions sets `CI`). Elsewhere it walks
// the first 30 of the same 200, in a tenth of the time, and skips the checks
// that the walk reached the states the invariants are about, which take all
// 200. To walk all 200 locally:
// `CI=true node --test packages/changeset/src/model.test.ts`.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  type CapturedMutation,
  type ChangeSet,
  type ChangeSets,
  type Instant,
  instant,
  type NextStep,
  parseItemId,
  type SourceWriter,
  type Ulid,
} from "@oriel/core";
import { workstreamStore, open } from "@oriel/db";
import { ChangeSetError, changeSetsOver, type Specs } from "./change-sets.ts";
import { sameValue } from "./hash.ts";
import { store } from "./store.ts";
import {
  fixtureJira,
  forkJira,
  type MemoryIssue,
  memoryJira,
  nth,
  setup,
  specs,
  t0,
} from "./testing.ts";

const seed = 20261029;
const histories = 200;
const sequences = process.env["CI"] ? histories : 30;
const steps = 28;

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

const thread = { via: "thread", by: "pm" } as const;
const reviewBase = new URL("http://localhost:4000/review/");

// Jira's catalogue, which can tighten under stored arguments: each of
// `banned` (an op and its arguments as JSON) no longer passes. The rows, and
// so any approval of them, stay as they were.
function tightening(banned: ReadonlySet<string>): Specs {
  const jira = specs.jira;
  if (!jira) throw new Error("no Jira specs");
  const ops = Object.fromEntries(
    Object.entries(jira.ops).map(([name, op]) => [
      name,
      {
        ...op,
        args: (input: unknown, path?: string) =>
          banned.has(`${name}\u0000${JSON.stringify(input)}`)
            ? { ok: false as const, issues: [{ path: path ?? "$", message: "no longer allowed" }] }
            : op.args(input, path),
      },
    ]),
  );
  return { jira: { ...jira, ops } };
}

// Whether every change a set applied can be undone, judged from its rows
// alone: a change to an item it created goes with the item, and what an undo
// puts back must pass the catalogue too.
function undoable(set: ChangeSet, catalogue: Specs): boolean {
  const ops = catalogue.jira?.ops ?? {};
  const created = new Set(
    set.mutations.flatMap((m) => (m.applied && ops[m.op]?.creates ? [m.applied.item.id] : [])),
  );
  return set.mutations.every((m) => {
    if (!m.applied) return true;
    const spec = ops[m.op];
    if (!spec?.args(m.args).ok) return false;
    if (created.has(m.applied.item.id) && !spec.creates) return true;
    const step = spec.undo(m.args, m.applied);
    return !("refused" in step) && ops[step.op]?.args(step.args).ok === true;
  });
}

// Done with: nothing more of it applies (it applied in full, or it was
// rejected or dismissed) and nothing it applied can be reverted (nothing
// did, it is a revert itself, or a change can't be undone); or a revert of
// it is under way or undid part of it.
function finished(set: ChangeSet, reverts: readonly ChangeSet[], catalogue: Specs): boolean {
  if (reverts.some((r) => r.decision?.kind !== "rejected" || r.mutations.some((m) => m.applied)))
    return true;
  const applied = set.mutations.filter((m) => m.applied !== null);
  const settled = set.decision?.kind === "rejected" || applied.length === set.mutations.length;
  return settled && (applied.length === 0 || set.revertOf !== null || !undoable(set, catalogue));
}

async function run(sequence: number, shared: ReturnType<typeof setup>) {
  const random = prng(seed + sequence * 7919);
  const banned = new Set<string>();
  const catalogue = tightening(banned);
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
  // Reads that found a sent row's item without its value, and the landings
  // before each; and each row's last landing.
  const absentReads: { row: Ulid; landed: number }[] = [];
  const lastLanding = new Map<Ulid, number>();

  // Checked as each write leaves.
  const writer: SourceWriter<"jira"> = {
    kind: "jira",
    current: jira.writer.current,
    // Each read notes the sent rows on the item that it found without their
    // value, and how many writes had landed by then (invariant 10).
    async read(id, fields) {
      // Landings so far: the read's answer can't reflect any later one.
      const landed = jira.landings.length;
      const found = await jira.writer.read(id, fields);
      if (found === "gone") return found;
      for (const [rowId] of known) {
        const row = rows.mutation(rowId);
        if (row?.status !== "failed" || row.target !== id) continue;
        const field =
          row.op === "setEstimate" ? "points" : row.op === "setSummary" ? "summary" : null;
        const args = row.args as Record<string, unknown>;
        if (field && !sameValue(found.values[field], args[field]))
          absentReads.push({ row: rowId, landed });
      }
      return found;
    },
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
      specs: catalogue,
      reviewBase,
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
      lastLanding.set(id, read);
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
  // that landed is undone, unless a person removed it or its reverse row, or
  // dismissed it unapplied (the dismissal warned it may have landed, and a
  // revert covers exactly what applied).
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
      const dismissed = rows.load(revertOf)?.decision?.kind === "rejected";
      const original = [...known].filter(
        ([r, info]) =>
          info.setId === revertOf &&
          !removed.has(r) &&
          !(dismissed && rows.mutation(r)?.status !== "applied"),
      );
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

  // Invariant 10: a row whose write landed is unsent again only once a read
  // made after that landing found its item without its value. Anything else
  // un-sends a write that may have landed.
  const checkUnsent = () => {
    for (const [id, last] of lastLanding) {
      if (rows.mutation(id)?.status !== "pending") continue;
      if (!absentReads.some((r) => r.row === id && r.landed > last))
        problem(`${id} landed, then went back to unsent without a read finding it absent since`);
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

  // States the offered-step invariants must reach, counted over the run.
  const reached = {
    dismissedWithSent: 0,
    goneUnapproved: 0,
    stale: 0,
    applying: 0,
    dismissedPartReverse: 0,
    // Stale arguments under an approval that still stands.
    staleApproved: 0,
    // A row sent before whose item Oriel couldn't check.
    couldntTell: 0,
    // A sent row whose item can't be read, and so can't be approved again.
    sentGone: 0,
  };

  // Invariant 7: takes one offered step on a copy of the database and of
  // Jira, and checks that it succeeds. A retry must send, or record in place,
  // its first change: only a revert's conflict check or (for a change sent
  // before, once found not in place) the workstream may stop it, since those read
  // the source.
  const probe = async (id: Ulid, step: NextStep, mutationId?: Ulid) => {
    const copy = open(":memory:");
    copy.deserialize(db.serialize());
    const fork = forkJira(jira);
    const engine = changeSetsOver({
      db: copy,
      sources: { jira: { writer: fork.writer, reader: fork.reader } },
      specs: catalogue,
      reviewBase,
      now: () => clock,
      emit: () => {},
    });
    const copied = store(copy);
    const set = copied.load(id);
    try {
      if (!set) throw new Error("gone");
      switch (step.kind) {
        case "approve":
        case "approve-rest": {
          // Offered on the diff last shown; the person approves the one in
          // front of them, which reads the source again. Only an item that
          // has become unreadable since may stop it there.
          const shown = await engine.diff(id);
          const refusal = await engine.decide(id, "approved", thread, shown.hash).then(
            () => null,
            (error: unknown) => error,
          );
          if (refusal !== null) {
            // Only an item that really can't be read now, or whose key another
            // item has taken, may be shown as gone.
            const keys = set.mutations
              .filter((m) => m.status !== "applied")
              .flatMap((m) => {
                const made = set.mutations.find((c) => c.ref !== null && c.ref === m.target);
                const item = m.target?.startsWith("jira:") ? m.target : made?.applied?.item.id;
                return item ? [parseItemId(item)?.key ?? ""] : [];
              });
            const unreadable = keys.some((k) => hidden.has(k) || reused.has(k));
            if (!(refusal instanceof ChangeSetError && /couldn.t be read/.test(refusal.message)))
              throw refusal;
            if (!unreadable) throw refusal;
            break;
          }
          // What approval vouches for (each change shown, readable as the
          // item it should be, and valid) never stops the apply after it.
          const report = await engine.apply(id).catch((error: unknown) => ({
            failed: [{ error: error instanceof Error ? error.message : String(error) }],
          }));
          const vouched =
            /no longer valid|hasn.t been shown in a diff|couldn.t be read when|couldn.t tell/;
          const stop = report.failed.find((f) => vouched.test(f.error));
          if (stop) problem(`${id} was approved, then apply stopped: ${stop.error}`);
          break;
        }
        case "reject":
          await engine.decide(id, "rejected", thread, set.hash);
          break;
        case "remove":
          await engine.edit(id, { remove: mutationId ? [mutationId] : [] });
          break;
        case "retry": {
          const first = set.mutations.find((m) => m.status !== "applied");
          const report = await engine.apply(id);
          const why = report.failed[0]?.error ?? "";
          if (
            report.applied.length === 0 &&
            fork.calls.length === 0 &&
            first?.status !== "failed" &&
            !why.startsWith("Stopped, so nothing was overwritten")
          )
            problem(`retry of ${id} was offered, then stopped before sending: ${why}`);
          break;
        }
        case "revert": {
          await engine.revert(id);
          // One revert at a time: no other may be under way, or have undone
          // part of it.
          const standing = copied
            .revertsOf(id)
            .flatMap((r) => copied.load(r) ?? [])
            .filter((r) => r.decision?.kind !== "rejected" || r.mutations.some((m) => m.applied));
          if (standing.length > 1) problem(`${id} was reverted while a revert of it stands`);
          break;
        }
        case "dismiss":
          await engine.dismiss(id);
          break;
      }
    } catch (error) {
      problem(
        `${step.kind} of ${id} was offered, then failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      copy.close();
    }
  };

  // Invariants 7 and 8, over the newest change sets: the ones the walk acts
  // on. Older ones change only through a teammate, which no guard reads. A
  // state already seen isn't checked again: what a guard reads is the set's
  // rows, its reverts', and the clock while a send's lease may be running.
  const seen = new Set<string>();
  const checkSteps = async () => {
    const a = nth(instances, 0);
    for (const { id } of sets.slice(-4)) {
      const set = rows.load(id);
      if (!set) continue;
      const reverts = sets.flatMap((s) => (s.revertOf === id ? (rows.load(s.id) ?? []) : []));
      const leased = set.mutations.some((m) => m.status === "failed");
      const state = JSON.stringify([set, reverts, leased ? clock : null]);
      if (seen.has(state)) continue;
      seen.add(state);
      const steps = await a.nextSteps(id);
      if (steps.length === 0 && !finished(set, reverts, catalogue))
        problem(`${id} offers nothing, yet isn't done with`);
      for (const step of steps) {
        if (step.kind === "remove")
          for (const mutationId of step.mutationIds) await probe(id, step, mutationId);
        else await probe(id, step);
      }
      const kinds = steps.map((s) => s.kind);
      const open = set.mutations.filter((m) => m.status !== "applied");
      const rejected = set.decision?.kind === "rejected";
      if (
        rejected &&
        set.mutations.some((m) => m.applied) &&
        open.some((m) => m.status === "failed")
      )
        reached.dismissedWithSent += 1;
      if (open.some((m) => m.preview?.["$gone"] === true) && !kinds.includes("approve"))
        reached.goneUnapproved += 1;
      const stale = open.some((m) => !catalogue.jira?.ops[m.op]?.args(m.args).ok);
      if (stale) reached.stale += 1;
      if (stale && set.decision?.kind === "approved") reached.staleApproved += 1;
      if (
        open.some((m) => m.status === "failed" && m.preview?.["$gone"] === true) &&
        !kinds.includes("approve") &&
        !kinds.includes("approve-rest")
      )
        reached.sentGone += 1;
      if (open.some((m) => m.status === "failed" && /couldn.t tell/.test(m.error ?? "")))
        reached.couldntTell += 1;
      if (set.revertOf !== null && rejected && set.mutations.some((m) => m.applied))
        reached.dismissedPartReverse += 1;
    }
  };

  // Invariant 9: while instance 0 applies a change set, it offers nothing
  // and refuses every action as busy.
  const checkBusy = async (id: Ulid) => {
    const a = nth(instances, 0);
    const set = rows.load(id);
    if (!set) return;
    reached.applying += 1;
    if (!a.applying(id)) problem(`${id} isn't marked as applying while it applies`);
    const offered = await a.nextSteps(id);
    if (offered.length) problem(`${id} offered ${offered.map((s) => s.kind)} while it applies`);
    const open = set.mutations.find((m) => m.status !== "applied");
    const actions: [string, () => Promise<unknown>][] = [
      ["approve", () => a.decide(id, "approved", thread, set.hash)],
      ["reject", () => a.decide(id, "rejected", thread, set.hash)],
      ["retry", () => a.apply(id)],
      ["revert", () => a.revert(id)],
      ["dismiss", () => a.dismiss(id)],
      ...(open
        ? [["remove", () => a.edit(id, { remove: [open.id] })] as [string, () => Promise<unknown>]]
        : []),
    ];
    for (const [name, act] of actions) {
      const outcome = await act().then(
        () => "done",
        (error: unknown) => (error instanceof ChangeSetError ? error.code : String(error)),
      );
      if (outcome !== "busy") problem(`${name} of ${id} while it applies: ${outcome}, not busy`);
    }
  };
  // Render, approve and apply in one go, perhaps with a fault on the first write.
  // Jira's catalogue tightens under a change not yet applied, other than
  // the next one: its stored arguments no longer pass. The row is as it was,
  // so an approval of it stands.
  const tighten = (id: Ulid): boolean => {
    const open = rows.load(id)?.mutations.filter((m) => m.status !== "applied") ?? [];
    // Only a rename: summaries are unique to a row, so this bans that row's
    // arguments and no other's.
    const later = open.slice(1).filter((m) => m.op === "setSummary");
    if (later.length === 0) return false;
    const m = pick(later);
    trail.push("tighten");
    banned.add(`${m.op}\u0000${JSON.stringify(m.args)}`);
    return true;
  };
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
    // Now and then the catalogue tightens between approval and apply.
    if (chance(0.1)) tighten(id);
    await applyOn(slot, id);
    fault = null;
  };

  // Pool stories taken out of the thread's workstream, which every sequence
  // shares, for as long as one move.
  const outOfWorkstream = new Set<string>();
  const member = (item: string) => ({
    id: item as `jira:${string}`,
    stableId: shared.indexed(parseItemId(item)?.key ?? "").stableId,
  });
  const leaveWorkstream = (item: string) => {
    if (!(pool as readonly string[]).includes(item) || outOfWorkstream.has(item)) return;
    workstreamStore(db).remove(shared.workstreamId, [member(item)], { kind: "user" }, clock);
    outOfWorkstream.add(item);
  };
  const joinWorkstream = (item: string) => {
    workstreamStore(db).add(shared.workstreamId, [member(item)], { kind: "user" }, clock);
    outOfWorkstream.delete(item);
  };
  let teammate = 0;
  // A summary no other row has: titles, numbered.
  let named = 0;
  const summary = () => `${pick(titles)} ${(named += 1)}`;
  const hidden = new Set<string>();
  // Keys another item has taken, with the stable ID of the item that had it.
  // A story the index holds is taken there too, as the next sync would see
  // it, so Oriel no longer knows which item the key should be.
  const reused = new Map<string, string>();
  const indexedKey = (key: string) => pool.includes(`jira:${key}` as (typeof pool)[number]);
  const reuseKey = (key: string, stableId: string) => {
    reused.set(key, stableId);
    jira.reuse(key, `9${stableId}`);
    if (indexedKey(key)) shared.indexPage([{ ...shared.indexed(key), stableId: `9${stableId}` }]);
  };
  const restoreKey = (key: string) => {
    const original = reused.get(key);
    if (original === undefined) return;
    jira.reuse(key, original);
    if (indexedKey(key)) shared.indexPage([shared.indexed(key)], [`9${original}`]);
    reused.delete(key);
  };
  const applyWithFault = async (id: Ulid) => {
    fault = pick<Fault>([null, null, "fail", "lost", "crash"]);
    faultAfter = pick([0, 1, 1]);
    await applyOn(pick([0, 1]), id);
    fault = null;
  };
  const revert = async (id: Ulid) => {
    let reverse: Ulid | null = null;
    await attempt(async () => {
      const result = await nth(instances, 0).revert(id);
      if ("conflicts" in result) return;
      remember(result);
      reverse = result.id;
    });
    if (reverse && chance(0.6)) await ship(reverse);
  };
  // Mostly the newest change set, so a revert tends to get shipped too.
  const randomSet = () => {
    const newest = sets.at(-1);
    if (!newest) return null;
    return chance(0.5) ? newest.id : pick(sets.slice(-4)).id;
  };
  // The same, among those not rejected or dismissed: for the moves that act
  // as if it could still apply.
  const liveSet = () => {
    const live = sets
      .slice(-4)
      .filter(({ id }) => rows.load(id)?.decision?.kind !== "rejected")
      .map(({ id }) => id);
    const newest = live.at(-1);
    if (!newest) return null;
    return chance(0.5) ? newest : pick(live);
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
          args: { summary: summary() },
        };
  const randomMutations = (): CapturedMutation[] => {
    if (chance(0.8)) return [setOp(pick(pool))];
    return [
      // Sometimes a change lands before the create, so a create sent with no
      // answer can sit next to applied rows.
      ...(chance(0.4) ? [setOp(pick(pool))] : []),
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
  // A random walk that also takes the steps the engine offers, and moves the
  // world under them: an item that can't be read, a catalogue that tightened.
  type Action =
    | "capture"
    | "ship"
    | "render"
    | "decide"
    | "apply"
    | "both"
    | "edit"
    | "teammate"
    | "revert"
    | "step"
    | "dismiss"
    | "hide"
    | "tighten"
    | "unreadable";
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
      ["both", sent ? 2 : 1],
      ["edit", sent || newest.revertOf !== null ? 1.5 : 0.8],
      ["teammate", done || sent ? 2.5 : 1.5],
      ["revert", done ? 3 : sent ? 3 : 0.5],
      ["step", 3],
      ["dismiss", sent ? 1 : 0.2],
      ["hide", 0.25],
      ["tighten", 0.15],
      ["unreadable", sent ? 1 : 0],
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
      const id = liveSet();
      if (id) await ship(id);
    } else if (action === "render") {
      const id = randomSet();
      if (!id) continue;
      trail.push("render");
      await attempt(() => a.diff(id));
    } else if (action === "decide") {
      const id = liveSet();
      if (!id) continue;
      // A rejection is final, so it ends a set's history: rarely.
      const kind = chance(0.9) ? "approved" : "rejected";
      trail.push(kind === "approved" ? "approve" : "reject");
      // A person decides on the diff in front of them.
      await attempt(async () => {
        const shown = await a.diff(id);
        await a.decide(id, kind, thread, shown.hash);
      });
    } else if (action === "apply") {
      const id = liveSet();
      if (!id) continue;
      fault = pick<Fault>([null, null, "fail", "lost", "crash"]);
      faultAfter = pick([0, 1, 1]);
      const slot = pick([0, 1]);
      trail.push(`apply(${slot},${fault ?? "ok"})`);
      await applyOn(slot, id);
      fault = null;
    } else if (action === "both") {
      // Two instances: the second starts while the first's write is in flight.
      const id = liveSet();
      if (!id) continue;
      trail.push("apply(both)");
      // Approved first, if it can be, so that a write goes out.
      await attempt(async () => {
        const shown = await a.diff(id);
        await a.decide(id, "approved", thread, shown.hash);
      });
      if (chance(0.6)) {
        whileSending = async () => {
          await checkBusy(id);
          await applyOn(1, id);
        };
      } else {
        // Or while the first checks whether an earlier send is in place.
        trail.push("(while reading)");
        jira.hooks.answered = async (item) => {
          jira.hooks.answered = undefined;
          // Its send often lands with its answer lost, after the first's
          // read: what the first read is out of date.
          fault = chance(0.5) ? "lost" : null;
          faultAfter = 0;
          await applyOn(1, id);
          fault = null;
          // Now and then a third can't read it, and says it couldn't tell,
          // perhaps in the very words already on the row.
          if (chance(0.5)) {
            jira.hooks.read = () => {
              jira.hooks.read = undefined;
              throw new Error("503: Jira is busy");
            };
            await applyOn(1, id);
            jira.hooks.read = undefined;
          }
          // And now and then the item leaves the workstream meanwhile, so the first
          // finds the change absent but may not send it. It comes back after.
          if (chance(0.5)) leaveWorkstream(item);
        };
      }
      await applyOn(0, id);
      whileSending = null;
      jira.hooks.answered = undefined;
      for (const item of outOfWorkstream) joinWorkstream(item);
    } else if (action === "edit") {
      const id = liveSet();
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
              ? { summary: summary() }
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
    } else if (action === "revert") {
      const id = randomSet();
      if (!id) continue;
      trail.push("revert");
      await revert(id);
    } else if (action === "step") {
      // One of the steps the engine offers, taken for real.
      const id = randomSet();
      if (!id) continue;
      const offered = await a.nextSteps(id);
      if (offered.length === 0) continue;
      const next = pick(offered);
      trail.push(`step(${next.kind})`);
      const hash = rows.load(id)?.hash ?? "";
      if (next.kind === "approve" || next.kind === "approve-rest") {
        await attempt(() => a.decide(id, "approved", thread, hash));
        if (chance(0.7)) await applyWithFault(id);
      } else if (next.kind === "retry") await applyWithFault(id);
      else if (next.kind === "reject") await attempt(() => a.decide(id, "rejected", thread, hash));
      else if (next.kind === "remove") {
        const mutationId = pick(next.mutationIds);
        await attempt(async () => {
          await a.edit(id, { remove: [mutationId] });
          removed.add(mutationId);
        });
      } else if (next.kind === "dismiss") await attempt(() => a.dismiss(id));
      else await revert(id);
    } else if (action === "dismiss") {
      const id = randomSet();
      if (!id) continue;
      trail.push("dismiss");
      await attempt(() => a.dismiss(id));
    } else if (action === "unreadable") {
      // A change sent with no answer, the rest of its set left out (which
      // voids the approval), then its item can't be read: the next diff shows
      // it gone, and approving is refused.
      const candidates = sets.slice(-4).flatMap(({ id }) => {
        const set = rows.load(id);
        if (!set || set.decision?.kind === "rejected") return [];
        const open = set.mutations.filter((m) => m.status !== "applied");
        const sentRow = open.find((m) => m.status === "failed" && m.target?.startsWith("jira:"));
        const others = open.filter((m) => m !== sentRow);
        return sentRow?.target && others.length
          ? [{ id, sentRow, target: sentRow.target, others }]
          : [];
      });
      if (candidates.length === 0) continue;
      const { id, target, others } = pick(candidates);
      trail.push("unreadable");
      for (const m of others)
        await attempt(async () => {
          await a.edit(id, { remove: [m.id] });
          removed.add(m.id);
        });
      const key = parseItemId(target)?.key ?? "";
      hidden.add(key);
      jira.hide(key);
      await attempt(() => a.diff(id));
    } else if (action === "hide") {
      // A story becomes unreadable (deleted, moved, forbidden), or another
      // item takes its key; or it comes back. Either way Oriel can't tell
      // what it holds. Mostly briefly: one comes back more often than not.
      const back = [...hidden, ...reused.keys()];
      if (back.length && chance(0.7)) {
        const key = pick(back);
        trail.push(`back(${key})`);
        hidden.delete(key);
        jira.show(key);
        restoreKey(key);
      } else {
        const key = pick([...pool.map((id) => parseItemId(id)?.key ?? ""), ...jira.created]);
        const issue = jira.issue(key);
        if (chance(0.5) || !issue || reused.has(key)) {
          trail.push(`hide(${key})`);
          hidden.add(key);
          jira.hide(key);
        } else {
          trail.push(`reuse(${key})`);
          reuseKey(key, issue.id);
        }
      }
    } else {
      const id = liveSet();
      if (id) tighten(id);
    }
    for (const { id } of sets) {
      const set = rows.load(id);
      if (set) remember(set);
    }
    absorb();
    checkReverts();
    checkApplied();
    checkUnsent();
    await checkSteps();
    for (const id of known.keys())
      if (rows.mutation(id)?.status === "applied") appliedBefore.add(id);
    if (problems.length)
      assert.fail(`sequence ${sequence}: ${problems.join("; ")}\n  steps: ${trail.join(" → ")}`);
  }
  // The index is shared by every sequence: as it was.
  for (const key of reused.keys()) restoreKey(key);
  return { landed: jira.landings.length, reverts: checked, reached };
}

test("model: random histories keep the change-set invariants", async () => {
  const shared = setup();
  let landed = 0;
  let reverts = 0;
  const reached: Record<string, number> = {};
  for (let sequence = 0; sequence < sequences; sequence++) {
    const outcome = await run(sequence, shared);
    landed += outcome.landed;
    reverts += outcome.reverts;
    for (const [state, n] of Object.entries(outcome.reached))
      reached[state] = (reached[state] ?? 0) + n;
  }
  if (sequences < histories) return;
  // And the states the offered-step invariants are about: a dismissed set
  // with applied rows and one sent unanswered, a gone item, stale arguments,
  // an apply in flight, and a revert dismissed partway.
  for (const [state, n] of Object.entries(reached)) assert.ok(n > 0, `never reached: ${state}`);
  // The histories must reach the states the invariants are about.
  assert.ok(landed > 450, `only ${landed} writes landed`);
  assert.ok(reverts > 40, `only ${reverts} reverted fields were checked`);
});
