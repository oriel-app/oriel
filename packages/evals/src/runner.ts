// A round: every case run once through the system under test, graded, and
// written to its own directory under the gitignored `.evals/`: one JSONL line
// per case (`results.jsonl`), a full transcript per case (`transcripts/`), and
// a summary per split with a confidence interval (`summary.json`).
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import {
  array,
  boolean,
  type Infer,
  type Instant,
  literal,
  nullable,
  number,
  object,
  string,
  union,
  unknown,
} from "@oriel/core";
import type { AgentEvent } from "@oriel/agent";
import type { FixtureRegion, JiraFixture } from "@oriel/jira";
import type { SlackFixture } from "@oriel/slack";
import { fileTitle, type FolderFixture } from "../../../scripts/fixtures/folder.ts";
import { type Fetch, requestModel, responseModel, sameModel } from "./anthropic.ts";
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
import {
  type Grade,
  gradeExactDiff,
  gradeJudge,
  gradeMentions,
  gradeSurfaced,
  gradeZeroMutations,
} from "./graders.ts";
import { formatRate, type Rate, wilson } from "./stats.ts";
import { buildWorld } from "./world.ts";

// What the system under test gets for one case. Everything it sends to the
// model must follow from this and from earlier responses (no clock, no
// randomness), or its cassettes won't replay.
export type SystemInput = {
  case: EvalCase;
  fixture: JiraFixture;
  // The folder fixture; null when the round has none, and then no case holds
  // files.
  folder: FolderFixture | null;
  // The Slack fixture; absent or null when the round has none, and then no
  // case holds messages.
  slack?: SlackFixture | null;
  // The Jira fixture region the case names, if any; its files are the case's.
  region: FixtureRegion | null;
  // The eval clock: fixed, so prompts that depend on time still replay.
  now: Instant;
  model: string;
  // Its only way to the model: cassettes, recording or replaying.
  fetch: Fetch;
};

// What it hands back: the mutations its change set captured, the reply the
// user sees, and its transcript, kept verbatim for the case's transcript file.
export const systemOutput = object({
  mutations: array(capturedMutation),
  reply: string,
  transcript: array(unknown),
});
export type SystemOutput = Infer<typeof systemOutput>;

export type SystemUnderTest = (input: SystemInput) => Promise<SystemOutput>;

export const caseResult = object({
  id: string,
  // The case's content, its golden diff included, so a comparison can tell an
  // edited case from the one it replaced.
  hash: string,
  split,
  kind: number,
  outcome: union(literal("pass"), literal("fail"), literal("error")),
  grades: array(object({ grader: graderName, pass: boolean, detail: string })),
  error: nullable(string),
  // Why a case that finished in a live round saved no cassettes, so it won't
  // replay; null otherwise.
  unrecorded: nullable(string),
  ms: number,
});
export type CaseResult = Infer<typeof caseResult>;

// A case's `waiting` and `failing` marks are notes about the agent, not the
// case, so marking or unmarking it still compares with the round before.
export function caseHash(loaded: LoadedCase): string {
  const { waiting: _waiting, failing: _failing, ...graded } = loaded.case;
  const content = canonicalJson({ case: graded, golden: loaded.golden });
  return createHash("sha256").update(content).digest("hex");
}

export type Summary = {
  model: string;
  judgeModel: string;
  splits: Record<Split, Rate & { failed: number; errored: number }>;
};

export type Round = { results: CaseResult[]; summary: Summary };

export type RoundOptions = {
  cases: readonly LoadedCase[];
  fixture: JiraFixture;
  // Absent: none, so no case may hold files.
  folder?: FolderFixture | null;
  // Absent: none, so no case may hold messages.
  slack?: SlackFixture | null;
  system: SystemUnderTest;
  model: string;
  judgeModel: string;
  // The cassettes one case's model calls go through, the judge's included.
  // They are committed only when the case finishes without error.
  transport: (caseId: string) => Cassettes;
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
  const results = await pool(options.cases, options.concurrency ?? 1, (loaded) =>
    runCase(loaded, options),
  );
  const summary = summarize(results, options);
  writeFileSync(
    new URL("results.jsonl", options.out),
    results.map((r) => `${JSON.stringify(r)}\n`).join(""),
  );
  writeFileSync(new URL("summary.json", options.out), `${JSON.stringify(summary, null, 2)}\n`);
  return { results, summary };
}

