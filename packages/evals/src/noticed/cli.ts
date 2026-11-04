// `pnpm evals:noticed`: Noticed's rounds, by 0031's method, beside the
// agent's. A round runs a climb's frozen cases, each `reps` times, through
// one arm, and books its cost in the climb's ledger, refused past its cap.
// Rounds live in `.evals/noticed/<round>/`; comparisons use the agent's own
// `compareChange`.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { ulid } from "@oriel/core";
import { anthropicFetch, type Fetch } from "../anthropic.ts";
import { estimate, loadClimb, type RoundSplit, spent, writeLedger } from "../climb.ts";
import { modelKey } from "../cli.ts";
import { compareChange, formatChange, readResults } from "../compare.ts";
import { loadFixtures } from "../fixtures.ts";
import { envFile, repoRoot, roundsDir } from "../repo.ts";
import { type CaseResult } from "../runner.ts";
import { formatRate, wilson } from "../stats.ts";
import { loadNoticedCases, type NoticedCase } from "./case.ts";
import { type Arm, caseHash, runTrial, startArm, type TrialExtra } from "./run.ts";

const climbsDir = new URL("packages/evals/noticed/climbs/", repoRoot);
const rounds = new URL("noticed/", roundsDir);

const usage = `usage: pnpm evals:noticed freeze <climb> --cap <dollars> --reps <k>
       pnpm evals:noticed round --climb <climb> [--split train|test|all] [--label <text>]
           [--env <path>] [--mode oriel|signals|model-first] [--model <id>] [--effort <level>]
           [--top <n>] [--text <chars>] [--prompt <name>] [--concurrency <n>]
       pnpm evals:noticed compare <rounds> <rounds> [--trim]
       pnpm evals:noticed report <round> [<round> ...]`;

const usd = (n: number) => `$${n.toFixed(2)}`;

async function pool<T, R>(items: readonly T[], size: number, run: (item: T) => Promise<R>) {
  const out: R[] = Array.from({ length: items.length });
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await run(items[i] as T);
      }
    }),
  );
  return out;
}

const percentile = (values: readonly number[], p: number) => {
  const sorted = values.toSorted((a, b) => a - b);
  return sorted.length
    ? (sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] ?? 0)
    : 0;
};

function freeze(climb: string, cap: number, reps: number, cases: readonly NoticedCase[]) {
  const file = new URL(`${climb}.json`, climbsDir);
  if (existsSync(file)) throw new Error(`${file.pathname} exists; a plan is frozen once`);
  mkdirSync(climbsDir, { recursive: true });
  const frozen = {
    cap,
    reps,
    cases: Object.fromEntries(cases.map((c) => [c.id, { hash: caseHash(c), group: c.group }])),
  };
  writeFileSync(file, `${JSON.stringify(frozen, null, 2)}\n`);
}

