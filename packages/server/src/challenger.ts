// A second look at a change set (the challenger spike). When a thread's turn
// captures a change set, Oriel starts a run of its own, once for that diff:
// the agent, with no history, reads the diff Oriel computed and whatever
// items it chooses, and hands Oriel findings. Its module holds the region's
// reads and writes, `challenge` and search(), and nothing of Oriel's own; its
// turn captures no change set, applies no action and holds no draft, and its
// reply is never shown. Nothing here runs on a page view.
//
// Oriel keeps a finding only when every line it names is in the diff, every
// quote is in its item word for word, and it doesn't grade the change; and
// it says what the look read, from the runs' own records. A companion's
// changes are what the same run wrote, kept as suggestions; only the person
// adds one to the change set, which they then review again.
import type { ChallengeStore, ThreadStore, WorkstreamStore } from "@oriel/db";
import {
  type Basis,
  type CapturedMutation,
  type Challenge,
  type ChangeSet,
  type ChangeSets,
  challengeAsk,
  challengeAskText,
  type Coverage,
  type Diff,
  type Finding,
  type FindingAsk,
  type Instant,
  isItemId,
  type ItemId,
  type Known,
  type Log,
  type Reader,
  type RunResult,
  type Staleness,
  staleness,
  type TelemetryEvent,
  type Ulid,
  verdictIn,
} from "@oriel/core";
import type { Agent } from "./agent.ts";
import { wordForWord } from "./quotes.ts";

export type ChallengerDeps = {
  challenges: ChallengeStore;
  changeSets: Pick<ChangeSets, "get" | "look" | "extend" | "changes">;
  threads: Pick<ThreadStore, "get">;
  workstreams: Pick<WorkstreamStore, "region">;
  agent: Agent;
  // Items as `items.read()` reads them, for the quotes.
  read: Reader["read"];
  // An item's update time as the index has it now; null for one it hasn't.
  updatedAt: (id: ItemId) => Instant | null;
  known: () => Known;
  snapshot: () => number;
  // The thread's pages hear that its change set's second look changed.
  changed: (threadId: Ulid, changeSetId: Ulid) => void;
  emit: (event: TelemetryEvent) => void;
  now: () => Instant;
  newId: () => Ulid;
  log: Log;
};

// A diff line as the agent's module gives it: Oriel's sentence, its item and
// each field before and after.
type ChangeLine = {
  n: number;
  change: string;
  item: string | null;
  fields: { name: string; before: unknown; after: unknown }[];
};

const linesOf = (diff: Diff): ChangeLine[] =>
  diff.lines.map((line, i) => ({
    n: i + 1,
    change: line.sentence,
    item: line.target,
    fields: line.fields.map(({ name, before, after }) => ({ name, before, after })),
  }));

// Every string in a read's arguments that names an item, nested or not.
const idsIn = (value: unknown): string[] =>
  typeof value === "string"
    ? isItemId(value)
      ? [value]
      : []
    : Array.isArray(value)
      ? value.flatMap(idsIn)
      : typeof value === "object" && value !== null
        ? Object.values(value).flatMap(idsIn)
        : [];

// What the look's runs read, from their own records: the workstream's items
// any read named, and how many times it searched.
export function coverageOf(results: readonly RunResult[], region: readonly ItemId[]): Coverage {
  const members = new Set<string>(region);
  const read = new Set<ItemId>();
  let searches = 0;
  for (const result of results)
    for (const each of result.reads) {
      // What it hands Oriel names items too; only what it read counts.
      if (each.status !== "answered" || each.fn.startsWith("challenge.")) continue;
      if (each.fn === "search") searches += 1;
      for (const id of idsIn(each.args)) if (members.has(id)) read.add(id as ItemId);
    }
  return { read: [...read].sort(), of: region.length, searches };
}

