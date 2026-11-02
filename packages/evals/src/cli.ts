// `pnpm evals` runs every case live, recording its cassettes, for local
// hillclimbing; `evals:ci` replays the cassettes and never reaches the network.
import { closeSync, constants, existsSync, fstatSync, openSync, readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { type Instant, instant, isUlid, ulid } from "@oriel/core";
import { loadFolderFixture } from "../../../scripts/fixtures/folder.ts";
import { loadSlackFixture } from "../../../scripts/fixtures/slack.ts";
import { anthropicFetch, anthropicKey, type Fetch, sameModel } from "./anthropic.ts";
import { loadCases } from "./case.ts";
import { cassetteDir, cassettes } from "./cassette.ts";
import { compareRounds, formatComparison, readResults } from "./compare.ts";
import { cassettesDir, casesDir, envFile, loadJiraFixture, repoRoot, roundsDir } from "./repo.ts";
import { exitCode, formatRound, runRound } from "./runner.ts";
import { system } from "./system.ts";

// Recording and replaying use the same models, or replays miss.
export const defaults = { model: "claude-opus-5-5", judge: "claude-sonnet-5-5" };

// The eval clock: fixed, after the fixture's last source edit.
export const evalNow: Instant = instant(new Date("2026-10-29T09:00:00.000Z"));

export const usage = `usage: pnpm evals [--model <id>] [--judge <id>] [--baseline <round>] [--env <path>]
         runs every case against the live model and records its cassettes;
         --env names the .env holding ANTHROPIC_API_KEY (default: the repo root's)
       pnpm evals compare <baseline round> <candidate round>
       pnpm --filter @oriel/evals evals:ci
         replays the cassettes; fails on any error and on failed deterministic cases
A round is the ULID naming its directory under .evals/.`;

export type Command =
  | { command: "live"; model: string; judge: string; baseline: string | null; env?: string }
  | { command: "replay"; model: string; judge: string }
  | { command: "compare"; baseline: string; candidate: string };

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
      },
    });
  } catch {
    return null;
  }
}

export function parseCommand(args: readonly string[]): Command | { error: string } {
  const parsed = parse(args);
  if (!parsed) return { error: usage };
  const { values, positionals } = parsed;
  const [verb, ...rest] = positionals;
  const model = values.model ?? defaults.model;
  const judge = values.judge ?? defaults.judge;
  if (sameModel(judge, model))
    return { error: "the judge model must differ from the model under test" };
  if (verb === undefined && (values.baseline === undefined || isUlid(values.baseline))) {
    const live = { command: "live" as const, model, judge, baseline: values.baseline ?? null };
    if (values.env === undefined) return live;
    if (values.env.trim()) return { ...live, env: values.env };
  }
  if (
    verb === "replay" &&
    rest.length === 0 &&
    values.baseline === undefined &&
    values.env === undefined
  )
    return { command: "replay", model, judge };
  const [baseline = "", candidate = ""] = rest;
  const flags = values.model ?? values.judge ?? values.baseline ?? values.env;
  if (
    verb === "compare" &&
    rest.length === 2 &&
    flags === undefined &&
    [baseline, candidate].every(isUlid)
  )
    return { command: "compare", baseline, candidate };
  return { error: usage };
}

// Reads a file only if it is a regular one: a link isn't followed and a pipe
// or device isn't waited on. Null for anything else; no error carries content.
export function readRegularFile(path: string): string | null {
  let fd: number;
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  } catch {
    return null;
  }
  try {
    return fstatSync(fd).isFile() ? readFileSync(fd, "utf8") : null;
  } finally {
    closeSync(fd);
  }
}

// The model key for a live round, from the .env `--env` names, or else the
// repo root's. Only ANTHROPIC_API_KEY is kept, and no problem quotes a value.
export function modelKey(
  env: string | undefined,
  rootEnv: URL,
): { key: string } | { problem: string } {
  if (env === undefined) {
    const key = anthropicKey(existsSync(rootEnv) ? readFileSync(rootEnv, "utf8") : null);
    return key
      ? { key }
      : { problem: "ANTHROPIC_API_KEY must be set in .env; env.example lists it." };
  }
  const text = readRegularFile(env);
  if (text === null) return { problem: `--env ${env} is not a regular file` };
  const key = anthropicKey(text);
  return key ? { key } : { problem: `ANTHROPIC_API_KEY must be set in ${env}` };
}

// What a round reads, writes and reaches. Tests pass their own, so none reads
// the clock, the network or the repo's .env.
export type Io = {
  cases: URL;
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
  if (command.command === "compare") {
    const round = (id: string) => readResults(new URL(`${id}/`, io.rounds));
    io.log(formatComparison(compareRounds(round(command.baseline), round(command.candidate))));
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
  const cases = loaded.filter((c) => c.case.waiting === undefined);
  if (!cases.length) {
    io.log("no cases to run in packages/evals/cases/; add one with the add-eval skill.");
    return 0;
  }
  const baseline =
    command.command === "live" && command.baseline
      ? new URL(`${command.baseline}/`, io.rounds)
      : null;
  if (baseline && !existsSync(new URL("results.jsonl", baseline))) {
    io.error(`no baseline round at ${baseline.pathname}`);
    return 1;
  }
  const key = command.command === "live" ? modelKey(command.env, io.envFile) : null;
  if (key && "problem" in key) {
    io.error(key.problem);
    return 1;
  }
  // The key goes to the model client and nowhere else.
  const live = key ? anthropicFetch(key.key, io.network) : null;
  const id = ulid(io.now());
  const round = await runRound({
    cases,
    fixture,
    folder,
    slack,
    system,
    model: command.model,
    judgeModel: command.judge,
    transport: (caseId) => {
      const dir = cassetteDir(io.cassettes, caseId, command.model, command.judge);
      return live ? cassettes({ mode: "record", dir, live }) : cassettes({ mode: "replay", dir });
    },
    out: new URL(`${id}/`, io.rounds),
    clock: io.clock,
    now: evalNow,
    concurrency: live ? 4 : 1,
  });
  const failing = new Map(
    cases.flatMap((c) => (c.case.failing ? [[c.case.id, c.case.failing.grader] as const] : [])),
  );
  io.log(`round ${id} (${command.command}, ${command.model}, judge ${command.judge})`);
  io.log(formatRound(round, failing));
  io.log(`results: .evals/${id}/`);
  if (baseline) io.log(formatComparison(compareRounds(readResults(baseline), round.results)));
  return exitCode(round.results, command.command, failing);
}

if (import.meta.main) {
  const command = parseCommand(process.argv.slice(2));
  if ("error" in command) {
    console.error(command.error);
    process.exit(1);
  }
  process.exitCode = await main(command);
}
