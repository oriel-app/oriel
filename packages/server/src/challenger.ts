// Only when the person asks; nothing here runs by itself. Its turn captures no change set, applies no action, holds no draft,
// and its reply is never shown. A finding is kept only when its lines are in the diff and its quotes in their items word for word.
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
  evidenceItems,
  type Finding,
  type FindingAsk,
  type Instant,
  isItemId,
  type ItemId,
  type Known,
  type Log,
  parseItemId,
  type Reader,
  type RunResult,
  type Staleness,
  staleness,
  type TelemetryEvent,
  type Ulid,
  verdictIn,
  wordForWord,
} from "@oriel/core";
import type { Agent } from "./agent.ts";

export type ChallengerDeps = {
  challenges: ChallengeStore;
  changeSets: Pick<ChangeSets, "get" | "look" | "extend" | "changes">;
  threads: Pick<ThreadStore, "get">;
  workstreams: Pick<WorkstreamStore, "region">;
  agent: Agent;
  read: Reader["read"];
  asOf: () => (id: ItemId) => Instant | null;
  modelOf: (runId: Ulid) => string | null;
  known: () => Known;
  snapshot: () => number;
  spent: (threadId: Ulid) => { inputTokens: number; outputTokens: number };
  maxMutations: number;
  changed: (threadId: Ulid, changeSetId: Ulid) => void;
  emit: (event: TelemetryEvent) => void;
  now: () => Instant;
  newId: () => Ulid;
  log: Log;
};

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

export const written = (line: { fields: readonly { after: unknown }[] }): string =>
  line.fields
    .map(({ after }) => (typeof after === "string" ? after : (JSON.stringify(after) ?? "")))
    .join("\n");

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

const listed = (fn: string, region: readonly ItemId[]): readonly ItemId[] => {
  if (fn === "items.list") return region;
  const [space, name] = fn.split(".");
  return name === "listItems" ? region.filter((id) => parseItemId(id)?.kind === space) : [];
};

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
      for (const id of listed(each.fn, region)) read.add(id);
    }
  return { read: [...read].sort(), of: region.length, searches };
}

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

export async function checkRecord(
  input: unknown,
  context: {
    lines: readonly string[];
    members: ReadonlySet<string>;
    read: Reader["read"];
  },
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
    const problem = shapeProblem(finding, i, context.lines.length);
    return problem ? [problem] : [];
  });
  const quoted = [
    ...new Set(shaped.value.flatMap((f) => f.evidence.flatMap((e) => ("id" in e ? [e.id] : [])))),
  ];
  const texts = new Map<string, string>();
  for (const result of quoted.length ? await context.read(quoted as ItemId[]) : [])
    if (result.status === "ok")
      texts.set(result.id, `${result.content.title}\n${result.content.text}`);
  shaped.value.forEach((finding, i) =>
    finding.evidence.forEach((evidence, j) => {
      const where = `finding ${i + 1}, quote ${j + 1}`;
      const from = "id" in evidence ? evidence.id : `what line ${evidence.line} would write`;
      const text = "id" in evidence ? texts.get(evidence.id) : context.lines[evidence.line - 1];
      if (text === undefined) problems.push(`${where}: Oriel can't read ${from}`);
      else if (!wordForWord(evidence.quote, text))
        problems.push(`${where}: not in ${from} word for word; copy its words exactly`);
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
      evidence: finding.evidence.map((evidence) =>
        "id" in evidence
          ? {
              id: evidence.id as ItemId,
              line: null,
              quote: evidence.quote,
              outside: !context.members.has(evidence.id),
            }
          : { id: null, line: evidence.line, quote: evidence.quote, outside: false as const },
      ),
      changes: finding.changes ?? [],
    })),
  };
}

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
  companions: { place: number; sentence: string; added: boolean }[];
  coverage: Challenge["coverage"];
  stale: Staleness;
  error: string | null;
  startedAt: Instant;
  finishedAt: Instant | null;
  dismissed: boolean;
};

export type Challenger = ReturnType<typeof challenger>;

