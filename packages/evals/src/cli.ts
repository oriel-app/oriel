// `pnpm evals` runs every case live, recording its cassettes, for local
// hillclimbing; `evals:ci` replays the cassettes and never reaches the network.
import { existsSync, lstatSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { type Instant, instant, isUlid, ulid } from "@oriel/core";
import { openChecked } from "@oriel/folder";
import { loadFolderFixture } from "../../../scripts/fixtures/folder.ts";
import { loadSlackFixture } from "../../../scripts/fixtures/slack.ts";
import { anthropicFetch, anthropicKey, type Fetch, isPriced, sameModel } from "./anthropic.ts";
import { loadCases } from "./case.ts";
import { cassetteDir, cassettes } from "./cassette.ts";
import {
  estimate,
  freezeClimb,
  isClimbName,
  loadClimb,
  type RoundSplit,
  roundSplit,
  spent,
  unfrozen,
  writeLedger,
} from "./climb.ts";
import { compareChange, formatChange, noChange, readResults } from "./compare.ts";
import {
  cassettesDir,
  casesDir,
  climbsDir,
  envFile,
  loadJiraFixture,
  repoRoot,
  roundsDir,
} from "./repo.ts";
import { exitCode, formatRound, runRound } from "./runner.ts";
import { system } from "./system.ts";

// Recording and replaying use the same models, or replays miss.
export const defaults = { model: "claude-opus-5-5", judge: "claude-sonnet-5-5" };

// The eval clock: fixed, after the fixture's last source edit.
export const evalNow: Instant = instant(new Date("2026-10-29T09:00:00.000Z"));

export const usage = `usage: pnpm evals [--model <id>] [--judge <id>] [--baseline <round>] [--env <path>]
           [--climb <name> [--split train|test|all] [--label <text>]]
         runs every case against the live model and records its cassettes;
         --env names the .env holding ANTHROPIC_API_KEY (default: the repo root's);
         --climb runs a climb's round: its frozen cases, each its trials a case,
         train alone unless --split says otherwise, refused past its cap
       pnpm evals compare <baseline rounds> <candidate rounds> [--trim]
         a fix must be better beyond noise; with --trim, no worse within the margin
       pnpm evals aa <rounds>
         judges every split of an unchanged agent's trials as if it were a change
       pnpm evals freeze <climb> --cap <dollars> --reps <trials a case>
         writes a climb's plan over the cases as they are now
       pnpm --filter @oriel/evals evals:ci
         replays the cassettes; fails on any error and on failed deterministic cases
A round is the ULID naming its directory under .evals/; join rounds of one
agent with + to pool their trials; a round may be in only one arm, once.`;

export type Command =
  | {
      command: "live";
      model: string;
      judge: string;
      baseline: string | null;
      env?: string;
      climb?: string;
      split?: RoundSplit;
      label?: string;
    }
  | { command: "replay"; model: string; judge: string }
  | { command: "compare"; baseline: string; candidate: string; trim?: true }
  | { command: "aa"; rounds: string }
  | { command: "freeze"; climb: string; cap: number; reps: number };

function parse(args: readonly string[]) {
  try {
    return parseArgs({
      args: [...args],
      allowPositionals: true,
      strict: true,
      options: {
        model: { type: "string" },
        judge: { type: "string" },
        baseline: { type: "string" },
        env: { type: "string" },
        climb: { type: "string" },
        split: { type: "string" },
        label: { type: "string" },
        trim: { type: "boolean" },
        cap: { type: "string" },
        reps: { type: "string" },
      },
    });
  } catch {
    return null;
  }
}

// Rounds joined with +, each a ULID, none twice.
const isRounds = (value: string) => {
  const ids = value.split("+");
  return ids.every(isUlid) && new Set(ids).size === ids.length;
};
const roundsOf = (value: string) => value.split("+");
const dollars = (value: string | undefined) =>
  value !== undefined && /^\d+(\.\d+)?$/.test(value) && Number(value) > 0 ? Number(value) : null;
const whole = (value: string | undefined) =>
  value !== undefined && /^[1-9]\d?$/.test(value) ? Number(value) : null;

export function parseCommand(args: readonly string[]): Command | { error: string } {
  const parsed = parse(args);
  if (!parsed) return { error: usage };
  const { values, positionals } = parsed;
  const [verb, ...rest] = positionals;
  const model = values.model ?? defaults.model;
  const judge = values.judge ?? defaults.judge;
  if (sameModel(judge, model))
    return { error: "the judge model must differ from the model under test" };
  const { climb, split, label, trim, cap, reps } = values;
  const climbFlags = climb ?? split ?? label;
  const planFlags = cap ?? reps;
  if (
    verb === undefined &&
    trim === undefined &&
    planFlags === undefined &&
    (values.baseline === undefined || isUlid(values.baseline)) &&
    (climb !== undefined || climbFlags === undefined) &&
    (climb === undefined || isClimbName(climb)) &&
    (split === undefined || roundSplit(split).ok) &&
    (label === undefined || label.trim() !== "")
  ) {
    const live = {
      command: "live" as const,
      model,
      judge,
      baseline: values.baseline ?? null,
      ...(climb === undefined ? {} : { climb }),
      ...(split === undefined ? {} : { split: split as RoundSplit }),
      ...(label === undefined ? {} : { label }),
    };
    if (values.env === undefined) return live;
    if (values.env.trim()) return { ...live, env: values.env };
  }
  const flags =
    values.model ?? values.judge ?? values.baseline ?? values.env ?? climbFlags ?? planFlags;
  if (verb === "replay" && rest.length === 0 && flags === undefined && trim === undefined)
    return { command: "replay", model, judge };
  const [first = "", second = ""] = rest;
  if (
    verb === "compare" &&
    rest.length === 2 &&
    flags === undefined &&
    [first, second].every(isRounds) &&
    !first.split("+").some((id) => second.split("+").includes(id))
  )
    return { command: "compare", baseline: first, candidate: second, ...(trim ? { trim } : {}) };
  if (verb === "aa" && rest.length === 1 && flags === undefined && !trim && isRounds(first))
    return { command: "aa", rounds: first };
  const plan = { cap: dollars(cap), reps: whole(reps) };
  if (
    verb === "freeze" &&
    rest.length === 1 &&
    isClimbName(first) &&
    plan.cap !== null &&
    plan.reps !== null &&
    (values.model ?? values.judge ?? values.baseline ?? values.env ?? climbFlags ?? trim) ===
      undefined
  )
    return { command: "freeze", climb: first, cap: plan.cap, reps: plan.reps };
  return { error: usage };
}

// Reads a .env as the folder source reads a file (decision 0019): no link on
// the way to it, no second link to it, no pipe or device. Null when nothing
// is there; no problem quotes the file.
async function readEnv(path: string): Promise<{ text: string | null } | { problem: string }> {
  const absolute = resolve(path);
  let expected: { dev: bigint; ino: bigint };
  try {
    expected = lstatSync(absolute, { bigint: true });
  } catch {
    return { text: null };
  }
  const opened = await openChecked(absolute, expected);
  if (opened.status === "vanished") return { text: null };
  if (opened.status === "forbidden") return { problem: `${path} can't be read` };
  if (opened.status === "changed")
    return { problem: `${path} is not a regular file with one link; it is refused` };
  try {
    return { text: await opened.handle.readFile("utf8") };
  } finally {
    await opened.handle.close();
  }
}

// The model key for a live round, from the .env `--env` names, or else the
// repo root's. Only ANTHROPIC_API_KEY is kept, and no problem quotes a value.
export async function modelKey(
  env: string | undefined,
  rootEnv: URL,
): Promise<{ key: string } | { problem: string }> {
  const read = await readEnv(env ?? fileURLToPath(rootEnv));
  if ("problem" in read) return read;
  if (env !== undefined && read.text === null) return { problem: `no file at ${env}` };
  const key = anthropicKey(read.text);
  if (key) return { key };
  return {
    problem:
      env === undefined
        ? "ANTHROPIC_API_KEY must be set in .env; env.example lists it."
        : `ANTHROPIC_API_KEY must be set in ${env}`,
  };
}

// What a round reads, writes and reaches. Tests pass their own, so none reads
// the clock, the network or the repo's .env.
export type Io = {
  cases: URL;
  // Where climbs' plans and ledgers are; the repo's when absent.
  climbs?: URL;
  cassettes: URL;
  rounds: URL;
  envFile: URL;
  network: Fetch;
  // Milliseconds since the epoch, naming the round.
  now: () => number;
  // Milliseconds, read only to time each case.
  clock: () => number;
  log: (line: string) => void;
  error: (line: string) => void;
};

const repoIo: Io = {
  cases: casesDir,
  climbs: climbsDir,
  cassettes: cassettesDir,
  rounds: roundsDir,
  envFile,
  network: fetch,
  now: Date.now,
  clock: () => performance.now(),
  log: console.log,
  error: console.error,
};

export async function main(command: Command, io: Io = repoIo): Promise<number> {
  const climbs = io.climbs ?? climbsDir;
  const round = (id: string) => readResults(new URL(`${id}/`, io.rounds));
  const pooled = (ids: string) => roundsOf(ids).flatMap(round);
  if (command.command === "compare") {
    const mode = command.trim ? "no-worse" : "better";
    io.log(formatChange(compareChange(pooled(command.baseline), pooled(command.candidate), mode)));
    return 0;
  }
  if (command.command === "aa") {
    const trials = roundsOf(command.rounds).flatMap((id) =>
      round(id).map((result) => ({ slot: `${id}:${result.rep ?? 0}`, result })),
    );
    const aa = noChange(trials);
    const share = (n: number) => `${n} of ${aa.judged} (${Math.round((100 * n) / aa.judged)}%)`;
    io.log(`A/A: ${aa.judged} comparisons of an unchanged agent's trials against each other`);
    io.log(`  kept as a fix (false keep): ${share(aa.better)}`);
    io.log(`  reverted as a trim (false revert): ${share(aa.judged - aa.noWorse)}`);
    io.log(`  a group flagged worse (false guard): ${share(aa.guarded)}`);
    return 0;
  }
  const fixture = loadJiraFixture();
  const folder = loadFolderFixture();
  const slack = loadSlackFixture();
  const { cases: loaded, problems } = loadCases(io.cases, fixture, repoRoot, folder, slack);
  for (const problem of problems) io.error(problem);
  if (problems.length) return 1;
  for (const { case: c } of loaded)
    if (c.waiting) io.log(`waiting  ${c.id} (${c.split}, kind ${c.kind}): ${c.waiting}`);
  const runnable = loaded.filter((c) => c.case.waiting === undefined);
  if (command.command === "freeze") {
    const refused = freezeClimb(climbs, command.climb, command, runnable);
    if (refused) io.error(refused);
    else io.log(`froze ${runnable.length} cases into climbs/${command.climb}.json`);
    return refused ? 1 : 0;
  }
  const plan =
    command.command === "live" && command.climb ? loadClimb(climbs, command.climb) : null;
  if (plan && "problem" in plan) {
    io.error(plan.problem);
    return 1;
  }
  const split = command.command === "live" ? (command.split ?? (plan ? "train" : "all")) : "all";
  const cases = runnable.filter((c) => split === "all" || c.case.split === split);
  if (!cases.length) {
    io.log("no cases to run in packages/evals/cases/; add one with the add-eval skill.");
    return 0;
  }
  // What the round books as it starts, before it has cost anything.
  let booked = 0;
  if (plan) {
    const changed = unfrozen(plan.climb, runnable);
    for (const problem of changed) io.error(problem);
    if (changed.length) return 1;
    const unpriced = [command.model, command.judge].filter((m) => !isPriced(m));
    if (unpriced.length) {
      io.error(`a climb's round needs a price for every model; none for ${unpriced.join(", ")}`);
      return 1;
    }
    const before = spent(plan.ledger);
    const next = estimate(plan.ledger, cases.length * plan.climb.reps);
    booked = next;
    if (before + next > plan.climb.cap) {
      io.error(
        `refused: this round would cost about ${usd(next)}, taking the climb to ${usd(before + next)} of its ${usd(plan.climb.cap)} cap`,
      );
      return 1;
    }
  }
  const baseline =
    command.command === "live" && command.baseline
      ? new URL(`${command.baseline}/`, io.rounds)
      : null;
  if (baseline && !existsSync(new URL("results.jsonl", baseline))) {
    io.error(`no baseline round at ${baseline.pathname}`);
    return 1;
  }
  const key = command.command === "live" ? await modelKey(command.env, io.envFile) : null;
  if (key && "problem" in key) {
    io.error(key.problem);
    return 1;
  }
  // The key goes to the model client and nowhere else.
  const live = key ? anthropicFetch(key.key, io.network) : null;
  const id = ulid(io.now());
  const reps = plan ? plan.climb.reps : 1;
  const climb = plan && command.command === "live" && command.climb ? command.climb : null;
  const entry = {
    round: id,
    label: command.command === "live" ? (command.label ?? "") : "",
    split,
  };
  // Booked at its estimate first, so a round stopped partway still counts.
  if (climb)
    writeLedger(climbs, climb, {
      ...entry,
      trials: cases.length * reps,
      usd: booked,
      estimated: true,
    });
  const ran = await runRound({
    cases,
    fixture,
    folder,
    slack,
    system,
    model: command.model,
    judgeModel: command.judge,
    // A case's first trial records its cassettes; the others only spend.
    transport: (caseId, rep) => {
      const dir = cassetteDir(io.cassettes, caseId, command.model, command.judge);
      if (live && rep > 0) return { fetch: live, commit: () => null };
      return live ? cassettes({ mode: "record", dir, live }) : cassettes({ mode: "replay", dir });
    },
    reps,
    ...(plan
      ? { groups: new Map(Object.entries(plan.climb.cases).map(([id, c]) => [id, c.group])) }
      : {}),
    out: new URL(`${id}/`, io.rounds),
    clock: io.clock,
    now: evalNow,
    concurrency: live ? 4 : 1,
  });
  const failing = new Map(
    cases.flatMap((c) => (c.case.failing ? [[c.case.id, c.case.failing.grader] as const] : [])),
  );
  io.log(`round ${id} (${command.command}, ${command.model}, judge ${command.judge})`);
  if (reps > 1) io.log(`${reps} trials a case; each split counts trials`);
  io.log(formatRound(ran, failing));
  io.log(`results: .evals/${id}/`);
  const cost = ran.summary.spend?.usd ?? 0;
  if (plan && climb) {
    writeLedger(climbs, climb, { ...entry, trials: ran.results.length, usd: cost });
    const total = spent(plan.ledger) + cost;
    io.log(`spent ${usd(cost)}; climb ${climb} has spent ${usd(total)} of ${usd(plan.climb.cap)}`);
  } else if (live) io.log(`spent ${usd(cost)}`);
  if (baseline) io.log(formatChange(compareChange(readResults(baseline), ran.results, "better")));
  return exitCode(ran.results, command.command, failing);
}

const usd = (dollars: number) => `$${dollars.toFixed(2)}`;

if (import.meta.main) {
  const command = parseCommand(process.argv.slice(2));
  if ("error" in command) {
    console.error(command.error);
    process.exit(1);
  }
  process.exitCode = await main(command);
}
