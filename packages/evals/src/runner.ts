// A round: every case run through the system under test, once or `reps`
// times (trials), graded, and written to its own directory under the gitignored
// `.evals/`: one JSONL line per trial (`results.jsonl`), a full transcript per
// trial (`transcripts/`), and a summary per split with a confidence interval and
// what the round's model calls cost (`summary.json`).
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import {
  array,
  boolean,
  builtBlock,
  type Infer,
  type Instant,
  literal,
  nullable,
  number,
  object,
  optional,
  type ItemId,
  record,
  string,
  union,
  unknown,
} from "@oriel/core";
import type { AgentEvent } from "@oriel/agent";
import { checkQuotes } from "@oriel/server/quotes";
import { quotesFrom } from "@oriel/web/markdown";
import {
  cost,
  type Fetch,
  requestModel,
  responseModel,
  responseUsage,
  sameModel,
  type Usage,
} from "./anthropic.ts";
import { canonicalJson } from "./canonical.ts";
import {
  capturedMutation,
  type EvalCase,
  type GraderName,
  graderName,
  isJudged,
  type LoadedCase,
  type Split,
  split,
  splits,
} from "./case.ts";
import type { Cassettes } from "./cassette.ts";
import { fixtureOf, type Fixtures } from "./fixtures.ts";
import {
  type Grade,
  gradeBlocks,
  gradeExactDiff,
  gradeIntents,
  gradeJudge,
  gradeAvoids,
  gradeMentions,
  gradeQuotes,
  gradeSurfaced,
  gradeNoSketch,
  gradeZeroMutations,
  gradeDrafts,
} from "./graders.ts";
import { gradeRefs, resolver, shown } from "./shown.ts";
import { formatRate, type Rate, wilson } from "./stats.ts";
import { buildWorld, caseWorld, fixedId, waitingConnectionId } from "./world.ts";

// What the system under test gets for one case. Everything it sends to the
// model must follow from this and from earlier responses (no clock, no
// randomness), or its cassettes won't replay.
export type SystemInput = {
  case: EvalCase;
  // Every fixture the round loaded.
  fixtures: Fixtures;
  // The fixture region the case names, if any, and the items its region
  // holds beside it.
  region: LoadedCase["region"];
  items: readonly ItemId[];
  // The eval clock: fixed, so prompts that depend on time still replay.
  now: Instant;
  model: string;
  // Its only way to the model: cassettes, recording or replaying.
  fetch: Fetch;
};

// What it hands back: the mutations its change set captured, the calls its
// intents applied as (none, when it says nothing of them), the reply the user
// sees, and its transcript, kept verbatim for the case's transcript file.
export const systemOutput = object({
  mutations: array(capturedMutation),
  intents: optional(array(object({ action: string, input: record(unknown) }))),
  // The drafts the turn held for the user (decision 0051).
  drafts: optional(array(object({ action: string, input: record(unknown) }))),
  // Each block the turn showed, with what its read answered.
  blocks: optional(array(object({ block: builtBlock, answered: unknown }))),
  // How many times the turn called sketch(), shown or refused.
  sketches: optional(number),
  reply: string,
  transcript: array(unknown),
});
// A system may leave its intents, blocks and sketches out, as one that
// never asks for any.
export type SystemOutput = Omit<
  Infer<typeof systemOutput>,
  "intents" | "drafts" | "blocks" | "sketches"
> & {
  intents?: Infer<typeof systemOutput>["intents"];
  drafts?: Infer<typeof systemOutput>["drafts"];
  blocks?: Infer<typeof systemOutput>["blocks"];
  sketches?: number;
};

export type SystemUnderTest = (input: SystemInput) => Promise<SystemOutput>;