export function challenger(deps: ChallengerDeps) {
  const { challenges } = deps;
  const running = new Set<Promise<void>>();
  const closing = new AbortController();
  const stops = new Map<Ulid, AbortController>();
  // Suggestions being added, by look and place, so two clicks add one.
  const adding = new Set<string>();

  // One look, start to end. Whatever happens, its row ends ready or failed.
  const look = async (set: ChangeSet, id: Ulid): Promise<void> => {
    const log: Log = (message, fields) =>
      deps.log(message, { ...fields, thread_id: set.threadId, change_set_id: set.id });
    const started = Date.parse(deps.now());
    // Update times as the look starts, before it reads any: an item that changes while it runs may not have been read as it is.
    const before = deps.asOf();
    const usage = { inputTokens: 0, outputTokens: 0 };
    const recorded = new Map<Ulid, Finding[]>();
    const results = new Map<Ulid, RunResult>();
    // The model is on each run's record, not on the turn's events: the last run's is the look's.
    const model = (): string | null => {
      const last = [...results.keys()].at(-1);
      return last === undefined ? null : deps.modelOf(last);
    };
    const stop = new AbortController();
    stops.set(id, stop);
    const signal = AbortSignal.any([closing.signal, stop.signal]);
    const failed = (why: string, kind: "no-record" | "error") => {
      challenges.failed(id, why, model(), usage, deps.now());
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

      const record = async (runId: Ulid, input: unknown): Promise<string> => {
        const checked = await checkRecord(input, {
          lines: lines.map(written),
          members,
          read: deps.read,
        });
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
          spent: deps.spent(thread.id),
          challenge: { diff: async () => lines, record },
        },
        { signal, log },
      );
      for await (const event of turn) {
        if (event.kind === "run.finished") results.set(event.runId, event.result);
        if (event.kind === "done") {
          usage.inputTokens = event.usage.inputTokens;
          usage.outputTokens = event.usage.outputTokens;
        }
      }
      // The agent's loop may end a stopped turn as done: a look stopped
      // partway keeps nothing.
      signal.throwIfAborted();
      const kept = keep(results, recorded);
      if (!kept)
        return failed("The second look ended without findings Oriel could keep.", "no-record");
      const { findings, companions } = kept;
      const targets = lines.flatMap((line) =>
        line.item !== null && isItemId(line.item) ? [line.item] : [],
      );
      const rested = [...new Set([...targets, ...findings.flatMap(evidenceItems)])];
      const basis: Basis[] = rested.map((item) => ({ id: item, updatedAt: before(item) }));
      challenges.ready(id, {
        findings,
        companions,
        coverage: coverageOf([...results.values()], regionIds),
        basis,
        model: model(),
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
      failed(
        closing.signal.aborted
          ? "Oriel stopped before it finished."
          : stop.signal.aborted
            ? "You dismissed it before it finished."
            : message,
        "error",
      );
    } finally {
      stops.delete(id);
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

  // An edit, or the agent's revision, may have taken out a suggestion the person added since.
  const holds = (set: ChangeSet, m: CapturedMutation): boolean =>
    set.mutations.some(
      (row) =>
        row.op === m.op &&
        row.target === m.target &&
        JSON.stringify(row.args) === JSON.stringify(m.args),
    );

  const stale = (challenge: Challenge, set: ChangeSet): boolean => {
    const now = staleness(challenge, { hash: set.hash, updatedAt: deps.asOf() });
    return now.diff || now.items.length > 0;
  };

  const begin = async (changeSetId: Ulid): Promise<Ulid | null> => {
    const set = await deps.changeSets.get(changeSetId);
    if (!set || set.revertOf !== null || set.decision !== null) return null;
    const latest = challenges.latest(changeSetId);
    const shown = latest?.dismissedAt === null;
    if (latest?.state === "running" && shown) return latest.id;
    if (latest?.state === "ready" && !stale(latest, set)) {
      if (!shown) {
        challenges.dismissed(latest.id, null);
        deps.changed(set.threadId, set.id);
      }
      return latest.id;
    }
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
    take(changeSetId: Ulid): Promise<Ulid | null> {
      return track(begin(changeSetId));
    },

    stale,

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
                ...(m.into === undefined ? {} : { into: m.into }),
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
        companions: latest.companions.map((companion, place) => ({
          place,
          sentence: said[place]?.sentence ?? "A change Oriel can't describe.",
          added: latest.added.includes(place) && holds(set, companion),
        })),
        coverage: latest.coverage,
        stale: staleness(latest, { hash: set.hash, updatedAt: deps.asOf() }),
        error: latest.error,
        startedAt: latest.startedAt,
        finishedAt: latest.finishedAt,
        dismissed: latest.dismissedAt !== null,
      };
    },

    dismiss(changeSetId: Ulid, challengeId: Ulid): void {
      const look = challenges.get(challengeId);
      if (!look || look.changeSetId !== changeSetId)
        throw new RangeError("no such second look on this change set");
      if (look.dismissedAt !== null) return;
      challenges.dismissed(challengeId, deps.now());
      stops.get(challengeId)?.abort(new Error("Dismissed."));
      deps.changed(look.threadId, changeSetId);
    },

    async add(changeSetId: Ulid, challengeId: Ulid, places: readonly number[]): Promise<ChangeSet> {
      const look = challenges.get(challengeId);
      if (!look || look.changeSetId !== changeSetId || look.state !== "ready")
        throw new RangeError("no such second look on this change set");
      const changes = places.map((place) => look.companions[place]);
      if (changes.some((change) => change === undefined))
        throw new RangeError("no such suggested change");
      const keys = places.map((place) => `${challengeId}:${place}`);
      const current = await deps.changeSets.get(changeSetId);
      const already = (place: number) => {
        const companion = look.companions[place];
        return look.added.includes(place) && !!current && !!companion && holds(current, companion);
      };
      if (places.some(already) || keys.some((key) => adding.has(key)))
        throw new RangeError("that change was already added");
      for (const key of keys) adding.add(key);
      let set: ChangeSet;
      try {
        set = await deps.changeSets.extend(
          changeSetId,
          changes as CapturedMutation[],
          deps.maxMutations,
        );
        for (const place of places) challenges.added(challengeId, place);
      } finally {
        for (const key of keys) adding.delete(key);
      }
      places.forEach(() =>
        deps.emit({
          name: "challenge.companion-added",
          at: deps.now(),
          workspaceId: set.workspaceId,
          changeSetId,
        }),
      );
      deps.changed(set.threadId, set.id);
      return set;
    },

    stop(): void {
      closing.abort(new Error("Closing."));
    },

    async settled(): Promise<void> {
      while (running.size) await Promise.all(running);
    },
  };
}
