// `pnpm evals` runs every case live, recording its cassettes, for local
// hillclimbing; `evals:ci` replays the cassettes and never reaches the network.
import { existsSync, readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { type Instant, instant, isUlid, ulid } from "@oriel/core";
import { anthropicFetch, anthropicKey, sameModel } from "./anthropic.ts";
import { loadCases } from "./case.ts";
import { cassettes } from "./cassette.ts";
import { compareRounds, formatComparison, readResults } from "./compare.ts";
import { cassettesDir, casesDir, envFile, loadJiraFixture, repoRoot, roundsDir } from "./repo.ts";
import { exitCode, formatRound, runRound } from "./runner.ts";
import { system } from "./system.ts";

// Recording and replaying use the same models, or replays miss.
export const defaults = { model: "claude-opus-5-5", judge: "claude-sonnet-5-5" };

// The eval clock: fixed, after the fixture's last source edit.
export const evalNow: Instant = instant(new Date("2026-10-29T09:00:00.000Z"));

export const usage = `usage: pnpm evals [--model <id>] [--judge <id>] [--baseline <round>]
         runs every case against the live model and records its cassettes
       pnpm evals compare <baseline round> <candidate round>
       pnpm --filter @oriel/evals evals:ci
         replays the cassettes; fails on any error and on failed deterministic cases
A round is the ULID naming its directory under .evals/.`;

export type Command =
  | { command: "live"; model: string; judge: string; baseline: string | null }
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
  if (verb === undefined && (values.baseline === undefined || isUlid(values.baseline)))
    return { command: "live", model, judge, baseline: values.baseline ?? null };
  if (verb === "replay" && rest.length === 0 && values.baseline === undefined)
    return { command: "replay", model, judge };
  const [baseline = "", candidate = ""] = rest;
  const flags = values.model ?? values.judge ?? values.baseline;
  if (
    verb === "compare" &&
    rest.length === 2 &&
    flags === undefined &&
    [baseline, candidate].every(isUlid)
  )
    return { command: "compare", baseline, candidate };
  return { error: usage };
}

async function main(command: Command): Promise<number> {
  if (command.command === "compare") {
    const round = (id: string) => readResults(new URL(`${id}/`, roundsDir));
    console.log(formatComparison(compareRounds(round(command.baseline), round(command.candidate))));
    return 0;
  }
  const fixture = loadJiraFixture();
  const { cases, problems } = loadCases(casesDir, fixture, repoRoot);
  for (const problem of problems) console.error(problem);
  if (problems.length) return 1;
  if (!cases.length) {
    console.log("no cases in packages/evals/cases/ yet; add one with the add-eval skill.");
    return 0;
  }
  if (!system) {
    console.log(`${cases.length} cases valid; no system under test yet (src/system.ts).`);
    return 0;
  }
  const baseline =
    command.command === "live" && command.baseline
      ? new URL(`${command.baseline}/`, roundsDir)
      : null;
  if (baseline && !existsSync(new URL("results.jsonl", baseline))) {
    console.error(`no baseline round at ${baseline.pathname}`);
    return 1;
  }
  const key =
    command.command === "live"
      ? anthropicKey(existsSync(envFile) ? readFileSync(envFile, "utf8") : null)
      : null;
  if (command.command === "live" && !key) {
    console.error("ANTHROPIC_API_KEY must be set in .env; env.example lists it.");
    return 1;
  }
  const live = key ? anthropicFetch(key) : null;
  const id = ulid(Date.now());
  const round = await runRound({
    cases,
    fixture,
    system,
    model: command.model,
    judgeModel: command.judge,
    transport: (caseId) => {
      const dir = new URL(`${caseId}/`, cassettesDir);
      return live ? cassettes({ mode: "record", dir, live }) : cassettes({ mode: "replay", dir });
    },
    out: new URL(`${id}/`, roundsDir),
    clock: () => performance.now(),
    now: evalNow,
    concurrency: live ? 4 : 1,
  });
  console.log(`round ${id} (${command.command}, ${command.model}, judge ${command.judge})`);
  console.log(formatRound(round));
  console.log(`results: .evals/${id}/`);
  if (baseline) console.log(formatComparison(compareRounds(readResults(baseline), round.results)));
  return exitCode(round.results, command.command);
}

if (import.meta.main) {
  const command = parseCommand(process.argv.slice(2));
  if ("error" in command) {
    console.error(command.error);
    process.exit(1);
  }
  process.exitCode = await main(command);
}
