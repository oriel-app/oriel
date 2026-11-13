import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import {
  array,
  boolean,
  builtBlock,
  type Finding,
  storedFinding,
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
  gradeWrites,
  gradeCreates,
  gradeJudge,
  gradeAvoids,
  gradeMentions,
  gradeQuotes,
  gradeSurfaced,
  gradeNoRefusedBlock,
  gradeNoSketch,
  gradeZeroMutations,
  gradeDrafts,
  gradeFindings,
} from "./graders.ts";
import { gradeRefs, resolver, shown } from "./shown.ts";
import { formatRate, type Rate, wilson } from "./stats.ts";
import { buildWorld, caseWorld, fixedId, waitingConnectionId } from "./world.ts";

// Everything it sends to the model must follow from this and from earlier responses
// (no clock, no randomness), or its cassettes won't replay.
export type SystemInput = {
  case: EvalCase;
  fixtures: Fixtures;
  region: LoadedCase["region"];
  items: readonly ItemId[];
  now: Instant;
  model: string;
  fetch: Fetch;
};

export const systemOutput = object({
  mutations: array(capturedMutation),
  intents: optional(array(object({ action: string, input: record(unknown) }))),
  drafts: optional(array(object({ action: string, input: record(unknown) }))),
  blocks: optional(array(object({ block: builtBlock, answered: unknown }))),
  sketches: optional(number),
  refusedBlocks: optional(number),
  look: optional(object({ kept: boolean, findings: array(storedFinding) })),
  reply: string,
  transcript: array(unknown),
});
export type SystemOutput = Omit<
  Infer<typeof systemOutput>,
  "intents" | "drafts" | "blocks" | "sketches" | "refusedBlocks" | "look"
> & {
  look?: { kept: boolean; findings: Finding[] };
  intents?: Infer<typeof systemOutput>["intents"];
  drafts?: Infer<typeof systemOutput>["drafts"];
  blocks?: Infer<typeof systemOutput>["blocks"];
  sketches?: number;
  refusedBlocks?: number;
};

export type SystemUnderTest = (input: SystemInput) => Promise<SystemOutput>;

