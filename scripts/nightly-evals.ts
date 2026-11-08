// The night's recording (decision 0061): every eval case once against the
// live model, recording its cassettes; a case whose draw would fail CI's
// replay drawn again, up to twice; then CI's own replay, strict. It writes
// packages/evals/nightly.json, which the next night compares with, removes
// packages/evals/stale.md, and prints a summary to paste into the PR.
//
//   node scripts/nightly-evals.ts --env /Users/Vibdev/code/oriel/.env
//
// Run it in a fresh checkout of origin/main, never the main checkout or a
// builder's worktree. `--env` names the .env holding ANTHROPIC_API_KEY; only
// that key is read, as `pnpm evals --env` reads it. Exit 0 when the replay
// passes, 1 when it doesn't.
//
// The T3 scheduled task's prompt, which the hub pastes into schedule_task
// (daily, 02:30):
//
//   Record Oriel's eval cassettes on main. Work only in
//   /Users/Vibdev/.t3/worktrees/oriel/nightly-evals; never touch
//   /Users/Vibdev/code/oriel except to run its scripts/github.ts, and never
//   print, copy or link its .env.
//   1. If the directory is missing: `git -C /Users/Vibdev/code/oriel worktree
//      add --detach /Users/Vibdev/.t3/worktrees/oriel/nightly-evals`. Then in
//      it: `git fetch --no-prune origin main` (if it hangs, use the port-443
//      URL in rules2.md), `git checkout --detach origin/main`,
//      `git clean -fdx -e .evals`, `pnpm install --frozen-lockfile`.
//   2. `~/.claude-hub/bin/heavy node scripts/nightly-evals.ts --env
//      /Users/Vibdev/code/oriel/.env > /tmp/oriel-nightly.md`. If a POST fails
//      on a connect timeout, run it once more with
//      NODE_OPTIONS=--network-family-autoselection-attempt-timeout=3000.
//   3. If `git status --porcelain` lists nothing, stop and report "no change".
//      Otherwise `git switch -C evals-night`, `git add -A tests/cassettes
//      packages/evals`, and commit "test(evals): the night's recording,
//      <date>" with the attribution lines. Push with
//      `git push --force origin HEAD:evals-night`.
//   4. Open the PR from the main checkout: `node
//      /Users/Vibdev/code/oriel/scripts/github.ts pr-create evals-night
//      "test(evals): the night's recording, <date>" "<the summary file's
//      text>"`. If one is open already on evals-night, pr-edit it instead.
//   5. If the script exited 0 and the summary's "Newly failing" says none,
//      `pr-wait` it, then `pr-enqueue` it once CI passes. Otherwise leave it
//      for the hub, and say why in one line.
//   6. Report: the PR, the pass rates line, newly failing cases, spend.
import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { isJudged, type Split, splits } from "../packages/evals/src/case.ts";
import { type Command, defaults, type Io, main, repoIo } from "../packages/evals/src/cli.ts";
import { readResults } from "../packages/evals/src/compare.ts";
import { casesDir, nightlyFile, roundsDir, staleFile } from "../packages/evals/src/repo.ts";
import type { CaseResult } from "../packages/evals/src/runner.ts";

// Draws after the first, for a case whose draw would fail the replay.
const redraws = 2;

type Night = {
  date: string;
  commit: string;
  // Each split's first draws, which are the agent's real rate.
  firstDraw: Record<Split, { passed: number; of: number }>;
  // Every case's first draw, and its last if it was drawn again.
  cases: Record<
    string,
    { first: CaseResult["outcome"]; last: CaseResult["outcome"]; draws: number }
  >;
  usd: number;
  replay: "pass" | "fail";
};

// What CI's replay would fail on: an error, or a deterministic case failing
// any grader but the one its `failing` mark names, or passing past its mark.
// A judged case's verdict never fails it, so it is never drawn again.
function breaksReplay(r: CaseResult, failing: ReadonlyMap<string, string>): boolean {
  if (r.outcome === "error") return true;
  const marked = failing.get(r.id);
  if (marked !== undefined)
    return r.outcome === "pass" ? false : r.grades.some((g) => !g.pass && g.grader !== marked);
  return r.outcome === "fail" && !isJudged(r.kind);
}

// Each case's file name and `failing` grader, by its ID.
function caseFiles(): Map<string, { file: string; failing?: string }> {
  const found = new Map<string, { file: string; failing?: string }>();
  for (const file of readdirSync(casesDir).filter((name) => name.endsWith(".json"))) {
    const parsed = JSON.parse(readFileSync(new URL(file, casesDir), "utf8")) as {
      id: string;
      failing?: { grader: string };
    };
    found.set(parsed.id, {
      file,
      ...(parsed.failing ? { failing: parsed.failing.grader } : {}),
    });
  }
  return found;
}

// Runs one round into its own directory under `step` and reads it back.
async function round(
  command: Command,
  io: Partial<Io>,
  step: URL,
): Promise<{ code: number; results: CaseResult[]; usd: number }> {
  mkdirSync(step, { recursive: true });
  const code = await main(command, { ...repoIo, ...io, rounds: step });
  const [id] = readdirSync(step);
  if (id === undefined) return { code, results: [], usd: 0 };
  const dir = new URL(`${id}/`, step);
  const summary = JSON.parse(readFileSync(new URL("summary.json", dir), "utf8")) as {
    spend?: { usd: number };
  };
  return { code, results: readResults(dir), usd: summary.spend?.usd ?? 0 };
}