// Why a recorded finding can't be kept, or null: its lines, its words, its
// companion's changes. Quotes are checked apart, since they read items.
function shapeProblem(finding: FindingAsk, i: number, lines: number): string | null {
  const where = `finding ${i + 1}`;
  const outside = finding.lines.find((n) => n > lines);
  if (outside !== undefined) return `${where}: the diff has no line ${outside}`;
  const graded = verdictIn(finding.says);
  if (graded)
    return `${where}: "${graded}" grades the change; say what the quotes show, and leave whether to approve to the person`;
  if (finding.kind === "companion" && !finding.changes?.length)
    return `${where}: a companion names the changes this run wrote for it, in \`changes\``;
  if (finding.kind !== "companion" && finding.changes?.length)
    return `${where}: only a companion has changes`;
  return null;
}

// What a second look's `record()` gets back, and the findings Oriel keeps
// from it, if any: kept only when every finding's lines are in the diff, it
// grades nothing, a companion names its changes, and every quote is in its
// item word for word. `members`: the region's items; any other is outside.
export async function checkRecord(
  input: unknown,
  context: { lines: number; members: ReadonlySet<string>; read: Reader["read"] },
): Promise<{ answer: string; findings?: Finding[] }> {
  const shaped = challengeAsk(input);
  if (!shaped.ok)
    return {
      answer: `Oriel kept nothing: ${shaped.issues
        .slice(0, 5)
        .map((issue) => `${issue.path}: ${issue.message}`)
        .join("; ")}`,
    };
  const problems = shaped.value.flatMap((finding, i) => {
    const problem = shapeProblem(finding, i, context.lines);
    return problem ? [problem] : [];
  });
  const quoted = [...new Set(shaped.value.flatMap((f) => f.evidence.map((e) => e.id)))];
  const texts = new Map<string, string>();
  for (const result of quoted.length ? await context.read(quoted as ItemId[]) : [])
    if (result.status === "ok")
      texts.set(result.id, `${result.content.title}\n${result.content.text}`);
  shaped.value.forEach((finding, i) =>
    finding.evidence.forEach((evidence, j) => {
      const text = texts.get(evidence.id);
      if (text === undefined)
        problems.push(`finding ${i + 1}, quote ${j + 1}: Oriel can't read ${evidence.id}`);
      else if (!wordForWord(evidence.quote, text))
        problems.push(
          `finding ${i + 1}, quote ${j + 1}: not in ${evidence.id} word for word; copy its words exactly`,
        );
    }),
  );
  if (problems.length)
    return {
      answer: `Oriel kept nothing, and shows nothing yet: ${problems.slice(0, 8).join("; ")}. Fix these and record again.`,
    };
  const n = shaped.value.length;
  return {
    answer:
      n === 0
        ? "Oriel recorded that you raised nothing. The person still reviews the diff themselves."
        : `Oriel kept ${n} finding${n === 1 ? "" : "s"} and shows them beside the diff as your reading, each quote checked. You're done.`,
    findings: shaped.value.map((finding) => ({
      kind: finding.kind,
      lines: [...new Set(finding.lines)].sort((a, b) => a - b),
      says: finding.says.trim(),
      evidence: finding.evidence.map((evidence) => ({
        id: evidence.id as ItemId,
        quote: evidence.quote,
        outside: !context.members.has(evidence.id),
      })),
      changes: finding.changes ?? [],
    })),
  };
}

// What a second look's turn keeps: the findings of the last run that
// finished well and recorded any, or null. That run's writes are its
// companions' changes; any a kept finding doesn't name are dropped, and so
// is a companion whose changes the run didn't write.
export function keep(
  results: ReadonlyMap<Ulid, RunResult>,
  recorded: ReadonlyMap<Ulid, Finding[]>,
): { findings: Finding[]; companions: CapturedMutation[] } | null {
  const kept = [...results.entries()]
    .filter(([runId, result]) => result.outcome === "ok" && recorded.has(runId))
    .at(-1);
  if (!kept) return null;
  const [runId, result] = kept;
  const companions: CapturedMutation[] = [];
  const findings = (recorded.get(runId) ?? []).flatMap((finding): Finding[] => {
    if (finding.kind !== "companion") return [finding];
    const wrote = finding.changes.map((n) => result.mutations[n - 1]);
    if (wrote.some((m) => m === undefined)) return [];
    const places = (wrote as CapturedMutation[]).map((m) => companions.push(m) - 1);
    return [{ ...finding, changes: places }];
  });
  return { findings, companions };
}