export const caseResult = object({
  id: string,
  // The case's content, its golden diff included, so a comparison can tell an
  // edited case from the one it replaced.
  hash: string,
  split,
  kind: number,
  // Which of the case's trials this is, from 0; absent for the first.
  rep: optional(number),
  // The case's group in a climb, which a comparison guards on its own;
  // absent outside one.
  group: optional(string),
  outcome: union(literal("pass"), literal("fail"), literal("error")),
  grades: array(
    object({
      // Noticed's rounds grade with their own three (src/noticed/).
      grader: union(
        graderName,
        literal("refs"),
        literal("quotes"),
        literal("recall"),
        literal("precision"),
        literal("grounding"),
      ),
      pass: boolean,
      detail: string,
    }),
  ),
  error: nullable(string),
  // Why a case that finished in a live round saved no cassettes, so it won't
  // replay; null otherwise.
  unrecorded: nullable(string),
  ms: number,
});
// `rep` and `group` are left out when absent, so a round of single trials
// outside a climb reads as rounds always have.
export type CaseResult = Omit<Infer<typeof caseResult>, "rep" | "group"> & {
  rep?: number;
  group?: string;
};

// A case's `waiting` and `failing` marks are notes about the agent, not the
// case, so marking or unmarking it still compares with the round before.
export function caseHash(loaded: LoadedCase): string {
  const { waiting: _waiting, failing: _failing, ...graded } = loaded.case;
  const content = canonicalJson({ case: graded, golden: loaded.golden });
  return createHash("sha256").update(content).digest("hex");
}

// What a round's model calls cost: the system under test's and the judge's.
export type Spend = { usd: number; tokens: Usage };

export type Summary = {
  model: string;
  judgeModel: string;
  // Trials a case; absent for one. Each split's rate counts trials.
  reps?: number;
  splits: Record<Split, Rate & { failed: number; errored: number }>;
  spend?: Spend;
};

export type Round = { results: CaseResult[]; summary: Summary };

export type RoundOptions = {
  cases: readonly LoadedCase[];
  // The fixtures the cases were loaded against.
  fixtures: Fixtures;
  system: SystemUnderTest;
  model: string;
  judgeModel: string;
  // The cassettes one trial's model calls go through, the judge's included.
  // They are committed only when the trial finishes without error.
  transport: (caseId: string, rep: number) => Cassettes;
  // Trials a case. Absent: one.
  reps?: number;
  // Each case's group, by ID, in a climb.
  groups?: ReadonlyMap<string, string>;
  // This round's directory.
  out: URL;
  // Milliseconds, read only to time each case.
  clock: () => number;
  now: Instant;
  concurrency?: number;
};

export async function runRound(options: RoundOptions): Promise<Round> {
  if (sameModel(options.judgeModel, options.model))
    throw new Error(`the judge model must differ from the model under test (${options.model})`);
  mkdirSync(new URL("transcripts/", options.out), { recursive: true });
  const reps = options.reps ?? 1;
  // Every case's first trial, then every case's second, and so on, so a
  // network outage costs many cases a trial each, not one case all of them.
  const trials = Array.from({ length: reps }, (_, rep) =>
    options.cases.map((loaded) => ({ loaded, rep })),
  ).flat();
  const done = await pool(trials, options.concurrency ?? 1, ({ loaded, rep }) =>
    runCase(loaded, rep, options),
  );
  const results = done.map((d) => d.result);
  const summary = { ...summarize(results, options), spend: total(done.map((d) => d.spend)) };
  writeFileSync(
    new URL("results.jsonl", options.out),
    results.map((r) => `${JSON.stringify(r)}\n`).join(""),
  );
  writeFileSync(new URL("summary.json", options.out), `${JSON.stringify(summary, null, 2)}\n`);
  return { results, summary };
}