async function runCase(loaded: LoadedCase, options: RoundOptions): Promise<CaseResult> {
  const evalCase = loaded.case;
  const tape = options.transport(evalCase.id);
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
      fixture: options.fixture,
      folder: options.folder ?? null,
      slack: options.slack ?? null,
      region: loaded.region,
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
  const result: CaseResult = {
    id: evalCase.id,
    hash: caseHash(loaded),
    split: evalCase.split,
    kind: evalCase.kind,
    outcome,
    grades,
    error,
    unrecorded,
    ms,
  };
  const transcript = {
    ...result,
    case: evalCase,
    model: options.model,
    judgeModel: options.judgeModel,
    modelsCalled: await tested.models(),
    output,
  };
  writeFileSync(
    new URL(`transcripts/${evalCase.id}.json`, options.out),
    `${JSON.stringify(transcript, null, 2)}\n`,
  );
  return result;
}

// Graders run in the case's order; a throw is the case's error.
async function grade(
  loaded: LoadedCase,
  output: SystemOutput,
  options: RoundOptions,
  transport: Fetch,
): Promise<Grade[]> {
  const grades: Grade[] = [];
  for (const expectation of loaded.case.expect) {
    if (expectation.grader === "exact-diff") {
      if (!loaded.golden) throw new Error(`${expectation.golden} was not loaded`);
      grades.push(gradeExactDiff(loaded.golden, output.mutations));
    }
    if (expectation.grader === "zero-mutations") grades.push(gradeZeroMutations(output.mutations));
    if (expectation.grader === "surfaced") {
      // A file is named by its title, and a Slack message by its author.
      const named =
        "item" in expectation
          ? (slackAuthor(options.slack ?? null, expectation.item) ?? expectation.item)
          : { title: fileTitle(expectation.file) };
      grades.push(gradeSurfaced(named, expectation.text, output.reply));
    }
    if (expectation.grader === "mentions")
      grades.push(gradeMentions(expectation.text, output.reply));
    if (expectation.grader === "judge") {
      grades.push(
        await gradeJudge({
          claims: expectation.claims,
          prompt: loaded.case.prompt,
          region: await evidence(loaded, options),
          searches: searchesOf(output.transcript),
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

// The region's items as their sources hold them once the case's edits are
// applied; an item that is gone says so.
async function evidence(loaded: LoadedCase, options: RoundOptions): Promise<unknown[]> {
  const world = await buildWorld({
    fixture: options.fixture,
    folder: options.folder ?? null,
    region: loaded.region,
    files: loaded.case.files ?? [],
    messages: loaded.case.messages ?? [],
    ...(options.slack ? { slack: options.slack } : {}),
    edited: loaded.case.edited ?? 0,
    folderEdited: loaded.case.folderEdited ?? 0,
  });
  try {
    return await world.evidence();
  } finally {
    world.close();
  }
}

// Notes each model a caller asks for and each model a response reports. A
// response is read from a copy, so a streamed body still streams to the caller.
function watched(inner: Fetch): { fetch: Fetch; models: () => Promise<string[]> } {
  const seen = new Set<string>();
  const reading: Promise<void>[] = [];
  const note = (model: string | null) => {
    if (model) seen.add(model);
  };
  const fetch: Fetch = async (input, init) => {
    const request = new Request(input, init);
    note(requestModel(await request.clone().text()));
    const response = await inner(request);
    reading.push(
      response
        .clone()
        .text()
        .then((body) => note(responseModel(body)))
        .catch(() => {}),
    );
    return response;
  };
  const models = async () => {
    await Promise.all(reading);
    return [...seen].sort();
  };
  return { fetch, models };
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
    lines.push(
      `${known ? "fail (known)" : r.outcome}  ${r.id} (${r.split}, kind ${r.kind}): ${why}`,
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

// A Slack message's author as the Slack source names them, a person or the
// app that posted as itself, or null for an item from another source. Their
// name is how a reply names the message.
function slackAuthor(slack: SlackFixture | null, item: string): { title: string } | null {
  if (!slack || !item.startsWith("slack:")) return null;
  const [channel, ts] = item.slice("slack:".length).split("-");
  const message = slack.channels.find((c) => c.id === channel)?.messages.find((m) => m.ts === ts);
  const person = slack.users.find((user) => user.id === message?.user);
  if (person) return { title: person.real_name };
  return message?.username ? { title: message.username } : null;
}