export const caseResult = object({
  id: string,
  hash: string,
  split,
  kind: number,
  rep: optional(number),
  group: optional(string),
  outcome: union(literal("pass"), literal("fail"), literal("error")),
  grades: array(
    object({
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
  unrecorded: nullable(string),
  ms: number,
});
export type CaseResult = Omit<Infer<typeof caseResult>, "rep" | "group"> & {
  rep?: number;
  group?: string;
};

// `waiting` and `failing` are notes about the agent, not the case, so marking or unmarking
// a case still compares with the round before.
export function caseHash(loaded: LoadedCase): string {
  const { waiting: _waiting, failing: _failing, ...graded } = loaded.case;
  const content = canonicalJson({ case: graded, golden: loaded.golden });
  return createHash("sha256").update(content).digest("hex");
}

export type Spend = { usd: number; tokens: Usage };

export type Summary = {
  model: string;
  judgeModel: string;
  reps?: number;
  splits: Record<Split, Rate & { failed: number; errored: number }>;
  spend?: Spend;
};

export type Round = { results: CaseResult[]; summary: Summary };

export type RoundOptions = {
  cases: readonly LoadedCase[];
  fixtures: Fixtures;
  system: SystemUnderTest;
  model: string;
  judgeModel: string;
  transport: (caseId: string, rep: number) => Cassettes;
  reps?: number;
  groups?: ReadonlyMap<string, string>;
  out: URL;
  clock: () => number;
  now: Instant;
  concurrency?: number;
};

export async function runRound(options: RoundOptions): Promise<Round> {
  if (sameModel(options.judgeModel, options.model))
    throw new Error(`the judge model must differ from the model under test (${options.model})`);
  mkdirSync(new URL("transcripts/", options.out), { recursive: true });
  const reps = options.reps ?? 1;
  // Every case's first trial, then every case's second, so a network outage costs many
  // cases a trial each, not one case all of them.
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
  // As requested and as each response reports itself, so an alias can't hide that the
  // judge and the system under test are one model.
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

async function grade(
  loaded: LoadedCase,
  output: SystemOutput,
  options: RoundOptions,
  transport: Fetch,
): Promise<Grade[]> {
  const grades: Grade[] = [];
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
  const quoted = quotesFrom(output.reply);
  const under = (id: string) => quoted.filter((quote) => quote.id === id).map((q) => q.text);
  const checked = quoted.length
    ? await inWorld(loaded, options, (world) => checkQuotes([output.reply], world.reader.read))
    : [];
  output = { ...output, reply: seen.text };
  const shownReply = loaded.case.kind !== 9;
  const refs = shownReply ? gradeRefs(seen) : null;
  if (refs) grades.push(refs);
  const quotes = shownReply ? gradeQuotes(checked) : null;
  if (quotes) grades.push(quotes);
  for (const expectation of loaded.case.expect) {
    if (expectation.grader === "exact-diff") {
      if (!loaded.golden) throw new Error(`${expectation.golden} was not loaded`);
      grades.push(gradeExactDiff(loaded.golden, output.mutations));
    }
    if (expectation.grader === "writes")
      grades.push(
        gradeWrites(
          expectation.calls.map(({ item, ...call }) => ({ ...call, item: named(loaded, item) })),
          output.mutations,
        ),
      );
    if (expectation.grader === "creates") grades.push(gradeCreates(expectation, output.mutations));
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
      const id = named(loaded, expectation.item);
      const called = fixtureOf(options.fixtures, id)?.called?.(id);
      const item = called ? { title: called } : id;
      grades.push(gradeSurfaced(item, expectation.text, output.reply, under(id)));
    }
    if (expectation.grader === "blocks") grades.push(gradeBlocks(expectation, output.blocks ?? []));
    if (expectation.grader === "no-sketch") grades.push(gradeNoSketch(output.sketches ?? 0));
    if (expectation.grader === "no-refused-block")
      grades.push(gradeNoRefusedBlock(output.refusedBlocks ?? 0));
    if (expectation.grader === "mentions")
      grades.push(gradeMentions(expectation.text, output.reply));
    if (expectation.grader === "avoids") grades.push(gradeAvoids(expectation.text, output.reply));
    if (expectation.grader === "findings")
      grades.push(
        gradeFindings(
          {
            cites: (expectation.cites ?? []).map((cite) => ({
              ...cite,
              item: named(loaded, cite.item),
            })),
            ...(expectation.atMost === undefined ? {} : { atMost: expectation.atMost }),
          },
          output.look ?? null,
        ),
      );
    if (expectation.grader === "judge") {
      grades.push(
        await gradeJudge({
          claims: expectation.claims,
          prompt: loaded.case.prompt ?? "",
          region: await evidence(loaded, options),
          searches: await searchesOf(output.transcript, loaded, options),
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

// The run's event leaves out the excerpts search() gave the agent, so its queries are
// searched again in the case's world, which gives the same.
async function searchesOf(
  transcript: readonly unknown[],
  loaded: LoadedCase,
  options: RoundOptions,
): Promise<unknown[]> {
  const events = transcript as readonly AgentEvent[];
  const runs = events.flatMap((event) => {
    if (event.kind !== "run.finished") return [];
    const queries = event.result.reads.filter((r) => r.fn === "search").map((r) => r.args);
    if (!queries.length) return [];
    const hits = events.flatMap((e) =>
      e.kind === "search" && e.runId === event.runId ? e.hits : [],
    );
    return [{ queries, hits }];
  });
  if (!runs.length) return [];
  return inWorld(loaded, options, async (world) =>
    Promise.all(
      runs.map(async ({ queries, hits }) => {
        const excerpts = new Map<string, Set<string>>();
        for (const [query, limit] of queries)
          for (const hit of await world.reader.search(String(query), Number(limit ?? 20)))
            if (hit.excerpt !== undefined)
              excerpts.set(hit.id, (excerpts.get(hit.id) ?? new Set()).add(hit.excerpt));
        return {
          queries,
          hits: hits.map((hit) => {
            const found = excerpts.get(hit.id);
            return found ? { ...hit, excerpts: [...found] } : hit;
          }),
        };
      }),
    ),
  );
}

function named(loaded: LoadedCase, item: string): ItemId {
  const id = loaded.named.get(item);
  if (id === undefined) throw new Error(`${item} was not loaded`);
  return id;
}

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

const evidence = (loaded: LoadedCase, options: RoundOptions): Promise<unknown[]> =>
  inWorld(loaded, options, (world) => world.evidence());

// A response is read from a copy, so a streamed body still streams to the caller.
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

function shared(a: readonly string[], b: readonly string[]): string | null {
  return a.find((x) => b.some((y) => sameModel(x, y))) ?? null;
}

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

export type Failing = ReadonlyMap<string, GraderName>;

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
    const marked = known ? undefined : failing.get(r.id);
    const why = r.error ?? r.grades.find((g) => !g.pass && g.grader !== marked)?.detail ?? "";
    const which = r.rep ? `, trial ${r.rep + 1}` : "";
    lines.push(
      `${known ? "fail (known)" : r.outcome}  ${r.id} (${r.split}, kind ${r.kind}${which}): ${why}`,
    );
  }
  return lines.join("\n");
}

// CI guards the pipeline, not the model's judgement, so a failed judged case doesn't fail it.
// Passing a `failing` case fails too, so the mark goes once the agent does better.
export function exitCode(
  results: readonly CaseResult[],
  mode: "live" | "replay",
  failing: Failing = new Map(),
): number {
  const broken = results.some((r) => {
    if (r.outcome === "error") return true;
    if (mode === "live") return false;
    if (failing.has(r.id))
      return r.outcome === "pass" || (!isJudged(r.kind) && !knownFailure(r, failing));
    return r.outcome === "fail" && !isJudged(r.kind);
  });
  return broken ? 1 : 0;
}