async function runCase(
  loaded: LoadedCase,
  rep: number,
  options: RoundOptions,
): Promise<{ result: CaseResult; spend: Spend }> {
  const evalCase = loaded.case;
  const tape = options.transport(evalCase.id, rep);
  // Models as requested and as each response reports itself, so an alias
  // can't hide that the judge and the system under test are one model.
  const tested = watched(tape.fetch);
  const judged = watched(tape.fetch);
  const started = options.clock();
  let output: SystemOutput | null = null;
  let grades: Grade[] = [];
  let error: string | null = null;
  let unrecorded: string | null = null;
  try {
    const raw: unknown = await options.system({
      case: evalCase,
      fixtures: options.fixtures,
      region: loaded.region,
      items: loaded.items,
      now: options.now,
      model: options.model,
      fetch: tested.fetch,
    });
    const parsed = systemOutput(raw);
    if (!parsed.ok) {
      const issues = parsed.issues.map((i) => `${i.path}: ${i.message}`).join("; ");
      throw new Error(`the system under test returned a malformed output: ${issues}`);
    }
    output = parsed.value;
    const calledJudge = shared(await tested.models(), [options.judgeModel]);
    if (calledJudge)
      throw new Error(`the system under test called the judge model, ${calledJudge}`);
    grades = await grade(loaded, output, options, judged.fetch);
    const both = shared(await tested.models(), await judged.models());
    if (both) throw new Error(`the judge and the system under test both ran ${both}`);
    unrecorded = tape.commit();
  } catch (caught) {
    // Never empty: an error is an error even when it says nothing.
    const said = caught instanceof Error ? caught.message : String(caught);
    error = said || `${caught instanceof Error ? caught.name : "a throw"}, no message`;
  }
  const ms = options.clock() - started;
  const outcome = error !== null ? "error" : grades.every((g) => g.pass) ? "pass" : "fail";
  const group = options.groups?.get(evalCase.id);
  const result: CaseResult = {
    id: evalCase.id,
    hash: caseHash(loaded),
    split: evalCase.split,
    kind: evalCase.kind,
    ...(rep ? { rep } : {}),
    ...(group === undefined ? {} : { group }),
    outcome,
    grades,
    error,
    unrecorded,
    ms,
  };
  const spend = total([await tested.spend(), await judged.spend()]);
  const transcript = {
    ...result,
    case: evalCase,
    model: options.model,
    judgeModel: options.judgeModel,
    modelsCalled: await tested.models(),
    spend,
    output,
  };
  const name = rep ? `${evalCase.id}.rep${rep}` : evalCase.id;
  writeFileSync(
    new URL(`transcripts/${name}.json`, options.out),
    `${JSON.stringify(transcript, null, 2)}\n`,
  );
  return { result, spend };
}

const none: Spend = { usd: 0, tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };

function total(spends: readonly Spend[]): Spend {
  return spends.reduce(
    (sum, s) => ({
      usd: sum.usd + s.usd,
      tokens: {
        input: sum.tokens.input + s.tokens.input,
        output: sum.tokens.output + s.tokens.output,
        cacheRead: sum.tokens.cacheRead + s.tokens.cacheRead,
        cacheWrite: sum.tokens.cacheWrite + s.tokens.cacheWrite,
      },
    }),
    none,
  );
}