function lastNight(): Night | null {
  if (!existsSync(nightlyFile)) return null;
  return JSON.parse(readFileSync(nightlyFile, "utf8")) as Night;
}

const rate = ({ passed, of }: { passed: number; of: number }) =>
  `${passed}/${of}${of ? ` (${Math.round((100 * passed) / of)}%)` : ""}`;

function report(tonight: Night, before: Night | null, notes: readonly string[]): string {
  const lines = [
    `## The night's recording, ${tonight.date}`,
    "",
    `main at \`${tonight.commit.slice(0, 8)}\``,
    "",
  ];
  lines.push("| split | first draws tonight | last night |", "| --- | --- | --- |");
  for (const s of splits)
    lines.push(
      `| ${s} | ${rate(tonight.firstDraw[s])} | ${before ? rate(before.firstDraw[s]) : "none"} |`,
    );
  const ids = Object.keys(tonight.cases).sort();
  const newly = ids.filter(
    (id) => tonight.cases[id]?.first !== "pass" && before?.cases[id]?.first === "pass",
  );
  const redrawn = ids.filter((id) => (tonight.cases[id]?.draws ?? 1) > 1);
  const added = before ? ids.filter((id) => before.cases[id] === undefined) : [];
  lines.push(
    "",
    `**Newly failing:** ${newly.length ? newly.map((id) => `\`${id}\` (${tonight.cases[id]?.first})`).join(", ") : "none"}`,
  );
  lines.push(
    `**Drawn again:** ${redrawn.length ? redrawn.map((id) => `\`${id}\` ${tonight.cases[id]?.draws} draws, last ${tonight.cases[id]?.last}`).join("; ") : "none"}`,
  );
  if (added.length) lines.push(`**New cases:** ${added.map((id) => `\`${id}\``).join(", ")}`);
  lines.push(
    `**Replay:** ${tonight.replay === "pass" ? "passes" : "FAILS: a case failed every draw; the hub decides"}`,
  );
  lines.push(`**Spend:** $${tonight.usd.toFixed(2)}`);
  for (const note of notes) lines.push(`- ${note}`);
  return `${lines.join("\n")}\n`;
}

async function run(): Promise<number> {
  const { values } = parseArgs({ options: { env: { type: "string" } }, strict: true });
  if (!values.env) {
    console.error("usage: node scripts/nightly-evals.ts --env <path to the main checkout's .env>");
    return 1;
  }
  const before = lastNight();
  const files = caseFiles();
  const failing = new Map(
    [...files].flatMap(([id, f]) => (f.failing ? [[id, f.failing] as const] : [])),
  );
  mkdirSync(roundsDir, { recursive: true });
  const night = pathToFileURL(`${mkdtempSync(join(fileURLToPath(roundsDir), "nightly-"))}/`);
  const live: Command = {
    command: "live",
    model: defaults.model,
    judge: defaults.judge,
    baseline: null,
    env: values.env,
  };
  const notes: string[] = [];

  const first = await round(live, {}, new URL("first/", night));
  if (!first.results.length) {
    console.error("the live round ran no case");
    return 1;
  }
  const last = new Map(first.results.map((r) => [r.id, r]));
  const draws = new Map(first.results.map((r) => [r.id, 1]));
  let usd = first.usd;
  for (let n = 1; n <= redraws; n++) {
    const again = [...last.values()].filter((r) => breaksReplay(r, failing)).map((r) => r.id);
    if (!again.length) break;
    // Only those cases, from a directory of their own; goldens and
    // cassettes are the repo's.
    const only = mkdtempSync(join(tmpdir(), "oriel-nightly-cases-"));
    try {
      for (const id of again) {
        const file = files.get(id)?.file;
        if (file) copyFileSync(new URL(file, casesDir), join(only, file));
      }
      const drawn = await round(
        live,
        { cases: pathToFileURL(`${only}/`) },
        new URL(`again-${n}/`, night),
      );
      usd += drawn.usd;
      for (const r of drawn.results) {
        last.set(r.id, r);
        draws.set(r.id, (draws.get(r.id) ?? 1) + 1);
      }
    } finally {
      rmSync(only, { recursive: true, force: true });
    }
  }
  // Every cassette is current now.
  if (existsSync(staleFile)) {
    rmSync(staleFile);
    notes.push("packages/evals/stale.md is removed: every case is recorded again.");
  }
  const replay = await round(
    { command: "replay", model: defaults.model, judge: defaults.judge },
    { stale: undefined },
    new URL("replay/", night),
  );
  const firstDraw = Object.fromEntries(
    splits.map((s) => {
      const own = first.results.filter((r) => r.split === s);
      return [s, { passed: own.filter((r) => r.outcome === "pass").length, of: own.length }];
    }),
  ) as Night["firstDraw"];
  const tonight: Night = {
    date: new Date().toISOString().slice(0, 10),
    commit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
    firstDraw,
    cases: Object.fromEntries(
      first.results.map((r) => [
        r.id,
        {
          first: r.outcome,
          last: last.get(r.id)?.outcome ?? r.outcome,
          draws: draws.get(r.id) ?? 1,
        },
      ]),
    ),
    usd,
    replay: replay.code === 0 ? "pass" : "fail",
  };
  writeFileSync(nightlyFile, `${JSON.stringify(tonight, null, 2)}\n`);
  const text = report(tonight, before, notes);
  writeFileSync(new URL("summary.md", night), text);
  console.log(text);
  return replay.code;
}

if (import.meta.main) process.exitCode = await run();