export type ChallengeView = {
  id: Ulid;
  state: Challenge["state"];
  findings: Finding[];
  // Each suggested change, in Oriel's words, and whether the person added it.
  companions: { place: number; sentence: string; added: boolean }[];
  coverage: Challenge["coverage"];
  stale: Staleness;
  error: string | null;
  startedAt: Instant;
  finishedAt: Instant | null;
};

export type Challenger = ReturnType<typeof challenger>;

export function challenger(deps: ChallengerDeps) {
  const { challenges } = deps;
  const running = new Set<Promise<void>>();
  const closing = new AbortController();

  // One look, start to end. Whatever happens, its row ends ready or failed.
  const look = async (set: ChangeSet, id: Ulid): Promise<void> => {
    const log: Log = (message, fields) =>
      deps.log(message, { ...fields, thread_id: set.threadId, change_set_id: set.id });
    const started = Date.parse(deps.now());
    const usage = { inputTokens: 0, outputTokens: 0 };
    // The model is on each run's record (SPEC §7), not on the turn's events.
    const model: string | null = null;
    const failed = (why: string, kind: "no-record" | "error") => {
      challenges.failed(id, why, model, usage, deps.now());
      deps.emit({
        name: "challenge.failed",
        at: deps.now(),
        workspaceId: set.workspaceId,
        changeSetId: set.id,
        why: kind,
      });
    };
    try {
      const thread = deps.threads.get(set.threadId, deps.now());
      if (!thread) return failed("Its thread is gone.", "error");
      const region = deps.workstreams.region(thread.workstreamId, thread.regionVersion);
      if (!region) return failed("Its workstream's version is gone.", "error");
      const regionIds = region.items.map((item) => item.id);
      const members = new Set<string>(regionIds);
      const lines = linesOf(await deps.changeSets.look(set.id));
      // What each run recorded, kept or not, by run: the last kept wins.
      const recorded = new Map<Ulid, Finding[]>();
      const results = new Map<Ulid, RunResult>();

      const record = async (runId: Ulid, input: unknown): Promise<string> => {
        const checked = await checkRecord(input, { lines: lines.length, members, read: deps.read });
        if (checked.findings) recorded.set(runId, checked.findings);
        return checked.answer;
      };

      const turn = deps.agent.turn(
        {
          thread,
          region,
          history: [],
          text: challengeAskText,
          snapshot: deps.snapshot(),
          spent: { inputTokens: 0, outputTokens: 0 },
          challenge: { diff: async () => lines, record },
        },
        { signal: closing.signal, log },
      );
      for await (const event of turn) {
        if (event.kind === "run.finished") results.set(event.runId, event.result);
        if (event.kind === "done") {
          usage.inputTokens = event.usage.inputTokens;
          usage.outputTokens = event.usage.outputTokens;
        }
      }
      const kept = keep(results, recorded);
      if (!kept)
        return failed("The second look ended without findings Oriel could keep.", "no-record");
      const { findings, companions } = kept;
      const targets = lines.flatMap((line) =>
        line.item !== null && isItemId(line.item) ? [line.item] : [],
      );
      const rested = [
        ...new Set([...targets, ...findings.flatMap((f) => f.evidence.map((e) => e.id))]),
      ];
      const basis: Basis[] = rested.map((item) => ({ id: item, updatedAt: deps.updatedAt(item) }));
      challenges.ready(id, {
        findings,
        companions,
        coverage: coverageOf([...results.values()], regionIds),
        basis,
        model,
        usage,
        at: deps.now(),
      });
      const kinds: Partial<Record<Finding["kind"], number>> = {};
      for (const finding of findings) kinds[finding.kind] = (kinds[finding.kind] ?? 0) + 1;
      deps.emit({
        name: "challenge.made",
        at: deps.now(),
        workspaceId: set.workspaceId,
        changeSetId: set.id,
        kinds,
        ms: Date.parse(deps.now()) - started,
        tokens: usage.inputTokens + usage.outputTokens,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log("challenge: failed", { error: message });
      failed(closing.signal.aborted ? "Oriel stopped before it finished." : message, "error");
    } finally {
      deps.changed(set.threadId, set.id);
    }
  };

  // Every look and every start, so `settled` waits for a look a start is
  // about to begin.
  const track = <T>(work: Promise<T>): Promise<T> => {
    const quiet = work.then(
      () => {},
      () => {},
    );
    running.add(quiet);
    void quiet.finally(() => running.delete(quiet));
    return work;
  };

  const stale = (challenge: Challenge, set: ChangeSet): boolean => {
    const now = staleness(challenge, { hash: set.hash, updatedAt: deps.updatedAt });
    return now.diff || now.items.length > 0;
  };

  const begin = async (changeSetId: Ulid, again: boolean): Promise<Ulid | null> => {
    const set = await deps.changeSets.get(changeSetId);
    if (!set || set.revertOf !== null || set.decision !== null) return null;
    const latest = challenges.latest(changeSetId);
    if (latest?.state === "running") return latest.id;
    if (!again && latest !== null) return latest.id;
    if (again && latest?.state === "ready" && !stale(latest, set)) return latest.id;
    const id = deps.newId();
    challenges.start({
      id,
      workspaceId: set.workspaceId,
      changeSetId: set.id,
      threadId: set.threadId,
      hash: set.hash,
      at: deps.now(),
    });
    deps.changed(set.threadId, set.id);
    void track(look(set, id));
    return id;
  };

  return {
    // Takes a second look at the change set, unless one of this same diff is
    // running or ready: once per diff. `again`: the person asked, as for a
    // look that went stale or failed.
    start(changeSetId: Ulid, again = false): Promise<Ulid | null> {
      return track(begin(changeSetId, again));
    },

    stale,

    // The change set's latest second look as the window shows it, or null:
    // computed from what was stored and the index now, with no model call.
    async view(set: ChangeSet): Promise<ChallengeView | null> {
      const latest = challenges.latest(set.id);
      if (!latest) return null;
      const said = latest.companions.length
        ? await deps.changeSets.changes(
            {
              ...set,
              mutations: latest.companions.map((m, i) => ({
                id: `${set.id}${i}` as Ulid,
                changeSetId: set.id,
                seq: i + 1,
                op: m.op,
                target: m.target,
                ref: m.ref,
                args: m.args,
                preview: null,
                status: "pending",
                applied: null,
                error: null,
                reverts: null,
                version: 0,
              })),
            },
            deps.known(),
          )
        : [];
      return {
        id: latest.id,
        state: latest.state,
        findings: latest.findings,
        companions: latest.companions.map((_, place) => ({
          place,
          sentence: said[place]?.sentence ?? "A change Oriel can't describe.",
          added: latest.added.includes(place),
        })),
        coverage: latest.coverage,
        stale: staleness(latest, { hash: set.hash, updatedAt: deps.updatedAt }),
        error: latest.error,
        startedAt: latest.startedAt,
        finishedAt: latest.finishedAt,
      };
    },

    // The person adds the second look's suggested changes at `place` to the
    // change set: the engine checks them as it checks a capture.
    async add(changeSetId: Ulid, challengeId: Ulid, place: number): Promise<ChangeSet> {
      const look = challenges.get(challengeId);
      if (!look || look.changeSetId !== changeSetId || look.state !== "ready")
        throw new RangeError("no such second look on this change set");
      const change = look.companions[place];
      if (!change) throw new RangeError("no such suggested change");
      if (look.added.includes(place)) throw new RangeError("that change was already added");
      const set = await deps.changeSets.extend(changeSetId, [change]);
      challenges.added(challengeId, place);
      deps.emit({
        name: "challenge.companion-added",
        at: deps.now(),
        workspaceId: set.workspaceId,
        changeSetId,
      });
      deps.changed(set.threadId, set.id);
      return set;
    },

    // Stops every look, for shutdown; each ends failed.
    stop(): void {
      closing.abort(new Error("Closing."));
    },

    // Resolves once no look is running: for shutdown, and for tests.
    async settled(): Promise<void> {
      while (running.size) await Promise.all(running);
    },
  };
}