// Graders run in the case's order; a throw is the case's error.
async function grade(
  loaded: LoadedCase,
  output: SystemOutput,
  options: RoundOptions,
  transport: Fetch,
): Promise<Grade[]> {
  const grades: Grade[] = [];
  // Graders read the reply as the user reads it, its chips drawn (decision
  // 0032).
  const seen = shown(
    output.reply,
    resolver({
      fixtures: options.fixtures,
      edited: loaded.case.edited ?? {},
      oriel: loaded.case.oriel,
      held: [...(loaded.region?.items ?? []), ...loaded.items],
      window: loaded.case.window
        ? { workstreams: loaded.case.window.workstreams, now: loaded.case.window.at ?? options.now }
        : null,
    }),
  );
  // What the reply quotes from items, under their chips, as written.
  const quoted = quotesFrom(output.reply);
  const under = (id: string) => quoted.filter((quote) => quote.id === id).map((q) => q.text);
  const checked = quoted.length
    ? await inWorld(loaded, options, (world) => checkQuotes([output.reply], world.reader.read))
    : [];
  output = { ...output, reply: seen.text };
  const refs = gradeRefs(seen);
  if (refs) grades.push(refs);
  const quotes = gradeQuotes(checked);
  if (quotes) grades.push(quotes);
  for (const expectation of loaded.case.expect) {
    if (expectation.grader === "exact-diff") {
      if (!loaded.golden) throw new Error(`${expectation.golden} was not loaded`);
      grades.push(gradeExactDiff(loaded.golden, output.mutations));
    }
    if (expectation.grader === "zero-mutations")
      grades.push(gradeZeroMutations(output.mutations, output.intents ?? [], output.drafts ?? []));
    if (expectation.grader === "drafts")
      grades.push(
        gradeDrafts(
          expectation.calls.map(({ kind, options, ...call }) => ({
            ...call,
            options: options ?? {},
            connection: waitingConnectionId(kind),
          })),
          output.drafts ?? [],
        ),
      );
    if (expectation.grader === "intents") {
      const calls = expectation.calls.map(({ items, ...call }) =>
        items ? { ...call, items: items.map((item) => named(loaded, item)) } : call,
      );
      grades.push(gradeIntents(calls, output.intents ?? [], output.mutations, fixedId));
    }
    if (expectation.grader === "surfaced") {
      // Named as its fixture says a reply calls it, such as a file by its
      // title; otherwise by its key.
      const id = named(loaded, expectation.item);
      const called = fixtureOf(options.fixtures, id)?.called?.(id);
      const item = called ? { title: called } : id;
      grades.push(gradeSurfaced(item, expectation.text, output.reply, under(id)));
    }
    if (expectation.grader === "blocks") grades.push(gradeBlocks(expectation, output.blocks ?? []));
    if (expectation.grader === "no-sketch") grades.push(gradeNoSketch(output.sketches ?? 0));
    if (expectation.grader === "mentions")
      grades.push(gradeMentions(expectation.text, output.reply));
    if (expectation.grader === "avoids") grades.push(gradeAvoids(expectation.text, output.reply));
    if (expectation.grader === "judge") {
      grades.push(
        await gradeJudge({
          claims: expectation.claims,
          prompt: loaded.case.prompt,
          region: await evidence(loaded, options),
          searches: searchesOf(output.transcript),
          captions: (output.blocks ?? []).map(({ block }) => block.caption),
          reply: output.reply,
          model: options.judgeModel,
          fetch: transport,
        }),
      );
    }
  }
  return grades;
}

// Every run that searched: its queries and what they found, so the judge can
// tell reach that searched from reach that didn't, and a search that found
// nothing from none at all.
function searchesOf(transcript: readonly unknown[]): unknown[] {
  const events = transcript as readonly AgentEvent[];
  return events.flatMap((event) => {
    if (event.kind !== "run.finished") return [];
    const queries = event.result.reads.filter((r) => r.fn === "search").map((r) => r.args);
    if (!queries.length) return [];
    const hits = events.flatMap((e) =>
      e.kind === "search" && e.runId === event.runId ? e.hits : [],
    );
    return [{ queries, hits }];
  });
}

// An item the case names, by ID; loading the case resolved it.
function named(loaded: LoadedCase, item: string): ItemId {
  const id = loaded.named.get(item);
  if (id === undefined) throw new Error(`${item} was not loaded`);
  return id;
}

// The case's world, built for one look and closed after it.
async function inWorld<T>(
  loaded: LoadedCase,
  options: RoundOptions,
  look: (world: Awaited<ReturnType<typeof buildWorld>>) => Promise<T>,
): Promise<T> {
  const world = await buildWorld(caseWorld(loaded, options.fixtures, options.now));
  try {
    return await look(world);
  } finally {
    world.close();
  }
}

// The region's items as their sources hold them once the case's edits are
// applied; an item that is gone says so.
const evidence = (loaded: LoadedCase, options: RoundOptions): Promise<unknown[]> =>
  inWorld(loaded, options, (world) => world.evidence());

// Notes each model a caller asks for and each model a response reports, and
// what each response's tokens cost. A response is read from a copy, so a
// streamed body still streams to the caller.
function watched(inner: Fetch): {
  fetch: Fetch;
  models: () => Promise<string[]>;
  spend: () => Promise<Spend>;
} {
  const seen = new Set<string>();
  const spent: Spend[] = [];
  const reading: Promise<void>[] = [];
  const note = (model: string | null) => {
    if (model) seen.add(model);
  };
  const fetch: Fetch = async (input, init) => {
    const request = new Request(input, init);
    const asked = requestModel(await request.clone().text());
    note(asked);
    const response = await inner(request);
    reading.push(
      response
        .clone()
        .text()
        .then((body) => {
          const model = responseModel(body);
          note(model);
          const tokens = responseUsage(body);
          spent.push({ usd: cost(model ?? asked ?? "", tokens) ?? 0, tokens });
        })
        .catch(() => {}),
    );
    return response;
  };
  const models = async () => {
    await Promise.all(reading);
    return [...seen].sort();
  };
  const spend = async () => {
    await Promise.all(reading);
    return total(spent);
  };
  return { fetch, models, spend };
}