const readExtras = (round: string): TrialExtra[] =>
  readFileSync(new URL(`${round}/trials.jsonl`, rounds), "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as TrialExtra);

// One line a round: its arm, pass rates by grade, the time to the first
// card and to the end, tokens and dollars a run.
function report(round: string): string {
  const results = readResults(new URL(`${round}/`, rounds));
  const extras = readExtras(round);
  const arm = JSON.parse(readFileSync(new URL(`${round}/arm.json`, rounds), "utf8")) as Arm & {
    label: string;
  };
  const done = results.filter((r) => r.outcome !== "error");
  const rate = (pass: (r: CaseResult) => boolean) =>
    formatRate(wilson(done.filter(pass).length, done.length));
  const grade = (name: string) => (r: CaseResult) =>
    r.grades.find((g) => g.grader === name)?.pass ?? false;
  const first = extras.flatMap((e) => (e.firstMs === null ? [] : [e.firstMs]));
  const tokens = extras.map((e) => e.tokens.input + e.tokens.output);
  const dollars = extras.reduce((n, e) => n + e.usd, 0);
  const errors = results.length - done.length;
  return [
    `${round} ${arm.label ? `"${arm.label}" ` : ""}(${arm.mode}, ${arm.model}, ${arm.effort}, prompt ${arm.prompt}, top ${arm.top ?? "all"}, text ${arm.textChars})`,
    `  pass ${rate((r) => r.outcome === "pass")}  recall ${rate(grade("recall"))}  precision ${rate(grade("precision"))}  grounding ${rate(grade("grounding"))}${errors ? `  errors ${errors}` : ""}`,
    `  first card p50 ${percentile(first, 0.5)}ms p90 ${percentile(first, 0.9)}ms; run p50 ${percentile(
      extras.map((e) => e.ms),
      0.5,
    )}ms; signals p50 ${percentile(
      extras.map((e) => e.signalsMs),
      0.5,
    )}ms; reads p50 ${percentile(
      extras.map((e) => e.readMs),
      0.5,
    )}ms`,
    `  tokens a run p50 ${percentile(tokens, 0.5)}; ${usd(dollars)} for ${extras.length} runs, ${usd(dollars / Math.max(1, extras.length))} a run; refused lines ${extras.reduce((n, e) => n + e.refused.length, 0)}, quotes dropped ${extras.reduce((n, e) => n + e.quotesDropped, 0)}`,
  ].join("\n");
}

const pooled = (arg: string) =>
  arg.split("+").flatMap((round) => readResults(new URL(`${round}/`, rounds)));

export async function main(args: readonly string[]): Promise<number> {
  const { positionals, values } = parseArgs({
    args: [...args],
    allowPositionals: true,
    options: {
      cap: { type: "string" },
      reps: { type: "string" },
      climb: { type: "string" },
      split: { type: "string" },
      label: { type: "string" },
      env: { type: "string" },
      mode: { type: "string" },
      model: { type: "string" },
      effort: { type: "string" },
      top: { type: "string" },
      text: { type: "string" },
      prompt: { type: "string" },
      concurrency: { type: "string" },
      trim: { type: "boolean" },
    },
  });
  const [command, ...rest] = positionals;
  const cases = loadNoticedCases();

  if (command === "freeze" && rest[0] && values.cap && values.reps) {
    freeze(rest[0], Number(values.cap), Number(values.reps), cases);
    return 0;
  }
  if (command === "report" && rest.length) {
    for (const round of rest) console.log(report(round));
    return 0;
  }
  if (command === "compare" && rest[0] && rest[1]) {
    const change = compareChange(
      pooled(rest[0]),
      pooled(rest[1]),
      values.trim ? "no-worse" : "better",
    );
    console.log(formatChange(change));
    return 0;
  }
  if (command !== "round" || !values.climb) {
    console.error(usage);
    return 2;
  }

  const climb = values.climb;
  const plan = loadClimb(climbsDir, climb);
  if ("problem" in plan) {
    console.error(plan.problem);
    return 1;
  }
  const split = (values.split ?? "train") as RoundSplit;
  const chosen = cases.filter((c) => split === "all" || c.split === split);
  const problems = chosen.flatMap((c) => {
    const frozen = plan.climb.cases[c.id];
    if (!frozen) return [`${c.id} isn't in the plan`];
    return frozen.hash === caseHash(c) ? [] : [`${c.id} changed since the freeze`];
  });
  if (problems.length) {
    console.error(problems.join("\n"));
    return 1;
  }
  const arm: Arm = {
    mode: (values.mode ?? startArm.mode) as Arm["mode"],
    model: values.model ?? startArm.model,
    effort: (values.effort ?? startArm.effort) as Arm["effort"],
    textChars: values.text ? Number(values.text) : startArm.textChars,
    prompt: values.prompt ?? startArm.prompt,
    ...(values.top ? { top: Number(values.top) } : {}),
  };
  const reps = plan.climb.reps;
  const trials = Array.from({ length: reps }, (_, rep) => chosen.map((c) => ({ c, rep }))).flat();
  const live = arm.mode !== "oriel";
  const booked = live ? estimate(plan.ledger, trials.length) : 0;
  if (spent(plan.ledger) + booked > plan.climb.cap) {
    console.error(
      `refused: about ${usd(booked)} would take the climb past its ${usd(plan.climb.cap)} cap (spent ${usd(spent(plan.ledger))})`,
    );
    return 1;
  }
  let fetch: Fetch | null = null;
  if (live) {
    const key = await modelKey(values.env, envFile);
    if ("problem" in key) {
      console.error(key.problem);
      return 1;
    }
    // The key goes to the model client and nowhere else.
    fetch = anthropicFetch(key.key);
  }
  const id = ulid(Date.now());
  const label = values.label ?? "";
  const out = new URL(`${id}/`, rounds);
  mkdirSync(out, { recursive: true });
  writeFileSync(new URL("arm.json", out), `${JSON.stringify({ ...arm, label }, null, 2)}\n`);
  writeLedger(climbsDir, climb, {
    round: id,
    label,
    split,
    trials: trials.length,
    usd: booked,
    estimated: true,
  });
  const fixtures = loadFixtures();
  const clock = () => performance.now();
  const ran = await pool(trials, Number(values.concurrency ?? 4), async ({ c, rep }) => {
    try {
      return await runTrial(c, rep, arm, {
        fixtures,
        fetch,
        clock,
        group: plan.climb.cases[c.id]?.group ?? c.group,
      });
    } catch (error) {
      const why = error instanceof Error ? error.message : String(error);
      console.error(`${c.id} #${rep}: ${why}`);
      return {
        result: {
          id: c.id,
          hash: caseHash(c),
          split: c.split,
          kind: 0,
          ...(rep ? { rep } : {}),
          group: c.group,
          outcome: "error" as const,
          grades: [],
          error: why,
          unrecorded: null,
          ms: 0,
        },
        extra: null,
      };
    }
  });
  writeFileSync(
    new URL("results.jsonl", out),
    ran.map((r) => JSON.stringify(r.result)).join("\n") + "\n",
  );
  const extras = ran.flatMap((r) => (r.extra ? [r.extra] : []));
  writeFileSync(
    new URL("trials.jsonl", out),
    extras.map((e) => JSON.stringify(e)).join("\n") + "\n",
  );
  const dollars = extras.reduce((n, e) => n + e.usd, 0);
  writeLedger(climbsDir, climb, { round: id, label, split, trials: trials.length, usd: dollars });
  console.log(report(id));
  for (const r of ran)
    if (r.result.outcome !== "pass")
      console.log(
        `  ${r.result.outcome} ${r.result.id}#${r.result.rep ?? 0}: ${
          r.result.error ??
          r.result.grades
            .filter((g) => !g.pass)
            .map((g) => `${g.grader}: ${g.detail}`)
            .join("; ")
        }`,
      );
  return 0;
}

if (import.meta.main) process.exitCode = await main(process.argv.slice(2));