// A model in both lists, counting an alias and its snapshots as one.
function shared(a: readonly string[], b: readonly string[]): string | null {
  return a.find((x) => b.some((y) => sameModel(x, y))) ?? null;
}

// Runs `work` over `items`, at most `limit` at a time, keeping input order.
async function pool<T, R>(
  items: readonly T[],
  limit: number,
  work: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  let next = 0;
  const lane = async () => {
    for (let i = next++; i < items.length; i = next++) {
      const item = items[i];
      if (item !== undefined) results[i] = await work(item);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, lane));
  return results;
}

function summarize(results: readonly CaseResult[], options: RoundOptions): Summary {
  const forSplit = (s: Split) => {
    const own = results.filter((r) => r.split === s);
    const count = (outcome: CaseResult["outcome"]) =>
      own.filter((r) => r.outcome === outcome).length;
    return { ...wilson(count("pass"), own.length), failed: count("fail"), errored: count("error") };
  };
  return {
    model: options.model,
    judgeModel: options.judgeModel,
    ...(options.reps && options.reps > 1 ? { reps: options.reps } : {}),
    splits: { train: forSplit("train"), test: forSplit("test") },
  };
}

// Cases marked `failing`, by ID: the grader each is known to fail.
export type Failing = ReadonlyMap<string, GraderName>;

// A known failure fails the marked grader and no other.
function knownFailure(r: CaseResult, failing: Failing): boolean {
  const marked = failing.get(r.id);
  return (
    marked !== undefined &&
    r.outcome === "fail" &&
    r.grades.every((g) => g.pass || g.grader === marked)
  );
}

export function formatRound(round: Round, failing: Failing = new Map()): string {
  const lines = splits.map((s) => {
    const r = round.summary.splits[s];
    const extra = r.errored ? `, ${r.errored} errored` : "";
    return `${s.padEnd(5)}  ${formatRate(r)}${extra}`;
  });
  for (const r of round.results) {
    if (r.unrecorded) lines.push(`unrecorded  ${r.id}: ${r.unrecorded}`);
    if (r.outcome === "pass") {
      if (failing.has(r.id)) lines.push(`pass  ${r.id}: it's marked failing; remove the mark`);
      continue;
    }
    const known = knownFailure(r, failing);
    // Past a known failure, name what else broke.
    const marked = known ? undefined : failing.get(r.id);
    const why = r.error ?? r.grades.find((g) => !g.pass && g.grader !== marked)?.detail ?? "";
    const which = r.rep ? `, trial ${r.rep + 1}` : "";
    lines.push(
      `${known ? "fail (known)" : r.outcome}  ${r.id} (${r.split}, kind ${r.kind}${which}): ${why}`,
    );
  }
  return lines.join("\n");
}

// CI replays to guard the pipeline, not the model's judgement (SPEC §8): any
// error fails, and so does a failed deterministic case; a failed judged case
// does not. A case in `failing` is a known failure of one grader: failing
// that grader alone doesn't fail a replay, but failing another or passing
// does, so the mark goes once the agent does better and can't hide a
// different regression. A live round fails only on errors.
export function exitCode(
  results: readonly CaseResult[],
  mode: "live" | "replay",
  failing: Failing = new Map(),
): number {
  const broken = results.some((r) => {
    if (r.outcome === "error") return true;
    if (mode === "live") return false;
    // A judged case's verdict never fails CI, marked or not.
    if (failing.has(r.id))
      return r.outcome === "pass" || (!isJudged(r.kind) && !knownFailure(r, failing));
    return r.outcome === "fail" && !isJudged(r.kind);
  });
  return broken ? 1 : 0;
}
